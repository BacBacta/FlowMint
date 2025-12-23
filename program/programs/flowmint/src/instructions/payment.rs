//! Payment Instruction
//!
//! Execute "pay any token -> USDC" payments.
//!
//! ## Flow
//!
//! 1. Validate payment parameters
//! 2. Execute Jupiter swap (input token -> USDC) via CPI
//! 3. Transfer exact USDC amount to merchant
//! 4. Handle any change (refund excess to payer)
//! 5. Record payment on-chain

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::FlowMintError;
use crate::jupiter::{
    JupiterRoute, execute_jupiter_swap, deserialize_route, verify_swap_output
};
use crate::state::{PaymentRecord, ProtocolConfig, UserStats};

/// USDC mint address on mainnet
pub const USDC_MINT_MAINNET: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/// USDC mint address on devnet
pub const USDC_MINT_DEVNET: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

/// Maximum memo length
pub const MAX_MEMO_LENGTH: usize = 64;

/// Accounts for the PayAnyToken instruction
#[derive(Accounts)]
pub struct PayAnyToken<'info> {
    /// The payer
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Protocol configuration
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    /// Payer's input token account (the token they're paying with)
    #[account(
        mut,
        constraint = payer_input_account.owner == payer.key() @ FlowMintError::InvalidOwner,
        constraint = payer_input_account.mint == input_mint.key() @ FlowMintError::InvalidMint
    )]
    pub payer_input_account: Account<'info, TokenAccount>,

    /// Payer's USDC account (for receiving change if any)
    #[account(
        mut,
        constraint = payer_usdc_account.owner == payer.key() @ FlowMintError::InvalidOwner,
        constraint = payer_usdc_account.mint == usdc_mint.key() @ FlowMintError::InvalidMint
    )]
    pub payer_usdc_account: Account<'info, TokenAccount>,

    /// Input token mint
    /// CHECK: Validated by token account constraints
    pub input_mint: AccountInfo<'info>,

    /// Merchant's USDC account (destination)
    #[account(
        mut,
        constraint = merchant_usdc_account.owner == merchant.key() @ FlowMintError::InvalidOwner,
        constraint = merchant_usdc_account.mint == usdc_mint.key() @ FlowMintError::InvalidMint
    )]
    pub merchant_usdc_account: Account<'info, TokenAccount>,

    /// Merchant pubkey
    /// CHECK: Just receiving payment
    pub merchant: AccountInfo<'info>,

    /// USDC mint
    /// CHECK: Validated by token account constraints
    pub usdc_mint: AccountInfo<'info>,

    /// Temporary PDA USDC account to receive swap output
    #[account(
        mut,
        seeds = [b"temp_usdc", payer.key().as_ref()],
        bump,
    )]
    pub temp_usdc_account: Account<'info, TokenAccount>,

    /// Payment record account (PDA)
    #[account(
        init,
        payer = payer,
        space = PaymentRecord::SIZE,
        seeds = [
            b"payment",
            payer.key().as_ref(),
            merchant.key().as_ref(),
            &Clock::get()?.unix_timestamp.to_le_bytes()
        ],
        bump
    )]
    pub payment_record: Account<'info, PaymentRecord>,

    /// Payer's stats account
    #[account(
        init_if_needed,
        payer = payer,
        space = UserStats::SIZE,
        seeds = [b"user_stats", payer.key().as_ref()],
        bump
    )]
    pub payer_stats: Account<'info, UserStats>,

    /// Jupiter program
    /// CHECK: Validated against known Jupiter program ID
    pub jupiter_program: AccountInfo<'info>,

    /// Token program
    pub token_program: Program<'info, Token>,

    /// System program
    pub system_program: Program<'info, System>,
}

/// Execute a payment by converting any token to USDC
///
/// # Flow
///
/// 1. Validate payment parameters
/// 2. Check payer has sufficient balance
/// 3. Execute Jupiter swap (input -> USDC) with ExactOut mode
/// 4. Transfer exact USDC amount to merchant
/// 5. Refund any excess USDC to payer
/// 6. Record payment on-chain
///
/// # Arguments
///
/// * `ctx` - PayAnyToken context
/// * `amount_in` - Maximum amount of input tokens to spend
/// * `exact_usdc_out` - Exact USDC amount merchant should receive
/// * `memo` - Optional payment reference
///
/// # Returns
///
/// * `Result<()>` - Success or error
pub fn pay_any_token_handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, PayAnyToken<'info>>,
    amount_in: u64,
    exact_usdc_out: u64,
    memo: Option<String>,
) -> Result<()> {
    let payer = &ctx.accounts.payer;
    let payer_input_account = &ctx.accounts.payer_input_account;
    let clock = Clock::get()?;

    // ============================================================
    // Step 1: Validate input
    // ============================================================
    require!(amount_in > 0, FlowMintError::AmountTooSmall);
    require!(exact_usdc_out > 0, FlowMintError::AmountTooSmall);

    // Check payer has sufficient balance
    require!(
        payer_input_account.amount >= amount_in,
        FlowMintError::InsufficientBalance
    );

    // ============================================================
    // Step 2: Handle direct USDC payment (no swap needed)
    // ============================================================
    let is_direct_usdc = ctx.accounts.input_mint.key() == ctx.accounts.usdc_mint.key();
    
    let actual_amount_in: u64;
    let actual_usdc_received: u64;

    if is_direct_usdc {
        // Direct USDC transfer - no swap needed
        actual_amount_in = exact_usdc_out;
        actual_usdc_received = exact_usdc_out;

        // Transfer USDC directly from payer to merchant
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.payer_input_account.to_account_info(),
                to: ctx.accounts.merchant_usdc_account.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, exact_usdc_out)?;
    } else {
        // ============================================================
        // Step 3: Deserialize and validate Jupiter route
        // ============================================================
        let remaining_accounts = &ctx.remaining_accounts;
        require!(!remaining_accounts.is_empty(), FlowMintError::InvalidInstructionData);

        let route_account = &remaining_accounts[0];
        let route_data = route_account.try_borrow_data()?;
        let route = deserialize_route(&route_data)?;

        // Validate route is for input -> USDC
        route.validate(
            &ctx.accounts.input_mint.key(),
            &ctx.accounts.usdc_mint.key(),
            amount_in,
            exact_usdc_out,
            ctx.accounts.config.default_slippage_bps, // Use protocol default for payments
        )?;

        // Check quote expiration
        require!(
            !route.is_expired(clock.unix_timestamp),
            FlowMintError::QuoteExpired
        );

        // ============================================================
        // Step 4: Execute Jupiter swap via CPI
        // ============================================================
        let temp_usdc_balance_before = ctx.accounts.temp_usdc_account.amount;

        let jupiter_accounts: Vec<AccountInfo<'info>> = remaining_accounts[1..].to_vec();
        execute_jupiter_swap(
            &ctx.accounts.jupiter_program,
            &jupiter_accounts,
            &route,
            None,
        )?;

        // Reload temp account to get updated balance
        ctx.accounts.temp_usdc_account.reload()?;
        let temp_usdc_balance_after = ctx.accounts.temp_usdc_account.amount;
        actual_usdc_received = temp_usdc_balance_after
            .checked_sub(temp_usdc_balance_before)
            .ok_or(FlowMintError::MathOverflow)?;

        // Verify we received at least the required USDC
        require!(
            actual_usdc_received >= exact_usdc_out,
            FlowMintError::InsufficientOutputAmount
        );

        // Get actual input amount used (for refund calculation)
        ctx.accounts.payer_input_account.reload()?;
        actual_amount_in = amount_in
            .checked_sub(ctx.accounts.payer_input_account.amount)
            .unwrap_or(amount_in);

        // ============================================================
        // Step 5: Transfer exact USDC amount to merchant
        // ============================================================
        let payer_key = payer.key();
        let seeds = &[
            b"temp_usdc".as_ref(),
            payer_key.as_ref(),
            &[ctx.bumps.temp_usdc_account],
        ];
        let signer_seeds = &[&seeds[..]];

        let transfer_to_merchant_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.temp_usdc_account.to_account_info(),
                to: ctx.accounts.merchant_usdc_account.to_account_info(),
                authority: ctx.accounts.temp_usdc_account.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_to_merchant_ctx, exact_usdc_out)?;

        // ============================================================
        // Step 6: Refund excess USDC to payer (if any)
        // ============================================================
        let excess_usdc = actual_usdc_received.saturating_sub(exact_usdc_out);
        if excess_usdc > 0 {
            let refund_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.temp_usdc_account.to_account_info(),
                    to: ctx.accounts.payer_usdc_account.to_account_info(),
                    authority: ctx.accounts.temp_usdc_account.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(refund_ctx, excess_usdc)?;
        }
    }

    // ============================================================
    // Step 7: Process memo and create payment record
    // ============================================================
    let mut memo_bytes = [0u8; MAX_MEMO_LENGTH];
    let memo_len = if let Some(ref m) = memo {
        let bytes = m.as_bytes();
        let len = bytes.len().min(MAX_MEMO_LENGTH);
        memo_bytes[..len].copy_from_slice(&bytes[..len]);
        len as u8
    } else {
        0
    };

    let record = &mut ctx.accounts.payment_record;
    record.payer = payer.key();
    record.merchant = ctx.accounts.merchant.key();
    record.input_mint = ctx.accounts.input_mint.key();
    record.amount_in = actual_amount_in;
    record.usdc_amount = exact_usdc_out;
    record.memo = memo_bytes;
    record.memo_len = memo_len;
    record.timestamp = clock.unix_timestamp;
    record.bump = ctx.bumps.payment_record;

    // ============================================================
    // Step 8: Update user stats
    // ============================================================
    let payer_stats = &mut ctx.accounts.payer_stats;
    if payer_stats.user == Pubkey::default() {
        payer_stats.user = payer.key();
        payer_stats.bump = ctx.bumps.payer_stats;
    }
    payer_stats.total_payments = payer_stats.total_payments.saturating_add(1);
    payer_stats.last_activity = clock.unix_timestamp;

    // ============================================================
    // Step 9: Emit event
    // ============================================================
    msg!(
        "Payment executed: {} {} -> {} USDC to {}",
        actual_amount_in,
        ctx.accounts.input_mint.key(),
        exact_usdc_out,
        ctx.accounts.merchant.key()
    );

    emit!(PaymentExecuted {
        payer: payer.key(),
        merchant: ctx.accounts.merchant.key(),
        input_mint: ctx.accounts.input_mint.key(),
        amount_in: actual_amount_in,
        usdc_amount: exact_usdc_out,
        timestamp: clock.unix_timestamp,
        payment_record: ctx.accounts.payment_record.key(),
    });

    Ok(())
}

/// Event emitted when a payment is executed
#[event]
pub struct PaymentExecuted {
    /// Payer pubkey
    pub payer: Pubkey,
    /// Merchant pubkey
    pub merchant: Pubkey,
    /// Input token mint
    pub input_mint: Pubkey,
    /// Amount of input tokens spent
    pub amount_in: u64,
    /// USDC amount paid to merchant
    pub usdc_amount: u64,
    /// Unix timestamp
    pub timestamp: i64,
    /// Payment record account
    pub payment_record: Pubkey,
}

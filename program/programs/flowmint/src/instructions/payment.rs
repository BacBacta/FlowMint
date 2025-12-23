//! Payment Instruction
//!
//! Execute "pay any token -> USDC" payments.

use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Transfer};

use crate::errors::FlowMintError;
use crate::state::{PaymentRecord, ProtocolConfig, UserStats};

/// USDC mint address on mainnet
pub const USDC_MINT_MAINNET: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/// USDC mint address on devnet (may differ)
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
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    /// Payer's input token account (the token they're paying with)
    #[account(
        mut,
        constraint = payer_input_account.owner == payer.key() @ FlowMintError::InvalidOwner
    )]
    pub payer_input_account: Account<'info, TokenAccount>,

    /// Input token mint
    /// CHECK: Validated by token account
    pub input_mint: AccountInfo<'info>,

    /// Merchant's USDC account (destination)
    #[account(mut)]
    pub merchant_usdc_account: Account<'info, TokenAccount>,

    /// Merchant pubkey
    /// CHECK: Just receiving payment
    pub merchant: AccountInfo<'info>,

    /// USDC mint
    /// CHECK: Validated in instruction
    pub usdc_mint: AccountInfo<'info>,

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

    /// Token program
    pub token_program: Program<'info, Token>,

    /// System program
    pub system_program: Program<'info, System>,
}

/// Execute a payment by converting any token to USDC
///
/// # Arguments
///
/// * `ctx` - PayAnyToken context
/// * `amount_in` - Amount of input tokens to spend
/// * `exact_usdc_out` - Exact USDC amount merchant should receive
/// * `memo` - Optional payment reference
///
/// # Returns
///
/// * `Result<()>` - Success or error
pub fn pay_any_token_handler(
    ctx: Context<PayAnyToken>,
    amount_in: u64,
    exact_usdc_out: u64,
    memo: Option<String>,
) -> Result<()> {
    let payer = &ctx.accounts.payer;
    let payer_input_account = &ctx.accounts.payer_input_account;
    let clock = Clock::get()?;

    // Validate input
    require!(amount_in > 0, FlowMintError::AmountTooSmall);
    require!(exact_usdc_out > 0, FlowMintError::AmountTooSmall);

    // Check payer has sufficient balance
    require!(
        payer_input_account.amount >= amount_in,
        FlowMintError::InsufficientBalance
    );

    // Validate merchant USDC account mint matches USDC
    require!(
        ctx.accounts.merchant_usdc_account.mint == ctx.accounts.usdc_mint.key(),
        FlowMintError::InvalidMint
    );

    // In a real implementation:
    // 1. Get Jupiter quote for input_token -> USDC with exactOut mode
    // 2. Execute the swap via CPI
    // 3. Transfer the USDC to merchant
    // 4. Handle any excess tokens

    // Process memo
    let mut memo_bytes = [0u8; MAX_MEMO_LENGTH];
    let memo_len = if let Some(ref m) = memo {
        let bytes = m.as_bytes();
        let len = bytes.len().min(MAX_MEMO_LENGTH);
        memo_bytes[..len].copy_from_slice(&bytes[..len]);
        len as u8
    } else {
        0
    };

    // Create payment record
    let record = &mut ctx.accounts.payment_record;
    record.payer = payer.key();
    record.merchant = ctx.accounts.merchant.key();
    record.input_mint = ctx.accounts.input_mint.key();
    record.amount_in = amount_in;
    record.usdc_amount = exact_usdc_out;
    record.memo = memo_bytes;
    record.memo_len = memo_len;
    record.timestamp = clock.unix_timestamp;
    record.bump = ctx.bumps.payment_record;

    // Update payer stats
    let stats = &mut ctx.accounts.payer_stats;
    if stats.user == Pubkey::default() {
        stats.user = payer.key();
        stats.bump = ctx.bumps.payer_stats;
    }
    stats.total_payments = stats.total_payments.checked_add(1).unwrap();
    stats.last_activity = clock.unix_timestamp;

    msg!(
        "Payment processed: {} {} -> {} USDC to {}",
        amount_in,
        ctx.accounts.input_mint.key(),
        exact_usdc_out,
        ctx.accounts.merchant.key()
    );

    // Emit event
    emit!(PaymentExecuted {
        payer: payer.key(),
        merchant: ctx.accounts.merchant.key(),
        input_mint: ctx.accounts.input_mint.key(),
        amount_in,
        usdc_amount: exact_usdc_out,
        timestamp: clock.unix_timestamp,
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
    /// USDC amount received by merchant
    pub usdc_amount: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

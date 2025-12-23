//! Swap Instruction
//!
//! Execute token swaps through Jupiter with slippage protection.
//! 
//! ## Flow
//! 
//! 1. Validate swap parameters against protocol config
//! 2. Deserialize Jupiter route from remaining accounts
//! 3. Validate route matches expected parameters
//! 4. Execute CPI to Jupiter swap program
//! 5. Verify output amount meets minimum requirements
//! 6. Record receipt on-chain

use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::errors::FlowMintError;
use crate::jupiter::{
    JupiterRoute, execute_jupiter_swap, deserialize_route, verify_swap_output
};
use crate::state::{ProtocolConfig, SwapReceipt, UserStats};

/// Accounts for the ExecuteSwap instruction
#[derive(Accounts)]
pub struct ExecuteSwap<'info> {
    /// The user executing the swap
    #[account(mut)]
    pub user: Signer<'info>,

    /// Protocol configuration
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    /// User's input token account
    #[account(
        mut,
        constraint = user_input_account.owner == user.key() @ FlowMintError::InvalidOwner,
        constraint = user_input_account.mint == input_mint.key() @ FlowMintError::InvalidMint
    )]
    pub user_input_account: Account<'info, TokenAccount>,

    /// User's output token account
    #[account(
        mut,
        constraint = user_output_account.owner == user.key() @ FlowMintError::InvalidOwner,
        constraint = user_output_account.mint == output_mint.key() @ FlowMintError::InvalidMint
    )]
    pub user_output_account: Account<'info, TokenAccount>,

    /// Input token mint
    /// CHECK: Validated by token account constraints
    pub input_mint: AccountInfo<'info>,

    /// Output token mint
    /// CHECK: Validated by token account constraints
    pub output_mint: AccountInfo<'info>,

    /// Swap receipt account (PDA)
    #[account(
        init,
        payer = user,
        space = SwapReceipt::SIZE,
        seeds = [
            b"receipt",
            user.key().as_ref(),
            &Clock::get()?.unix_timestamp.to_le_bytes()
        ],
        bump
    )]
    pub receipt: Account<'info, SwapReceipt>,

    /// User stats account (PDA)
    #[account(
        init_if_needed,
        payer = user,
        space = UserStats::SIZE,
        seeds = [b"user_stats", user.key().as_ref()],
        bump
    )]
    pub user_stats: Account<'info, UserStats>,

    /// Jupiter program
    /// CHECK: Validated against known Jupiter program ID
    pub jupiter_program: AccountInfo<'info>,

    /// Token program
    pub token_program: Program<'info, Token>,

    /// System program
    pub system_program: Program<'info, System>,
}

/// Execute a token swap through Jupiter
///
/// # Flow
/// 
/// 1. Validate slippage against protocol configuration
/// 2. Check user has sufficient balance
/// 3. Deserialize and validate Jupiter route from remaining accounts
/// 4. Execute Jupiter CPI swap
/// 5. Verify output meets minimum requirements
/// 6. Record swap receipt
/// 7. Update user stats and protocol stats
///
/// # Arguments
///
/// * `ctx` - ExecuteSwap context with all required accounts
/// * `amount_in` - Amount of input tokens to swap
/// * `minimum_amount_out` - Minimum acceptable output amount
/// * `slippage_bps` - Slippage tolerance in basis points
/// * `protected_mode` - Use protected mode with stricter limits
///
/// # Returns
///
/// * `Result<()>` - Success or error
pub fn execute_swap_handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, ExecuteSwap<'info>>,
    amount_in: u64,
    minimum_amount_out: u64,
    slippage_bps: u16,
    protected_mode: bool,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let user = &ctx.accounts.user;
    let user_input_account = &ctx.accounts.user_input_account;
    let user_output_account = &ctx.accounts.user_output_account;
    let clock = Clock::get()?;

    // ============================================================
    // Step 1: Validate slippage against configuration
    // ============================================================
    let effective_protected_mode = protected_mode || config.protected_mode_enabled;
    require!(
        config.validate_slippage(slippage_bps, effective_protected_mode),
        FlowMintError::SlippageExceeded
    );

    // ============================================================
    // Step 2: Check user has sufficient balance
    // ============================================================
    require!(
        user_input_account.amount >= amount_in,
        FlowMintError::InsufficientBalance
    );

    // Validate minimum amounts
    require!(amount_in > 0, FlowMintError::AmountTooSmall);
    require!(minimum_amount_out > 0, FlowMintError::AmountTooSmall);

    // ============================================================
    // Step 3: Deserialize and validate Jupiter route
    // ============================================================
    let remaining_accounts = &ctx.remaining_accounts;
    require!(!remaining_accounts.is_empty(), FlowMintError::InvalidInstructionData);

    // First remaining account contains the route data
    let route_account = &remaining_accounts[0];
    let route_data = route_account.try_borrow_data()?;
    
    let route = deserialize_route(&route_data)?;

    // Validate route matches expected parameters
    route.validate(
        &ctx.accounts.input_mint.key(),
        &ctx.accounts.output_mint.key(),
        amount_in,
        minimum_amount_out,
        slippage_bps,
    )?;

    // Check quote expiration
    require!(
        !route.is_expired(clock.unix_timestamp),
        FlowMintError::QuoteExpired
    );

    // Validate price impact if in protected mode
    if effective_protected_mode {
        let price_impact_bps = calculate_price_impact(&route);
        require!(
            price_impact_bps <= config.max_price_impact_bps,
            FlowMintError::PriceImpactTooHigh
        );
    }

    // ============================================================
    // Step 4: Record output balance before swap
    // ============================================================
    let output_balance_before = user_output_account.amount;

    // ============================================================
    // Step 5: Execute Jupiter CPI swap
    // ============================================================
    let jupiter_accounts: Vec<AccountInfo<'info>> = remaining_accounts[1..].to_vec();

    let _actual_output = execute_jupiter_swap(
        &ctx.accounts.jupiter_program,
        &jupiter_accounts,
        &route,
        None, // User signs directly, no PDA signer needed
    )?;

    // ============================================================
    // Step 6: Verify output meets minimum requirements
    // ============================================================
    ctx.accounts.user_output_account.reload()?;
    let output_balance_after = ctx.accounts.user_output_account.amount;
    let actual_amount_out = output_balance_after
        .checked_sub(output_balance_before)
        .ok_or(FlowMintError::MathOverflow)?;

    verify_swap_output(
        actual_amount_out,
        minimum_amount_out,
        slippage_bps,
        route.out_amount,
    )?;

    // ============================================================
    // Step 7: Record swap receipt
    // ============================================================
    let receipt = &mut ctx.accounts.receipt;
    receipt.user = user.key();
    receipt.input_mint = ctx.accounts.input_mint.key();
    receipt.output_mint = ctx.accounts.output_mint.key();
    receipt.amount_in = amount_in;
    receipt.amount_out = actual_amount_out;
    receipt.slippage_bps = slippage_bps;
    receipt.protected_mode = effective_protected_mode;
    receipt.timestamp = clock.unix_timestamp;
    receipt.tx_signature = [0u8; 32];
    receipt.bump = ctx.bumps.receipt;

    // ============================================================
    // Step 8: Update user stats
    // ============================================================
    let user_stats = &mut ctx.accounts.user_stats;
    if user_stats.user == Pubkey::default() {
        user_stats.user = user.key();
        user_stats.bump = ctx.bumps.user_stats;
    }
    user_stats.total_swaps = user_stats.total_swaps.saturating_add(1);
    user_stats.last_activity = clock.unix_timestamp;

    // ============================================================
    // Step 9: Update protocol stats
    // ============================================================
    config.total_swaps = config.total_swaps.saturating_add(1);

    // ============================================================
    // Step 10: Emit event for off-chain indexing
    // ============================================================
    msg!(
        "Swap executed: {} {} -> {} {} (slippage: {} bps, protected: {})",
        amount_in,
        ctx.accounts.input_mint.key(),
        actual_amount_out,
        ctx.accounts.output_mint.key(),
        slippage_bps,
        effective_protected_mode
    );

    emit!(SwapExecuted {
        user: user.key(),
        input_mint: ctx.accounts.input_mint.key(),
        output_mint: ctx.accounts.output_mint.key(),
        amount_in,
        amount_out: actual_amount_out,
        slippage_bps,
        protected_mode: effective_protected_mode,
        timestamp: clock.unix_timestamp,
        receipt: ctx.accounts.receipt.key(),
    });

    Ok(())
}

/// Calculate price impact from route
fn calculate_price_impact(route: &JupiterRoute) -> u16 {
    if route.in_amount == 0 || route.out_amount == 0 {
        return 0;
    }

    let total_fee: u64 = route.route_steps.iter().map(|s| s.fee_amount).sum();
    let impact_bps = if route.in_amount > 0 {
        (total_fee * 10000 / route.in_amount) as u16
    } else {
        0
    };

    impact_bps
}

/// Event emitted when a swap is executed
#[event]
pub struct SwapExecuted {
    /// User who executed the swap
    pub user: Pubkey,
    /// Input token mint
    pub input_mint: Pubkey,
    /// Output token mint
    pub output_mint: Pubkey,
    /// Amount of input tokens
    pub amount_in: u64,
    /// Amount of output tokens received
    pub amount_out: u64,
    /// Slippage tolerance used
    pub slippage_bps: u16,
    /// Whether protected mode was active
    pub protected_mode: bool,
    /// Unix timestamp
    pub timestamp: i64,
    /// Receipt account address
    pub receipt: Pubkey,
}

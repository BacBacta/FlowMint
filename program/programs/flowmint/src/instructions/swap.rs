//! Swap Instruction
//!
//! Execute token swaps through Jupiter with slippage protection.

use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::errors::FlowMintError;
use crate::state::{ProtocolConfig, SwapReceipt, UserStats};

/// Accounts for the ExecuteSwap instruction
#[derive(Accounts)]
pub struct ExecuteSwap<'info> {
    /// The user executing the swap
    #[account(mut)]
    pub user: Signer<'info>,

    /// Protocol configuration
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    /// User's input token account
    #[account(
        mut,
        constraint = user_input_account.owner == user.key() @ FlowMintError::InvalidOwner
    )]
    pub user_input_account: Account<'info, TokenAccount>,

    /// User's output token account
    #[account(
        mut,
        constraint = user_output_account.owner == user.key() @ FlowMintError::InvalidOwner
    )]
    pub user_output_account: Account<'info, TokenAccount>,

    /// Input token mint
    /// CHECK: Validated by token account
    pub input_mint: AccountInfo<'info>,

    /// Output token mint
    /// CHECK: Validated by token account
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

    /// Token program
    pub token_program: Program<'info, Token>,

    /// System program
    pub system_program: Program<'info, System>,
}

/// Execute a token swap
///
/// This instruction validates swap parameters and would normally
/// execute a CPI to Jupiter. For now, it validates and records the intent.
///
/// # Arguments
///
/// * `ctx` - ExecuteSwap context
/// * `amount_in` - Input amount
/// * `minimum_amount_out` - Minimum expected output
/// * `slippage_bps` - Slippage tolerance
/// * `protected_mode` - Use protected mode?
///
/// # Returns
///
/// * `Result<()>` - Success or error
pub fn execute_swap_handler(
    ctx: Context<ExecuteSwap>,
    amount_in: u64,
    minimum_amount_out: u64,
    slippage_bps: u16,
    protected_mode: bool,
) -> Result<()> {
    let config = &ctx.accounts.config;
    let user = &ctx.accounts.user;
    let user_input_account = &ctx.accounts.user_input_account;
    let clock = Clock::get()?;

    // Validate slippage against configuration
    require!(
        config.validate_slippage(slippage_bps, protected_mode),
        FlowMintError::SlippageExceeded
    );

    // Check user has sufficient balance
    require!(
        user_input_account.amount >= amount_in,
        FlowMintError::InsufficientBalance
    );

    // Validate minimum amounts
    require!(amount_in > 0, FlowMintError::AmountTooSmall);
    require!(minimum_amount_out > 0, FlowMintError::AmountTooSmall);

    // In a real implementation, we would:
    // 1. Deserialize the Jupiter route from remaining accounts
    // 2. Validate the route matches our parameters
    // 3. Execute CPI to Jupiter's swap program
    // 4. Verify the output amount meets minimum_amount_out

    // For now, we record the swap intent and emit an event
    // The actual swap would be executed via CPI to Jupiter

    // Create receipt
    let receipt = &mut ctx.accounts.receipt;
    receipt.user = user.key();
    receipt.input_mint = ctx.accounts.input_mint.key();
    receipt.output_mint = ctx.accounts.output_mint.key();
    receipt.amount_in = amount_in;
    receipt.amount_out = minimum_amount_out; // Would be actual output in real impl
    receipt.slippage_bps = slippage_bps;
    receipt.protected_mode = protected_mode || config.protected_mode_enabled;
    receipt.timestamp = clock.unix_timestamp;
    receipt.tx_signature = [0u8; 32]; // Would be filled after TX confirmation
    receipt.bump = ctx.bumps.receipt;

    // Update user stats
    let user_stats = &mut ctx.accounts.user_stats;
    if user_stats.user == Pubkey::default() {
        user_stats.user = user.key();
        user_stats.bump = ctx.bumps.user_stats;
    }
    user_stats.total_swaps = user_stats.total_swaps.checked_add(1).unwrap();
    user_stats.last_activity = clock.unix_timestamp;

    msg!(
        "Swap initiated: {} -> {} ({} units, {} bps slippage)",
        ctx.accounts.input_mint.key(),
        ctx.accounts.output_mint.key(),
        amount_in,
        slippage_bps
    );

    // Emit event for off-chain indexing
    emit!(SwapExecuted {
        user: user.key(),
        input_mint: ctx.accounts.input_mint.key(),
        output_mint: ctx.accounts.output_mint.key(),
        amount_in,
        amount_out: minimum_amount_out,
        slippage_bps,
        protected_mode: receipt.protected_mode,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
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
    /// Amount of output tokens
    pub amount_out: u64,
    /// Slippage tolerance used
    pub slippage_bps: u16,
    /// Whether protected mode was active
    pub protected_mode: bool,
    /// Unix timestamp
    pub timestamp: i64,
}

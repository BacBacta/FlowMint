//! Initialize Instruction
//!
//! Initializes the FlowMint protocol configuration.

use anchor_lang::prelude::*;

use crate::errors::FlowMintError;
use crate::state::ProtocolConfig;

/// Maximum allowed slippage in basis points (50%)
pub const MAX_SLIPPAGE_BPS: u16 = 5000;

/// Accounts for the Initialize instruction
#[derive(Accounts)]
pub struct Initialize<'info> {
    /// The authority that will manage the protocol
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The protocol configuration account (PDA)
    #[account(
        init,
        payer = authority,
        space = ProtocolConfig::SIZE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    /// Treasury account to receive protocol fees
    /// CHECK: This is just a destination address
    pub treasury: AccountInfo<'info>,

    /// System program
    pub system_program: Program<'info, System>,
}

/// Initialize the FlowMint protocol
///
/// # Arguments
///
/// * `ctx` - Initialize context
/// * `default_slippage_bps` - Default maximum slippage
/// * `protected_slippage_bps` - Protected mode slippage
/// * `max_price_impact_bps` - Maximum price impact
///
/// # Returns
///
/// * `Result<()>` - Success or error
pub fn handler(
    ctx: Context<Initialize>,
    default_slippage_bps: u16,
    protected_slippage_bps: u16,
    max_price_impact_bps: u16,
) -> Result<()> {
    // Validate parameters
    require!(
        default_slippage_bps <= MAX_SLIPPAGE_BPS,
        FlowMintError::InvalidConfiguration
    );
    require!(
        protected_slippage_bps <= default_slippage_bps,
        FlowMintError::InvalidConfiguration
    );
    require!(
        max_price_impact_bps <= MAX_SLIPPAGE_BPS,
        FlowMintError::InvalidConfiguration
    );

    let config = &mut ctx.accounts.config;

    config.authority = ctx.accounts.authority.key();
    config.default_slippage_bps = default_slippage_bps;
    config.protected_slippage_bps = protected_slippage_bps;
    config.max_price_impact_bps = max_price_impact_bps;
    config.protected_mode_enabled = false;
    config.protocol_fee_bps = 0; // No protocol fee by default
    config.treasury = ctx.accounts.treasury.key();
    config.total_swaps = 0;
    config.total_volume_usd = 0;
    config.bump = ctx.bumps.config;
    config._reserved = [0u8; 64];

    msg!(
        "FlowMint initialized with default_slippage={} bps, protected_slippage={} bps",
        default_slippage_bps,
        protected_slippage_bps
    );

    Ok(())
}

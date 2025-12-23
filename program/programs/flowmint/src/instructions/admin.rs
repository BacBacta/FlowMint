//! Admin Instructions
//!
//! Administrative functions for protocol management.

use anchor_lang::prelude::*;

use crate::errors::FlowMintError;
use crate::state::ProtocolConfig;

/// Maximum allowed slippage in basis points
pub const MAX_SLIPPAGE_BPS: u16 = 5000;

/// Accounts for admin configuration updates
#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    /// The protocol authority
    #[account(
        constraint = authority.key() == config.authority @ FlowMintError::Unauthorized
    )]
    pub authority: Signer<'info>,

    /// Protocol configuration
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,
}

/// Update protocol configuration
///
/// # Arguments
///
/// * `ctx` - UpdateConfig context
/// * `new_default_slippage_bps` - New default slippage (optional)
/// * `new_protected_slippage_bps` - New protected slippage (optional)
/// * `new_max_price_impact_bps` - New max price impact (optional)
///
/// # Returns
///
/// * `Result<()>` - Success or error
pub fn update_config_handler(
    ctx: Context<UpdateConfig>,
    new_default_slippage_bps: Option<u16>,
    new_protected_slippage_bps: Option<u16>,
    new_max_price_impact_bps: Option<u16>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    // Update default slippage if provided
    if let Some(slippage) = new_default_slippage_bps {
        require!(slippage <= MAX_SLIPPAGE_BPS, FlowMintError::InvalidConfiguration);
        config.default_slippage_bps = slippage;
        msg!("Updated default_slippage_bps to {}", slippage);
    }

    // Update protected slippage if provided
    if let Some(slippage) = new_protected_slippage_bps {
        require!(slippage <= MAX_SLIPPAGE_BPS, FlowMintError::InvalidConfiguration);
        require!(
            slippage <= config.default_slippage_bps,
            FlowMintError::InvalidConfiguration
        );
        config.protected_slippage_bps = slippage;
        msg!("Updated protected_slippage_bps to {}", slippage);
    }

    // Update max price impact if provided
    if let Some(impact) = new_max_price_impact_bps {
        require!(impact <= MAX_SLIPPAGE_BPS, FlowMintError::InvalidConfiguration);
        config.max_price_impact_bps = impact;
        msg!("Updated max_price_impact_bps to {}", impact);
    }

    emit!(ConfigUpdated {
        authority: ctx.accounts.authority.key(),
        default_slippage_bps: config.default_slippage_bps,
        protected_slippage_bps: config.protected_slippage_bps,
        max_price_impact_bps: config.max_price_impact_bps,
    });

    Ok(())
}

/// Toggle protected mode globally
///
/// # Arguments
///
/// * `ctx` - UpdateConfig context
/// * `enabled` - Whether to enable protected mode
///
/// # Returns
///
/// * `Result<()>` - Success or error
pub fn toggle_protected_mode_handler(ctx: Context<UpdateConfig>, enabled: bool) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.protected_mode_enabled = enabled;

    msg!("Protected mode {}", if enabled { "enabled" } else { "disabled" });

    emit!(ProtectedModeToggled {
        authority: ctx.accounts.authority.key(),
        enabled,
    });

    Ok(())
}

/// Event emitted when configuration is updated
#[event]
pub struct ConfigUpdated {
    /// Authority that made the change
    pub authority: Pubkey,
    /// New default slippage
    pub default_slippage_bps: u16,
    /// New protected slippage
    pub protected_slippage_bps: u16,
    /// New max price impact
    pub max_price_impact_bps: u16,
}

/// Event emitted when protected mode is toggled
#[event]
pub struct ProtectedModeToggled {
    /// Authority that made the change
    pub authority: Pubkey,
    /// New protected mode state
    pub enabled: bool,
}

//! Admin Instructions
//!
//! Administrative functions for protocol management.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

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
    new_protocol_fee_bps: Option<u16>,
    new_treasury: Option<Pubkey>,
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

    // Update protocol fee bps if provided
    if let Some(fee_bps) = new_protocol_fee_bps {
        require!(fee_bps <= 10_000, FlowMintError::InvalidConfiguration);
        config.protocol_fee_bps = fee_bps;
        msg!("Updated protocol_fee_bps to {}", fee_bps);
    }

    // Update treasury if provided
    if let Some(treasury) = new_treasury {
        config.treasury = treasury;
        msg!("Updated treasury to {}", treasury);
    }

    emit!(ConfigUpdated {
        authority: ctx.accounts.authority.key(),
        default_slippage_bps: config.default_slippage_bps,
        protected_slippage_bps: config.protected_slippage_bps,
        max_price_impact_bps: config.max_price_impact_bps,
    });

    Ok(())
}

/// Accounts for withdrawing protocol fees from the USDC FeeVault
#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    /// The protocol authority
    #[account(
        constraint = authority.key() == config.authority @ FlowMintError::Unauthorized
    )]
    pub authority: Signer<'info>,

    /// Protocol configuration PDA (also token authority for FeeVault)
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    /// USDC mint (must match vault + destination)
    /// CHECK: Validated by token account constraints
    pub usdc_mint: AccountInfo<'info>,

    /// Protocol FeeVault token account (USDC)
    #[account(
        mut,
        constraint = fee_vault_usdc_account.mint == usdc_mint.key() @ FlowMintError::InvalidMint,
        constraint = fee_vault_usdc_account.owner == config.key() @ FlowMintError::InvalidOwner,
        seeds = [b"fee_vault", usdc_mint.key().as_ref()],
        bump,
    )]
    pub fee_vault_usdc_account: Account<'info, TokenAccount>,

    /// Treasury USDC token account (owned by config.treasury)
    #[account(
        mut,
        constraint = treasury_usdc_account.mint == usdc_mint.key() @ FlowMintError::InvalidMint,
        constraint = treasury_usdc_account.owner == config.treasury @ FlowMintError::InvalidOwner,
    )]
    pub treasury_usdc_account: Account<'info, TokenAccount>,

    /// Token program
    pub token_program: Program<'info, Token>,
}

/// Withdraw all accumulated USDC fees to the treasury
pub fn withdraw_fees_handler(ctx: Context<WithdrawFees>) -> Result<()> {
    let amount = ctx.accounts.fee_vault_usdc_account.amount;
    if amount == 0 {
        return Ok(());
    }

    let config_seeds = &[b"config".as_ref(), &[ctx.accounts.config.bump]];
    let signer_seeds = &[&config_seeds[..]];

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.fee_vault_usdc_account.to_account_info(),
            to: ctx.accounts.treasury_usdc_account.to_account_info(),
            authority: ctx.accounts.config.to_account_info(),
        },
        signer_seeds,
    );

    token::transfer(cpi_ctx, amount)?;

    msg!("Withdrew {} USDC fees to treasury", amount);
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

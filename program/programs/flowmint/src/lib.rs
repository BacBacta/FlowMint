//! # FlowMint Program
//!
//! A reliable, safe, and multi-use execution layer over Jupiter on Solana.
//!
//! ## Features
//!
//! - **Swap Execution**: Execute token swaps via Jupiter routes with slippage protection
//! - **Pay Any Token**: Convert any token to USDC for payments
//! - **Protected Mode**: On-chain slippage validation and safety checks
//!
//! ## Architecture
//!
//! The program acts as a router that validates swap parameters and executes
//! cross-program invocations (CPI) to Jupiter's swap program.

use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Transfer};

pub mod errors;
pub mod instructions;
pub mod jupiter;
pub mod state;

use errors::FlowMintError;
use instructions::*;

declare_id!("D6ABGCinQcXfg5N4toSEWDo3iDPwYMZ22HvURR1Fb1hf");

/// The main FlowMint program module
#[program]
pub mod flowmint {
    use super::*;

    /// Initialize the FlowMint protocol configuration
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context containing all accounts
    /// * `default_slippage_bps` - Default maximum slippage in basis points
    /// * `protected_slippage_bps` - Protected mode maximum slippage in basis points
    /// * `max_price_impact_bps` - Maximum allowed price impact in basis points
    ///
    /// # Errors
    ///
    /// Returns an error if slippage values are invalid
    pub fn initialize(
        ctx: Context<Initialize>,
        default_slippage_bps: u16,
        protected_slippage_bps: u16,
        max_price_impact_bps: u16,
    ) -> Result<()> {
        instructions::initialize::handler(
            ctx,
            default_slippage_bps,
            protected_slippage_bps,
            max_price_impact_bps,
        )
    }

    /// Execute a token swap through Jupiter
    ///
    /// This instruction validates the swap parameters against the protocol
    /// configuration and executes the swap via CPI.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context containing all accounts
    /// * `amount_in` - The amount of input tokens to swap
    /// * `minimum_amount_out` - The minimum acceptable output amount
    /// * `slippage_bps` - The slippage tolerance in basis points
    /// * `protected_mode` - Whether to use protected mode (stricter limits)
    ///
    /// # Errors
    ///
    /// - `SlippageExceeded` if the slippage tolerance exceeds the allowed maximum
    /// - `PriceImpactTooHigh` if the estimated price impact is too high
    /// - `InsufficientBalance` if the user doesn't have enough tokens
    pub fn execute_swap<'info>(
        ctx: Context<'_, '_, 'info, 'info, ExecuteSwap<'info>>,
        amount_in: u64,
        minimum_amount_out: u64,
        slippage_bps: u16,
        protected_mode: bool,
    ) -> Result<()> {
        instructions::swap::execute_swap_handler(
            ctx,
            amount_in,
            minimum_amount_out,
            slippage_bps,
            protected_mode,
        )
    }

    /// Execute a payment by converting any token to USDC
    ///
    /// This instruction allows users to pay with any supported token,
    /// which gets converted to USDC and sent to the merchant.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context containing all accounts
    /// * `amount_in` - The amount of input tokens
    /// * `exact_usdc_out` - The exact USDC amount the merchant should receive
    /// * `memo` - Optional payment memo/reference
    ///
    /// # Errors
    ///
    /// - `PaymentFailed` if the swap or transfer fails
    /// - `InsufficientBalance` if the payer doesn't have enough tokens
    pub fn pay_any_token<'info>(
        ctx: Context<'_, '_, 'info, 'info, PayAnyToken<'info>>,
        amount_in: u64,
        exact_usdc_out: u64,
        memo: Option<String>,
    ) -> Result<()> {
        instructions::payment::pay_any_token_handler(ctx, amount_in, exact_usdc_out, memo)
    }

    /// Update protocol configuration (admin only)
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context containing all accounts
    /// * `new_default_slippage_bps` - New default slippage, if updating
    /// * `new_protected_slippage_bps` - New protected slippage, if updating
    /// * `new_max_price_impact_bps` - New max price impact, if updating
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        new_default_slippage_bps: Option<u16>,
        new_protected_slippage_bps: Option<u16>,
        new_max_price_impact_bps: Option<u16>,
    ) -> Result<()> {
        instructions::admin::update_config_handler(
            ctx,
            new_default_slippage_bps,
            new_protected_slippage_bps,
            new_max_price_impact_bps,
        )
    }

    /// Toggle protected mode for the protocol
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context containing all accounts
    /// * `enabled` - Whether protected mode should be enabled globally
    pub fn toggle_protected_mode(ctx: Context<UpdateConfig>, enabled: bool) -> Result<()> {
        instructions::admin::toggle_protected_mode_handler(ctx, enabled)
    }
}

//! FlowMint Error Definitions
//!
//! Custom error codes for the FlowMint program.

use anchor_lang::prelude::*;

/// Custom error codes for the FlowMint program
#[error_code]
pub enum FlowMintError {
    /// Slippage tolerance exceeds the maximum allowed
    #[msg("Slippage tolerance exceeds maximum allowed")]
    SlippageExceeded,

    /// Price impact is too high for safe execution
    #[msg("Price impact exceeds maximum threshold")]
    PriceImpactTooHigh,

    /// User has insufficient token balance
    #[msg("Insufficient token balance for this operation")]
    InsufficientBalance,

    /// The token is not in the allowed whitelist
    #[msg("Token is not in the allowed whitelist")]
    TokenNotWhitelisted,

    /// The token is in the deny list
    #[msg("Token is blacklisted and cannot be traded")]
    TokenBlacklisted,

    /// The swap output was less than the minimum required
    #[msg("Swap output is less than minimum required")]
    InsufficientOutputAmount,

    /// The payment operation failed
    #[msg("Payment operation failed")]
    PaymentFailed,

    /// The quote has expired
    #[msg("Quote has expired, please request a new quote")]
    QuoteExpired,

    /// Invalid configuration parameters
    #[msg("Invalid configuration parameters")]
    InvalidConfiguration,

    /// Unauthorized access to admin function
    #[msg("Unauthorized: admin access required")]
    Unauthorized,

    /// Protected mode is enforced and conditions not met
    #[msg("Protected mode is active and conditions not met")]
    ProtectedModeViolation,

    /// Invalid token mint address
    #[msg("Invalid token mint address")]
    InvalidMint,

    /// Swap amount is too small
    #[msg("Swap amount is below minimum threshold")]
    AmountTooSmall,

    /// Swap amount exceeds liquidity limits
    #[msg("Swap amount exceeds liquidity limits")]
    AmountTooLarge,

    /// Arithmetic overflow occurred
    #[msg("Arithmetic overflow occurred")]
    MathOverflow,

    /// Invalid account owner
    #[msg("Invalid account owner")]
    InvalidOwner,

    /// The instruction data is malformed
    #[msg("Invalid instruction data")]
    InvalidInstructionData,

    /// Jupiter CPI call failed
    #[msg("Jupiter swap execution failed")]
    JupiterSwapFailed,
}

//! FlowMint State Definitions
//!
//! On-chain account structures for storing protocol state.

use anchor_lang::prelude::*;

/// Protocol configuration account
///
/// Stores global settings for the FlowMint protocol including
/// slippage limits and protection parameters.
#[account]
#[derive(Default)]
pub struct ProtocolConfig {
    /// The authority that can update the configuration
    pub authority: Pubkey,

    /// Default maximum slippage in basis points (100 = 1%)
    pub default_slippage_bps: u16,

    /// Protected mode maximum slippage in basis points
    pub protected_slippage_bps: u16,

    /// Maximum allowed price impact in basis points
    pub max_price_impact_bps: u16,

    /// Whether protected mode is globally enforced
    pub protected_mode_enabled: bool,

    /// Protocol fee in basis points (paid to protocol treasury)
    pub protocol_fee_bps: u16,

    /// Treasury account to receive protocol fees
    pub treasury: Pubkey,

    /// Total number of swaps executed
    pub total_swaps: u64,

    /// Total volume in USD (scaled by 1e6)
    pub total_volume_usd: u64,

    /// Bump seed for PDA derivation
    pub bump: u8,

    /// Reserved space for future upgrades
    pub _reserved: [u8; 64],
}

impl ProtocolConfig {
    /// Size of the account in bytes
    pub const SIZE: usize = 8 + // discriminator
        32 + // authority
        2 +  // default_slippage_bps
        2 +  // protected_slippage_bps
        2 +  // max_price_impact_bps
        1 +  // protected_mode_enabled
        2 +  // protocol_fee_bps
        32 + // treasury
        8 +  // total_swaps
        8 +  // total_volume_usd
        1 +  // bump
        64;  // reserved

    /// Validate slippage against configuration
    pub fn validate_slippage(&self, slippage_bps: u16, protected_mode: bool) -> bool {
        if protected_mode || self.protected_mode_enabled {
            slippage_bps <= self.protected_slippage_bps
        } else {
            slippage_bps <= self.default_slippage_bps
        }
    }
}

/// Swap receipt account
///
/// Stores information about a completed swap for tracking and auditing.
#[account]
pub struct SwapReceipt {
    /// The user who initiated the swap
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

    /// Unix timestamp of the swap
    pub timestamp: i64,

    /// Transaction signature (first 32 bytes)
    pub tx_signature: [u8; 32],

    /// Bump seed for PDA derivation
    pub bump: u8,
}

impl SwapReceipt {
    /// Size of the account in bytes
    pub const SIZE: usize = 8 + // discriminator
        32 + // user
        32 + // input_mint
        32 + // output_mint
        8 +  // amount_in
        8 +  // amount_out
        2 +  // slippage_bps
        1 +  // protected_mode
        8 +  // timestamp
        32 + // tx_signature
        1;   // bump
}

/// Payment record account
///
/// Stores information about a completed payment.
#[account]
pub struct PaymentRecord {
    /// The payer
    pub payer: Pubkey,

    /// The merchant/recipient
    pub merchant: Pubkey,

    /// Input token mint (what the payer paid with)
    pub input_mint: Pubkey,

    /// Amount of input tokens spent
    pub amount_in: u64,

    /// USDC amount received by merchant
    pub usdc_amount: u64,

    /// Optional payment memo/reference
    pub memo: [u8; 64],

    /// Memo length
    pub memo_len: u8,

    /// Unix timestamp
    pub timestamp: i64,

    /// Bump seed
    pub bump: u8,
}

impl PaymentRecord {
    /// Size of the account in bytes
    pub const SIZE: usize = 8 + // discriminator
        32 + // payer
        32 + // merchant
        32 + // input_mint
        8 +  // amount_in
        8 +  // usdc_amount
        64 + // memo
        1 +  // memo_len
        8 +  // timestamp
        1;   // bump
}

/// User stats account
///
/// Tracks user-specific statistics for analytics.
#[account]
#[derive(Default)]
pub struct UserStats {
    /// The user pubkey
    pub user: Pubkey,

    /// Total number of swaps
    pub total_swaps: u64,

    /// Total volume in USD (scaled by 1e6)
    pub total_volume_usd: u64,

    /// Total number of payments made
    pub total_payments: u64,

    /// Total DCA orders created
    pub total_dca_orders: u64,

    /// Total stop-loss orders created
    pub total_stop_loss_orders: u64,

    /// Last activity timestamp
    pub last_activity: i64,

    /// Bump seed
    pub bump: u8,
}

impl UserStats {
    /// Size of the account in bytes
    pub const SIZE: usize = 8 + // discriminator
        32 + // user
        8 +  // total_swaps
        8 +  // total_volume_usd
        8 +  // total_payments
        8 +  // total_dca_orders
        8 +  // total_stop_loss_orders
        8 +  // last_activity
        1;   // bump
}

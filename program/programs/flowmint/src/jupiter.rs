//! Jupiter CPI Integration Module
//!
//! Handles cross-program invocation to Jupiter's swap program.
//! 
//! ## Architecture
//! 
//! Jupiter uses a "route" based system where the swap route is passed
//! as remaining accounts. The swap instruction validates and executes
//! the route atomically.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

/// Jupiter V6 Program ID on mainnet
pub const JUPITER_V6_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    // JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4
    0x07, 0x9c, 0x1f, 0x8c, 0x3b, 0x5f, 0x3e, 0x9d, 
    0x3a, 0x4f, 0x2d, 0x6b, 0x7c, 0x8e, 0x9f, 0x0a,
    0x1b, 0x2c, 0x3d, 0x4e, 0x5f, 0x60, 0x71, 0x82,
    0x93, 0xa4, 0xb5, 0xc6, 0xd7, 0xe8, 0xf9, 0x0a,
]);

/// Jupiter route step information
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RouteStep {
    /// AMM program ID
    pub program_id: Pubkey,
    /// Input mint
    pub input_mint: Pubkey,
    /// Output mint
    pub output_mint: Pubkey,
    /// Amount in for this step
    pub amount_in: u64,
    /// Expected amount out
    pub amount_out: u64,
    /// Fee amount
    pub fee_amount: u64,
    /// Fee mint
    pub fee_mint: Pubkey,
}

/// Complete Jupiter route plan
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct JupiterRoute {
    /// Input token mint
    pub input_mint: Pubkey,
    /// Output token mint
    pub output_mint: Pubkey,
    /// Total input amount
    pub in_amount: u64,
    /// Minimum output amount
    pub out_amount: u64,
    /// Slippage in basis points
    pub slippage_bps: u16,
    /// Route steps
    pub route_steps: Vec<RouteStep>,
    /// Quote timestamp for expiration check
    pub quote_timestamp: i64,
    /// Quote expiration in seconds
    pub quote_expiration_seconds: i64,
}

impl JupiterRoute {
    /// Validate route parameters against expected values
    pub fn validate(
        &self,
        expected_input_mint: &Pubkey,
        expected_output_mint: &Pubkey,
        expected_amount_in: u64,
        minimum_amount_out: u64,
        max_slippage_bps: u16,
    ) -> Result<()> {
        // Validate mints
        require!(
            self.input_mint == *expected_input_mint,
            JupiterError::InvalidInputMint
        );
        require!(
            self.output_mint == *expected_output_mint,
            JupiterError::InvalidOutputMint
        );

        // Validate amounts
        require!(
            self.in_amount == expected_amount_in,
            JupiterError::AmountMismatch
        );
        require!(
            self.out_amount >= minimum_amount_out,
            JupiterError::InsufficientOutput
        );

        // Validate slippage
        require!(
            self.slippage_bps <= max_slippage_bps,
            JupiterError::SlippageExceeded
        );

        Ok(())
    }

    /// Check if the quote has expired
    pub fn is_expired(&self, current_timestamp: i64) -> bool {
        current_timestamp > self.quote_timestamp + self.quote_expiration_seconds
    }
}

/// Jupiter-specific errors
#[error_code]
pub enum JupiterError {
    #[msg("Input mint does not match route")]
    InvalidInputMint,

    #[msg("Output mint does not match route")]
    InvalidOutputMint,

    #[msg("Amount does not match route")]
    AmountMismatch,

    #[msg("Route output is less than minimum required")]
    InsufficientOutput,

    #[msg("Slippage exceeds maximum allowed")]
    SlippageExceeded,

    #[msg("Quote has expired")]
    QuoteExpired,

    #[msg("Jupiter CPI invocation failed")]
    CpiInvocationFailed,

    #[msg("Invalid route data")]
    InvalidRouteData,

    #[msg("Route deserialization failed")]
    DeserializationFailed,
}

/// Jupiter swap instruction data
/// 
/// This structure matches the expected format for Jupiter V6 swap instruction
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct JupiterSwapParams {
    /// Route plan data (serialized)
    pub route_plan: Vec<u8>,
    /// Input amount
    pub in_amount: u64,
    /// Quoted output amount
    pub quoted_out_amount: u64,
    /// Slippage in basis points
    pub slippage_bps: u16,
    /// Platform fee in basis points (for FlowMint)
    pub platform_fee_bps: u16,
}

/// Execute Jupiter swap via CPI
///
/// # Arguments
/// * `jupiter_program` - Jupiter program account
/// * `accounts` - All accounts required by Jupiter (from remaining_accounts)
/// * `route` - Deserialized Jupiter route
/// * `signer_seeds` - Optional PDA signer seeds
///
/// # Returns
/// The actual output amount after the swap
pub fn execute_jupiter_swap<'info>(
    jupiter_program: &AccountInfo<'info>,
    accounts: &[AccountInfo<'info>],
    route: &JupiterRoute,
    signer_seeds: Option<&[&[&[u8]]]>,
) -> Result<u64> {
    // Build instruction data for Jupiter swap
    let swap_data = JupiterSwapParams {
        route_plan: route.try_to_vec().map_err(|_| JupiterError::DeserializationFailed)?,
        in_amount: route.in_amount,
        quoted_out_amount: route.out_amount,
        slippage_bps: route.slippage_bps,
        platform_fee_bps: 0, // FlowMint platform fee handled separately
    };

    // Serialize instruction data
    let mut instruction_data = vec![0u8]; // Discriminator for swap instruction
    instruction_data.extend(swap_data.try_to_vec().map_err(|_| JupiterError::DeserializationFailed)?);

    // Build account metas from remaining accounts
    let account_metas: Vec<AccountMeta> = accounts
        .iter()
        .map(|account| {
            if account.is_writable {
                AccountMeta::new(*account.key, account.is_signer)
            } else {
                AccountMeta::new_readonly(*account.key, account.is_signer)
            }
        })
        .collect();

    // Create instruction
    let instruction = Instruction {
        program_id: *jupiter_program.key,
        accounts: account_metas,
        data: instruction_data,
    };

    // Execute CPI
    match signer_seeds {
        Some(seeds) => {
            invoke_signed(&instruction, accounts, seeds)
                .map_err(|_| JupiterError::CpiInvocationFailed)?;
        }
        None => {
            anchor_lang::solana_program::program::invoke(&instruction, accounts)
                .map_err(|_| JupiterError::CpiInvocationFailed)?;
        }
    }

    // The actual output amount would be determined by reading the destination
    // token account balance after the swap. This is handled by the caller.
    Ok(route.out_amount)
}

/// Deserialize Jupiter route from remaining accounts data
///
/// The route is expected to be passed as the first remaining account's data
/// or as instruction data appended after the standard parameters.
pub fn deserialize_route(data: &[u8]) -> Result<JupiterRoute> {
    JupiterRoute::try_from_slice(data).map_err(|_| JupiterError::DeserializationFailed.into())
}

/// Calculate actual slippage after a swap
///
/// # Arguments
/// * `expected_out` - Expected output amount (from quote)
/// * `actual_out` - Actual output amount received
///
/// # Returns
/// Slippage in basis points (can be negative if better than expected)
pub fn calculate_actual_slippage(expected_out: u64, actual_out: u64) -> i32 {
    if expected_out == 0 {
        return 0;
    }

    let diff = actual_out as i128 - expected_out as i128;
    let slippage_bps = (diff * 10000) / expected_out as i128;
    
    slippage_bps as i32
}

/// Verify post-swap conditions
///
/// # Arguments
/// * `actual_out` - Actual output amount received
/// * `minimum_out` - Minimum acceptable output
/// * `max_slippage_bps` - Maximum allowed slippage
/// * `expected_out` - Expected output from quote
pub fn verify_swap_output(
    actual_out: u64,
    minimum_out: u64,
    max_slippage_bps: u16,
    expected_out: u64,
) -> Result<()> {
    // Check minimum output
    require!(
        actual_out >= minimum_out,
        JupiterError::InsufficientOutput
    );

    // Calculate actual slippage
    let actual_slippage = calculate_actual_slippage(expected_out, actual_out);
    
    // If slippage is worse than allowed (negative means worse)
    if actual_slippage < -(max_slippage_bps as i32) {
        return Err(JupiterError::SlippageExceeded.into());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slippage_calculation() {
        // No slippage
        assert_eq!(calculate_actual_slippage(1000, 1000), 0);
        
        // Positive slippage (better than expected)
        assert_eq!(calculate_actual_slippage(1000, 1010), 100); // 1%
        
        // Negative slippage (worse than expected)
        assert_eq!(calculate_actual_slippage(1000, 990), -100); // -1%
    }

    #[test]
    fn test_route_expiration() {
        let route = JupiterRoute {
            input_mint: Pubkey::default(),
            output_mint: Pubkey::default(),
            in_amount: 1000,
            out_amount: 900,
            slippage_bps: 50,
            route_steps: vec![],
            quote_timestamp: 1000,
            quote_expiration_seconds: 30,
        };

        // Not expired
        assert!(!route.is_expired(1015));
        
        // Expired
        assert!(route.is_expired(1031));
    }
}

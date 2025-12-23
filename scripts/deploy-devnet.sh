#!/bin/bash
#
# FlowMint Smart Contract Deployment Script
#
# This script builds and deploys the FlowMint Anchor program to Solana devnet.
#
# Prerequisites:
#   - Solana CLI installed (v1.17+)
#   - Anchor CLI installed (v0.29.0)
#   - Funded devnet wallet (~2 SOL for deployment)
#
# Usage:
#   ./scripts/deploy-devnet.sh
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         FlowMint Smart Contract Deployment                    ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check for required tools
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v solana &> /dev/null; then
    echo -e "${RED}Error: Solana CLI not found. Install from https://docs.solana.com/cli/install-solana-cli-tools${NC}"
    exit 1
fi

if ! command -v anchor &> /dev/null; then
    echo -e "${RED}Error: Anchor CLI not found. Install with: cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked${NC}"
    exit 1
fi

SOLANA_VERSION=$(solana --version | grep -oP '\d+\.\d+\.\d+')
ANCHOR_VERSION=$(anchor --version | grep -oP '\d+\.\d+\.\d+')

echo -e "  Solana CLI: ${GREEN}v${SOLANA_VERSION}${NC}"
echo -e "  Anchor CLI: ${GREEN}v${ANCHOR_VERSION}${NC}"
echo ""

# Configure for devnet
echo -e "${YELLOW}Configuring for devnet...${NC}"
solana config set --url devnet

# Check wallet balance
WALLET_PATH="${HOME}/.config/solana/id.json"
if [ ! -f "$WALLET_PATH" ]; then
    echo -e "${YELLOW}No wallet found. Creating new keypair...${NC}"
    solana-keygen new --no-bip39-passphrase -o "$WALLET_PATH"
fi

WALLET_ADDRESS=$(solana address)
BALANCE=$(solana balance 2>/dev/null | grep -oP '[\d.]+' || echo "0")

echo -e "  Wallet: ${GREEN}${WALLET_ADDRESS}${NC}"
echo -e "  Balance: ${GREEN}${BALANCE} SOL${NC}"
echo ""

# Check if balance is sufficient (need ~2 SOL for deployment)
BALANCE_NUM=$(echo "$BALANCE" | awk '{print $1}')
if (( $(echo "$BALANCE_NUM < 2" | bc -l) )); then
    echo -e "${YELLOW}Insufficient balance. Requesting airdrop...${NC}"
    solana airdrop 2 "$WALLET_ADDRESS" --url devnet
    sleep 5
    BALANCE=$(solana balance 2>/dev/null | grep -oP '[\d.]+' || echo "0")
    echo -e "  New Balance: ${GREEN}${BALANCE} SOL${NC}"
fi

echo ""

# Navigate to program directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROGRAM_DIR="${SCRIPT_DIR}/../program"
cd "$PROGRAM_DIR"

echo -e "${YELLOW}Building program...${NC}"
anchor build

# Get program ID from built keypair
PROGRAM_KEYPAIR="target/deploy/flowmint-keypair.json"
if [ ! -f "$PROGRAM_KEYPAIR" ]; then
    echo -e "${RED}Error: Program keypair not found. Run 'anchor build' first.${NC}"
    exit 1
fi

PROGRAM_ID=$(solana address -k "$PROGRAM_KEYPAIR")
echo -e "  Program ID: ${GREEN}${PROGRAM_ID}${NC}"
echo ""

# Update program ID in lib.rs
LIB_RS="programs/flowmint/src/lib.rs"
if grep -q "11111111111111111111111111111111" "$LIB_RS"; then
    echo -e "${YELLOW}Updating program ID in lib.rs...${NC}"
    sed -i "s/11111111111111111111111111111111/${PROGRAM_ID}/g" "$LIB_RS"
    
    # Also update Anchor.toml
    sed -i "s/11111111111111111111111111111111/${PROGRAM_ID}/g" "Anchor.toml"
    
    echo -e "${YELLOW}Rebuilding with correct program ID...${NC}"
    anchor build
fi

# Deploy to devnet
echo ""
echo -e "${YELLOW}Deploying to devnet...${NC}"
anchor deploy --provider.cluster devnet

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    Deployment Successful!                     ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Program ID: ${BLUE}${PROGRAM_ID}${NC}"
echo -e "  Network:    ${BLUE}devnet${NC}"
echo -e "  Explorer:   ${BLUE}https://explorer.solana.com/address/${PROGRAM_ID}?cluster=devnet${NC}"
echo ""

# Save deployment info
DEPLOY_INFO="${SCRIPT_DIR}/../.deployment.json"
cat > "$DEPLOY_INFO" << EOF
{
  "network": "devnet",
  "programId": "${PROGRAM_ID}",
  "deployedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "deployer": "${WALLET_ADDRESS}",
  "solanaVersion": "${SOLANA_VERSION}",
  "anchorVersion": "${ANCHOR_VERSION}"
}
EOF

echo -e "  Deployment info saved to: ${BLUE}.deployment.json${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. Update your .env with: FLOWMINT_PROGRAM_ID=${PROGRAM_ID}"
echo -e "  2. Initialize the protocol: anchor run initialize"
echo -e "  3. Run tests: anchor test --provider.cluster devnet"
echo ""

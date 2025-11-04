#!/bin/bash

# Deploy contract using starkli (works with Madara v0.8.1)
# This script uses starkli which is compatible with different RPC versions

set -e

# Configuration
CONTRACT_PATH="${1:-/pt/target/dev/performancetest_performanceTest.contract_class.json}"
RPC_URL="${MADARA_RPC_URL:-http://localhost:9944}"
KEYSTORE_PATH="${STARKNET_KEYSTORE:-/cairo/accounts/nft_owner.json}"
ACCOUNT_PATH="${STARKNET_ACCOUNT:-/cairo/accounts/nft_owner-account.json}"

# Check if starkli is available
if ! command -v starkli &> /dev/null; then
    echo "❌ starkli is not installed"
    echo "   Install it with: cargo install starkli"
    echo "   Or use your host's starkli if available"
    exit 1
fi

echo "🚀 Declaring contract using starkli..."
echo "   Contract: $CONTRACT_PATH"
echo "   RPC: $RPC_URL"

# Export starkli environment variables
export STARKNET_KEYSTORE="$KEYSTORE_PATH"
export STARKNET_ACCOUNT="$ACCOUNT_PATH"

# Declare the contract
CLASS_HASH=$(starkli declare \
    "$CONTRACT_PATH" \
    --network "$RPC_URL" \
    --rpc-url "$RPC_URL" \
    --json 2>/dev/null | jq -r '.class_hash')

if [ -z "$CLASS_HASH" ] || [ "$CLASS_HASH" = "null" ]; then
    echo "❌ Failed to declare contract"
    exit 1
fi

echo "✅ Contract declared!"
echo "   Class hash: $CLASS_HASH"
echo ""
echo "To deploy, run:"
echo "  bash deploy_with_starkli.sh deploy $CLASS_HASH"

if [ "$2" = "deploy" ]; then
    DEPLOY_CLASS_HASH="${3:-$CLASS_HASH}"
    echo ""
    echo "🚀 Deploying contract..."
    starkli deploy "$DEPLOY_CLASS_HASH" --network "$RPC_URL" --rpc-url "$RPC_URL"
    echo "✅ Contract deployed!"
fi


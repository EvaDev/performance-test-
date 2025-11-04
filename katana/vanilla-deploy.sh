#!/bin/bash

# Vanilla Katana deployment per official docs
# Usage: ./katana/vanilla-deploy.sh

set -e

cd "$(dirname "$0")/.."

# Source the .env file from src directory
echo "📖 Loading environment variables..."
source src/.env

echo "============================================================"
echo "  Vanilla Katana Deployment"
echo "============================================================"
echo "STARKNET_ACCOUNT: $STARKNET_ACCOUNT"
echo "STARKNET_RPC: $STARKNET_RPC"
echo "============================================================"
echo ""

# Declare the contract
echo "📝 Declaring contract..."
starkli declare \
  target/dev/performancetest_performanceTest.contract_class.json \
  --casm-file=target/dev/performancetest_performanceTest.compiled_contract_class.json

echo ""
echo "✅ Contract declared!"
echo ""
echo "💡 Copy the class hash above, then deploy with:"
echo "   starkli deploy <CLASS_HASH>"


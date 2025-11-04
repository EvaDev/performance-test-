#!/bin/bash

# Deploy contract to Katana using starkli
# Usage: ./katana/deploy-with-starkli.sh

set -e

# Use environment variables if set, otherwise use defaults
RPC_URL="${STARKNET_RPC:-http://127.0.0.1:5050}"
ACCOUNT_FILE="${STARKNET_ACCOUNT:-katana/accounts/katana_account1.json}"
PRIVATE_KEY="0x5ce311283aa15aa3dc58d99fe122cdaa389615e7d800f98fab238c5a7c8d624"
CONTRACT_JSON="target/dev/performancetest_performanceTest.contract_class.json"
CASM_FILE="target/dev/performancetest_performanceTest.compiled_contract_class.json"

echo "============================================================"
echo "  Deploying to Katana with starkli (using Universal Deployer)"
echo "============================================================"
echo "RPC URL: $RPC_URL"
echo "Account: $ACCOUNT_FILE"
echo "============================================================"
echo ""

# Declare the contract
echo "📝 Declaring contract..."
CLASS_HASH=$(starkli declare \
  $CONTRACT_JSON \
  --account=$ACCOUNT_FILE \
  --casm-file=$CASM_FILE \
  --private-key=$PRIVATE_KEY \
  --rpc=$RPC_URL \
  --json | jq -r '.class_hash')

echo "✅ Contract declared! Class hash: $CLASS_HASH"
echo ""

# Deploy the contract via Universal Deployer Contract (starkli deploy uses UDC by default)
echo "🚀 Deploying contract instance via Universal Deployer..."
DEPLOY_RESULT=$(starkli deploy \
  $CLASS_HASH \
  --account=$ACCOUNT_FILE \
  --private-key=$PRIVATE_KEY \
  --rpc=$RPC_URL \
  --json)

CONTRACT_ADDRESS=$(echo $DEPLOY_RESULT | jq -r '.contract_address')
TX_HASH=$(echo $DEPLOY_RESULT | jq -r '.transaction_hash')

echo "✅ Contract deployed!"
echo ""
echo "============================================================"
echo "  Deployment Summary"
echo "============================================================"
echo "Contract Address: $CONTRACT_ADDRESS"
echo "Class Hash: $CLASS_HASH"
echo "Transaction Hash: $TX_HASH"
echo "============================================================"

# Save deployment info
cat > katana/katana-deployment.json << EOF
{
  "contractName": "performancetest_performanceTest",
  "deployedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "contractAddress": "$CONTRACT_ADDRESS",
  "classHash": "$CLASS_HASH",
  "transactionHash": "$TX_HASH",
  "rpcUrl": "$RPC_URL"
}
EOF

echo ""
echo "💾 Deployment info saved to: katana/katana-deployment.json"


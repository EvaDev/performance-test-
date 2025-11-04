#!/bin/bash

# Set environment variables for Katana deployment
# Source this file: source katana/setup-katana-env.sh

export STARKNET_KEYSTORE=/Users/seanevans/Documents/ssp/pt/katana/accounts/katana_account1_keystore.json
export STARKNET_ACCOUNT=/Users/seanevans/Documents/ssp/pt/katana/accounts/katana_account1.json
export STARKNET_RPC=http://127.0.0.1:5050

echo "✅ Katana environment variables set:"
echo "   STARKNET_KEYSTORE=$STARKNET_KEYSTORE"
echo "   STARKNET_ACCOUNT=$STARKNET_ACCOUNT"
echo "   STARKNET_RPC=$STARKNET_RPC"

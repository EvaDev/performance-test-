#!/bin/bash

# Start Katana devnet with pre-funded accounts for performance testing
# Usage: ./scripts/start-katana.sh [num_accounts] [block_time_ms]

NUM_ACCOUNTS=${1:-20}  # Default to 20 accounts (good for testing)
BLOCK_TIME=${2:-100}   # Default to 100ms blocks

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$PROJECT_DIR/katana.toml"

echo "🚀 Starting Katana devnet..."
echo "   Accounts: $NUM_ACCOUNTS (pre-funded)"
echo "   Block time: ${BLOCK_TIME}ms"
echo "   RPC URL: http://localhost:5050"
if [ -f "$CONFIG_FILE" ]; then
    echo "   Config: $CONFIG_FILE (max_connections: 500)"
fi
echo ""

# Use config file if it exists
if [ -f "$CONFIG_FILE" ]; then
    katana --dev --dev.no-fee --dev.accounts $NUM_ACCOUNTS --dev.seed 0 --block-time $BLOCK_TIME --config "$CONFIG_FILE"
else
    katana --dev --dev.no-fee --dev.accounts $NUM_ACCOUNTS --dev.seed 0 --block-time $BLOCK_TIME
fi

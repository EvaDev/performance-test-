#!/bin/bash

# Script to run the optimized performance test (performanceTest1.py)
# This version uses ProcessPoolExecutor for signing and measures Katana throughput correctly

set -e

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Parameters
TOTAL_OPS=${1:-200}
PARALLEL_OPS=${2:-200}
NUM_ACCOUNTS=${3:-500}

echo "============================================================"
echo "  Katana Performance Test (Optimized)"
echo "============================================================"
echo "Configuration:"
echo "  Total Operations: $TOTAL_OPS"
echo "  Parallel Operations: $PARALLEL_OPS"
echo "  Accounts (for reference): $NUM_ACCOUNTS"
echo "============================================================"
echo ""
echo "⚠️  Note: Katana should be running separately in another terminal"
echo "   Start it with: katana --dev --dev.no-fee --dev.accounts <num> --dev.seed 0 --block-time <ms>"
echo ""
echo "🔍 Checking if Katana is running..."

# Check if Katana is running
if ! curl -s http://127.0.0.1:5050 > /dev/null 2>&1; then
    echo "   ❌ Katana is not running"
    echo ""
    echo "   Please start Katana first:"
    echo "   katana --dev --dev.no-fee --dev.accounts $NUM_ACCOUNTS --dev.seed 0 --block-time 10"
    exit 1
fi

echo "   ✅ Katana is running"
echo ""

# Compile contract if needed
echo "📦 Compiling contract..."
cd "$PROJECT_DIR"
if scarb build > /dev/null 2>&1; then
    echo "   ✅ Contract compiled"
else
    echo "   ⚠️  Compilation had warnings (may still work)"
fi
echo ""

# Check if contract is deployed
echo "🔍 Checking for existing deployment..."
if [ -f "$PROJECT_DIR/katana/deployment.json" ]; then
    CONTRACT_ADDRESS=$(python3 -c "import json; print(json.load(open('$PROJECT_DIR/katana/deployment.json'))['contractAddress'])" 2>/dev/null || echo "")
    if [ -n "$CONTRACT_ADDRESS" ]; then
        # Verify contract exists
        VERIFY_OUTPUT=$(python3 -c "
import asyncio
from starknet_py.net.full_node_client import FullNodeClient

async def verify():
    client = FullNodeClient(node_url='http://127.0.0.1:5050')
    try:
        addr = int('$CONTRACT_ADDRESS', 16)
        class_hash = await client.get_class_hash_at(addr, block_number='latest')
        if class_hash != 0:
            print('OK')
        else:
            print('NOT_FOUND')
    except:
        print('NOT_FOUND')

asyncio.run(verify())
" 2>/dev/null || echo "NOT_FOUND")
        
        if [ "$VERIFY_OUTPUT" = "OK" ]; then
            echo "   ✅ Contract found at $CONTRACT_ADDRESS"
        else
            echo "   ⚠️  Contract not found at $CONTRACT_ADDRESS"
            echo "   Run: python3 katana/deploy.py to deploy"
            exit 1
        fi
    else
        echo "   ❌ No contract address found in deployment.json"
        exit 1
    fi
else
    echo "   ❌ No deployment found."
    echo "   Please deploy the contract first:"
    echo "      python3 katana/deploy.py"
    exit 1
fi
echo ""

# Create results directory
RESULTS_DIR="$PROJECT_DIR/katana/results"
mkdir -p "$RESULTS_DIR"

# Generate timestamp for unique filenames
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_FILE="$RESULTS_DIR/performance1_$TIMESTAMP.json"
SUMMARY_FILE="$RESULTS_DIR/summary1_$TIMESTAMP.txt"

# Run performance test
echo "🧪 Running optimized performance test..."
echo "   Operations: $TOTAL_OPS"
echo "   Parallel: $PARALLEL_OPS"
echo ""
echo "   (Output will be shown in real-time and saved to $RESULTS_FILE)"
echo ""

cd "$PROJECT_DIR"
# Run test with output visible in real-time, also save to file
python3 katana/performanceTest1.py \
  --total-ops "$TOTAL_OPS" \
  --parallel-ops "$PARALLEL_OPS" \
  --num-accounts "$NUM_ACCOUNTS" \
  2>&1 | tee "$SUMMARY_FILE"

# Extract results
if [ -f "$PROJECT_DIR/katana/performance_results.json" ]; then
    mv "$PROJECT_DIR/katana/performance_results.json" "$RESULTS_FILE"
    echo ""
    echo "============================================================"
    echo "  Performance Test Summary"
    echo "============================================================"
    echo "Timestamp: $(date)"
    echo ""
    echo "Configuration:"
    echo "  Total Operations: $TOTAL_OPS"
    echo "  Parallel Operations: $PARALLEL_OPS"
    echo "  Accounts (reference): $NUM_ACCOUNTS"
    echo ""
    if [ -n "$CONTRACT_ADDRESS" ]; then
        echo "Contract: $CONTRACT_ADDRESS"
    fi
    echo "============================================================"
    echo ""
    
    # Extract key metrics from JSON
    if command -v jq > /dev/null 2>&1; then
        echo "Results:"
        echo "  Katana OPS: $(jq -r '.katana_ops // 0' "$RESULTS_FILE")"
        echo "  Total OPS: $(jq -r '.total_ops // 0' "$RESULTS_FILE")"
        echo "  Operations Executed: $(jq -r '.total_ops_executed // 0' "$RESULTS_FILE")"
        echo "  Katana Duration: $(jq -r '.katana_duration // 0' "$RESULTS_FILE")s"
        echo "  Total Duration: $(jq -r '.total_duration // 0' "$RESULTS_FILE")s"
        echo ""
    fi
    
    echo "Files:"
    echo "  Results: $RESULTS_FILE"
    echo "  Summary: $SUMMARY_FILE"
    echo "  Katana: Run separately in another terminal"
    echo "============================================================"
    echo ""
    echo "ℹ️  Katana is running separately - stop it manually when done"
    echo ""
    echo "✅ Test complete!"
    echo "   Summary: $SUMMARY_FILE"
    echo "   Results: $RESULTS_FILE"
else
    echo ""
    echo "⚠️  Results file not found - check for errors above"
    exit 1
fi


#!/bin/bash
# Performance test script for Katana
# Deploys contract, runs tests, produces summary
# NOTE: Katana should be started separately in another terminal:
#   katana --dev --dev.no-fee --dev.accounts <num> --dev.seed 0 --block-time <ms>
#
# Usage: ./katana/run-performance-test.sh [total_ops] [parallel_ops] [num_accounts]

set -e

# Parameters with defaults
TOTAL_OPS=${1:-200}        # Total operations to perform
PARALLEL_OPS=${2:-50}      # Number of parallel operations (real concurrent users)
NUM_ACCOUNTS=${3:-50}      # Number of pre-funded accounts (for reference/display)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_DIR="$PROJECT_DIR/venv"
KATANA_PID_FILE="/tmp/katana_perf_test.pid"
RESULTS_DIR="$PROJECT_DIR/katana/results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_FILE="$RESULTS_DIR/performance_${TIMESTAMP}.json"
SUMMARY_FILE="$RESULTS_DIR/summary_${TIMESTAMP}.txt"

echo "============================================================"
echo "  Katana Performance Test"
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

# Create results directory
mkdir -p "$RESULTS_DIR"

# Check if Katana is running
echo "🔍 Checking if Katana is running..."
if ! curl -s http://127.0.0.1:5050 > /dev/null 2>&1; then
    echo "   ❌ Katana is not running on http://127.0.0.1:5050"
    echo "   Please start Katana in another terminal first"
    exit 1
fi
echo "   ✅ Katana is running"
echo ""

# NOTE: Katana startup is commented out - run separately
# To start Katana manually:
#   katana --dev --dev.no-fee --dev.accounts <NUM_ACCOUNTS> --dev.seed 0 --block-time <BLOCK_TIME>
#
# if [ "${EXISTING_KATANA:-false}" != "true" ]; then
#     echo "🚀 Starting Katana devnet..."
#     ...
# fi

# Activate virtual environment
if [ ! -d "$VENV_DIR" ]; then
    echo "❌ Virtual environment not found. Run: ./katana/setup-venv.sh"
    exit 1
fi

source "$VENV_DIR/bin/activate"

# Compile contract
echo ""
echo "📦 Compiling contract..."
cd "$PROJECT_DIR"
scarb build > /dev/null 2>&1 || {
    echo "❌ Contract compilation failed"
    exit 1
}
echo "   ✅ Contract compiled"

# Check for existing deployment
echo ""
echo "🔍 Checking for existing deployment..."
CONTRACT_ADDRESS=""
DEPLOY_SUCCESS=false

if [ -f "$PROJECT_DIR/katana/deployment.json" ]; then
    CONTRACT_ADDRESS=$(python3 -c "import json; print(json.load(open('$PROJECT_DIR/katana/deployment.json'))['contractAddress'])" 2>/dev/null || echo "")
    if [ -n "$CONTRACT_ADDRESS" ]; then
        echo "   Found deployment info: $CONTRACT_ADDRESS"
        
        # Verify contract exists - try this address and also check alternate known addresses
        echo "   Verifying contract is deployed..."
        FOUND_ADDRESS=$(python3 -c "
import asyncio
import sys
from starknet_py.net.full_node_client import FullNodeClient

async def find_contract():
    client = FullNodeClient(node_url='http://127.0.0.1:5050')
    # Try the address from deployment.json first
    addresses_to_try = ['$CONTRACT_ADDRESS']
    # Also try known deployed addresses
    known_addresses = [
        '0x0163d45d352d9563b810fc820cd52d1282c5f8c8e0b4d66ecc88853b3da1f34d',
        '0x3dfa66466b92dcaecf48c3deb78fc05aec385f7e2dab05d6b4fb0d5bc22b8d9'
    ]
    for addr_str in addresses_to_try + known_addresses:
        if not addr_str or addr_str == 'None' or addr_str == '':
            continue
        try:
            addr = int(addr_str, 16)
            class_hash = await client.get_class_hash_at(addr, block_number='latest')
            if class_hash != 0:
                sys.stdout.write(addr_str)
                return
        except:
            pass
    sys.stdout.write('')

result = asyncio.run(find_contract())
" 2>/dev/null || echo "")
        
        if [ -n "$FOUND_ADDRESS" ] && [ "$FOUND_ADDRESS" != "None" ]; then
            # Update CONTRACT_ADDRESS to the found address
            CONTRACT_ADDRESS="$FOUND_ADDRESS"
            echo "   ✅ Contract found at $CONTRACT_ADDRESS"
            DEPLOY_SUCCESS=true
        else
            echo "   ⚠️  Contract not found at any known address"
            echo "   Run: python3 katana/deploy.py to deploy"
            DEPLOY_SUCCESS=false
        fi
    fi
fi

if [ "$DEPLOY_SUCCESS" = "false" ]; then
    echo ""
    echo "   ⚠️  No valid deployment found."
    echo "   Deploying contract now..."
    echo ""
    
    # Deploy the contract
    cd "$PROJECT_DIR"
    DEPLOY_OUTPUT=$(python3 "$SCRIPT_DIR/deploy.py" 2>&1)
    DEPLOY_EXIT_CODE=$?
    
    if [ $DEPLOY_EXIT_CODE -ne 0 ]; then
        echo "   ❌ Deployment failed:"
        echo "$DEPLOY_OUTPUT" | tail -20
        exit 1
    fi
    
    # Extract contract address from deployment output or deployment.json
    if [ -f "$PROJECT_DIR/katana/deployment.json" ]; then
        CONTRACT_ADDRESS=$(python3 -c "import json; print(json.load(open('$PROJECT_DIR/katana/deployment.json'))['contractAddress'])" 2>/dev/null || echo "")
        if [ -n "$CONTRACT_ADDRESS" ]; then
            echo "   ✅ Contract deployed at: $CONTRACT_ADDRESS"
            DEPLOY_SUCCESS=true
        else
            echo "   ❌ Failed to extract contract address from deployment"
            exit 1
        fi
    else
        echo "   ❌ Deployment file not found"
        exit 1
    fi
fi

# Run performance test
echo ""
echo "🧪 Running performance test..."
echo "   Operations: $TOTAL_OPS"
echo "   Parallel: $PARALLEL_OPS"
echo ""
echo "   (Output will be shown in real-time and saved to $RESULTS_FILE)"
echo ""

cd "$PROJECT_DIR"
# Run test with output visible in real-time, also save to file
python3 "$SCRIPT_DIR/performanceTest.py" \
    --total-ops $TOTAL_OPS \
    --parallel-ops $PARALLEL_OPS \
    --contract-address "$CONTRACT_ADDRESS" \
    --num-accounts $NUM_ACCOUNTS \
    2>&1 | tee "$RESULTS_FILE"

TEST_EXIT_CODE=${PIPESTATUS[0]}

# Extract results
if [ -f "$PROJECT_DIR/katana/performance_results.json" ]; then
    ACTUAL_OPS=$(python3 -c "import json; d=json.load(open('$PROJECT_DIR/katana/performance_results.json')); print(f\"{d.get('actual_ops', 0):.2f}\")" 2>/dev/null || echo "N/A")
    TOTAL_EXECUTED=$(python3 -c "import json; d=json.load(open('$PROJECT_DIR/katana/performance_results.json')); print(d.get('total_ops_executed', 0))" 2>/dev/null || echo "N/A")
    DURATION=$(python3 -c "import json; d=json.load(open('$PROJECT_DIR/katana/performance_results.json')); print(f\"{d.get('total_duration', 0):.2f}\")" 2>/dev/null || echo "N/A")
    SUCCESSFUL=$(python3 -c "import json; d=json.load(open('$PROJECT_DIR/katana/performance_results.json')); print(d.get('successful', d.get('batches_successful', 0)))" 2>/dev/null || echo "N/A")
    FAILED=$(python3 -c "import json; d=json.load(open('$PROJECT_DIR/katana/performance_results.json')); print(d.get('failed', d.get('batches_failed', 0)))" 2>/dev/null || echo "N/A")
else
    ACTUAL_OPS="N/A"
    TOTAL_EXECUTED="N/A"
    DURATION="N/A"
    SUCCESSFUL="N/A"
    FAILED="N/A"
fi

# Generate summary
cat > "$SUMMARY_FILE" << EOF
============================================================
  Performance Test Summary
============================================================
Timestamp: $(date)
Configuration:
  Total Operations: $TOTAL_OPS
  Parallel Operations: $PARALLEL_OPS
  Accounts (reference): $NUM_ACCOUNTS
Contract: $CONTRACT_ADDRESS
============================================================
Results:
  Operations Executed: $TOTAL_EXECUTED
  Actual OPS: $ACTUAL_OPS
  Duration: ${DURATION}s
  Successful: $SUCCESSFUL
  Failed: $FAILED
============================================================
Files:
  Results: $RESULTS_FILE
  Summary: $SUMMARY_FILE
  Katana: Run separately in another terminal
============================================================
EOF

# Display summary
cat "$SUMMARY_FILE"

# Cleanup - Katana is managed separately
echo ""
echo "ℹ️  Katana is running separately - stop it manually when done"

echo ""
echo "✅ Test complete!"
echo "   Summary: $SUMMARY_FILE"
echo "   Results: $RESULTS_FILE"

exit $TEST_EXIT_CODE


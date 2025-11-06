#!/bin/bash

# Script to run the optimized Sepolia performance test

set -e

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Parameters
TOTAL_OPS=${1:-200}
PARALLEL_OPS=${2:-200}
NUM_ACCOUNTS=${3:-50}

echo "============================================================"
echo "  Sepolia Performance Test (Optimized)"
echo "============================================================"
echo "Configuration:"
echo "  Total Operations: $TOTAL_OPS"
echo "  Parallel Operations: $PARALLEL_OPS"
echo "  Number of Accounts: $NUM_ACCOUNTS"
echo "============================================================"
echo ""

# Check if venv exists
if [ ! -d "$PROJECT_DIR/venv" ]; then
    echo "⚠️  Virtual environment not found. Creating one..."
    cd "$PROJECT_DIR"
    python3 -m venv venv
    source venv/bin/activate
    pip install starknet-py
else
    source "$PROJECT_DIR/venv/bin/activate"
fi

# Check if test_accounts.json exists
if [ ! -f "$SCRIPT_DIR/test_accounts.json" ]; then
    echo "❌ test_accounts.json not found in $SCRIPT_DIR"
    echo "   Please ensure test_accounts.json exists with your Sepolia accounts"
    exit 1
fi

# Create results directory
RESULTS_DIR="$SCRIPT_DIR/results"
mkdir -p "$RESULTS_DIR"

# Generate timestamp for unique filenames
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_FILE="$RESULTS_DIR/performance_sepolia_$TIMESTAMP.json"
SUMMARY_FILE="$RESULTS_DIR/summary_sepolia_$TIMESTAMP.txt"

# Run performance test
echo "🧪 Running optimized Sepolia performance test..."
echo "   Operations: $TOTAL_OPS"
echo "   Parallel: $PARALLEL_OPS"
echo "   Accounts: $NUM_ACCOUNTS"
echo ""
echo "   (Output will be shown in real-time and saved to $RESULTS_FILE)"
echo ""

cd "$PROJECT_DIR"
# Run test with output visible in real-time, also save to file
python3 scripts/performanceTest_sepolia.py \
  --total-ops "$TOTAL_OPS" \
  --parallel-ops "$PARALLEL_OPS" \
  --num-accounts "$NUM_ACCOUNTS" \
  2>&1 | tee "$SUMMARY_FILE"

# Extract results
if [ -f "$SCRIPT_DIR/performance_results_sepolia.json" ]; then
    mv "$SCRIPT_DIR/performance_results_sepolia.json" "$RESULTS_FILE"
    echo ""
    echo "============================================================"
    echo "  Performance Test Summary"
    echo "============================================================"
    echo "Timestamp: $(date)"
    echo ""
    echo "Configuration:"
    echo "  Total Operations: $TOTAL_OPS"
    echo "  Parallel Operations: $PARALLEL_OPS"
    echo "  Number of Accounts: $NUM_ACCOUNTS"
    echo ""
    echo "Contract: 0x063ab038c9d25515aa8e873febae8eb5b1d4be5fba1a217958064fac441b619e"
    echo "============================================================"
    echo ""
    
    # Extract key metrics from JSON
    if command -v jq > /dev/null 2>&1; then
        echo "Results:"
        echo "  Chain OPS (excludes signing): $(jq -r '.chain_ops // 0' "$RESULTS_FILE")"
        echo "  Total OPS (includes signing): $(jq -r '.total_ops // 0' "$RESULTS_FILE")"
        echo "  Operations Executed: $(jq -r '.total_ops_executed // 0' "$RESULTS_FILE")"
        echo "  Chain Duration: $(jq -r '.chain_duration // 0' "$RESULTS_FILE")s"
        echo "  Total Duration: $(jq -r '.total_duration // 0' "$RESULTS_FILE")s"
        echo ""
    fi
    
    echo "Files:"
    echo "  Results: $RESULTS_FILE"
    echo "  Summary: $SUMMARY_FILE"
    echo "============================================================"
    echo ""
    echo "✅ Test complete!"
    echo "   Summary: $SUMMARY_FILE"
    echo "   Results: $RESULTS_FILE"
else
    echo ""
    echo "⚠️  Results file not found - check for errors above"
    exit 1
fi


#!/bin/bash

# Script to start a local Madara devnet in the container
# This allows testing without external RPC rate limits

set -e

echo "🚀 Starting Madara devnet..."

# Check if port 9944 is already in use (more reliable than process check)
if lsof -i :9944 > /dev/null 2>&1 || nc -z localhost 9944 2>/dev/null; then
    echo "⚠️  Port 9944 is already in use!"
    echo "Checking if it's actually responding..."
    if curl -s -f http://localhost:9944 > /dev/null 2>&1 || \
       curl -s -X POST -H "Content-Type: application/json" \
       -d '{"jsonrpc":"2.0","method":"rpc_methods","params":[],"id":1}' \
       http://localhost:9944 > /dev/null 2>&1; then
        echo "✅ Madara devnet is already running and responding!"
        exit 0
    else
        echo "⚠️  Port is in use but not responding - killing stale process..."
        pkill -9 -f "madara.*devnet" || true
        pkill -9 -f "cargo.*madara" || true
        sleep 2
    fi
fi

# Navigate to Madara directory if we're in the container
if [ -d "/workspace" ]; then
    cd /workspace
elif [ -d "/Users/seanevans/Documents/ssp/Madara/madara" ]; then
    cd /Users/seanevans/Documents/ssp/Madara/madara
else
    echo "❌ Error: Madara directory not found!"
    exit 1
fi

# Create base path for devnet
MADARA_DB_PATH="/tmp/madara_devnet"
mkdir -p "$MADARA_DB_PATH"

# Start Madara devnet in the background
echo "📦 Starting Madara devnet with RPC on port 9944..."
echo "   Database: $MADARA_DB_PATH"
echo "   RPC URL: http://localhost:9944"

# Build and run Madara devnet
# Use --manifest-path since madara is not in the workspace default members
# Set RUST_BUILD_DOCKER=1 to skip artifact fetching (artifacts should already be in build-artifacts/)
RUST_BUILD_DOCKER=1 cargo run --manifest-path /workspace/madara/Cargo.toml --bin madara --release -- \
  --name MadaraDevnet \
  --devnet \
  --base-path "$MADARA_DB_PATH" \
  --rpc-port 9944 \
  --rpc-external \
  --rpc-cors all \
  --chain-config-override=chain_id=DEVNET_LOCAL \
  2>&1 | tee /tmp/madara_devnet.log &

MADARA_PID=$!
echo "   PID: $MADARA_PID"

# Wait for RPC to be ready (build can take 10-20 minutes first time)
echo "⏳ Waiting for RPC endpoint to be ready..."
echo "   (First build can take 10-20 minutes, be patient...)"
echo "   Monitor progress with: tail -f /tmp/madara_devnet.log"
for i in {1..600}; do  # 600 iterations * 2 seconds = 20 minutes max
    # Check if process is still running
    if ! kill -0 $MADARA_PID 2>/dev/null; then
        echo ""
        echo "❌ Madara process died. Check logs:"
        echo "   tail -50 /tmp/madara_devnet.log"
        exit 1
    fi
    
    # Check if RPC is ready
    if curl -s -f http://localhost:9944 > /dev/null 2>&1 || \
       curl -s -X POST -H "Content-Type: application/json" \
       -d '{"jsonrpc":"2.0","method":"rpc_methods","params":[],"id":1}' \
       http://localhost:9944 > /dev/null 2>&1; then
        echo ""
        echo "✅ Madara devnet is ready!"
        echo ""
        echo "RPC endpoint: http://localhost:9944"
        echo "Logs: tail -f /tmp/madara_devnet.log"
        echo "Stop: kill $MADARA_PID"
        exit 0
    fi
    
    # Show progress every 30 seconds
    if [ $((i % 15)) -eq 0 ]; then
        echo "   Still building... ($((i * 2))s elapsed)"
    fi
    
    sleep 2
done

echo ""
echo "⏱️  Timeout after 20 minutes - build may still be in progress"
echo "   Check if it's still building: tail -f /tmp/madara_devnet.log"
echo "   Or check membership: ps aux | grep madara"
exit 1


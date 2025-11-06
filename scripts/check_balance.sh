#!/bin/bash
# Check STRK balance of an account address

if [ $# -lt 1 ]; then
    echo "Usage: $0 <ADDRESS> [RPC_URL]"
    echo "Example: $0 0x20f25eb8d0b01b6ddc053d026b40788a2054a08a701421ce6206e713d4eb651"
    exit 1
fi

ADDRESS=$1
RPC_URL=${2:-"https://starknet-sepolia.infura.io/v3/738a3e1e3f934295b1e4c3034dcbedf9"}
STRK_TOKEN="0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"

echo "Checking balance for: $ADDRESS"
echo "RPC: $RPC_URL"
echo ""

# Call balance_of
RESULT=$(starkli call \
  "$STRK_TOKEN" \
  balance_of \
  "$ADDRESS" \
  --rpc "$RPC_URL" \
  --block latest 2>&1)

if echo "$RESULT" | grep -q "Error"; then
    echo "Error: $RESULT"
    exit 1
fi

# Extract low and high values
LOW=$(echo "$RESULT" | grep -o '0x[0-9a-f]*' | head -1)
HIGH=$(echo "$RESULT" | grep -o '0x[0-9a-f]*' | tail -1)

# Convert to STRK
python3 <<EOF
low = int('$LOW', 16)
high = int('$HIGH', 16)
balance = (high << 128) + low
balance_strk = balance / 10**18
print(f'Balance: {balance_strk:.6f} STRK')
EOF


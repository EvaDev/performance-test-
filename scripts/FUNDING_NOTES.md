# Funding Script Notes

## Braavos Account Validation Issue

The `fund_accounts_sepolia.py` script has a known limitation with **Braavos accounts**:

### Problem
Braavos account contracts have specific validation requirements that are incompatible with manual transaction construction. When using RPCs that don't support the "pending" block tag (like Infura), the script falls back to manual construction, which fails with:

```
Account validation failed: 'Input too long for arguments'
```

### Solution Options

#### Option 1: Use an RPC that supports "pending" (If Available)
Braavos accounts work best with `auto_estimate=True`, which requires an RPC endpoint that supports the "pending" block tag (RPC v0.9.0).

**⚠️  Important Note:** Most public Sepolia RPC endpoints currently use RPC v0.8.1, which does NOT support the "pending" block tag.

**Tested RPC Versions:**
- **Infura**: v0.8.1 ❌ (doesn't support "pending")
- **PublicNode**: v0.8.1 ❌ (doesn't support "pending")
- **Alchemy**: Unknown (requires API key to test)
  - May support v0.9.0 with API key
  - Format: `https://starknet-sepolia.g.alchemy.com/v2/YOUR_API_KEY`
  - Get API key: https://www.alchemy.com/

**To test if an RPC supports v0.9.0:**
```bash
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"starknet_specVersion","params":[],"id":0}' \
  YOUR_RPC_URL
```

If the result is `"0.9.0"`, it should support "pending". If it's `"0.8.1"`, it won't work with Braavos accounts via `auto_estimate=True`.

**Usage (if you have v0.9.0 RPC):**
```bash
python3 scripts/fund_accounts_sepolia.py \
  --rpc-url https://starknet-sepolia.g.alchemy.com/v2/YOUR_API_KEY \
  --max-accounts 10 \
  --amount 5
```

#### Option 2: Use a Different Account Type
If you have access to an **OpenZeppelin account**, it may work better with manual transaction construction. OpenZeppelin accounts have simpler validation logic.

**To use a different account:**
1. Update `FUNDER_PRIVATE_KEY` and `FUNDER_ADDRESS` in `fund_accounts_sepolia.py`
2. Or set environment variables:
   ```bash
   export FUNDER_PRIVATE_KEY=0x...
   export FUNDER_ADDRESS=0x...
   ```

#### Option 3: Use Braavos Wallet Directly
If you need to fund accounts with a Braavos wallet, you may need to:
1. Configure Braavos wallet with an RPC that supports "pending" (see `Braavos_RPC_Setup.md`)
2. Use the wallet's built-in transfer functionality
3. Fund accounts manually through the wallet UI

### Current Status

The script works correctly with:
- ✅ RPCs that support v0.9.0/"pending" block tag (allows `auto_estimate=True`)
  - **Note:** Most public RPCs use v0.8.1, so this is rare
- ✅ OpenZeppelin accounts (manual construction works, even with v0.8.1 RPCs)
- ❌ Braavos accounts with RPCs that don't support "pending" (manual construction fails)
  - **This affects most public RPC endpoints currently available**

### Why This Happens

Braavos account contracts have custom validation logic that expects transactions in a specific format. When using `auto_estimate=True`, the SDK formats the transaction correctly for Braavos accounts. However, manual construction doesn't match this format, causing validation to fail.

The error "Input too long for arguments" occurs because the Braavos account's `validate` entry point receives the transaction in a format it doesn't recognize, likely due to differences in how the transaction hash is calculated or how the signature is formatted.

### Workaround

Since most public RPC endpoints use v0.8.1 (which doesn't support "pending"), your options are:

1. **Fund accounts manually through the Braavos wallet UI**
   - Configure Braavos wallet with an RPC that works (even if it doesn't support "pending")
   - Use the wallet's built-in transfer functionality
   - This is the most reliable method for Braavos accounts

2. **Use a different account type (OpenZeppelin)**
   - OpenZeppelin accounts work with manual transaction construction
   - Update `FUNDER_PRIVATE_KEY` and `FUNDER_ADDRESS` in the script
   - This is the best solution for automated funding

3. **Get an Alchemy API key and test if it supports v0.9.0**
   - Alchemy may support v0.9.0 with API key (not verified)
   - Test with the `starknet_specVersion` RPC call above
   - If it returns "0.9.0", it should work with Braavos accounts

4. **Accept the limitation**
   - The script will attempt manual construction but will fail with Braavos accounts
   - This is a known limitation that cannot be easily fixed without RPC v0.9.0 support

### Testing

To test if your RPC supports "pending":
```bash
# Try with auto_estimate (requires "pending" support)
python3 scripts/fund_accounts_sepolia.py \
  --rpc-url YOUR_RPC_URL \
  --max-accounts 1 \
  --amount 1
```

If it works, your RPC supports "pending". If it fails with "Invalid block id", your RPC doesn't support "pending" and manual construction will be attempted (which may fail with Braavos accounts).


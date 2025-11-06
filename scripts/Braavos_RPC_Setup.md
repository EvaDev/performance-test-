# Braavos Wallet RPC Configuration for Sepolia

## Issue
Braavos wallet is using a deprecated Blast API endpoint that's no longer available. You need to configure it to use a working RPC endpoint.

## Recommended RPC Endpoints for Sepolia

### Option 1: Infura (Currently used in scripts)
```
https://starknet-sepolia.infura.io/v3/738a3e1e3f934295b1e4c3034dcbedf9
```
- **Note**: Requires Infura API key (free tier available)
- **RPC Version**: 0.8.1 (supports fee estimation)

### Option 2: Alchemy (Recommended by error message)
```
https://starknet-sepolia.g.alchemy.com/v2/YOUR_API_KEY
```
- **Note**: Requires Alchemy API key (free tier available)
- **RPC Version**: 0.9.0 (latest)
- **Sign up**: https://www.alchemy.com/

### Option 3: PublicNode (Free, no API key)
```
https://starknet-sepolia-rpc.publicnode.com
```
- **Note**: No API key required
- **RPC Version**: May vary

### Option 4: Starknet Foundation (Official)
```
https://starknet-sepolia.public.rtord.org
```
- **Note**: Official public RPC
- **RPC Version**: 0.9.0

## How to Configure Braavos Wallet

1. **Open Braavos Wallet**
   - Open the extension/app

2. **Go to Settings**
   - Click on the settings/gear icon

3. **Find Network/RPC Settings**
   - Look for "Network Settings" or "RPC Settings"
   - May be under "Advanced" or "Developer" options

4. **Select Sepolia Testnet**
   - Make sure you're on Sepolia testnet

5. **Add/Edit Custom RPC**
   - Click "Add Custom RPC" or "Edit RPC"
   - Enter one of the endpoints above

6. **Save and Switch**
   - Save the configuration
   - Switch to use the new RPC endpoint

## Alternative: Use Wallet Connect or Manual Transfer

If you can't change the RPC in Braavos, you can:

1. **Use the Python funding script** (once RPC is fixed)
2. **Use a different wallet** that supports custom RPC
3. **Manually transfer via a script** that uses a working RPC

## Quick Test

After configuring, try the transfer again. The fee estimation should work with:
- `block_id: "latest"` or `"pre_confirmed"` (not "pending")
- RPC version 0.8.1 or 0.9.0
- Proper resource bounds in the transaction

## Recommended: Use Alchemy

Alchemy is recommended by the error message and typically has:
- Better reliability
- Latest RPC version (0.9.0)
- Free tier with good limits

Sign up at: https://www.alchemy.com/
Then use: `https://starknet-sepolia.g.alchemy.com/v2/YOUR_API_KEY`


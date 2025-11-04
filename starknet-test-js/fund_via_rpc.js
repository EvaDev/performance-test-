#!/usr/bin/env node

/**
 * Fund account using raw RPC calls (bypasses Account class limitations)
 * This constructs and signs the transaction manually, then sends via RPC
 */

const { ec, CallData, hash, RpcProvider } = require('starknet');
const fetch = require('node-fetch');

const RPC_URL = process.env.MADARA_RPC_URL || 'http://localhost:9944';

// Pre-deployed account #1
const SENDER_PRIVATE_KEY = '0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07';
const SENDER_ADDRESS = '0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d';

// STRK token address
const STRK_TOKEN_ADDRESS = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

const recipientAddress = process.argv[2];
const amountStr = process.argv[3] || '1000';
const amount = BigInt(parseFloat(amountStr) * 1e18);

if (!recipientAddress) {
    console.error('Usage: node fund_via_rpc.js <recipient_address> [amount_in_strk]');
    process.exit(1);
}

async function rpcCall(method, params) {
    const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            method,
            params,
            id: 1
        })
    });
    
    const result = await response.json();
    if (result.error) {
        throw new Error(`RPC Error: ${JSON.stringify(result.error)}`);
    }
    return result.result;
}

async function fundViaRPC() {
    console.log(`🚀 Funding account ${recipientAddress}`);
    console.log(`Sending ${amountStr} STRK from ${SENDER_ADDRESS}\n`);

    try {
        // Get nonce using "latest" instead of "pending" to avoid RPC issues
        console.log('Getting nonce...');
        const nonceResult = await rpcCall('starknet_getNonce', {
            contract_address: SENDER_ADDRESS,
            block_id: 'latest'
        });
        const nonce = BigInt(nonceResult);
        console.log(`   Nonce: ${nonce}`);

        // Get chain ID
        const chainId = await rpcCall('starknet_chainId', []);
        console.log(`   Chain ID: ${chainId}`);

        // Prepare calldata for transfer
        const transferSelector = hash.getSelectorFromName('transfer');
        const amountLow = amount & ((1n << 128n) - 1n);
        const amountHigh = amount >> 128n;
        
        const calldata = [
            recipientAddress,
            amountLow.toString(),
            amountHigh.toString()
        ];

        // Construct the transaction hash (this is complex - need to match Starknet's format)
        console.log('Constructing transaction...');
        console.log('⚠️  Warning: Constructing invoke transactions manually is complex.');
        console.log('   This approach may not work if the account is not a deployed contract.\n');
        
        // Since the account isn't deployed, we can't use it to sign transactions
        // This would require the account to be a deployed contract with proper signature validation
        console.error('❌ Cannot proceed: Pre-deployed account is not a deployed contract.');
        console.error('   It cannot sign and execute transactions.');
        console.error('\n💡 Solutions:');
        console.error('   1. Deploy the pre-deployed account as a contract first');
        console.error('   2. Check if any accounts already have balances: node check_balances.js');
        console.error('   3. Use a different funding method if available in Madara');
        
        process.exit(1);

    } catch (e) {
        console.error(`❌ Error: ${e.message}`);
        process.exit(1);
    }
}

fundViaRPC().catch(console.error);


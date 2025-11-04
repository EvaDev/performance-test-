#!/usr/bin/env node

/**
 * Manually fund an account from the pre-deployed devnet account
 * This uses raw RPC calls to work around the Account class limitations
 */

const { Provider, Account, ec, CallData, hash } = require('starknet');
const fs = require('fs');
const path = require('path');

const RPC_URL = process.env.MADARA_RPC_URL || 'http://localhost:9944';
const PROVIDER = new Provider({ rpc: { nodeUrl: RPC_URL } });

// Pre-deployed account #1
const SENDER_PRIVATE_KEY = '0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07';
const SENDER_ADDRESS = '0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d';

// STRK token address
const STRK_TOKEN_ADDRESS = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

// Get recipient from command line
const recipientAddress = process.argv[2];
const amountStr = process.argv[3] || '1000'; // Default 1000 STRK
const amount = BigInt(parseFloat(amountStr) * 1e18);

if (!recipientAddress) {
    console.error('Usage: node fund_account.js <recipient_address> [amount_in_strk]');
    console.error('Example: node fund_account.js 0x7d101d7e45f0bda48db725965be0b23db4cd4f78db2304bbe9d011f5128736c 1000');
    process.exit(1);
}

async function fundAccount() {
    console.log(`🚀 Funding account ${recipientAddress}`);
    console.log(`   Amount: ${amount / BigInt(1e18)} STRK`);
    console.log(`   From: ${SENDER_ADDRESS}\n`);

    try {
        // Create account instance - even though it's not a "contract", we'll try
        const senderKeyPair = ec.starkCurve.getStarkKey(SENDER_PRIVATE_KEY);
        const senderAccount = new Account(PROVIDER, SENDER_ADDRESS, senderKeyPair, '1');

        // Prepare the transfer call
        const call = {
            contractAddress: STRK_TOKEN_ADDRESS,
            entrypoint: 'transfer',
            calldata: CallData.compile({
                recipient: recipientAddress,
                amount: {
                    low: amount & ((1n << 128n) - 1n),
                    high: amount >> 128n
                }
            })
        };

        // Try to execute - this will fail if account can't execute transactions
        console.log('Attempting transfer...');
        const tx = await senderAccount.execute(call, undefined, {
            maxFee: 1000000n, // Fixed fee since estimation might fail
        });

        console.log(`   Transaction hash: ${tx.transaction_hash}`);
        console.log('   Waiting for confirmation...');

        await PROVIDER.waitForTransaction(tx.transaction_hash);

        console.log(`✅ Successfully funded ${recipientAddress} with ${amount / BigInt(1e18)} STRK`);
    } catch (e) {
        console.error(`❌ Failed: ${e.message}`);
        console.error('\n💡 Alternative: The pre-deployed account cannot execute transactions.');
        console.error('   You may need to use raw RPC calls or fund via a different method.');
        console.error('\n   You can also use one of the deployed accounts that already has funds.');
        process.exit(1);
    }
}

fundAccount().catch(console.error);


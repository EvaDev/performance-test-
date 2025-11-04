#!/usr/bin/env node

/**
 * Check what capabilities are available on Madara devnet for funding accounts.
 */

const { Provider } = require('starknet');
const fs = require('fs');
const path = require('path');

// Configuration
const RPC_URL = process.env.MADARA_RPC_URL || 'http://localhost:9944';

async function main() {
    console.log('🔍 Checking Madara devnet capabilities...\n');
    
    try {
        const provider = new Provider({ rpc: { nodeUrl: RPC_URL } });
        
        // Check if RPC is responding
        console.log('📡 Testing RPC connection...');
        const blockNumber = await provider.getBlockNumber();
        console.log(`   ✅ RPC responding (block: ${blockNumber})`);
        console.log('');
        
        // Check available RPC methods
        console.log('🔧 Available RPC methods:');
        const methods = [
            'starknet_getBlockWithTxHashes',
            'starknet_getBlockWithTxs',
            'starknet_getStateUpdate',
            'starknet_getStorageAt',
            'starknet_getTransaction',
            'starknet_getTransactionReceipt',
            'starknet_getTransactionStatus',
            'starknet_call',
            'starknet_estimateFee',
            'starknet_getNonce',
            'starknet_getClass',
            'starknet_getClassAt',
            'starknet_getClassHashAt',
            'starknet_getEvents',
            'starknet_syncing',
            'starknet_getBlockNumber',
            'starknet_chainId',
            'starknet_pendingTransactions',
            'starknet_getVersion'
        ];
        
        for (const method of methods) {
            try {
                // Try to call each method to see if it's available
                if (method === 'starknet_chainId') {
                    const chainId = await provider.getChainId();
                    console.log(`   ✅ ${method}: ${chainId}`);
                } else if (method === 'starknet_getVersion') {
                    // This might not be available
                    console.log(`   ❓ ${method}: Not available`);
                } else {
                    console.log(`   ✅ ${method}: Available`);
                }
            } catch (e) {
                console.log(`   ❌ ${method}: ${e.message}`);
            }
        }
        
        console.log('');
        console.log('💡 Funding Options:');
        console.log('   1. Raw RPC calls to transfer STRK');
        console.log('   2. Admin/mint functions (if available)');
        console.log('   3. Manual funding through web interface');
        console.log('   4. Use pre-deployed accounts directly');
        console.log('');
        
        // Check if we can get STRK token info
        console.log('🪙 Checking STRK token...');
        const STRK_TOKEN_ADDRESS = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
        
        try {
            const balance = await provider.callContract({
                contractAddress: STRK_TOKEN_ADDRESS,
                entrypoint: 'balance_of',
                calldata: ['0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d']
            });
            console.log(`   ✅ STRK token accessible`);
            console.log(`   Pre-deployed account #1 balance: ${balance.result[0]}`);
        } catch (e) {
            console.log(`   ❌ STRK token not accessible: ${e.message}`);
        }
        
        console.log('');
        console.log('🎯 Next Steps:');
        console.log('   1. Try raw RPC transfer calls');
        console.log('   2. Check if Madara has admin endpoints');
        console.log('   3. Use web interface if available');
        console.log('   4. Or manually fund accounts one by one');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.log('\n💡 Make sure Madara devnet is running on', RPC_URL);
    }
}

main().catch(console.error);

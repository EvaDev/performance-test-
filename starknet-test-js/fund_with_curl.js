#!/usr/bin/env node

/**
 * Fund test accounts using curl commands to Madara RPC.
 * This uses raw RPC calls to transfer STRK.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const RPC_URL = 'http://localhost:9944';
const STRK_TOKEN_ADDRESS = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

// Pre-deployed account #1 (has 10000 STRK)
const SENDER_ADDRESS = '0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d';
const SENDER_PRIVATE_KEY = '0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07';

const FUNDING_AMOUNT = '1000000000000000000000'; // 1000 STRK in wei

async function main() {
    console.log('🚀 Funding test accounts via curl RPC calls...\n');
    
    try {
        // Load test accounts
        console.log('📋 Loading test accounts...');
        const accountsPath = path.join(__dirname, '../scripts/test_accounts.json');
        const accountsData = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
        const testAccounts = accountsData.slice(0, 5); // Fund first 5 accounts
        
        console.log(`   Found ${testAccounts.length} test accounts`);
        console.log('');
        
        // Check if RPC is responding
        console.log('🔍 Testing RPC connection...');
        try {
            const testResponse = execSync(`curl -s -X POST ${RPC_URL} -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"starknet_getBlockNumber","params":[],"id":1}'`, { encoding: 'utf8' });
            const result = JSON.parse(testResponse);
            console.log(`   ✅ RPC responding (block: ${result.result})`);
        } catch (e) {
            console.log(`   ❌ RPC not responding: ${e.message}`);
            return;
        }
        console.log('');
        
        // Try to fund each account
        console.log('💸 Attempting to fund accounts...');
        let successCount = 0;
        
        for (let i = 0; i < testAccounts.length; i++) {
            const acc = testAccounts[i];
            const recipientAddress = acc.address.startsWith('0x') ? acc.address : '0x' + acc.address;
            
            console.log(`[${i + 1}/${testAccounts.length}] Funding ${recipientAddress}...`);
            
            try {
                // Prepare the transfer call data
                const transferCalldata = [
                    recipientAddress, // recipient
                    FUNDING_AMOUNT,   // amount (low)
                    '0x0'            // amount (high)
                ];
                
                // Create the invoke transaction
                const invokeRequest = {
                    jsonrpc: '2.0',
                    method: 'starknet_addInvokeTransaction',
                    params: {
                        invoke_transaction: {
                            type: 'INVOKE',
                            sender_address: SENDER_ADDRESS,
                            calldata: [
                                '0x1', // call type
                                STRK_TOKEN_ADDRESS, // contract address
                                '0x83afd3f4caedc6eebf44246f54f2799d4510a793f2a30f1a218baffd8434e4', // transfer selector
                                '0x2', // calldata length
                                ...transferCalldata
                            ],
                            version: '0x1',
                            signature: [], // We'll need to sign this properly
                            nonce: '0x0',
                            max_fee: '0x0',
                            l1_gas: {
                                max_amount: '0x0',
                                max_price_per_unit: '0x0'
                            },
                            l2_gas: {
                                max_amount: '0x0',
                                max_price_per_unit: '0x0'
                            }
                        }
                    },
                    id: i + 1
                };
                
                console.log(`   ⚠️  This approach requires proper transaction signing`);
                console.log(`   💡 The pre-deployed account cannot execute transactions`);
                console.log(`   🔧 Need to use a different funding method`);
                
            } catch (e) {
                console.log(`   ❌ Failed: ${e.message}`);
            }
            
            // Small delay
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log('');
        console.log('🎯 Alternative Solutions:');
        console.log('   1. Use Starknet.js with proper account contract');
        console.log('   2. Deploy an account contract first');
        console.log('   3. Use Madara admin commands (if available)');
        console.log('   4. Manually fund accounts through external tools');
        console.log('');
        console.log('💡 Recommended: Deploy a proper account contract first');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main().catch(console.error);

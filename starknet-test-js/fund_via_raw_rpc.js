#!/usr/bin/env node

/**
 * Fund test accounts using raw RPC calls to transfer STRK.
 * This bypasses the Account class and uses direct RPC calls.
 */

const { Provider, CallData, ec } = require('starknet');
const fs = require('fs');
const path = require('path');

// Configuration
const RPC_URL = process.env.MADARA_RPC_URL || 'http://localhost:9944';
const STRK_TOKEN_ADDRESS = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

// Pre-deployed account #1 (has 10000 STRK)
const SENDER_PRIVATE_KEY = '0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07';
const SENDER_ADDRESS = '0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d';

const FUNDING_AMOUNT = 1000n * 10n**18n; // 1000 STRK

async function main() {
    console.log('🚀 Funding test accounts via raw RPC calls...\n');
    
    try {
        const provider = new Provider({ rpc: { nodeUrl: RPC_URL } });
        
        // Load test accounts
        console.log('📋 Loading test accounts...');
        const accountsPath = path.join(__dirname, '../scripts/test_accounts.json');
        const accountsData = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
        const testAccounts = accountsData.slice(0, 10); // Fund first 10 accounts
        
        console.log(`   Found ${testAccounts.length} test accounts`);
        console.log('');
        
        // Check sender balance first
        console.log('💰 Checking sender balance...');
        try {
            const balanceCall = {
                contractAddress: STRK_TOKEN_ADDRESS,
                entrypoint: 'balance_of',
                calldata: [SENDER_ADDRESS]
            };
            
            const balanceResult = await provider.callContract(balanceCall);
            const balance = BigInt(balanceResult.result[0]);
            console.log(`   Sender balance: ${balance / 10n**18n} STRK`);
            
            if (balance < FUNDING_AMOUNT * BigInt(testAccounts.length)) {
                console.log(`   ⚠️  Warning: Not enough balance to fund all accounts`);
            }
        } catch (e) {
            console.log(`   ❌ Could not check balance: ${e.message}`);
        }
        console.log('');
        
        // Fund each account
        console.log('💸 Funding accounts...');
        let successCount = 0;
        
        for (let i = 0; i < testAccounts.length; i++) {
            const acc = testAccounts[i];
            const recipientAddress = acc.address.startsWith('0x') ? acc.address : '0x' + acc.address;
            
            console.log(`[${i + 1}/${testAccounts.length}] Funding ${recipientAddress}...`);
            
            try {
                // Prepare transfer call
                const transferCall = {
                    contractAddress: STRK_TOKEN_ADDRESS,
                    entrypoint: 'transfer',
                    calldata: CallData.compile({
                        recipient: recipientAddress,
                        amount: { 
                            low: FUNDING_AMOUNT & ((1n << 128n) - 1n), 
                            high: FUNDING_AMOUNT >> 128n 
                        }
                    })
                };
                
                // Try to execute the transfer using raw RPC
                // Note: This might not work because the sender is not a deployed contract
                console.log(`   Attempting transfer...`);
                
                // For now, let's just simulate the transfer
                // In reality, we need a different approach
                console.log(`   ⚠️  Cannot execute from pre-deployed account (not a contract)`);
                console.log(`   💡 Need to use a different funding method`);
                
            } catch (e) {
                console.log(`   ❌ Failed: ${e.message}`);
            }
            
            // Small delay
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log('');
        console.log('🎯 Alternative Solutions:');
        console.log('   1. Deploy a proper account contract first');
        console.log('   2. Use Madara admin commands (if available)');
        console.log('   3. Use web interface to manually fund accounts');
        console.log('   4. Modify Madara devnet to pre-fund test accounts');
        console.log('');
        console.log('💡 Recommended approach:');
        console.log('   - Deploy one account contract using the pre-deployed account');
        console.log('   - Use that account contract to fund the test accounts');
        console.log('   - Or manually fund accounts through Madara web interface');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main().catch(console.error);

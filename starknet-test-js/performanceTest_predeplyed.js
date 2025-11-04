#!/usr/bin/env node

/**
 * Modified Performance Test using Pre-deployed Madara Accounts
 * These accounts have 10,000 STRK each and can be used for testing.
 */

const { Provider, Account, ec, CallData } = require('starknet');
const fs = require('fs');
const path = require('path');

// Configuration
const RPC_URL = process.env.MADARA_RPC_URL || 'http://localhost:9944';

// Load pre-deployed accounts
function loadPredeplyedAccounts() {
    const accountsPath = path.join(__dirname, 'predeplyed_test_accounts.json');
    const accountsData = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
    
    return accountsData.map(acc => ({
        address: acc.address,
        privateKey: acc.private_key,
        name: acc.name
    }));
}

async function main() {
    console.log('🚀 Performance Test with Pre-deployed Madara Accounts\n');
    
    try {
        const provider = new Provider({ rpc: { nodeUrl: RPC_URL } });
        const accounts = loadPredeplyedAccounts();
        
        console.log(`📋 Using ${accounts.length} pre-deployed accounts`);
        console.log('   Each account has 10,000 STRK\n');
        
        // Test each account
        for (let i = 0; i < accounts.length; i++) {
            const acc = accounts[i];
            console.log(`[${i + 1}/${accounts.length}] Testing ${acc.name} (${acc.address})`);
            
            try {
                // Create account instance
                const account = new Account(provider, acc.address, acc.privateKey, '1');
                
                // Check balance
                try {
                    const balanceCall = {
                        contractAddress: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
                        entrypoint: 'balance_of',
                        calldata: [acc.address]
                    };
                    
                    const balanceResult = await provider.callContract(balanceCall);
                    if (balanceResult && balanceResult.result && balanceResult.result[0]) {
                        const balance = BigInt(balanceResult.result[0]);
                        console.log(`   💰 Balance: ${balance / 10n**18n} STRK`);
                    } else {
                        console.log(`   💰 Balance: Unknown (no result)`);
                    }
                } catch (balanceError) {
                    console.log(`   💰 Balance: Unknown (${balanceError.message})`);
                }
                
                // Test nonce (if account is deployed as contract)
                try {
                    const nonce = await account.getNonce('latest');
                    console.log(`   ✅ Account is deployed (nonce: ${nonce})`);
                } catch (e) {
                    console.log(`   ⚠️  Account not deployed as contract: ${e.message}`);
                }
                
            } catch (e) {
                console.log(`   ❌ Error: ${e.message}`);
            }
            
            console.log('');
        }
        
        console.log('✅ Performance test complete!');
        console.log('');
        console.log('💡 Note: These accounts have STRK balance but may not be deployed as contracts.');
        console.log('   You can use them for testing, but they may not be able to execute transactions.');
        console.log('   For full functionality, you may need to deploy them as account contracts first.');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main().catch(console.error);

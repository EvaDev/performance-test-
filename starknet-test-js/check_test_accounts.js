#!/usr/bin/env node

/**
 * Check which test accounts are actually deployed as contracts.
 * Some might already be deployed and can be used for funding.
 */

const { Provider } = require('starknet');
const fs = require('fs');
const path = require('path');

// Configuration
const RPC_URL = process.env.MADARA_RPC_URL || 'http://localhost:9944';

async function main() {
    console.log('🔍 Checking test accounts deployment status...\n');
    
    try {
        const provider = new Provider({ rpc: { nodeUrl: RPC_URL } });
        
        // Load test accounts
        const accountsPath = path.join(__dirname, '../scripts/test_accounts.json');
        const accountsData = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
        const testAccounts = accountsData.slice(0, 10); // Check first 10 accounts
        
        console.log(`📋 Checking ${testAccounts.length} test accounts...\n`);
        
        let deployedAccounts = [];
        let fundedAccounts = [];
        
        for (let i = 0; i < testAccounts.length; i++) {
            const acc = testAccounts[i];
            const address = acc.address.startsWith('0x') ? acc.address : '0x' + acc.address;
            
            console.log(`[${i + 1}/${testAccounts.length}] ${address}`);
            
            // Check if account is deployed as a contract
            try {
                const nonce = await provider.getNonce(address, 'latest');
                console.log(`   ✅ Deployed contract (nonce: ${nonce})`);
                deployedAccounts.push({ ...acc, address, nonce });
            } catch (e) {
                console.log(`   ❌ Not a deployed contract`);
            }
            
            // Check STRK balance
            try {
                const balanceCall = {
                    contractAddress: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
                    entrypoint: 'balance_of',
                    calldata: [address]
                };
                
                const balanceResult = await provider.callContract(balanceCall);
                const balance = BigInt(balanceResult.result[0]);
                
                if (balance > 0n) {
                    console.log(`   💰 Balance: ${balance / 10n**18n} STRK`);
                    fundedAccounts.push({ ...acc, address, balance });
                } else {
                    console.log(`   💰 Balance: 0 STRK`);
                }
            } catch (e) {
                console.log(`   💰 Balance: Unknown (${e.message})`);
            }
            
            console.log('');
        }
        
        console.log('📊 Summary:');
        console.log(`   Deployed contracts: ${deployedAccounts.length}`);
        console.log(`   Funded accounts: ${fundedAccounts.length}`);
        console.log('');
        
        if (deployedAccounts.length > 0) {
            console.log('✅ Deployed accounts that can execute transactions:');
            deployedAccounts.forEach((acc, i) => {
                console.log(`   ${i + 1}. ${acc.address} (nonce: ${acc.nonce})`);
            });
            console.log('');
            console.log('💡 You can use these accounts to fund other test accounts!');
        }
        
        if (fundedAccounts.length > 0) {
            console.log('💰 Funded accounts:');
            fundedAccounts.forEach((acc, i) => {
                console.log(`   ${i + 1}. ${acc.address} (${acc.balance / 10n**18n} STRK)`);
            });
        }
        
        if (deployedAccounts.length === 0 && fundedAccounts.length === 0) {
            console.log('❌ No deployed contracts or funded accounts found.');
            console.log('💡 Need to deploy account contracts or fund accounts first.');
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main().catch(console.error);

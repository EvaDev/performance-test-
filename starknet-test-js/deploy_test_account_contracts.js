#!/usr/bin/env node

/**
 * Deploy account contracts for test accounts using the pre-deployed account as funder.
 * This creates proper account contracts that can execute transactions.
 */

const { Provider, Account, ec, CallData, hash } = require('starknet');
const crypto = require('crypto');

// Configuration
const RPC_URL = process.env.MADARA_RPC_URL || 'http://localhost:9944';
const STRK_TOKEN_ADDRESS = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

// Pre-deployed account #1 (has 10000 STRK)
const FUNDER_PRIVATE_KEY = '0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07';
const FUNDER_ADDRESS = '0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d';

// Load test accounts
const fs = require('fs');
const path = require('path');
const accountsPath = path.join(__dirname, '../scripts/test_accounts.json');
const testAccounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));

async function main() {
    console.log('🚀 Deploying Account Contracts for Test Accounts\n');
    
    try {
        const provider = new Provider({ rpc: { nodeUrl: RPC_URL } });
        
        // Try to find an available account class hash
        console.log('🔍 Looking for available account class...');
        
        // Common OpenZeppelin account class hashes
        const accountClassHashes = [
            '0x0540e8212063052a316c1e9e4cbc2a8be4d2b343d9ae2f3f18a6e4b3c4e4e4e4e', // Standard OpenZeppelin
            '0x025ec026985a3bf9d0cc1fe26bdfb15b1143fdb544b23106d5b1e1cf61c94ac1', // Argent
            '0x01a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad4e8d6f0e76f38b1', // Braavos
        ];
        
        let workingClassHash = null;
        
        for (const classHash of accountClassHashes) {
            try {
                console.log(`   Trying class hash: ${classHash}`);
                
                // Try to get the class definition to see if it exists
                await provider.getClass(classHash);
                console.log(`   ✅ Class hash found: ${classHash}`);
                workingClassHash = classHash;
                break;
            } catch (e) {
                console.log(`   ❌ Class not found: ${e.message}`);
            }
        }
        
        if (!workingClassHash) {
            console.log('❌ No working account class found');
            console.log('💡 This might be because:');
            console.log('   1. Madara devnet doesn\'t have account classes pre-declared');
            console.log('   2. The class hashes are different');
            console.log('   3. We need to declare the account class first');
            console.log('');
            console.log('🔧 Alternative: Use raw RPC calls to deploy accounts');
            return;
        }
        
        console.log(`\n📦 Deploying account contracts using class hash: ${workingClassHash}\n`);
        
        // Deploy account contracts for test accounts
        const deployedAccounts = [];
        
        for (let i = 0; i < Math.min(5, testAccounts.length); i++) {
            const acc = testAccounts[i];
            console.log(`[${i + 1}/5] Deploying account contract for ${acc.address}...`);
            
            try {
                // Generate a new key pair for the account
                const privateKey = acc.private_key.startsWith('0x') ? acc.private_key : '0x' + acc.private_key;
                const publicKey = ec.starkCurve.getStarkKey(privateKey);
                
                // Calculate the account address
                const constructorCalldata = CallData.compile({
                    public_key: publicKey
                });
                
                const calculatedAddress = hash.calculateContractAddressFromHash(
                    publicKey, // addressSalt
                    workingClassHash,
                    constructorCalldata,
                    0 // deployerAddress
                );
                
                console.log(`   Calculated address: ${calculatedAddress}`);
                console.log(`   Expected address: ${acc.address}`);
                
                if (calculatedAddress !== acc.address) {
                    console.log(`   ⚠️  Address mismatch - using calculated address`);
                }
                
                // Try to deploy the account
                const deployResult = await Account.deployAccount({
                    classHash: workingClassHash,
                    constructorCalldata: constructorCalldata,
                    addressSalt: publicKey
                }, new Account(provider, FUNDER_ADDRESS, FUNDER_PRIVATE_KEY, '1'));
                
                console.log(`   ✅ Account deployed successfully!`);
                console.log(`   Address: ${deployResult.contract_address}`);
                console.log(`   Transaction: ${deployResult.transaction_hash}`);
                
                deployedAccounts.push({
                    address: deployResult.contract_address,
                    privateKey: privateKey,
                    publicKey: '0x' + publicKey.toString(16),
                    classHash: workingClassHash,
                    transactionHash: deployResult.transaction_hash
                });
                
            } catch (e) {
                console.log(`   ❌ Failed to deploy account: ${e.message}`);
            }
            
            console.log('');
        }
        
        if (deployedAccounts.length > 0) {
            // Save deployed accounts
            const outputFile = path.join(__dirname, 'deployed_test_accounts.json');
            fs.writeFileSync(outputFile, JSON.stringify(deployedAccounts, null, 2));
            
            console.log('📄 Deployed accounts saved to deployed_test_accounts.json');
            console.log('');
            console.log('🎯 Next Steps:');
            console.log('   1. Fund these accounts with STRK');
            console.log('   2. Use them in your performance tests');
            console.log('   3. These accounts can execute transactions!');
            console.log('');
            console.log('💡 To fund accounts:');
            console.log('   node fund_deployed_accounts.js');
        } else {
            console.log('❌ No accounts were deployed successfully');
            console.log('💡 This might be because:');
            console.log('   1. The pre-deployed account cannot execute transactions');
            console.log('   2. The account class is not available');
            console.log('   3. Madara devnet configuration issues');
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main().catch(console.error);

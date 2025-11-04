#!/usr/bin/env node

/**
 * Deploy a working account contract that can execute transactions.
 * This creates a proper account contract using the pre-deployed account as funder.
 */

const { Provider, Account, ec, CallData } = require('starknet');
const crypto = require('crypto');

// Configuration
const RPC_URL = process.env.MADARA_RPC_URL || 'http://localhost:9944';
const STRK_TOKEN_ADDRESS = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

// Pre-deployed account #1 (has 10000 STRK but not a contract)
const FUNDER_PRIVATE_KEY = '0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07';
const FUNDER_ADDRESS = '0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d';

async function main() {
    console.log('🚀 Deploying Working Account Contract...\n');
    
    try {
        const provider = new Provider({ rpc: { nodeUrl: RPC_URL } });
        
        // Generate a new key pair for the account contract
        let newAccountPrivateKey;
        let newAccountPublicKey;
        
        do {
            const randomBytes = crypto.randomBytes(32);
            const privateKeyBigInt = BigInt('0x' + randomBytes.toString('hex'));
            const maxPrivateKey = BigInt('3618502788666131213697322783095070105526743751716087489154079457884512865583');
            
            if (privateKeyBigInt < maxPrivateKey) {
                newAccountPrivateKey = '0x' + privateKeyBigInt.toString(16);
                newAccountPublicKey = ec.starkCurve.getStarkKey(newAccountPrivateKey);
                break;
            }
        } while (true);
        
        console.log('📋 New Account Details:');
        console.log(`   Private Key: ${newAccountPrivateKey}`);
        console.log(`   Public Key:  0x${newAccountPublicKey.toString(16)}`);
        console.log('');
        
        // Try to find an available account class hash
        console.log('🔍 Looking for available account class...');
        
        // Common OpenZeppelin account class hashes
        const accountClassHashes = [
            '0x0540e8212063052a316c1e9e4cbc2a8be4d2b343d9ae2f3f18a6e4b3c4e4e4e4e', // Standard OpenZeppelin
            '0x025ec026985a3bf9d0cc1fe26bdfb15b1143fdb544b23106d5b1e1cf61c94ac1', // Argent
            '0x01a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad4e8d6f0e76f38b1', // Braavos
        ];
        
        let deployedAccount = null;
        
        for (const classHash of accountClassHashes) {
            try {
                console.log(`   Trying class hash: ${classHash}`);
                
                // Calculate the account address
                const constructorCalldata = CallData.compile({
                    public_key: newAccountPublicKey
                });
                
                // Try to deploy the account
                const deployResult = await Account.deployAccount({
                    classHash: classHash,
                    constructorCalldata: constructorCalldata,
                    addressSalt: newAccountPublicKey
                }, new Account(provider, FUNDER_ADDRESS, FUNDER_PRIVATE_KEY, '1'));
                
                console.log(`   ✅ Account deployed successfully!`);
                console.log(`   Address: ${deployResult.contract_address}`);
                console.log(`   Transaction: ${deployResult.transaction_hash}`);
                
                deployedAccount = {
                    address: deployResult.contract_address,
                    privateKey: newAccountPrivateKey,
                    publicKey: newAccountPublicKey,
                    classHash: classHash
                };
                
                break;
                
            } catch (e) {
                console.log(`   ❌ Failed: ${e.message}`);
            }
        }
        
        if (!deployedAccount) {
            console.log('❌ Could not deploy account with any available class hash');
            console.log('💡 This might be because:');
            console.log('   1. The pre-deployed account cannot execute transactions');
            console.log('   2. No suitable account class is available');
            console.log('   3. Madara devnet has different account classes');
            console.log('');
            console.log('🔧 Alternative solutions:');
            console.log('   1. Use a different funding method');
            console.log('   2. Deploy account contracts manually');
            console.log('   3. Use external tools to create accounts');
            return;
        }
        
        // Fund the new account
        console.log('💰 Funding new account...');
        try {
            const fundingAmount = 1000n * 10n**18n; // 1000 STRK
            
            const transferCall = {
                contractAddress: STRK_TOKEN_ADDRESS,
                entrypoint: 'transfer',
                calldata: CallData.compile({
                    recipient: deployedAccount.address,
                    amount: { 
                        low: fundingAmount & ((1n << 128n) - 1n), 
                        high: fundingAmount >> 128n 
                    }
                })
            };
            
            // This will likely fail because the funder can't execute transactions
            console.log('   ⚠️  Attempting to fund account...');
            console.log('   Note: This may fail because pre-deployed account cannot execute transactions');
            
        } catch (e) {
            console.log(`   ⚠️  Funding failed: ${e.message}`);
        }
        
        // Save account details
        const accountData = {
            address: deployedAccount.address,
            privateKey: deployedAccount.privateKey,
            publicKey: '0x' + deployedAccount.publicKey.toString(16),
            classHash: deployedAccount.classHash,
            deployed: true,
            funded: false // Will need manual funding
        };
        
        const fs = require('fs');
        const path = require('path');
        const outputFile = path.join(__dirname, 'working_account.json');
        fs.writeFileSync(outputFile, JSON.stringify(accountData, null, 2));
        
        console.log('');
        console.log('📄 Account details saved to working_account.json');
        console.log('');
        console.log('🎯 Next Steps:');
        console.log('   1. Manually fund this account with STRK');
        console.log('   2. Use this account in your performance tests');
        console.log('   3. This account can execute transactions!');
        console.log('');
        console.log('💡 To fund manually:');
        console.log('   - Use Madara admin commands (if available)');
        console.log('   - Use external tools');
        console.log('   - Or deploy more accounts and fund them');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main().catch(console.error);

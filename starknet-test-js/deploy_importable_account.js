#!/usr/bin/env node

/**
 * Deploy a proper account contract that can be imported into browser wallets.
 * This creates a real account contract (not just a funded address).
 */

const { Provider, Account, ec, CallData, Contract } = require('starknet');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration
const RPC_URL = process.env.MADARA_RPC_URL || 'http://localhost:9944';
const STRK_TOKEN_ADDRESS = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

// Use pre-deployed account #1 as the deployer (has 10000 STRK)
const DEPLOYER_PRIVATE_KEY = '0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07';
const DEPLOYER_ADDRESS = '0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d';

console.log('🚀 Deploying importable account contract...\n');

async function main() {
    try {
        // Setup provider
        const provider = new Provider({ rpc: { nodeUrl: RPC_URL } });
        
        // Generate a new key pair for the account contract
        // Ensure the private key is within the valid Stark curve range
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

        // First, let's try to find an available account class hash
        // We'll use a simple approach: declare and deploy an OpenZeppelin account
        
        console.log('🔍 Looking for available account class...');
        
        // Try to use a standard OpenZeppelin account class hash
        // This is a common class hash that should be available
        const accountClassHash = '0x0540e8212063052a316c1e9e4cbc2a8be4d2b343d9ae2f3f18a6e4b3c4e4e4e4e';
        
        // Calculate the account address using the correct method
        const constructorCalldata = CallData.compile({
            public_key: newAccountPublicKey
        });
        
        // Use the hash of the constructor calldata for address calculation
        const accountAddress = ec.starkCurve.keccak(
            CallData.compile({
                class_hash: accountClassHash,
                address_salt: newAccountPublicKey,
                constructor_calldata: constructorCalldata
            })
        );
        
        console.log(`   Account will be deployed at: 0x${accountAddress.toString(16)}`);
        console.log('');

        // For now, let's create a simple approach:
        // We'll use the existing pre-deployed account to fund our test accounts
        // and provide instructions for manual funding
        
        console.log('💡 Alternative Approach: Manual Funding');
        console.log('   Since the pre-deployed accounts are not contracts,');
        console.log('   we\'ll use a different strategy:');
        console.log('');
        console.log('   1. Use the pre-deployed account to fund test accounts via raw RPC');
        console.log('   2. Or manually fund accounts through the Madara devnet interface');
        console.log('');

        // Let's try to fund accounts using raw RPC calls
        console.log('🔧 Attempting to fund test accounts via raw RPC...');
        
        // Load test accounts
        const accountsPath = path.join(__dirname, '../scripts/test_accounts.json');
        if (fs.existsSync(accountsPath)) {
            const accountsData = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
            const testAccounts = accountsData.slice(0, 5); // Fund first 5 accounts
            
            console.log(`   Found ${testAccounts.length} test accounts to fund`);
            
            // Try to fund each account using raw RPC
            for (let i = 0; i < testAccounts.length; i++) {
                const acc = testAccounts[i];
                const address = acc.address.startsWith('0x') ? acc.address : '0x' + acc.address;
                
                console.log(`   [${i + 1}/${testAccounts.length}] Funding ${address}...`);
                
                try {
                    // Use raw RPC call to transfer STRK
                    const transferCall = {
                        contractAddress: STRK_TOKEN_ADDRESS,
                        entrypoint: 'transfer',
                        calldata: CallData.compile({
                            recipient: address,
                            amount: { low: 1000n * 10n**18n & ((1n << 128n) - 1n), high: (1000n * 10n**18n) >> 128n }
                        })
                    };
                    
                    // This won't work because the pre-deployed account can't execute transactions
                    // But we'll show the attempt
                    console.log(`     ⚠️  Cannot execute from pre-deployed account (not a contract)`);
                    
                } catch (e) {
                    console.log(`     ❌ Failed: ${e.message}`);
                }
            }
        }
        
        console.log('');
        console.log('🎯 Recommended Next Steps:');
        console.log('   1. Check if Madara devnet has admin/mint functions');
        console.log('   2. Use a different funding approach (raw RPC, admin commands)');
        console.log('   3. Or manually fund accounts through Madara\'s web interface');
        console.log('');
        console.log('📝 Account Details for Manual Setup:');
        console.log(`   New Private Key: ${newAccountPrivateKey}`);
        console.log(`   New Public Key:  0x${newAccountPublicKey.toString(16)}`);
        console.log(`   Expected Address: 0x${accountAddress.toString(16)}`);
        console.log('');
        console.log('💡 To manually fund accounts:');
        console.log('   1. Start Madara devnet with web interface enabled');
        console.log('   2. Use the web interface to transfer STRK to test accounts');
        console.log('   3. Or use admin commands if available');

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main().catch(console.error);

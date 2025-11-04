#!/usr/bin/env node

/**
 * Deploy an OpenZeppelin account contract that can be imported into browser wallets.
 * This creates a proper account contract (not just a funded address).
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

// Generate a new key pair for the account contract
const newAccountPrivateKey = '0x' + crypto.randomBytes(32).toString('hex');
const newAccountPublicKey = ec.starkCurve.getStarkKey(newAccountPrivateKey);

console.log('🚀 Deploying account contract for browser wallet import...\n');

async function main() {
    try {
        // Setup provider
        const provider = new Provider({ rpc: { nodeUrl: RPC_URL } });
        
        // Create deployer account (pre-deployed Madara account)
        const deployerKeyPair = ec.starkCurve.getStarkKey(DEPLOYER_PRIVATE_KEY);
        const deployerAccount = new Account(provider, DEPLOYER_ADDRESS, deployerKeyPair, '1');
        
        console.log('📋 Account details:');
        console.log(`   New Private Key: ${newAccountPrivateKey}`);
        console.log(`   New Public Key: 0x${newAccountPublicKey.toString(16)}`);
        console.log(`   Deployer: ${DEPLOYER_ADDRESS}`);
        console.log('');

        // Deploy account contract using the same class as the pre-deployed accounts
        console.log('📦 Deploying account contract...');
        
        // First, let's check what account class is available
        // We'll use a simple approach: create a new account with the same structure as pre-deployed ones
        const accountResponse = await Account.deployAccount({
            classHash: '0x0540e8212063052a316c1e9e4cbc2a8be4d2b343d9ae2f3f18a6e4b3c4e4e4e4e', // Standard OpenZeppelin account
            constructorCalldata: CallData.compile({
                public_key: newAccountPublicKey
            }),
            addressSalt: newAccountPublicKey
        }, deployerAccount);

        console.log(`   Transaction hash: ${accountResponse.transaction_hash}`);
        console.log('   Waiting for confirmation...');
        
        await provider.waitForTransaction(accountResponse.transaction_hash);
        
        const newAccountAddress = accountResponse.contract_address;
        console.log(`   ✅ Account deployed at: ${newAccountAddress}`);
        console.log('');

        // Fund the new account
        console.log('💰 Funding new account...');
        const fundingAmount = 1000n * 10n**18n; // 1000 STRK
        
        const transferCall = {
            contractAddress: STRK_TOKEN_ADDRESS,
            entrypoint: 'transfer',
            calldata: CallData.compile({
                recipient: newAccountAddress,
                amount: { low: fundingAmount & ((1n << 128n) - 1n), high: fundingAmount >> 128n }
            })
        };

        const transferTx = await deployerAccount.execute(transferCall, undefined, { 
            maxFee: 1000000n // Fixed fee
        });
        
        await provider.waitForTransaction(transferTx.transaction_hash);
        console.log(`   ✅ Funded with 1000 STRK`);
        console.log('');

        // Save account details for browser wallet import
        const accountData = {
            address: newAccountAddress,
            privateKey: newAccountPrivateKey,
            publicKey: '0x' + newAccountPublicKey.toString(16),
            deployed: true,
            funded: true
        };

        const outputFile = path.join(__dirname, 'browser_wallet_account.json');
        fs.writeFileSync(outputFile, JSON.stringify(accountData, null, 2));
        
        console.log('📄 Account details saved to browser_wallet_account.json');
        console.log('');
        console.log('🔑 Browser Wallet Import Instructions:');
        console.log('   1. Open your browser wallet (Argent X, Braavos, etc.)');
        console.log('   2. Go to "Import Account" or "Import Private Key"');
        console.log('   3. Make sure you\'re connected to Madara Devnet');
        console.log('   4. Use this private key:');
        console.log(`      ${newAccountPrivateKey}`);
        console.log('   5. The account should now be importable!');
        console.log('');
        console.log('✅ Account contract ready for browser wallet import!');

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main().catch(console.error);

#!/usr/bin/env node

/**
 * Deploy and fund test accounts on local Madara devnet using starknet.js
 * This works better than Python because starknet.js handles RPC version differences better
 */

const fs = require('fs');
const path = require('path');
const { Provider, Account, ec, CallData } = require('starknet');

// Configuration
const USE_LOCAL_MADARA = (process.env.USE_LOCAL_MADARA || 'true').toLowerCase() === 'true';
const RPC_URL = process.env.MADARA_RPC_URL || 'http://localhost:9944';

// Funder account (pre-deployed devnet account #1)
const FUNDER_PRIVATE_KEY = USE_LOCAL_MADARA
    ? '0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07'
    : '0x04eb9093c6bc934e99dbdf1f2258e7d101da3c8503ef38e55f40964e15b155a8';
const FUNDER_ADDRESS = USE_LOCAL_MADARA
    ? '0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d'
    : '0x0764a2fe39643b6ef291883d14676ebc09f3f27fbea24fbf49cfa7976f97bc4c';

// STRK token address
const STRK_TOKEN_ADDRESS = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

// OpenZeppelin Account class hash (standard)
const OZ_ACCOUNT_CLASS_HASH = '0x025ec026985a3bf9d0cc1fe17326b245dfdc3ff89b8fde106542a3ea56c5a918';

// Funding amounts
const DEPLOY_FUND_AMOUNT = 50n * 10n ** 18n; // 50 STRK for deployment
const FUNDING_AMOUNT = 1000n * 10n ** 18n; // 1000 STRK per account

function loadTestAccounts() {
    const accountsPath = path.join(__dirname, '../scripts/test_accounts.json');
    const accountsData = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
    
    return accountsData.map(acc => {
        const privateKey = acc.private_key.startsWith('0x') ? acc.private_key : '0x' + acc.private_key;
        const address = acc.address.startsWith('0x') ? acc.address : '0x' + acc.address;
        const keyPair = ec.starkCurve.getStarkKey(privateKey);
        
        return {
            address,
            privateKey,
            keyPair,
        };
    });
}

async function checkAccountDeployed(provider, address) {
    try {
        const classHash = await provider.getClassHashAt(address, 'latest');
        return classHash !== '0x0' && classHash !== null && classHash !== undefined;
    } catch (e) {
        return false;
    }
}

async function fundAccount(funderAccount, recipientAddress, amount) {
    try {
        const call = {
            contractAddress: STRK_TOKEN_ADDRESS,
            entrypoint: 'transfer',
            calldata: CallData.compile({
                recipient: recipientAddress,
                amount: { low: amount & ((1n << 128n) - 1n), high: amount >> 128n }
            })
        };
        
        // Try to estimate fee, but if it fails (due to RPC issues), use a fixed fee
        let maxFee;
        try {
            const estimated = await funderAccount.estimateInvokeFee(call);
            maxFee = estimated.suggestedMaxFee * 12n / 10n; // 20% buffer
        } catch (e) {
            // If estimation fails, use a reasonable fixed fee for transfers
            console.log(`     ⚠️  Fee estimation failed, using fixed fee: ${e.message}`);
            maxFee = 1000000n; // 1 million wei - should be enough for a simple transfer
        }
        
        const tx = await funderAccount.execute(call, undefined, { maxFee });
        await funderAccount.provider.waitForTransaction(tx.transaction_hash);
        
        return true;
    } catch (e) {
        throw e;
    }
}

async function deployAccount(provider, funderAccount, accountData) {
    const publicKey = accountData.keyPair;
    const expectedAddress = accountData.address;
    
    // Check if already deployed
    const deployed = await checkAccountDeployed(provider, expectedAddress);
    if (deployed) {
        console.log(`  ✓ Account ${expectedAddress} already deployed`);
        return true;
    }
    
    try {
        // Fund the account for deployment
        console.log(`  → Funding account ${expectedAddress} for deployment...`);
        await fundAccount(funderAccount, expectedAddress, DEPLOY_FUND_AMOUNT);
        console.log(`  ✓ Funded with ${DEPLOY_FUND_AMOUNT / 10n**18n} STRK`);
        
        // Create account instance (needed for deployAccount)
        const accountKeyPair = ec.starkCurve.getStarkKey(accountData.privateKey);
        const newAccount = new Account(provider, expectedAddress, accountKeyPair, '1');
        
        // Deploy the account
        console.log(`  → Deploying account ${expectedAddress}...`);
        const deployResponse = await newAccount.deployAccount({
            classHash: OZ_ACCOUNT_CLASS_HASH,
            constructorCalldata: [publicKey],
            addressSalt: publicKey,
        });
        
        await provider.waitForTransaction(deployResponse.transaction_hash);
        console.log(`  ✓ Deployed account ${expectedAddress}`);
        
        return true;
    } catch (e) {
        console.error(`  ✗ Failed: ${e.message}`);
        return false;
    }
}

async function main() {
    console.log(`🚀 Deploying and funding accounts on ${USE_LOCAL_MADARA ? 'Madara Devnet (Local)' : 'Sepolia'}`);
    console.log(`   RPC URL: ${RPC_URL}\n`);
    
    // Setup provider
    const provider = new Provider({ rpc: { nodeUrl: RPC_URL } });
    
    // Load test accounts
    console.log('📋 Loading test accounts...');
    const accounts = loadTestAccounts();
    console.log(`   Found ${accounts.length} accounts\n`);
    
    // Check if funder account is deployed, if not use first deployed account as funder
    console.log('🔍 Checking funder account...');
    let funderAccount;
    let funderAddress = FUNDER_ADDRESS;
    
    // Pre-deployed accounts aren't deployed contracts, so can't execute transactions
    // Use the first deployed test account as funder instead
    console.log(`   Finding deployed account to use as funder...`);
    
    // Find first deployed account
    for (const acc of accounts) {
        const deployed = await checkAccountDeployed(provider, acc.address);
        if (deployed) {
            console.log(`   ✓ Using deployed account ${acc.address} as funder`);
            funderAddress = acc.address;
            const funderKeyPair = ec.starkCurve.getStarkKey(acc.privateKey);
            funderAccount = new Account(provider, funderAddress, funderKeyPair, '1');
            
            // Verify account is usable
            try {
                const nonce = await funderAccount.getNonce('latest');
                console.log(`   ✓ Funder account is ready (nonce: ${nonce})`);
            } catch (e) {
                console.log(`   ⚠️  Could not verify nonce: ${e.message}`);
            }
            break;
        }
    }
    
    if (!funderAccount) {
        console.error('   ✗ No deployed accounts found! Cannot proceed.');
        process.exit(1);
    }
    console.log('');
    
    // Deploy accounts
    console.log('📦 Deploying accounts...');
    let deployedCount = 0;
    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        console.log(`[${i + 1}/${accounts.length}] Processing ${acc.address}...`);
        
        const success = await deployAccount(provider, funderAccount, acc);
        if (success) {
            deployedCount++;
        }
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`\n✓ Deployed ${deployedCount}/${accounts.length} accounts\n`);
    
    // Fund accounts
    console.log('💰 Funding accounts...');
    let fundedCount = 0;
    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        console.log(`[${i + 1}/${accounts.length}] Funding ${acc.address}...`);
        
        try {
            await fundAccount(funderAccount, acc.address, FUNDING_AMOUNT);
            console.log(`  ✓ Funded with ${FUNDING_AMOUNT / 10n**18n} STRK`);
            fundedCount++;
        } catch (e) {
            console.error(`  ✗ Failed: ${e.message}`);
        }
        
        // Small delay
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log(`\n✓ Funded ${fundedCount}/${accounts.length} accounts\n`);
    console.log('✅ All done!');
}

main().catch(console.error);


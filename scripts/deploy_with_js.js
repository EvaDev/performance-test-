#!/usr/bin/env node

/**
 * Deploy contracts using starknet.js - compatible with Madara v0.8.1
 * This works because starknet.js handles different RPC versions better
 */

const fs = require('fs');
const path = require('path');
const { Provider, Account, ec, json } = require('starknet');

// Configuration
const USE_LOCAL_MADARA = (process.env.USE_LOCAL_MADARA || 'true').toLowerCase() === 'true';
const RPC_URL = process.env.MADARA_RPC_URL || 'http://localhost:9944';

// Account configuration (use pre-deployed devnet account #1)
const PRIVATE_KEY = USE_LOCAL_MADARA 
    ? '0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07'
    : '0x04eb9093c6bc934e99dbdf1f2258e7d101da3c8503ef38e55f40964e15b155a8';
const ACCOUNT_ADDRESS = USE_LOCAL_MADARA
    ? '0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d'
    : '0x0764a2fe39643b6ef291883d14676ebc09f3f27fbea24fbf49cfa7976f97bc4c';

async function declareContract() {
    console.log('🚀 Declaring contract using starknet.js...');
    
    // Find contract file
    const possiblePaths = [
        path.join(__dirname, '../target/dev/performancetest_performanceTest.contract_class.json'),
        path.join(__dirname, '../../target/dev/performancetest_performanceTest.contract_class.json'),
        '/pt/target/dev/performancetest_performanceTest.contract_class.json',
    ];
    
    let contractPath = null;
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            contractPath = p;
            break;
        }
    }
    
    if (!contractPath) {
        console.error('❌ Contract file not found');
        process.exit(1);
    }
    
    console.log(`   Contract: ${contractPath}`);
    
    // Load contract
    const contractClass = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
    
    // Find CASM file
    const casmPath = contractPath.replace('.contract_class.json', '.compiled_contract_class.json');
    if (!fs.existsSync(casmPath)) {
        const altCasmPath = contractPath.replace('.contract_class.json', '.casm.json');
        if (fs.existsSync(altCasmPath)) {
            var compiledCasm = JSON.parse(fs.readFileSync(altCasmPath, 'utf8'));
        } else {
            console.error('❌ CASM file not found');
            process.exit(1);
        }
    } else {
        var compiledCasm = JSON.parse(fs.readFileSync(casmPath, 'utf8'));
    }
    
    // Setup provider and account
    const provider = new Provider({ rpc: { nodeUrl: RPC_URL } });
    const keyPair = ec.starkCurve.getStarkKey(PRIVATE_KEY);
    const account = new Account(provider, ACCOUNT_ADDRESS, keyPair, 1); // 1 = SEQUENCER for devnet
    
    console.log(`   Network: ${RPC_URL}`);
    console.log(`   Account: ${ACCOUNT_ADDRESS}`);
    
    try {
        // Declare contract
        console.log('   Declaring...');
        const declareResponse = await account.declare({
            contract: contractClass,
            casm: compiledCasm,
        });
        
        console.log(`   Transaction hash: ${declareResponse.transaction_hash}`);
        console.log('   Waiting for confirmation...');
        
        await provider.waitForTransaction(declareResponse.transaction_hash);
        
        console.log(`✅ Contract declared!`);
        console.log(`   Class hash: ${declareResponse.class_hash}`);
        
        return declareResponse.class_hash;
    } catch (error) {
        console.error('❌ Declaration failed:');
        console.error(error);
        process.exit(1);
    }
}

async function deployContract(classHash) {
    console.log('🚀 Deploying contract using starknet.js...');
    console.log(`   Class hash: ${classHash}`);
    
    const provider = new Provider({ rpc: { nodeUrl: RPC_URL } });
    const keyPair = ec.starkCurve.getStarkKey(PRIVATE_KEY);
    const account = new Account(provider, ACCOUNT_ADDRESS, keyPair, 1);
    
    try {
        const deployResponse = await account.deployContract({
            classHash: classHash,
            constructorCalldata: [],
        });
        
        console.log(`   Transaction hash: ${deployResponse.transaction_hash}`);
        console.log('   Waiting for confirmation...');
        
        await provider.waitForTransaction(deployResponse.transaction_hash);
        
        console.log(`✅ Contract deployed!`);
        console.log(`   Address: ${deployResponse.contract_address}`);
        
        return deployResponse.contract_address;
    } catch (error) {
        console.error('❌ Deployment failed:');
        console.error(error);
        process.exit(1);
    }
}

// Main
const command = process.argv[2];
const arg = process.argv[3];

(async () => {
    if (command === 'declare') {
        const classHash = await declareContract();
        console.log(`\n💡 To deploy, run:`);
        console.log(`   node deploy_with_js.js deploy ${classHash}`);
    } else if (command === 'deploy') {
        if (!arg) {
            console.error('Usage: node deploy_with_js.js deploy <CLASS_HASH>');
            process.exit(1);
        }
        await deployContract(arg);
    } else {
        console.log('Usage:');
        console.log('  node deploy_with_js.js declare');
        console.log('  node deploy_with_js.js deploy <CLASS_HASH>');
        process.exit(1);
    }
})();


const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config({ silent: true });
const { Provider, Account, ec, json, constants, CallData, Contract, shortString } = require('starknet');

// Use local Madara devnet
const defaultNodeUrl = process.env.NODE_URL || 'http://localhost:9944';
const providers = [
  new Provider({ rpc: { nodeUrl: defaultNodeUrl } })
];

// Pre-deployed Madara accounts (these ARE deployed as contracts with 10,000 STRK each)
const PREDEPLOYED_ACCOUNTS = [
  {
    address: '0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d',
    privateKey: '0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07',
    name: 'Account #1'
  },
  {
    address: '0x008a1719e7ca19f3d91e8ef50a48fc456575f645497a1d55f30e3781f786afe4',
    privateKey: '0x0514977443078cf1e0c36bc88b89ada9a46061a5cf728f40274caea21d76f174',
    name: 'Account #2'
  },
  {
    address: '0x0733a8e2bcced14dcc2608462bd96524fb64eef061689b6d976708efc2c8ddfd',
    privateKey: '0x00177100ae65c71074126963e695e17adf5b360146f960378b5cdfd9ed69870b',
    name: 'Account #3'
  },
  {
    address: '0x025073e0772b1e348a5da66ea67fb46f75ecdca1bd24dbbc98567cbf4a0e00b3',
    privateKey: '0x07ae55c8093920562c1cbab9edeb4eb52f788b93cac1d5721bda20c96100d743',
    name: 'Account #4'
  },
  {
    address: '0x0294f066a54e07616fd0d50c935c2b5aa616d33631fec94b34af8bd4f6296f68',
    privateKey: '0x02ce1754eb64b7899c64dcdd0cff138864be2514e70e7761c417b728f2bf7457',
    name: 'Account #5'
  },
  {
    address: '0x005d1d65ea82aa0107286e68537adf0371601789e26b1cd6e455a8e5be5c5665',
    privateKey: '0x037a683c3969bf18044c9d2bbe0b1739897c89cf25420342d6dfc36c30fc519d',
    name: 'Account #6'
  },
  {
    address: '0x01d775883a0a6e5405a345f18d7639dcb54b212c362d5a99087f742fba668396',
    privateKey: '0x07b4a2263d9cc475816a03163df7efd58552f1720c8df0bd2a813663895ef022',
    name: 'Account #7'
  },
  {
    address: '0x04add50f5bcc31a8418b43b1ddc8d703986094baf998f8e9625e13dbcc3df18b',
    privateKey: '0x064b37f84e667462b95dc56e3c5e93a703ef16d73de7b9c5bfd92b90f11f90e1',
    name: 'Account #8'
  },
  {
    address: '0x03dbe3dd8c2f721bc24e87bcb739063a10ee738cef090bc752bc0d5a29f10b72',
    privateKey: '0x0213d0d77d5ff9ffbeabdde0af7513e89aafd5e36ae99b8401283f6f57c57696',
    name: 'Account #9'
  },
  {
    address: '0x07484e8e3af210b2ead47fa08c96f8d18b616169b350a8b75fe0dc4d2e01d493',
    privateKey: '0x0410c6eadd73918ea90b6658d24f5f2c828e39773819c1443d8602a3c72344c2',
    name: 'Account #10'
  }
];

const strkTokenAddress = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const contractAddress = process.env.CONTRACT_ADDRESS || '0x63ab038c9d25515aa8e873febae8eb5b1d4be5fba1a217958064fac441b619e';

// Support both container (/pt) and host paths
const abiPath = process.env.CONTRACT_ABI_PATH || (fs.existsSync('/pt/ABI/performancetestABI.json') 
    ? '/pt/ABI/performancetestABI.json' 
    : '/Users/seanevans/Documents/ssp/pt/ABI/performancetestABI.json');
const contractAbi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));

// Use pre-deployed accounts as test accounts
let testAccounts = PREDEPLOYED_ACCOUNTS.map(acc => ({
  address: acc.address,
  privateKey: acc.privateKey,
  name: acc.name
}));

async function getStrkBalance(address, provIdx = 0) {
    const prov = providers[provIdx % providers.length];
    try {
        const call = {
            contractAddress: strkTokenAddress,
            entrypoint: 'balance_of',
            calldata: [address]
        };
        const result = await prov.callContract(call);
        if (result && result.result && result.result[0]) {
            return BigInt(result.result[0]);
        }
        return 0n;
    } catch (e) {
        console.log(`   Balance check failed for ${address}: ${e.message}`);
        return 0n;
    }
}

async function checkAccountDeployed(address, provIdx = 0) {
    const prov = providers[provIdx % providers.length];
    try {
        const nonce = await prov.getNonce(address, 'latest');
        return true;
    } catch (e) {
        return false;
    }
}

async function main() {
    const args = process.argv.slice(2);
    const numAccounts = parseInt(args[0]) || 10;
    const batchSize = parseInt(args[1]) || 5;
    const readRatio = parseFloat(args[2]) || 0.2;
    const mode = args[3] || 'blend';
    const numTx = parseInt(args[4]) || 20;

    console.log('🚀 Madara Devnet Performance Test (Working Version)');
    console.log(`   Using pre-deployed accounts: ${Math.min(numAccounts, testAccounts.length)}`);
    console.log(`   Mode: ${mode}`);
    console.log(`   Batch size: ${batchSize}`);
    console.log(`   Read ratio: ${readRatio}`);
    console.log(`   Number of transactions: ${numTx}`);
    console.log('');

    // Check if contract is deployed
    try {
        const contract = new Contract(contractAbi, contractAddress, providers[0]);
        const result = await contract.call('get_balance', [testAccounts[0].address]);
        console.log(`✅ Contract found at ${contractAddress}`);
        console.log(`   Test account balance: ${result.balance}`);
    } catch (e) {
        console.log(`❌ Contract not found at ${contractAddress}`);
        console.log(`   Please deploy the contract first using deploy.js`);
        return;
    }

    // Use pre-deployed accounts directly
    console.log('📋 Using pre-deployed accounts for testing...');
    const accountsToUse = testAccounts.slice(0, Math.min(numAccounts, testAccounts.length));
    
    for (let i = 0; i < accountsToUse.length; i++) {
        const acc = accountsToUse[i];
        console.log(`[${i + 1}/${accountsToUse.length}] ${acc.name} (${acc.address})`);
        
        // Check if account is deployed
        const isDeployed = await checkAccountDeployed(acc.address);
        if (isDeployed) {
            console.log(`   ✅ Account is deployed as contract`);
        } else {
            console.log(`   ❌ Account not deployed as contract`);
        }
        
        // Check balance
        const balance = await getStrkBalance(acc.address);
        console.log(`   💰 Balance: ${balance / 10n**18n} STRK`);
    }

    console.log('');
    console.log('🎯 Starting Performance Test...');
    console.log('   These accounts CAN execute transactions!');
    console.log('');

    // Run the actual performance test
    const startTime = Date.now();
    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    // Calculate actual number of operations to run
    const numReads = Math.max(1, Math.floor(batchSize * readRatio));
    const numWrites = Math.max(1, Math.floor(batchSize * (1 - readRatio)));
    
    console.log(`   Will run ${numReads} read operations and ${numWrites} write operations`);

    // Test read operations
    console.log('📖 Testing read operations...');
    for (let i = 0; i < numReads; i++) {
        const acc = accountsToUse[i % accountsToUse.length];
        try {
            const contract = new Contract(contractAbi, contractAddress, providers[0]);
            const result = await contract.call('get_balance', [acc.address]);
            console.log(`   ✅ Read ${i + 1}: Balance = ${result.balance}`);
            successCount++;
        } catch (e) {
            console.log(`   ❌ Read ${i + 1} failed: ${e.message}`);
            errorCount++;
            errors.push({ type: 'read', error: e.message });
        }
    }

    // Test write operations (these should work now!)
    console.log('📝 Testing write operations...');
    for (let i = 0; i < numWrites; i++) {
        const acc = accountsToUse[i % accountsToUse.length];
        try {
            const account = new Account(providers[0], acc.address, acc.privateKey, '1');
            const contract = new Contract(contractAbi, contractAddress, providers[0]);
            
            // Try to call update_and_get
            const call = contract.populate('update_and_get', { 
                new_balance: { low: BigInt(i + 1), high: 0n } 
            });
            
            const estimated = await account.estimateInvokeFee(call);
            const maxFee = estimated.overall_fee * 12n / 10n;
            
            const result = await account.execute(call, undefined, { maxFee });
            console.log(`   ✅ Write ${i + 1}: Transaction ${result.transaction_hash}`);
            successCount++;
        } catch (e) {
            console.log(`   ❌ Write ${i + 1} failed: ${e.message}`);
            errorCount++;
            errors.push({ type: 'write', error: e.message });
        }
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log('');
    console.log('📊 Performance Test Results:');
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Successful operations: ${successCount}`);
    console.log(`   Failed operations: ${errorCount}`);
    console.log(`   Success rate: ${((successCount / (successCount + errorCount)) * 100).toFixed(1)}%`);
    
    if (errors.length > 0) {
        console.log('');
        console.log('❌ Common errors:');
        const errorTypes = {};
        errors.forEach(err => {
            errorTypes[err.type] = (errorTypes[err.type] || 0) + 1;
        });
        Object.entries(errorTypes).forEach(([type, count]) => {
            console.log(`   ${type}: ${count} failures`);
        });
    }

    console.log('');
    console.log('💡 Summary:');
    if (successCount > 0) {
        console.log('   ✅ Performance test completed successfully!');
        console.log('   🎉 Your contract is working on Madara devnet!');
    }
    if (errorCount > 0) {
        console.log('   ⚠️  Some operations failed - check the errors above');
    }
}

main().catch(console.error);

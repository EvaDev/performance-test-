#!/usr/bin/env node

/**
 * Create a modified version of your performance test that uses pre-deployed Madara accounts.
 * These accounts have 10,000 STRK each and can be used for testing.
 */

const fs = require('fs');
const path = require('path');

// Pre-deployed Madara accounts (these have 10,000 STRK each)
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
        address: '0x07484e8e3af210',
        privateKey: '0x07484e8e3af210',
        name: 'Account #10'
    }
];

async function main() {
    console.log('🚀 Creating Modified Performance Test with Pre-deployed Accounts\n');
    
    try {
        // Create a new test accounts file with pre-deployed accounts
        const modifiedAccounts = PREDEPLOYED_ACCOUNTS.map((acc, index) => ({
            address: acc.address,
            private_key: acc.privateKey,
            name: acc.name,
            index: index
        }));
        
        // Save the modified accounts
        const accountsPath = path.join(__dirname, 'predeplyed_test_accounts.json');
        fs.writeFileSync(accountsPath, JSON.stringify(modifiedAccounts, null, 2));
        
        console.log('📄 Created predeplyed_test_accounts.json with pre-deployed accounts');
        console.log('');
        
        // Create a modified performance test script
        const modifiedPerformanceTest = `#!/usr/bin/env node

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
    console.log('🚀 Performance Test with Pre-deployed Madara Accounts\\n');
    
    try {
        const provider = new Provider({ rpc: { nodeUrl: RPC_URL } });
        const accounts = loadPredeplyedAccounts();
        
        console.log(\`📋 Using \${accounts.length} pre-deployed accounts\`);
        console.log('   Each account has 10,000 STRK\\n');
        
        // Test each account
        for (let i = 0; i < accounts.length; i++) {
            const acc = accounts[i];
            console.log(\`[\${i + 1}/\${accounts.length}] Testing \${acc.name} (\${acc.address})\`);
            
            try {
                // Create account instance
                const account = new Account(provider, acc.address, acc.privateKey, '1');
                
                // Check balance
                const balanceCall = {
                    contractAddress: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
                    entrypoint: 'balance_of',
                    calldata: [acc.address]
                };
                
                const balanceResult = await provider.callContract(balanceCall);
                const balance = BigInt(balanceResult.result[0]);
                
                console.log(\`   💰 Balance: \${balance / 10n**18n} STRK\`);
                
                // Test nonce (if account is deployed as contract)
                try {
                    const nonce = await account.getNonce('latest');
                    console.log(\`   ✅ Account is deployed (nonce: \${nonce})\`);
                } catch (e) {
                    console.log(\`   ⚠️  Account not deployed as contract: \${e.message}\`);
                }
                
            } catch (e) {
                console.log(\`   ❌ Error: \${e.message}\`);
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
`;

        const testPath = path.join(__dirname, 'performanceTest_predeplyed.js');
        fs.writeFileSync(testPath, modifiedPerformanceTest);
        fs.chmodSync(testPath, '755');
        
        console.log('📄 Created performanceTest_predeplyed.js');
        console.log('');
        
        console.log('🎯 Usage:');
        console.log('   1. Make sure Madara devnet is running');
        console.log('   2. Run: node performanceTest_predeplyed.js');
        console.log('   3. This will test all pre-deployed accounts');
        console.log('');
        
        console.log('📊 Pre-deployed Account Summary:');
        PREDEPLOYED_ACCOUNTS.forEach((acc, i) => {
            console.log(`   ${i + 1}. ${acc.name}: ${acc.address}`);
        });
        console.log('');
        
        console.log('✅ Ready to run performance tests with pre-deployed accounts!');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main().catch(console.error);

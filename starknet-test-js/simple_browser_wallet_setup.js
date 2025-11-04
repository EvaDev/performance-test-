#!/usr/bin/env node

/**
 * Simple setup for browser wallet - shows how to use pre-deployed Madara accounts
 * that can be imported into browser wallets.
 */

const { Provider, Account, ec } = require('starknet');

// Configuration
const RPC_URL = process.env.MADARA_RPC_URL || 'http://localhost:9944';

// Pre-deployed Madara accounts (these are actual account contracts, not just funded addresses)
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
    }
];

async function main() {
    console.log('🚀 Madara Devnet Browser Wallet Setup\n');
    
    try {
        const provider = new Provider({ rpc: { nodeUrl: RPC_URL } });
        
        console.log('📋 Available Pre-deployed Accounts:');
        console.log('   These accounts have 10,000 STRK each and can be imported into browser wallets\n');
        
        for (const account of PREDEPLOYED_ACCOUNTS) {
            console.log(`🔑 ${account.name}:`);
            console.log(`   Address: ${account.address}`);
            console.log(`   Private Key: ${account.privateKey}`);
            
            // Test if the account is actually deployed as a contract
            try {
                const accountInstance = new Account(provider, account.address, account.privateKey, '1');
                const nonce = await accountInstance.getNonce('latest');
                console.log(`   Status: ✅ Deployed contract (nonce: ${nonce})`);
            } catch (e) {
                console.log(`   Status: ❌ Not a deployed contract - ${e.message}`);
            }
            console.log('');
        }
        
        console.log('🔧 Browser Wallet Import Instructions:');
        console.log('   1. Open your browser wallet (Argent X, Braavos, etc.)');
        console.log('   2. Make sure you\'re connected to Madara Devnet:');
        console.log(`      - RPC URL: ${RPC_URL}`);
        console.log('      - Chain ID: DEVNET_LOCAL');
        console.log('   3. Go to "Import Account" or "Import Private Key"');
        console.log('   4. Try importing one of the accounts above');
        console.log('   5. If it works, you can use it to fund your test accounts!');
        console.log('');
        console.log('💡 Note: If the import fails, it means the account is not a proper contract.');
        console.log('   In that case, we\'ll need to deploy a proper account contract first.');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.log('\n💡 Make sure Madara devnet is running on', RPC_URL);
    }
}

main().catch(console.error);

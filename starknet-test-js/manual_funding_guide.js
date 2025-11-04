#!/usr/bin/env node

/**
 * Manual funding guide for Madara devnet test accounts.
 * Since pre-deployed accounts can't execute transactions, we need alternative approaches.
 */

const fs = require('fs');
const path = require('path');

async function main() {
    console.log('🎯 Manual Funding Guide for Madara Devnet\n');
    
    // Load test accounts
    const accountsPath = path.join(__dirname, '../scripts/test_accounts.json');
    const accountsData = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
    const testAccounts = accountsData.slice(0, 10); // First 10 accounts
    
    console.log('📋 Test Accounts to Fund:');
    testAccounts.forEach((acc, i) => {
        const address = acc.address.startsWith('0x') ? acc.address : '0x' + acc.address;
        console.log(`   ${i + 1}. ${address}`);
    });
    console.log('');
    
    console.log('🔧 Funding Options:\n');
    
    console.log('1. 🌐 Madara Web Interface (Recommended)');
    console.log('   - Start Madara with web interface:');
    console.log('     docker run -p 9944:9944 -p 3000:3000 madara-dev:latest');
    console.log('   - Open http://localhost:3000 in browser');
    console.log('   - Use pre-deployed account to transfer STRK');
    console.log('   - Send 1000 STRK to each test account');
    console.log('');
    
    console.log('2. 🔧 Admin Commands (If Available)');
    console.log('   - Check if Madara has admin/mint endpoints');
    console.log('   - Use curl commands to mint STRK directly to accounts');
    console.log('   - Example: curl -X POST http://localhost:9944/admin/mint \\');
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -d \'{"address":"0x...","amount":"1000000000000000000000"}\'');
    console.log('');
    
    console.log('3. 📝 Modify Madara Devnet Configuration');
    console.log('   - Edit Madara devnet config to pre-fund test accounts');
    console.log('   - Add test accounts to genesis block with STRK balance');
    console.log('   - Restart Madara devnet');
    console.log('');
    
    console.log('4. 🐍 Python Script with Raw RPC');
    console.log('   - Create Python script using aiohttp');
    console.log('   - Use raw RPC calls to execute transfers');
    console.log('   - Bypass starknet.py Account class limitations');
    console.log('');
    
    console.log('5. 🔑 Deploy Account Contract First');
    console.log('   - Deploy a proper account contract using pre-deployed account');
    console.log('   - Use that account contract to fund test accounts');
    console.log('   - This requires finding the correct account class hash');
    console.log('');
    
    console.log('💡 Quick Start - Web Interface:');
    console.log('   1. Stop current Madara: pkill -f madara');
    console.log('   2. Start with web interface:');
    console.log('      docker run -p 9944:9944 -p 3000:3000 madara-dev:latest');
    console.log('   3. Open http://localhost:3000');
    console.log('   4. Import pre-deployed account:');
    console.log('      Private Key: 0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07');
    console.log('   5. Transfer 1000 STRK to each test account');
    console.log('');
    
    console.log('📊 Test Account Addresses (copy these):');
    testAccounts.forEach((acc, i) => {
        const address = acc.address.startsWith('0x') ? acc.address : '0x' + acc.address;
        console.log(`${address}`);
    });
    console.log('');
    
    console.log('✅ After funding, run: node check_balances.js');
}

main().catch(console.error);

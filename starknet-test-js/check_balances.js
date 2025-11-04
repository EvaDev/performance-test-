#!/usr/bin/env node

/**
 * Check STRK balances for test accounts
 */

const { Provider, Contract } = require('starknet');
const fs = require('fs');
const path = require('path');

const RPC_URL = process.env.MADARA_RPC_URL || 'http://localhost:9944';
const PROVIDER = new Provider({ rpc: { nodeUrl: RPC_URL } });
const STRK_TOKEN_ADDRESS = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

// STRK token ABI (just balanceOf function)
const STRK_ABI = [
    {
        "type": "function",
        "name": "balanceOf",
        "inputs": [{ "name": "account", "type": "core::starknet::contract_address::ContractAddress" }],
        "outputs": [{ "type": "core::integer::u256" }],
        "state_mutability": "view"
    }
];

function loadTestAccounts() {
    const accountsPath = path.join(__dirname, '../scripts/test_accounts.json');
    const accountsData = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
    return accountsData.map(acc => ({
        address: acc.address.startsWith('0x') ? acc.address : '0x' + acc.address,
    }));
}

async function checkBalances() {
    console.log('🔍 Checking STRK balances for test accounts...\n');
    
    const accounts = loadTestAccounts();
    const strkContract = new Contract(STRK_ABI, STRK_TOKEN_ADDRESS, PROVIDER);
    
    let accountsWithBalance = [];
    
    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        try {
            const result = await strkContract.call('balanceOf', [acc.address]);
            const balanceLow = BigInt(result[0]);
            const balanceHigh = BigInt(result[1] || 0);
            const balance = (balanceHigh << 128n) + balanceLow;
            const balanceInStrk = Number(balance) / 1e18;
            
            if (balance > 0n) {
                accountsWithBalance.push({ address: acc.address, balance: balanceInStrk });
                console.log(`[${i + 1}] ${acc.address}: ${balanceInStrk.toFixed(2)} STRK`);
            }
        } catch (e) {
            // Skip errors
        }
    }
    
    console.log(`\n✅ Found ${accountsWithBalance.length} accounts with balance`);
    
    if (accountsWithBalance.length > 0) {
        console.log('\n💡 You can use one of these accounts as the funder!');
        console.log(`   First account with balance: ${accountsWithBalance[0].address}`);
        console.log(`   Balance: ${accountsWithBalance[0].balance.toFixed(2)} STRK`);
    } else {
        console.log('\n⚠️  No accounts have STRK balance yet.');
        console.log('   You need to fund at least one account to use it as the funder.');
    }
}

checkBalances().catch(console.error);


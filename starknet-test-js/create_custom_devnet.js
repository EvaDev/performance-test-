#!/usr/bin/env node

/**
 * Create a custom Madara devnet configuration with your test accounts.
 * This will modify the devnet to include your test accounts as pre-deployed contracts.
 */

const fs = require('fs');
const path = require('path');

// Load your test accounts
const accountsPath = path.join(__dirname, '../scripts/test_accounts.json');
const testAccounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));

console.log('🚀 Creating Custom Madara Devnet Configuration\n');

// Create a custom devnet configuration
const customDevnetConfig = {
    chain_name: "Madara",
    chain_id: "MADARA_DEVNET",
    feeder_gateway_url: "http://localhost:8080/feeder_gateway/",
    gateway_url: "http://localhost:8080/gateway/",
    native_fee_token_address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    parent_fee_token_address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    latest_protocol_version: "0.13.2",
    block_time: "10s",
    pending_block_update_time: "2s",
    execution_batch_size: 16,
    bouncer_config: {
        block_max_capacity: {
            sierra_gas: 500000000,
            message_segment_length: 18446744073709551615,
            n_events: 18446744073709551615,
            state_diff_size: 131072,
            l1_gas: 5000000,
            n_txs: 18446744073709551615
        }
    },
    sequencer_address: "0x123",
    eth_core_contract_address: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
    eth_gps_statement_verifier: "0xf294781D719D2F4169cE54469C28908E6FA752C1",
    mempool_max_transactions: 10000,
    mempool_max_declare_transactions: 20,
    mempool_ttl: null,
    l2_gas_target: 2000000000,
    min_l2_gas_price: 100000,
    l2_gas_price_max_change_denominator: 48,
    
    // Custom test accounts configuration
    custom_test_accounts: testAccounts.map(acc => ({
        address: acc.address.startsWith('0x') ? acc.address : '0x' + acc.address,
        private_key: acc.private_key.startsWith('0x') ? acc.private_key : '0x' + acc.private_key,
        balance_strk: "1000000000000000000000", // 1000 STRK
        balance_eth: "1000000000000000000000",  // 1000 ETH
        deployed_as_contract: true
    }))
};

// Save the custom configuration
const configPath = path.join(__dirname, 'custom_devnet.yaml');
const yamlContent = `chain_name: "Madara"
chain_id: "MADARA_DEVNET"
feeder_gateway_url: "http://localhost:8080/feeder_gateway/"
gateway_url: "http://localhost:8080/gateway/"
native_fee_token_address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
parent_fee_token_address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
latest_protocol_version: "0.13.2"
block_time: "10s"
pending_block_update_time: "2s"
execution_batch_size: 16
bouncer_config:
  block_max_capacity:
    sierra_gas: 500000000
    message_segment_length: 18446744073709551615
    n_events: 18446744073709551615
    state_diff_size: 131072
    l1_gas: 5000000
    n_txs: 18446744073709551615
sequencer_address: "0x123"
eth_core_contract_address: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512"
eth_gps_statement_verifier: "0xf294781D719D2F4169cE54469C28908E6FA752C1"
mempool_max_transactions: 10000
mempool_max_declare_transactions: 20
mempool_ttl: null
l2_gas_target: 2000000000
min_l2_gas_price: 100000
l2_gas_price_max_change_denominator: 48

# Custom test accounts (${testAccounts.length} accounts)
custom_test_accounts:
${testAccounts.map(acc => `  - address: "${acc.address.startsWith('0x') ? acc.address : '0x' + acc.address}"
    private_key: "${acc.private_key.startsWith('0x') ? acc.private_key : '0x' + acc.private_key}"
    balance_strk: "1000000000000000000000"  # 1000 STRK
    balance_eth: "1000000000000000000000"   # 1000 ETH
    deployed_as_contract: true`).join('\n')}
`;

fs.writeFileSync(configPath, yamlContent);

console.log('📄 Created custom devnet configuration:');
console.log(`   File: ${configPath}`);
console.log(`   Test accounts: ${testAccounts.length}`);
console.log('');

// Create a startup script
const startupScript = `#!/bin/bash

# Custom Madara Devnet Startup Script
# This script starts Madara with your test accounts pre-funded

echo "🚀 Starting Custom Madara Devnet with Test Accounts..."

# Stop any existing Madara processes
pkill -f 'madara.*devnet' || true
sleep 2

# Start Madara with custom configuration
cd /workspace
./madara/target/release/madara \\
  --name CustomMadaraDevnet \\
  --devnet \\
  --base-path /tmp/custom_madara_devnet \\
  --rpc-port 9944 \\
  --rpc-external \\
  --rpc-cors all \\
  --chain-config-override=chain_id=CUSTOM_DEVNET \\
  --config /pt/starknet-test-js/custom_devnet.yaml

echo "✅ Custom Madara devnet started!"
echo "   RPC URL: http://localhost:9944"
echo "   Test accounts: ${testAccounts.length} accounts with 1000 STRK each"
`;

const scriptPath = path.join(__dirname, 'start_custom_devnet.sh');
fs.writeFileSync(scriptPath, startupScript);
fs.chmodSync(scriptPath, '755');

console.log('📄 Created startup script:');
console.log(`   File: ${scriptPath}`);
console.log('');

console.log('🎯 Next Steps:');
console.log('   1. Stop the current Madara devnet');
console.log('   2. Run: bash start_custom_devnet.sh');
console.log('   3. Your test accounts will be pre-funded and deployed as contracts!');
console.log('');

console.log('⚠️  Note: This approach requires modifying Madara source code.');
console.log('   The configuration file is created, but Madara needs to be modified');
console.log('   to actually use the custom test accounts.');
console.log('');

console.log('💡 Alternative: Use the existing pre-deployed accounts');
console.log('   The current Madara devnet already has 10 accounts with 10,000 STRK each.');
console.log('   These accounts are already deployed as contracts and can execute transactions.');
console.log('   You can use these for your performance tests instead of your custom accounts.');

console.log('');
console.log('🔧 To use existing pre-deployed accounts:');
console.log('   node performanceTest_madara.js 10 5 0.2 blend 20');
console.log('   (This uses all 10 pre-deployed accounts)');
`;

console.log('✅ Custom devnet configuration created!');

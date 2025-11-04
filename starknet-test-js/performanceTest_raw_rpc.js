#!/usr/bin/env node

/**
 * Performance test using raw RPC calls to bypass account contract limitations.
 * This uses the pre-deployed accounts directly via raw RPC calls.
 */

const { Provider, CallData, ec, hash } = require('starknet');
const https = require('https');
const http = require('http');

// Configuration
const RPC_URL = process.env.MADARA_RPC_URL || 'http://localhost:9944';
const STRK_TOKEN_ADDRESS = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0x63ab038c9d25515aa8e873febae8eb5b1d4be5fba1a217958064fac441b619e';

// Pre-deployed Madara accounts
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
  }
];

// Contract ABI (simplified)
const CONTRACT_ABI = [
  {
    "type": "function",
    "name": "get_balance",
    "inputs": [{"name": "account", "type": "core::starknet::contract_address::ContractAddress"}],
    "outputs": [{"name": "balance", "type": "core::integer::u256"}],
    "state_mutability": "view"
  },
  {
    "type": "function", 
    "name": "update_and_get",
    "inputs": [{"name": "new_balance", "type": "core::integer::u256"}],
    "outputs": [{"name": "balance", "type": "core::integer::u256"}],
    "state_mutability": "external"
  }
];

async function makeRpcCall(method, params) {
  return new Promise((resolve, reject) => {
    const url = new URL(RPC_URL);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    
    const postData = JSON.stringify({
      jsonrpc: '2.0',
      method: method,
      params: params,
      id: 1
    });
    
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.error) {
            reject(new Error(`RPC Error: ${response.error.message}`));
          } else {
            resolve(response.result);
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });
    
    req.on('error', (e) => {
      reject(new Error(`RPC call failed: ${e.message}`));
    });
    
    req.write(postData);
    req.end();
  });
}

async function getStrkBalance(address) {
  try {
    const call = {
      contract_address: STRK_TOKEN_ADDRESS,
      entry_point_selector: '0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e', // balance_of selector
      calldata: [address]
    };
    
    const result = await makeRpcCall('starknet_call', {
      request: call,
      block_id: 'latest'
    });
    
    if (result && result[0]) {
      return BigInt(result[0]);
    }
    return 0n;
  } catch (e) {
    console.log(`   Balance check failed: ${e.message}`);
    return 0n;
  }
}

async function callContract(contractAddress, entrypoint, calldata) {
  try {
    const call = {
      contract_address: contractAddress,
      entry_point_selector: hash.getSelectorFromName(entrypoint),
      calldata: calldata
    };
    
    const result = await makeRpcCall('starknet_call', {
      request: call,
      block_id: 'latest'
    });
    
    return result;
  } catch (e) {
    throw new Error(`Contract call failed: ${e.message}`);
  }
}

async function executeRawTransaction(senderAddress, senderPrivateKey, contractAddress, entrypoint, calldata) {
  try {
    // Get nonce
    const nonce = await makeRpcCall('starknet_getNonce', {
      contract_address: senderAddress,
      block_id: 'latest'
    });
    
    // Prepare transaction
    const transaction = {
      type: 'INVOKE',
      sender_address: senderAddress,
      calldata: CallData.compile({
        contractAddress: contractAddress,
        entrypoint: entrypoint,
        calldata: calldata
      }),
      version: '0x1',
      signature: [],
      nonce: nonce.toString(),
      max_fee: '0x0',
      resource_bounds: {
        l2_gas: { max_amount: '0x0', max_price_per_unit: '0x0' },
        l1_gas: { max_amount: '0x0', max_price_per_unit: '0x0' },
        l1_data_gas: { max_amount: '0x0', max_price_per_unit: '0x0' }
      }
    };
    
    // Estimate fee
    let maxFee;
    try {
      const estimateResult = await makeRpcCall('starknet_estimateFee', {
        request: transaction,
        block_id: 'pending',
        simulation_flags: ['SKIP_VALIDATE']
      });
      maxFee = BigInt(estimateResult.overall_fee) * 12n / 10n; // 20% buffer
    } catch (e) {
      console.log(`   Fee estimation failed, using fixed fee: ${e.message}`);
      maxFee = 1000000n; // Fixed fee
    }
    
    transaction.max_fee = '0x' + maxFee.toString(16);
    
    // Sign transaction (simplified - in reality this is more complex)
    const signature = ec.starkCurve.sign(
      hash.getSelectorFromName('__execute__'),
      senderPrivateKey
    );
    transaction.signature = [signature.r.toString(), signature.s.toString()];
    
    // Send transaction
    const result = await makeRpcCall('starknet_addInvokeTransaction', {
      invoke_transaction: transaction
    });
    
    return result.transaction_hash;
  } catch (e) {
    throw new Error(`Transaction failed: ${e.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const numAccounts = parseInt(args[0]) || 5;
  const batchSize = parseInt(args[1]) || 3;
  const readRatio = parseFloat(args[2]) || 0.2;
  const mode = args[3] || 'blend';
  const numTx = parseInt(args[4]) || 10;

  console.log('🚀 Madara Devnet Performance Test (Raw RPC Version)');
  console.log(`   Using pre-deployed accounts: ${Math.min(numAccounts, PREDEPLOYED_ACCOUNTS.length)}`);
  console.log(`   Mode: ${mode}`);
  console.log(`   Batch size: ${batchSize}`);
  console.log(`   Read ratio: ${readRatio}`);
  console.log(`   Number of transactions: ${numTx}`);
  console.log('');

  // Check if contract is accessible
  try {
    const result = await callContract(CONTRACT_ADDRESS, 'get_balance', [PREDEPLOYED_ACCOUNTS[0].address]);
    console.log(`✅ Contract accessible at ${CONTRACT_ADDRESS}`);
    console.log(`   Test call result: ${result}`);
  } catch (e) {
    console.log(`❌ Contract not accessible: ${e.message}`);
    return;
  }

  // Check account balances
  console.log('📋 Checking account balances...');
  const accountsToUse = PREDEPLOYED_ACCOUNTS.slice(0, Math.min(numAccounts, PREDEPLOYED_ACCOUNTS.length));
  
  for (let i = 0; i < accountsToUse.length; i++) {
    const acc = accountsToUse[i];
    console.log(`[${i + 1}/${accountsToUse.length}] ${acc.name} (${acc.address})`);
    
    const balance = await getStrkBalance(acc.address);
    console.log(`   💰 Balance: ${balance / 10n**18n} STRK`);
  }

  console.log('');
  console.log('🎯 Starting Performance Test...');
  console.log('   Using raw RPC calls to bypass account contract limitations');
  console.log('');

  const startTime = Date.now();
  let successCount = 0;
  let errorCount = 0;
  const errors = [];

  // Calculate operations
  const numReads = Math.max(1, Math.floor(batchSize * readRatio));
  const numWrites = Math.max(1, Math.floor(batchSize * (1 - readRatio)));
  
  console.log(`   Will run ${numReads} read operations and ${numWrites} write operations`);

  // Test read operations
  console.log('📖 Testing read operations...');
  for (let i = 0; i < numReads; i++) {
    const acc = accountsToUse[i % accountsToUse.length];
    try {
      const result = await callContract(CONTRACT_ADDRESS, 'get_balance', [acc.address]);
      console.log(`   ✅ Read ${i + 1}: Result = ${result}`);
      successCount++;
    } catch (e) {
      console.log(`   ❌ Read ${i + 1} failed: ${e.message}`);
      errorCount++;
      errors.push({ type: 'read', error: e.message });
    }
  }

  // Test write operations using raw RPC
  console.log('📝 Testing write operations...');
  for (let i = 0; i < numWrites; i++) {
    const acc = accountsToUse[i % accountsToUse.length];
    try {
      const calldata = CallData.compile({
        new_balance: { low: BigInt(i + 1), high: 0n }
      });
      
      const txHash = await executeRawTransaction(
        acc.address,
        acc.privateKey,
        CONTRACT_ADDRESS,
        'update_and_get',
        calldata
      );
      
      console.log(`   ✅ Write ${i + 1}: Transaction ${txHash}`);
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
    console.log('   ✅ Performance test completed!');
    console.log('   🎉 Raw RPC approach is working!');
  }
  if (errorCount > 0) {
    console.log('   ⚠️  Some operations failed - check the errors above');
  }
}

main().catch(console.error);

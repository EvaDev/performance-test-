#!/usr/bin/env node

/**
 * Test if the contract is accessible and working.
 */

const { Provider, CallData, ec, hash } = require('starknet');
const https = require('https');
const http = require('http');

// Configuration
const RPC_URL = process.env.MADARA_RPC_URL || 'http://localhost:9944';
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0x63ab038c9d25515aa8e873febae8eb5b1d4be5fba1a217958064fac441b619e';

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

async function testContractAccess() {
  console.log('🔍 Testing Contract Access\n');
  
  try {
    // Test 1: Check if contract exists
    console.log('1. Checking if contract exists...');
    try {
      const classHash = await makeRpcCall('starknet_getClassHashAt', {
        contract_address: CONTRACT_ADDRESS
      });
      console.log(`   ✅ Contract exists, class hash: ${classHash}`);
    } catch (e) {
      console.log(`   ❌ Contract not found: ${e.message}`);
      return;
    }
    
    // Test 2: Try a simple call
    console.log('\n2. Testing simple contract call...');
    try {
      const call = {
        contract_address: CONTRACT_ADDRESS,
        entry_point_selector: '0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e', // get_balance selector
        calldata: ['0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d'] // Account #1
      };
      
      const result = await makeRpcCall('starknet_call', {
        request: call,
        block_id: 'latest'
      });
      
      console.log(`   ✅ Contract call successful: ${result}`);
    } catch (e) {
      console.log(`   ❌ Contract call failed: ${e.message}`);
    }
    
    // Test 3: Check block info
    console.log('\n3. Checking block info...');
    try {
      const block = await makeRpcCall('starknet_getBlockWithTxs', {
        block_id: 'latest'
      });
      console.log(`   ✅ Latest block: ${block.block_number}`);
      console.log(`   Transactions: ${block.transactions.length}`);
    } catch (e) {
      console.log(`   ❌ Block info failed: ${e.message}`);
    }
    
    // Test 4: Check chain info
    console.log('\n4. Checking chain info...');
    try {
      const chainId = await makeRpcCall('starknet_chainId', {});
      console.log(`   ✅ Chain ID: ${chainId}`);
    } catch (e) {
      console.log(`   ❌ Chain info failed: ${e.message}`);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testContractAccess().catch(console.error);

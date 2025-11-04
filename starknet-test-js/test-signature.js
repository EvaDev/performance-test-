#!/usr/bin/env node

/**
 * Test script to debug signature validation issue with starkli deploy on Madara
 * This script manually constructs the same transaction that starkli would create
 * and tests signature validation
 */

const { Account, Provider, ec, hash, CallData } = require("starknet");
const fs = require("fs");

// Configuration
const RPC_URL = "http://localhost:9944";
const ACCOUNT_ADDRESS = "0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d";
const ACCOUNT_PRIVATE_KEY = "0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07";
const CLASS_HASH = "0x31dc017a851d04d829dd00745f0aef11b6c41d4d6cf6bed9b22108521bc50ba";

async function testSignature() {
  console.log("🔍 Testing signature validation issue...");
  console.log(`   Account: ${ACCOUNT_ADDRESS}`);
  console.log(`   Class hash: ${CLASS_HASH}`);
  
  // Initialize provider and account
  const provider = new Provider({ rpc: { nodeUrl: RPC_URL } });
  const keyPair = ec.starkCurve.getStarkKey(ACCOUNT_PRIVATE_KEY);
  const account = new Account(provider, ACCOUNT_ADDRESS, keyPair, 1);
  
  console.log(`   Public key: ${ec.starkCurve.getStarkKey(ACCOUNT_PRIVATE_KEY)}`);
  
  // Get nonce via direct RPC call
  console.log("\n📊 Fetching account state...");
  try {
    const https = require('https');
    const http = require('http');
    const httpModule = RPC_URL.startsWith('https') ? https : http;
    const parsedUrl = new URL(RPC_URL);
    
    const nonceRequest = JSON.stringify({
      jsonrpc: '2.0',
      method: 'starknet_getNonce',
      params: {
        contract_address: ACCOUNT_ADDRESS,
        block_id: 'pending'
      },
      id: 1
    });
    
    const nonceResult = await new Promise((resolve, reject) => {
      const req = httpModule.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname || '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(nonceRequest)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.error) reject(new Error(result.error.message || 'RPC error'));
            else resolve(result.result);
          } catch (e) {
            reject(new Error(`Failed to parse: ${e.message}`));
          }
        });
      });
      req.on('error', reject);
      req.write(nonceRequest);
      req.end();
    });
    
    console.log(`   Nonce: ${nonceResult}`);
  } catch (error) {
    console.error(`   ❌ Failed to get nonce: ${error.message}`);
    return;
  }
  
  // Get account class hash via direct RPC call
  try {
    const classHashRequest = JSON.stringify({
      jsonrpc: '2.0',
      method: 'starknet_getClassHashAt',
      params: {
        contract_address: ACCOUNT_ADDRESS,
        block_id: 'latest'
      },
      id: 1
    });
    
    const parsedUrl = new URL(RPC_URL);
    const httpModule = RPC_URL.startsWith('https') ? require('https') : require('http');
    
    const classHashResult = await new Promise((resolve, reject) => {
      const req = httpModule.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname || '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(classHashRequest)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.error) reject(new Error(result.error.message || 'RPC error'));
            else resolve(result.result);
          } catch (e) {
            reject(new Error(`Failed to parse: ${e.message}`));
          }
        });
      });
      req.on('error', reject);
      req.write(classHashRequest);
      req.end();
    });
    
    console.log(`   Account class hash: ${classHashResult}`);
  } catch (error) {
    console.error(`   ❌ Failed to get class hash: ${error.message}`);
    return;
  }
  
  // Test what starkli would deploy - UDC.deployContract
  console.log("\n🔨 Testing UDC deployment transaction...");
  const UDC_ADDRESS = "0x41a78e741e5af2fec34b695679bc6891742439f7afb8484ecd7766661ad02bf";
  const UDC_DEPLOY_SELECTOR = "0x1987cbd17808b9a23693d4de7e246a443cfe37e6e7fbaeabd7d7e6532b07c3d";
  
  // Generate salt (same as starkli would)
  const crypto = require("crypto");
  const salt = "0x1b38a366c1bad2a17d18c4defae817c2eb098b8bd0339dd0b3811b59caebec0";
  
  // Build calldata for UDC.deployContract
  const deployCalldata = CallData.compile([
    CLASS_HASH,
    salt,
    0, // unique = false
    0, // constructor calldata length
  ]);
  
  console.log(`   UDC address: ${UDC_ADDRESS}`);
  console.log(`   Salt: ${salt}`);
  console.log(`   Calldata: ${deployCalldata.join(", ")}`);
  
  // Get chain ID
  try {
    const chainIdRequest = JSON.stringify({
      jsonrpc: '2.0',
      method: 'starknet_chainId',
      params: [],
      id: 1
    });
    
    const parsedUrl = new URL(RPC_URL);
    const httpModule = RPC_URL.startsWith('https') ? require('https') : require('http');
    
    const chainIdResult = await new Promise((resolve, reject) => {
      const req = httpModule.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname || '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(chainIdRequest)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.error) reject(new Error(result.error.message || 'RPC error'));
            else resolve(result.result);
          } catch (e) {
            reject(new Error(`Failed to parse: ${e.message}`));
          }
        });
      });
      req.on('error', reject);
      req.write(chainIdRequest);
      req.end();
    });
    
    console.log(`   Chain ID: ${chainIdResult}`);
    console.log(`   Sepolia Chain ID: 0x534e5f5345504f4c4941 (SN_SEPOLIA)`);
    console.log(`   Mainnet Chain ID: 0x534e5f4d41494e (SN_MAIN)`);
  } catch (error) {
    console.error(`   ❌ Failed to get chain ID: ${error.message}`);
  }
  
  // Try to execute the transaction (this will show us the transaction hash calculation)
  console.log("\n📝 Attempting transaction construction...");
  try {
    // Manually patch getNonce to use direct RPC
    const originalGetNonce = account.getNonce.bind(account);
    account.getNonce = async () => {
      // Use direct RPC call
      const parsedUrl = new URL(RPC_URL);
      const httpModule = RPC_URL.startsWith('https') ? require('https') : require('http');
      const nonceRequest = JSON.stringify({
        jsonrpc: '2.0',
        method: 'starknet_getNonce',
        params: { contract_address: ACCOUNT_ADDRESS, block_id: 'pending' },
        id: 1
      });
      
      return new Promise((resolve, reject) => {
        const req = httpModule.request({
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
          path: parsedUrl.pathname || '/',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(nonceRequest)
          }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const result = JSON.parse(data);
              if (result.error) reject(new Error(result.error.message));
              else resolve(BigInt(result.result));
            } catch (e) {
              reject(e);
            }
          });
        });
        req.on('error', reject);
        req.write(nonceRequest);
        req.end();
      });
    };
    
    // This will construct the transaction and calculate the hash
    // Even if it fails, we can see what hash it's trying to sign
    const response = await account.execute({
      contractAddress: UDC_ADDRESS,
      entrypoint: "deployContract",
      calldata: deployCalldata,
      maxFee: "0x174876e800"
    });
    
    console.log(`   ✅ Transaction hash: ${response.transaction_hash}`);
  } catch (error) {
    console.error(`   ❌ Transaction failed: ${error.message}`);
    
    // If it's a signature validation error, let's see what hash was calculated
    if (error.message.includes("signature") || error.message.includes("validate")) {
      console.log("\n🔍 Signature validation error detected!");
      console.log("   This suggests the transaction hash calculation might differ");
      console.log("   between what starkli calculates and what Madara expects.");
      console.log("\n💡 Possible causes:");
      console.log("   1. Transaction version mismatch (v2 vs v3)");
      console.log("   2. Chain ID mismatch");
      console.log("   3. Nonce mismatch");
      console.log("   4. Data availability mode differences");
    }
  }
}

testSignature().catch(console.error);


#!/usr/bin/env node

/**
 * Deploy/Declare script using Starknet.js (like the tests do)
 * This works around starkli signature compatibility issues
 */

const { Provider, Account, ec, hash, CallData } = require("starknet");
const fs = require("fs");
const path = require("path");

// Configuration
// Use the base RPC endpoint (Madara handles versioning internally)
const RPC_URL = process.env.MADARA_RPC_URL || "http://localhost:9944";
const ACCOUNT_ADDRESS = process.env.ACCOUNT_ADDRESS || "0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d";
const ACCOUNT_PRIVATE_KEY = process.env.ACCOUNT_PRIVATE_KEY || "0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07";

// Get command and arguments from command line
const command = process.argv[2];
const arg = process.argv[3];

if (!command) {
  console.error("Usage:");
  console.error("  node deploy-contract.js declare <path-to-contract-class.json>");
  console.error("  node deploy-contract.js deploy <class-hash> [constructor-calldata-json]");
  console.error("");
  console.error("Examples:");
  console.error("  node deploy-contract.js declare target/dev/performancetest_performanceTest.contract_class.json");
  console.error("  node deploy-contract.js deploy 0x31dc017a851d04d829dd00745f0aef11b6c41d4d6cf6bed9b22108521bc50ba");
  process.exit(1);
}

async function declareContract() {
  const contractFilePath = arg;
  
  try {
    console.log("🚀 Starting contract declaration...");
    console.log(`   RPC: ${RPC_URL}`);
    console.log(`   Account: ${ACCOUNT_ADDRESS}`);
    console.log(`   Contract: ${contractFilePath}`);

    // Initialize provider with base RPC endpoint
    const provider = new Provider({ 
      rpc: { nodeUrl: RPC_URL }
    });
    const keyPair = ec.starkCurve.getStarkKey(ACCOUNT_PRIVATE_KEY);
    const account = new Account(provider, ACCOUNT_ADDRESS, keyPair, 1);

    // Helper function to fetch nonce via direct RPC call (starknet.js getNonce sometimes fails)
    async function getNonceDirectRPC(address, blockIdentifier = 'pending') {
      const https = require('https');
      const http = require('http');
      const httpModule = RPC_URL.startsWith('https') ? https : http;
      
      const requestBody = JSON.stringify({
        jsonrpc: '2.0',
        method: 'starknet_getNonce',
        params: {
          contract_address: address,
          block_id: blockIdentifier
        },
        id: 1
      });
      
      const parsedUrl = new URL(RPC_URL);
      const postOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname || '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody)
        }
      };
      
      return new Promise((resolve, reject) => {
        const req = httpModule.request(postOptions, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const result = JSON.parse(data);
              if (result.error) {
                reject(new Error(result.error.message || 'RPC error'));
              } else {
                resolve(result.result);
              }
            } catch (e) {
              reject(e);
            }
          });
        });
        req.on('error', reject);
        req.write(requestBody);
        req.end();
      });
    }

    // Manually fetch nonce using direct RPC call
    console.log("   Fetching account nonce...");
    let accountNonce = 0n;
    try {
      const nonceResult = await getNonceDirectRPC(ACCOUNT_ADDRESS, 'pending');
      accountNonce = BigInt(nonceResult);
      console.log(`   ✓ Nonce: ${accountNonce.toString()}`);
    } catch (error) {
      console.log(`   ⚠ Could not fetch nonce: ${error.message}`);
      console.log(`   Proceeding with nonce 0`);
      accountNonce = 0n;
    }

    // Patch provider's getNonce method if it exists
    if (typeof provider.getNonce === 'function') {
      const originalGetNonce = provider.getNonce.bind(provider);
      provider.getNonce = async (address, blockIdentifier = 'pending') => {
        try {
          return await getNonceDirectRPC(address, blockIdentifier);
        } catch (error) {
          // Fall back to original method if direct RPC fails
          return originalGetNonce(address, blockIdentifier);
        }
      };
    }
    
    // Also patch account's getNonce if it exists
    if (typeof account.getNonce === 'function') {
      const originalAccountGetNonce = account.getNonce.bind(account);
      account.getNonce = async (blockIdentifier = 'pending') => {
        try {
          return await getNonceDirectRPC(ACCOUNT_ADDRESS, blockIdentifier);
        } catch (error) {
          // Fall back to original method
          return originalAccountGetNonce(blockIdentifier);
        }
      };
    }

    // Read the contract class file
    const contractPath = path.isAbsolute(contractFilePath) 
      ? contractFilePath 
      : path.join(process.cwd(), contractFilePath);
    
    if (!fs.existsSync(contractPath)) {
      throw new Error(`Contract file not found: ${contractPath}`);
    }

    const contractData = JSON.parse(fs.readFileSync(contractPath, "utf-8"));
    
    // Check if it's Sierra (Cairo 1) or Legacy (Cairo 0)
    const isSierra = contractData.sierra_program !== undefined;
    
    let declareResponse;
    
    if (isSierra) {
      // Cairo 1 - need both Sierra and CASM
      // Try to find CASM file (could be .casm.json or .compiled_contract_class.json)
      const basePath = contractPath.replace(/\.(json|sierra\.json|contract_class\.json)$/, "");
      const casmPath1 = basePath + ".casm.json";
      const casmPath2 = basePath + ".compiled_contract_class.json";
      let casm = null;
      let casmPath = null;
      
      if (fs.existsSync(casmPath2)) {
        casmPath = casmPath2;
        casm = JSON.parse(fs.readFileSync(casmPath, "utf-8"));
        console.log("   Found CASM file (.compiled_contract_class.json), using both Sierra and CASM");
      } else if (fs.existsSync(casmPath1)) {
        casmPath = casmPath1;
        casm = JSON.parse(fs.readFileSync(casmPath, "utf-8"));
        console.log("   Found CASM file (.casm.json), using both Sierra and CASM");
      } else {
        console.log("   Error: CASM file not found!");
        console.log(`   Tried: ${casmPath1}`);
        console.log(`   Tried: ${casmPath2}`);
        throw new Error("CASM file is required for Cairo 1 declarations. Please provide the compiled contract class file.");
      }

      // Calculate class hash first to check if contract is already declared
      const classHash = hash.computeContractClassHash(contractData);
      console.log(`   Class hash: ${classHash}`);
      
      // Check if contract is already declared
      console.log("   Checking if contract is already declared...");
      try {
        const existingClass = await provider.getClassByHash(classHash);
        if (existingClass) {
          console.log(`\n✅ Contract is already declared!`);
          console.log(`   Class hash: ${classHash}`);
          return {
            classHash: classHash,
            transactionHash: null,
            alreadyDeclared: true
          };
        }
      } catch (error) {
        // If getClassByHash fails, contract is not declared (or error finding it)
        // This is fine, we'll proceed with declaration
        console.log(`   Contract not found, proceeding with declaration...`);
      }

      // Declare with RPC 0.9.0 - use declare which handles Sierra and CASM
      console.log("   Declaring contract...");
      declareResponse = await account.declare({
        contract: contractData,
        casm: casm,
      });
    } else {
      // Legacy Cairo 0
      declareResponse = await account.declare({
        contract: contractData,
      });
    }

    console.log(`\n✅ Transaction sent: ${declareResponse.transaction_hash}`);
    console.log("⏳ Waiting for confirmation...");

    // Wait for transaction to be confirmed
    await provider.waitForTransaction(declareResponse.transaction_hash);

    console.log(`\n✅ Contract declared successfully!`);
    console.log(`   Class hash: ${declareResponse.class_hash}`);
    console.log(`   Transaction hash: ${declareResponse.transaction_hash}`);

    return {
      classHash: declareResponse.class_hash,
      transactionHash: declareResponse.transaction_hash,
    };
  } catch (error) {
    console.error("\n❌ Error declaring contract:");
    console.error(error);
    process.exit(1);
  }
}

async function deployContract() {
  try {
    const classHash = arg;
    
    if (!classHash) {
      console.error("❌ Error: Class hash required for deployment");
      console.error("Usage: node deploy-contract.js deploy <class-hash> [constructor-calldata-json]");
      process.exit(1);
    }

    console.log("🚀 Starting contract deployment...");
    console.log(`   RPC: ${RPC_URL}`);
    console.log(`   Account: ${ACCOUNT_ADDRESS}`);
    console.log(`   Class hash: ${classHash}`);

    // Initialize provider
    const provider = new Provider({ 
      rpc: { nodeUrl: RPC_URL }
    });
    const keyPair = ec.starkCurve.getStarkKey(ACCOUNT_PRIVATE_KEY);
    const account = new Account(provider, ACCOUNT_ADDRESS, keyPair, 1);

    // Helper function to fetch nonce via direct RPC call (same as in declare function)
    async function getNonceDirectRPC(address, blockIdentifier = 'pending') {
      const https = require('https');
      const http = require('http');
      const httpModule = RPC_URL.startsWith('https') ? https : http;
      
      const requestBody = JSON.stringify({
        jsonrpc: '2.0',
        method: 'starknet_getNonce',
        params: {
          contract_address: address,
          block_id: blockIdentifier
        },
        id: 1
      });
      
      const parsedUrl = new URL(RPC_URL);
      const postOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname || '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody)
        }
      };
      
      return new Promise((resolve, reject) => {
        const req = httpModule.request(postOptions, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const result = JSON.parse(data);
              if (result.error) {
                reject(new Error(result.error.message || 'RPC error'));
              } else {
                resolve(result.result);
              }
            } catch (e) {
              reject(e);
            }
          });
        });
        req.on('error', reject);
        req.write(requestBody);
        req.end();
      });
    }

    // Manually fetch nonce using direct RPC call
    console.log("   Fetching account nonce...");
    let accountNonce = 0n;
    try {
      const nonceResult = await getNonceDirectRPC(ACCOUNT_ADDRESS, 'pending');
      accountNonce = BigInt(nonceResult);
      console.log(`   ✓ Nonce: ${accountNonce.toString()}`);
    } catch (error) {
      console.log(`   ⚠ Could not fetch nonce: ${error.message}`);
      console.log(`   Proceeding with nonce 0`);
      accountNonce = 0n;
    }

    // Patch provider's getNonce method if it exists
    if (typeof provider.getNonce === 'function') {
      const originalGetNonce = provider.getNonce.bind(provider);
      provider.getNonce = async (address, blockIdentifier = 'pending') => {
        try {
          return await getNonceDirectRPC(address, blockIdentifier);
        } catch (error) {
          // Fall back to original method if direct RPC fails
          return originalGetNonce(address, blockIdentifier);
        }
      };
    }
    
    // Also patch account's getNonce if it exists
    if (typeof account.getNonce === 'function') {
      const originalAccountGetNonce = account.getNonce.bind(account);
      account.getNonce = async (blockIdentifier = 'pending') => {
        try {
          return await getNonceDirectRPC(ACCOUNT_ADDRESS, blockIdentifier);
        } catch (error) {
          // Fall back to original method
          return originalAccountGetNonce(blockIdentifier);
        }
      };
    }

    // Check if account contract is deployed (required for deploying contracts)
    // Note: We'll proceed with deployment - if account is not deployed, the deployment will fail with a clear error
    console.log("   Proceeding with deployment (account deployment will be verified during execution)...");

    // Parse constructor calldata if provided
    let constructorCalldata = [];
    if (process.argv[4]) {
      try {
        constructorCalldata = JSON.parse(process.argv[4]);
      } catch (e) {
        console.error(`❌ Error parsing constructor calldata: ${e.message}`);
        process.exit(1);
      }
    }

    console.log("   Deploying contract...");
    
    // Workaround for RPC version mismatch: starknet.js always calls fee estimation internally,
    // which requires RPC 0.9.0, but other operations work with 0.8.1
    // Since we can't bypass fee estimation, we need to patch it to use 0.9.0 endpoint for fee estimation
    
    const feeEstimateUrl = RPC_URL.replace(/\/$/, '') + '/rpc/v0.9.0/';
    
    // Helper function to make RPC call to specific endpoint
    async function makeRpcCall(method, params, endpoint) {
      const https = require('https');
      const http = require('http');
      const httpModule = endpoint.startsWith('https') ? https : http;
      
      const parsedUrl = new URL(endpoint);
      const requestBody = JSON.stringify({
        jsonrpc: '2.0',
        method: method,
        params: params,
        id: 1
      });
      
      const postOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname || '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody)
        }
      };
      
      return new Promise((resolve, reject) => {
        const req = httpModule.request(postOptions, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const result = JSON.parse(data);
              if (result.error) {
                const errorMsg = result.error.message || 'RPC error';
                const errorCode = result.error.code;
                const errorData = result.error.data ? (typeof result.error.data === 'string' ? result.error.data : JSON.stringify(result.error.data)) : '';
                const fullError = `${errorMsg}${errorCode ? ` (code: ${errorCode})` : ''}${errorData ? ` - ${errorData}` : ''}`;
                reject(new Error(fullError));
              } else {
                resolve(result.result);
              }
            } catch (e) {
              reject(new Error(`Failed to parse RPC response: ${e.message}. Response: ${data.substring(0, 500)}`));
            }
          });
        });
        req.on('error', reject);
        req.write(requestBody);
        req.end();
      });
    }
    
    // Try using Account.execute with UDC instead of Account.deployContract
    // Account.deployContract uses v3 with resource bounds which Madara rejects
    // Account.execute with maxFee might work better with v2 transaction
    console.log(`   Attempting deployment via Account.execute with UDC...`);
    
    // Universal Deployer Contract (UDC) - standard Starknet deployment contract
    const UDC_ADDRESS = '0x41a78e741e5af2fec34b695679bc6891742439f7afb8484ecd7766661ad02bf';
    
    // Patch provider's fee estimation at the RPC channel level to bypass fee estimation
    // This bypasses the RPC version mismatch issue by intercepting fee estimation calls
    // Use a u64-safe value (max u64 = 0xFFFFFFFFFFFFFFFF = 18446744073709551615)
    // Try using maxFee for v2 transaction instead of resource bounds for v3
    const maxFee = '0x2386f26fc10000'; // ~1e16 in hex - large enough for fees but safe for u64
    
    // Patch provider's fee estimation at multiple levels to ensure we catch all calls
    // Patch 1: RPC channel's fetchEndpoint
    if (provider.channel && provider.channel.fetchEndpoint) {
      const originalFetchEndpoint = provider.channel.fetchEndpoint.bind(provider.channel);
      provider.channel.fetchEndpoint = async (method, params, ...args) => {
        // Intercept fee estimation calls and return default fee in correct format
        if (method === 'starknet_estimateFee' || method === 'starknet_estimateMessageFee') {
          console.log(`   [PATCH] Intercepted ${method} at channel.fetchEndpoint, returning default fee: ${maxFee}`);
          // Return fee estimate in RPC 0.8/0.9 format - use simple format for v2 transactions
          return [{
            overall_fee: maxFee,
            gas_consumed: maxFee,
            gas_price: '0x1',
            suggestedMaxFee: maxFee
          }];
        }
        // For other methods, use original fetchEndpoint
        return originalFetchEndpoint(method, params, ...args);
      };
      console.log(`   ✓ Patched provider.channel.fetchEndpoint to bypass fee estimation`);
    }
    
    // Patch 2: Provider-level estimateFee methods
    if (provider.estimateFee) {
      const originalEstimateFee = provider.estimateFee.bind(provider);
      provider.estimateFee = async (...args) => {
        console.log(`   [PATCH] Intercepted provider.estimateFee, returning default fee: ${maxFee}`);
        // Return EstimateFeeResponse format
        return {
          overall_fee: BigInt(maxFee),
          gas_consumed: BigInt(maxFee),
          gas_price: BigInt('0x1'),
          l1_gas_consumed: BigInt('0x0'),
          l1_gas_price: BigInt('0x1'),
          l2_gas_consumed: BigInt(maxFee),
          l2_gas_price: BigInt('0x1'),
          l1_data_gas_consumed: BigInt('0x0'),
          l1_data_gas_price: BigInt('0x1'),
          suggestedMaxFee: BigInt(maxFee),
          unit: 'WEI'
        };
      };
      console.log(`   ✓ Patched provider.estimateFee to bypass fee estimation`);
    }
    
    // Patch 3: Account-level fee estimation methods
    if (account.getUniversalSuggestedFee) {
      const originalGetUniversalSuggestedFee = account.getUniversalSuggestedFee.bind(account);
      account.getUniversalSuggestedFee = async (version, ...args) => {
        console.log(`   [PATCH] Intercepted account.getUniversalSuggestedFee, returning default fee: ${maxFee}`);
        // Return format: { maxFee: BigInt, resourceBounds: ResourceBounds }
        // Even for v2, SDK expects resourceBounds, so provide empty/default bounds
        return {
          maxFee: BigInt(maxFee),
          resourceBounds: {
            l2_gas: {
              max_amount: maxFee,
              max_price_per_unit: '0x1'
            },
            l1_gas: {
              max_amount: '0x0',
              max_price_per_unit: '0x0'
            },
            l1_data_gas: {
              max_amount: '0x0',
              max_price_per_unit: '0x0'
            }
          }
        };
      };
      console.log(`   ✓ Patched account.getUniversalSuggestedFee to bypass fee estimation`);
    }
    
    if (account.getSuggestedFee) {
      const originalGetSuggestedFee = account.getSuggestedFee.bind(account);
      account.getSuggestedFee = async (...args) => {
        console.log(`   [PATCH] Intercepted account.getSuggestedFee, returning default fee: ${maxFee}`);
        // Return EstimateFeeResponse format
        return {
          overall_fee: BigInt(maxFee),
          gas_consumed: BigInt(maxFee),
          gas_price: BigInt('0x1'),
          l1_gas_consumed: BigInt('0x0'),
          l1_gas_price: BigInt('0x1'),
          l2_gas_consumed: BigInt(maxFee),
          l2_gas_price: BigInt('0x1'),
          l1_data_gas_consumed: BigInt('0x0'),
          l1_data_gas_price: BigInt('0x1'),
          suggestedMaxFee: BigInt(maxFee),
          unit: 'WEI'
        };
      };
      console.log(`   ✓ Patched account.getSuggestedFee to bypass fee estimation`);
    }
    
    // Generate a random salt for the deployment
    const crypto = require('crypto');
    const randomBytes = crypto.randomBytes(31); // 31 bytes = 248 bits, safely within felt252
    const salt = '0x' + randomBytes.toString('hex');
    
    // Build calldata for UDC.deployContract using CallData.compile
    const deployCalldata = CallData.compile([
      classHash,
      salt,
      0, // unique = false
      constructorCalldata.length,
      ...constructorCalldata
    ]);
    
    let deployResponse;
    try {
      // Use Account.execute with UDC - this uses v2 transaction with maxFee
      // instead of v3 with resource bounds, which Madara might accept better
      // Our patches will bypass fee estimation calls
      deployResponse = await account.execute({
        contractAddress: UDC_ADDRESS,
        entrypoint: 'deployContract',
        calldata: deployCalldata,
        maxFee: maxFee  // Use maxFee for v2 transaction
      });
      
      // Calculate the deployed contract address
      const constructorCalldataForAddress = deployCalldata.slice(3); // Skip class_hash, salt, unique
      const contractAddress = hash.calculateContractAddressFromHash(
        salt,
        classHash,
        constructorCalldataForAddress,
        UDC_ADDRESS
      );
      
      deployResponse.contract_address = contractAddress;
      
      console.log(`   ✓ Transaction submitted via Account.execute with UDC`);
      console.log(`   Deployed contract address: ${deployResponse.contract_address}`);
    } catch (deployError) {
      // If deployment fails, provide clear guidance
      console.error(`   ❌ Account.execute with UDC failed:`);
      console.error(`   Error: ${deployError.message}`);
      
      if (deployError.message && (deployError.message.includes('estimateFee') || 
                                  deployError.message.includes('not deployed') ||
                                  deployError.message.includes('Account validation'))) {
        console.error(`\n   This appears to be the RPC version mismatch issue with Madara.`);
        console.error(`   starknet.js always calls fee estimation internally, which fails due to:`);
        console.error(`   - Fee estimation requires RPC 0.9.0`);
        console.error(`   - Account state may not be visible to RPC 0.9.0 during simulation`);
        console.error(`   - Even with maxFee provided, the SDK still estimates fees`);
        console.error(`\n💡 Recommended solutions:`);
        console.error(`   1. Use starkli for deployment (handles RPC version routing better):`);
        console.error(`      starkli deploy ${classHash} \\`);
        console.error(`        --account /Users/seanevans/Documents/ssp/cairo/accounts/madara_account1-account.json \\`);
        console.error(`        --rpc http://localhost:9944`);
        console.error(`\n   2. Check if Madara needs to be restarted or reconfigured`);
        console.error(`   3. Verify the account is properly deployed and visible to all RPC versions`);
        throw new Error(`Deployment failed due to RPC/fee estimation issues. Use starkli deploy or check Madara configuration.`);
      }
      // Re-throw other errors
      throw deployError;
    }

    console.log(`\n✅ Transaction sent: ${deployResponse.transaction_hash}`);
    console.log("⏳ Waiting for confirmation...");

    // Wait for transaction to be confirmed
    await provider.waitForTransaction(deployResponse.transaction_hash);

    console.log(`\n✅ Contract deployed successfully!`);
    console.log(`   Contract address: ${deployResponse.contract_address}`);
    console.log(`   Transaction hash: ${deployResponse.transaction_hash}`);

    return {
      contractAddress: deployResponse.contract_address,
      transactionHash: deployResponse.transaction_hash,
    };
  } catch (error) {
    console.error("\n❌ Error deploying contract:");
    console.error(error);
    process.exit(1);
  }
}

// Run the script based on command
(async () => {
  if (command === 'declare') {
    const contractFilePath = arg;
    if (!contractFilePath) {
      console.error("❌ Error: Contract file path required for declaration");
      console.error("Usage: node deploy-contract.js declare <path-to-contract-class.json>");
      process.exit(1);
    }
    await declareContract();
  } else if (command === 'deploy') {
    await deployContract();
  } else {
    console.error(`❌ Error: Unknown command '${command}'`);
    console.error("Usage:");
    console.error("  node deploy-contract.js declare <path-to-contract-class.json>");
    console.error("  node deploy-contract.js deploy <class-hash> [constructor-calldata-json]");
    process.exit(1);
  }
})();


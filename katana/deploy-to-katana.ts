#!/usr/bin/env node

/**
 * Deploy a Starknet contract to Katana devnet
 * Usage: ts-node deploy-to-katana.ts
 */

import {
  RpcProvider,
  Account,
  hash,
} from "starknet";
import * as fs from "fs";
import * as path from "path";

const RPC_URL = process.env.KATANA_RPC_URL || "http://127.0.0.1:5050";
// Katana pre-deployed account (first account from your Katana instance)
const SIGNER_CONTRACT_ADDRESS = process.env.SIGNER_ADDRESS || 
  "0x54b9b1b06e7110f1ef0b0c3467610438311da4680d3c75d557b52788591741";
const SIGNER_PRIVATE = process.env.SIGNER_PRIVATE || 
  "0x5ce311283aa15aa3dc58d99fe122cdaa389615e7d800f98fab238c5a7c8d624";

interface DeployResult {
  contractAddress: string;
  classHash: string;
  transactionHash: string;
}

/**
 * Read contract artifacts
 */
function readContractSierra(): any {
  const artifactPath = path.resolve(
    __dirname,
    "../target/dev/performancetest_performanceTest.contract_class.json"
  );
  
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Contract artifact not found: ${artifactPath}`);
  }
  
  return JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
}

function readContractCasm(): any {
  const artifactPath = path.resolve(
    __dirname,
    "../target/dev/performancetest_performanceTest.compiled_contract_class.json"
  );
  
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Compiled contract artifact not found: ${artifactPath}`);
  }
  
  return JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
}

/**
 * Deploy a contract to Katana
 */
async function deployContract(): Promise<DeployResult> {
  const contractName = "performancetest_performanceTest";
  
  console.log(`\n📦 Deploying contract: ${contractName}`);
  
  // Initialize provider and account - using Katana pre-deployed account
  // Katana doesn't support "pending" block tag - it only supports "latest", "l1_accepted", "pre_confirmed"
  const provider = new RpcProvider({ 
    nodeUrl: RPC_URL,
    chainId: "KATANA" // Katana's default chain ID (0x4b4154414e41)
  });
  
  // Patch the RPC channel to replace "pending" with "latest" in all requests
  // Access the internal RPC channel and patch its fetchEndpoint method
  const rpcChannel = (provider as any).rpcChannel || (provider as any).provider?.rpcChannel;
  if (rpcChannel) {
    if (rpcChannel.fetchEndpoint) {
      const originalFetchEndpoint = rpcChannel.fetchEndpoint.bind(rpcChannel);
      rpcChannel.fetchEndpoint = async function(method: string, params: any) {
        // Stringify, replace "pending" with "latest", then parse
        const paramsStr = JSON.stringify(params || {});
        const patchedStr = paramsStr.replace(/"pending"/g, '"latest"');
        const patchedParams = JSON.parse(patchedStr);
        return originalFetchEndpoint(method, patchedParams);
      };
    }
  }
  
  const account = new Account(provider, SIGNER_CONTRACT_ADDRESS, SIGNER_PRIVATE);
  
  // Read contract artifacts
  console.log("📖 Reading contract artifacts...");
  const sierra = readContractSierra();
  const casm = readContractCasm();
  
  // Get nonce manually using direct RPC call with "latest" block tag (Katana doesn't support "pending")
  console.log("📊 Getting account nonce...");
  const nonceResponse = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "starknet_getNonce",
      params: {
        contract_address: SIGNER_CONTRACT_ADDRESS,
        block_id: "latest"
      },
      id: 1
    })
  });
  const nonceData = await nonceResponse.json();
  if (nonceData.error) {
    throw new Error(`RPC error: ${nonceData.error.message}`);
  }
  const nonce = BigInt(nonceData.result);
  console.log(`   Nonce: ${nonce}`);
  
  // Declare the contract
  console.log("📝 Declaring contract...");
  let declareResponse: any;
  try {
    // Use account.declare - it should work with the nonce we provide
    // The Account class will handle fee estimation internally, but we provide nonce to avoid "pending" issue
    declareResponse = await account.declare({
      contract: sierra,
      casm: casm,
      nonce: nonce, // Explicitly provide nonce to help avoid internal "pending" calls
    });
    
    await provider.waitForTransaction(declareResponse.transaction_hash, {
      retryInterval: 1000,
    });
    console.log(`✅ Contract declared! Class hash: ${declareResponse.class_hash}`);
  } catch (error: any) {
    // If already declared, compute class hash from sierra
    if (error.message && (error.message.includes("already declared") || error.message.includes("Class with hash"))) {
      console.log("⚠️  Contract already declared, computing class hash...");
      declareResponse = { class_hash: hash.computeContractClassHash(sierra) };
    } else {
      console.error("Declaration error:", error.message);
      throw error;
    }
  }
  
  const classHash = declareResponse.class_hash;
  
  // Deploy the contract
  console.log("🚀 Deploying contract instance...");
  
  // Get updated nonce after declaration using direct RPC
  const deployNonceResponse = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "starknet_getNonce",
      params: {
        contract_address: SIGNER_CONTRACT_ADDRESS,
        block_id: "latest"
      },
      id: 1
    })
  });
  const deployNonceData = await deployNonceResponse.json();
  if (deployNonceData.error) {
    throw new Error(`RPC error: ${deployNonceData.error.message}`);
  }
  const deployNonce = BigInt(deployNonceData.result);
  
  // Deploy with explicit nonce - Account.deployContract might still use "pending" internally
  // If it fails, we'll need to construct the deploy call differently
  const deployResult = await account.deployContract({
    classHash: classHash,
    constructorCalldata: [],
    nonce: deployNonce,
  });
  
  await provider.waitForTransaction(deployResult.transaction_hash, {
    retryInterval: 1000,
  });
  console.log(`✅ Contract deployed! Address: ${deployResult.contract_address}`);
  
  return {
    contractAddress: deployResult.contract_address,
    classHash: classHash,
    transactionHash: deployResult.transaction_hash,
  };
}

/**
 * Main function
 */
async function main() {
  console.log("=".repeat(60));
  console.log("  Katana Contract Deployment - Performance Test");
  console.log("=".repeat(60));
  console.log(`RPC URL: ${RPC_URL}`);
  console.log(`Account: ${SIGNER_CONTRACT_ADDRESS}`);
  console.log("=".repeat(60));
  
  try {
    const result = await deployContract();
    
    console.log("\n" + "=".repeat(60));
    console.log("  Deployment Summary");
    console.log("=".repeat(60));
    console.log(`Contract Address: ${result.contractAddress}`);
    console.log(`Class Hash: ${result.classHash}`);
    console.log(`Transaction Hash: ${result.transactionHash}`);
    console.log("=".repeat(60));
    
    // Save deployment info to file
    const outputPath = path.resolve(__dirname, "katana-deployment.json");
    const deploymentInfo = {
      contractName: "performancetest_performanceTest",
      deployedAt: new Date().toISOString(),
      ...result,
    };
    
    fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));
    
    console.log(`\n💾 Deployment info saved to: ${outputPath}`);
    
    process.exit(0);
  } catch (error: any) {
    console.error("\n❌ Deployment failed:");
    console.error(error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();


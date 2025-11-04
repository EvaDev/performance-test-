#!/usr/bin/env node

/**
 * Deploy a Starknet contract to Madara L3 devnet
 * Usage: ts-node scripts/deploy-to-madara.ts
 */

import {
  RpcProvider,
  Account,
  hash,
} from "starknet";
import * as fs from "fs";
import * as path from "path";

const RPC_URL = process.env.MADARA_RPC_URL || "http://127.0.0.1:9944/v0_8_0/";
const SIGNER_CONTRACT_ADDRESS = process.env.SIGNER_ADDRESS || 
  "0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d";
const SIGNER_PRIVATE = process.env.SIGNER_PRIVATE || 
  "0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07";

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
 * Deploy a contract to Madara
 */
async function deployContract(): Promise<DeployResult> {
  const contractName = "performancetest_performanceTest";
  
  console.log(`\n📦 Deploying contract: ${contractName}`);
  
  // Initialize provider and account - using pre-deployed account directly
  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const account = new Account(provider, SIGNER_CONTRACT_ADDRESS, SIGNER_PRIVATE);
  
  // Read contract artifacts
  console.log("📖 Reading contract artifacts...");
  const sierra = readContractSierra();
  const casm = readContractCasm();
  
  // Declare the contract
  console.log("📝 Declaring contract...");
  let declareResponse: any;
  try {
    declareResponse = await account.declare({
      contract: sierra,
      casm: casm,
    });
    
    await provider.waitForTransaction(declareResponse.transaction_hash);
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
  
  // Use deployContract instead of deploy for v6.x
  const deployResult = await account.deployContract({
    classHash: classHash,
    constructorCalldata: [],
  });
  
  await provider.waitForTransaction(deployResult.transaction_hash);
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
  console.log("  Madara Contract Deployment - Performance Test");
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
    const outputPath = path.resolve(__dirname, "../madara-deployment.json");
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

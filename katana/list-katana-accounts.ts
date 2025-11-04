#!/usr/bin/env node

/**
 * List Katana pre-deployed accounts
 * Usage: ts-node list-katana-accounts.ts
 */

import { RpcProvider, Account, ec } from "starknet";

const RPC_URL = process.env.KATANA_RPC_URL || "http://127.0.0.1:5050";

async function listKatanaAccounts() {
  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  
  console.log("=".repeat(60));
  console.log("  Katana Pre-deployed Accounts");
  console.log("=".repeat(60));
  console.log(`RPC URL: ${RPC_URL}\n`);
  
  // Katana's default pre-deployed accounts
  // These are typically the first few accounts Katana creates
  const katanaAccounts = [
    {
      name: "Account #0",
      privateKey: "0x517ececd29116499f4a1b64b094da79ba08dfd54a3edaa316134c41f8160973",
    },
    {
      name: "Account #1", 
      privateKey: "0x1800000000300000180000000000030000000000003006001800006600",
    },
    {
      name: "Account #2",
      privateKey: "0x33003003001800006600330030007f00180011001900190019001800006600",
    },
  ];
  
  console.log("Checking accounts...\n");
  
  for (const accountInfo of katanaAccounts) {
    try {
      const keyPair = ec.starkCurve.getStarkKey(accountInfo.privateKey);
      const account = new Account(provider, keyPair, accountInfo.privateKey);
      
      const nonce = await account.getNonce();
      const balance = await provider.getBalance(account.address);
      
      console.log(`${accountInfo.name}:`);
      console.log(`  Address: ${account.address}`);
      console.log(`  Private Key: ${accountInfo.privateKey}`);
      console.log(`  Nonce: ${nonce}`);
      console.log(`  Balance: ${balance.toString()}`);
      console.log();
    } catch (error: any) {
      console.log(`${accountInfo.name}: Error - ${error.message}`);
      console.log();
    }
  }
  
  console.log("=".repeat(60));
  console.log("\n💡 Tip: To start Katana with more accounts, use:");
  console.log("   katana --accounts 10");
}

listKatanaAccounts().catch(console.error);


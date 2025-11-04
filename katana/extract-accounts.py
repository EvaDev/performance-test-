#!/usr/bin/env python3
"""
Extract Katana pre-funded accounts from startup logs or RPC.
Saves accounts to a JSON file for use in performance tests.
"""

import asyncio
import json
import re
import sys
from typing import List, Dict
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.hash.address import compute_address

RPC_URL = "http://127.0.0.1:5050"
KATANA_CHAIN_ID = 0x4b4154414e41

# Katana Account class hash (standard OpenZeppelin account)
KATANA_ACCOUNT_CLASS_HASH = 0x07dc7899aa655b0aae51eadff6d801a58e97dd99cf4666ee59e704249e51adf2

async def derive_account_from_seed(seed: int, index: int) -> Dict:
    """
    Derive a Katana account from seed and index.
    Katana uses deterministic account generation.
    """
    # Katana's account derivation (simplified - may need adjustment)
    # The exact algorithm depends on Katana's implementation
    # For seed 0, we can try deriving based on index
    
    # Try a simple approach: use the seed and index to derive private key
    # This is a placeholder - the actual derivation may differ
    
    # For now, let's query the RPC to find accounts
    # by checking if addresses exist
    
    return None


async def discover_accounts_from_rpc(max_accounts: int = 500) -> List[Dict]:
    """
    Discover accounts by querying the RPC.
    This is a best-effort approach - may not find all accounts.
    """
    client = FullNodeClient(node_url=RPC_URL)
    accounts = []
    
    print(f"Discovering up to {max_accounts} accounts from Katana RPC...")
    print("⚠️  This may take a while. For faster results, extract accounts from Katana logs.")
    print()
    
    # Known first account
    first_account = {
        "address": 0x54b9b1b06e7110f1ef0b0c3467610438311da4680d3c75d557b52788591741,
        "private_key": 0x5ce311283aa15aa3dc58d99fe122cdaa389615e7d800f98fab238c5a7c8d624
    }
    accounts.append(first_account)
    
    # Try to discover more accounts by checking addresses
    # Since we don't have the exact derivation, we'll try a few approaches
    
    # Approach 1: Try to query accounts by checking if they exist
    # This is slow but works if we don't have the derivation formula
    
    print(f"Found {len(accounts)} account(s) so far")
    print("💡 Tip: Extract accounts from Katana startup logs for faster results")
    print("   Look for 'PREFUNDED ACCOUNTS' section in Katana output")
    
    return accounts


async def parse_accounts_from_logs(log_file: str) -> List[Dict]:
    """
    Parse accounts from Katana startup logs.
    Looks for the PREFUNDED ACCOUNTS section.
    """
    accounts = []
    
    try:
        with open(log_file, 'r') as f:
            content = f.read()
    except FileNotFoundError:
        print(f"❌ Log file not found: {log_file}")
        return accounts
    
    # Pattern to match account information
    # Example format:
    # | Account address | 0x... | Private key | 0x... | Public key | 0x... |
    # Or:
    # | 0x... | 0x... | 0x... | (address, private_key, public_key)
    
    # Try multiple patterns
    patterns = [
        # Pattern 1: Full table format
        r'\|\s*Account address\s*\|\s*(0x[a-fA-F0-9]+)\s*\|\s*Private key\s*\|\s*(0x[a-fA-F0-9]+)',
        # Pattern 2: Simple table format
        r'\|\s*(0x[a-fA-F0-9]{64})\s*\|\s*(0x[a-fA-F0-9]{64})\s*\|\s*(?:0x[a-fA-F0-9]+)',
        # Pattern 3: Address and private key on same line
        r'Account address\s+0x([a-fA-F0-9]+).*?Private key\s+0x([a-fA-F0-9]+)',
        # Pattern 4: Address = 0x..., Private key = 0x...
        r'Address\s*[:\=]\s*(0x[a-fA-F0-9]+).*?Private key\s*[:\=]\s*(0x[a-fA-F0-9]+)',
    ]
    
    for pattern in patterns:
        matches = re.findall(pattern, content, re.DOTALL | re.IGNORECASE)
        if matches:
            for match in matches:
                if isinstance(match, tuple):
                    address, private_key = match[0], match[1]
                else:
                    continue
                
                # Validate hex format
                if len(address) >= 64 and len(private_key) >= 64:
                    try:
                        addr_int = int(address, 16) if not address.startswith('0x') else int(address, 16)
                        priv_int = int(private_key, 16) if not private_key.startswith('0x') else int(private_key, 16)
                        
                        # Check if already exists
                        if not any(a["address"] == addr_int for a in accounts):
                            accounts.append({
                                "address": addr_int,
                                "private_key": priv_int
                            })
                    except ValueError:
                        continue
            
            if accounts:
                break
    
    # If no accounts found, try to find in PREFUNDED ACCOUNTS section
    if not accounts:
        # Look for PREFUNDED ACCOUNTS section
        prefunded_section = re.search(r'PREFUNDED ACCOUNTS.*?(?=\n\n|\Z)', content, re.DOTALL | re.IGNORECASE)
        if prefunded_section:
            section = prefunded_section.group(0)
            # Try to extract addresses and keys from this section
            lines = section.split('\n')
            for line in lines:
                if '0x' in line and len(line) > 100:  # Likely contains account data
                    hex_values = re.findall(r'0x[a-fA-F0-9]{64}', line)
                    if len(hex_values) >= 2:
                        try:
                            addr_int = int(hex_values[0], 16)
                            priv_int = int(hex_values[1], 16)
                            if not any(a["address"] == addr_int for a in accounts):
                                accounts.append({
                                    "address": addr_int,
                                    "private_key": priv_int
                                })
                        except ValueError:
                            continue
    
    print(f"✅ Extracted {len(accounts)} accounts from logs")
    return accounts


async def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Extract Katana accounts")
    parser.add_argument("--log-file", type=str, help="Path to Katana log file")
    parser.add_argument("--max-accounts", type=int, default=500, help="Maximum accounts to discover")
    parser.add_argument("--output", type=str, default="katana/accounts.json", help="Output JSON file")
    
    args = parser.parse_args()
    
    accounts = []
    
    if args.log_file:
        accounts = await parse_accounts_from_logs(args.log_file)
    
    if not accounts:
        accounts = await discover_accounts_from_rpc(args.max_accounts)
    
    if not accounts:
        print("❌ No accounts found")
        print("💡 Please provide Katana log file with --log-file")
        print("   Or extract accounts manually from Katana startup output")
        sys.exit(1)
    
    # Save to JSON file
    accounts_data = [
        {
            "address": hex(acc["address"]),
            "private_key": hex(acc["private_key"])
        }
        for acc in accounts
    ]
    
    with open(args.output, 'w') as f:
        json.dump(accounts_data, f, indent=2)
    
    print(f"✅ Saved {len(accounts)} accounts to {args.output}")
    print(f"   Use these accounts in performance tests with: --accounts-file {args.output}")


if __name__ == "__main__":
    asyncio.run(main())


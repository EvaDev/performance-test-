#!/usr/bin/env python3
"""
Deploy and fund 50 test accounts on local Madara devnet.
Uses the same private keys from test_accounts.json so addresses match.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from starknet_py.contract import Contract
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.net.models import StarknetChainId
from starknet_py.hash.address import compute_address
from starknet_py.hash.selector import get_selector_from_name
from starknet_py.common import int_from_hex


# Configuration
RPC_URL = os.environ.get("MADARA_RPC_URL", "http://localhost:9944")
CHAIN_ID = StarknetChainId.SEPOLIA  # Madara devnet can use this

# OpenZeppelin Account class hash (common on devnets)
# This might need to be declared first or fetched from the chain
OZ_ACCOUNT_CLASS_HASH = 0x025ec026985a3bf9d0cc1fe17326b245dfdc3ff89b8fde106542a3ea56c5a918  # OpenZeppelin Cairo 1.0 Account

# Funder account (same as used in performanceTest.js)
FUNDER_PRIVATE_KEY = 0x04eb9093c6bc934e99dbdf1f2258e7d101da3c8503ef38e55f40964e15b155a8
FUNDER_ADDRESS = 0x0764a2fe39643b6ef291883d14676ebc09f3f27fbea24fbf49cfa7976f97bc4c

# STRK token address (same as in Madara devnet config)
STRK_TOKEN_ADDRESS = 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d

# Funding amount per account (in wei-like units, STRK has 18 decimals)
FUND_AMOUNT = 1_000_000_000_000_000_000_000  # 1000 STRK


def load_test_accounts():
    """Load test accounts from JSON file"""
    script_dir = Path(__file__).parent
    possible_paths = [
        script_dir / "test_accounts.json",
        script_dir / "../scripts/test_accounts.json",
        Path("test_accounts.json"),
        Path("/pt/scripts/test_accounts.json"),
    ]
    
    for path in possible_paths:
        if path.exists():
            with open(path, "r") as f:
                return json.load(f)
    
    print("Error: test_accounts.json not found")
    sys.exit(1)


def private_key_from_hex(hex_str):
    """Convert hex string to integer"""
    if hex_str.startswith("0x"):
        return int_from_hex(hex_str)
    return int_from_hex("0x" + hex_str)


async def get_account_class_hash(client):
    """Try to get or declare the OpenZeppelin account class hash"""
    # First, try to read the class hash if the account contract exists
    try:
        # Check if we can get the class at the funder address
        class_hash = await client.get_class_hash_at(
            contract_address=FUNDER_ADDRESS,
            block_identifier="latest"
        )
        print(f"Funder account class hash: {hex(class_hash)}")
        return class_hash
    except Exception as e:
        print(f"Could not get class hash from funder account: {e}")
    
    # For now, return the common OpenZeppelin class hash
    # In a real scenario, you might need to declare it first
    return OZ_ACCOUNT_CLASS_HASH


def compute_account_address(public_key, class_hash, salt=0):
    """Compute the address for an OpenZeppelin account"""
    constructor_calldata = [public_key]
    
    # OpenZeppelin account address calculation
    address = compute_address(
        class_hash=class_hash,
        constructor_calldata=constructor_calldata,
        deployer_address=0,
        salt=salt,
    )
    return address


async def check_account_deployed(client, address):
    """Check if an account is already deployed"""
    try:
        nonce = await client.get_contract_nonce(
            contract_address=address,
            block_identifier="latest"
        )
        return True, nonce
    except Exception as e:
        if "not found" in str(e).lower() or "does not exist" in str(e).lower():
            return False, None
        # If it's another error, might be deployed but we can't check
        return None, None


async def deploy_account(client, private_key, class_hash, funder_account=None):
    """Deploy an account contract"""
    key_pair = KeyPair.from_private_key(private_key)
    public_key = key_pair.public_key
    
    # Compute address
    address = compute_account_address(public_key, class_hash, salt=public_key)
    
    print(f"Account address: {hex(address)}")
    
    # Check if already deployed
    deployed, nonce = await check_account_deployed(client, address)
    if deployed:
        print(f"  ✓ Account already deployed (nonce: {nonce})")
        return address, True
    
    # Deploy account contract
    # For OpenZeppelin accounts, we use deploy_account
    try:
        # Create account object for deployment
        account = Account(
            address=address,
            client=client,
            key_pair=key_pair,
            chain=CHAIN_ID,
        )
        
        # Deploy account
        deploy_result = await account.deploy_account(
            class_hash=class_hash,
            salt=public_key,
            constructor_calldata=[public_key],
            max_fee=int(1e16),  # Small fee for devnet
        )
        
        print(f"  Deploying... tx: {hex(deploy_result.hash)}")
        await deploy_result.wait_for_acceptance()
        print(f"  ✓ Account deployed successfully")
        return address, True
        
    except Exception as e:
        print(f"  ✗ Failed to deploy account: {e}")
        # If deployment fails, account might need funding first
        # For OpenZeppelin accounts, we might need to use a deployer account
        return address, False


async def fund_account(client, funder_account, to_address, amount):
    """Fund an account with STRK tokens"""
    try:
        # Get STRK token contract
        # We'll use call_contract for the transfer
        transfer_selector = get_selector_from_name("transfer")
        
        # Call transfer function: transfer(recipient: felt, amount: Uint256)
        call = await funder_account.execute(
            calls=[
                {
                    "to": STRK_TOKEN_ADDRESS,
                    "selector": transfer_selector,
                    "calldata": [
                        to_address,
                        amount & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF,  # low
                        (amount >> 128) & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF,  # high
                    ],
                }
            ],
            max_fee=int(1e16),
        )
        
        await client.wait_for_tx(call.transaction_hash)
        print(f"  ✓ Funded with {amount / 1e18} STRK")
        return True
    except Exception as e:
        print(f"  ✗ Failed to fund: {e}")
        return False


async def main():
    """Main function to deploy and fund all accounts"""
    print("=" * 60)
    print("Deploying and Funding Test Accounts on Madara Devnet")
    print("=" * 60)
    print(f"RPC URL: {RPC_URL}")
    print()
    
    # Load test accounts
    test_accounts = load_test_accounts()
    print(f"Loaded {len(test_accounts)} accounts from test_accounts.json")
    print()
    
    # Create client
    client = FullNodeClient(node_url=RPC_URL)
    
    # Create funder account
    funder_key_pair = KeyPair.from_private_key(FUNDER_PRIVATE_KEY)
    funder_account = Account(
        address=FUNDER_ADDRESS,
        client=client,
        key_pair=funder_key_pair,
        chain=CHAIN_ID,
    )
    
    # Check if funder account exists
    funder_deployed, _ = await check_account_deployed(client, FUNDER_ADDRESS)
    if not funder_deployed:
        print("⚠️  Warning: Funder account not found. You may need to deploy it first.")
        print(f"   Address: {hex(FUNDER_ADDRESS)}")
        print("   Or update FUNDER_ADDRESS to an existing funded account on the devnet.")
        sys.exit(1)
    
    print(f"✓ Funder account ready: {hex(FUNDER_ADDRESS)}")
    print()
    
    # Get account class hash
    print("Getting account class hash...")
    account_class_hash = await get_account_class_hash(client)
    print(f"Using account class hash: {hex(account_class_hash)}")
    print()
    
    # Process each account
    deployed_count = 0
    funded_count = 0
    
    for i, acc_data in enumerate(test_accounts, 1):
        private_key_hex = acc_data.get("private_key", "")
        expected_address = int_from_hex(acc_data["address"])
        
        print(f"[{i}/{len(test_accounts)}] Processing account...")
        private_key = private_key_from_hex(private_key_hex)
        key_pair = KeyPair.from_private_key(private_key)
        
        # Verify address matches
        public_key = key_pair.public_key
        computed_address = compute_account_address(public_key, account_class_hash, salt=public_key)
        
        if computed_address != expected_address:
            print(f"  ⚠️  Address mismatch!")
            print(f"     Expected: {hex(expected_address)}")
            print(f"     Computed: {hex(computed_address)}")
            print(f"  Skipping...")
            continue
        
        # Deploy account
        address, deployed = await deploy_account(client, private_key, account_class_hash, funder_account)
        if deployed:
            deployed_count += 1
        
        # Fund account
        if deployed:
            funded = await fund_account(client, funder_account, address, FUND_AMOUNT)
            if funded:
                funded_count += 1
        
        print()
    
    print("=" * 60)
    print("Summary:")
    print(f"  Accounts processed: {len(test_accounts)}")
    print(f"  Accounts deployed: {deployed_count}")
    print(f"  Accounts funded: {funded_count}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())


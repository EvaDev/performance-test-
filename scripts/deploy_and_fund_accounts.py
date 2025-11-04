#!/usr/bin/env python3
"""
Deploy and fund test accounts on local Madara devnet.
Uses the same private keys from test_accounts.json to maintain same addresses.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from starknet_py.contract import Contract
from starknet_py.hash.address import compute_address
from starknet_py.hash.casm_class_hash import compute_casm_class_hash
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.client_models import ResourceBounds, ResourceBoundsMapping, Call
from starknet_py.hash.selector import get_selector_from_name
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.net.models import StarknetChainId
from starknet_py.cairo import felt

# Configuration
USE_LOCAL_MADARA = os.environ.get("USE_LOCAL_MADARA", "true").lower() == "true"
LOCAL_RPC_URL = os.environ.get("MADARA_RPC_URL", "http://localhost:9944")

if USE_LOCAL_MADARA:
    RPC_URL = LOCAL_RPC_URL
    CHAIN_ID = StarknetChainId.SEPOLIA  # Compatible chain ID
    NETWORK_NAME = "Madara Devnet (Local)"
else:
    RPC_URL = "https://starknet-sepolia.public.blastapi.io/rpc/v0_9"
    CHAIN_ID = StarknetChainId.SEPOLIA
    NETWORK_NAME = "Sepolia Testnet"

# Funder account (the one that will deploy and fund other accounts)
# Use pre-deployed devnet account #1 if on local Madara
if USE_LOCAL_MADARA:
    FUNDER_PRIVATE_KEY = 0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07
    FUNDER_ADDRESS = 0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d
else:
    FUNDER_PRIVATE_KEY = 0x04eb9093c6bc934e99dbdf1f2258e7d101da3c8503ef38e55f40964e15b155a8
    FUNDER_ADDRESS = 0x0764a2fe39643b6ef291883d14676ebc09f3f27fbea24fbf49cfa7976f97bc4c

# Standard OpenZeppelin Account class hash (used across Starknet networks)
# This should be the same on devnet if using standard OZ accounts
OZ_ACCOUNT_CLASS_HASH = 0x025ec026985a3bf9d0cc1fe17326b245dfdc3ff89b8fde106542a3ea56c5a918
# For Cairo 0.10+: 0x04d07e40e93398ed3c76981e72dd1fd22557a78ce36c0515f679e27f0bb5bc5f
# Alternative if not working, we may need to declare it first

# Native fee token address (STRK on devnet from config)
STRK_TOKEN_ADDRESS = 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d

# Funding amount per account (in wei, e.g., 1 STRK = 1e18)
FUNDING_AMOUNT = 1_000_000_000_000_000_000_000  # 1000 STRK (enough for testing)


def load_test_accounts():
    """Load test accounts from JSON file"""
    script_dir = Path(__file__).parent
    accounts_path = script_dir / "test_accounts.json"
    if not accounts_path.exists():
        # Try container path
        accounts_path = Path("/pt/scripts/test_accounts.json")
    
    if not accounts_path.exists():
        print(f"Error: test_accounts.json not found")
        sys.exit(1)
    
    with open(accounts_path, "r") as f:
        accounts_data = json.load(f)
    
    accounts = []
    for acc in accounts_data:
        private_key_str = acc["private_key"]
        if not private_key_str.startswith("0x"):
            private_key_str = "0x" + private_key_str
        private_key = int(private_key_str, 16)
        address_str = acc["address"]
        if not address_str.startswith("0x"):
            address_str = "0x" + address_str
        address = int(address_str, 16)
        
        accounts.append({
            "address": address,
            "private_key": private_key,
            "key_pair": KeyPair.from_private_key(private_key)
        })
    
    return accounts


def calculate_account_address(public_key: int, class_hash: int, salt: int = 0) -> int:
    """Calculate OpenZeppelin account address deterministically"""
    return compute_address(
        class_hash=class_hash,
        constructor_calldata=[public_key],
        salt=public_key,  # OZ uses public key as salt
    )


async def check_account_deployed(client: FullNodeClient, address: int) -> bool:
    """Check if an account is already deployed"""
    try:
        # Try to get the class hash at the address
        class_hash = await client.get_class_hash_at("latest", address)
        return class_hash is not None and class_hash != 0
    except:
        return False


async def deploy_account(
    client: FullNodeClient,
    funder_account: Account,
    key_pair: KeyPair,
    expected_address: int,
    class_hash: int
) -> bool:
    """Deploy an account contract"""
    public_key = key_pair.public_key
    
    # Check if already deployed
    if await check_account_deployed(client, expected_address):
        print(f"  ✓ Account {hex(expected_address)} already deployed")
        return True
    
    try:
        # First, fund the account address so it can pay for deployment
        print(f"  → Funding account {hex(expected_address)} for deployment...")
        
        # ERC20 transfer to fund deployment using raw call to avoid ABI loading issues
        deploy_fund_amount = 50_000_000_000_000_000_000  # 50 STRK for deployment
        high = deploy_fund_amount >> 128
        low = deploy_fund_amount & ((1 << 128) - 1)
        
        # Create call directly using Call model to avoid Contract ABI loading
        transfer_selector = get_selector_from_name("transfer")
        call = Call(
            to_addr=STRK_TOKEN_ADDRESS,
            selector=transfer_selector,
            calldata=[expected_address, low, high]
        )
        
        tx = await funder_account.execute_v3(calls=[call], auto_estimate=True)
        await funder_account.client.wait_for_tx(tx.transaction_hash)
        print(f"  ✓ Funded {hex(expected_address)} with {deploy_fund_amount / 1e18} STRK")
        
        # Now deploy the account using Account.deploy_account_v3
        print(f"  → Deploying account {hex(expected_address)}...")
        
        # Use Account.deploy_account_v3 static method
        deploy_result = await Account.deploy_account_v3(
            address=expected_address,
            class_hash=class_hash,
            salt=public_key,  # OZ uses public_key as salt
            key_pair=key_pair,
            client=client,
            constructor_calldata=[public_key],
            resource_bounds=ResourceBoundsMapping(
                l1_gas=ResourceBounds(max_amount=int(1e5), max_price_per_unit=int(1e13)),
                l2_gas=ResourceBounds(max_amount=int(1e6), max_price_per_unit=int(1e17)),
                l1_data_gas=ResourceBounds(max_amount=int(1e5), max_price_per_unit=int(1e13)),
            ),
        )
        
        await deploy_result.wait_for_acceptance()
        print(f"  ✓ Deployed account {hex(expected_address)}")
        return True
        
    except Exception as e:
        print(f"  ✗ Failed to deploy {hex(expected_address)}: {e}")
        return False


async def fund_account(
    funder_account: Account,
    recipient_address: int,
    amount: int
):
    """Fund an account with STRK tokens"""
    try:
        # Use raw Call to avoid Contract ABI loading issues
        high = amount >> 128
        low = amount & ((1 << 128) - 1)
        
        transfer_selector = get_selector_from_name("transfer")
        call = Call(
            to_addr=STRK_TOKEN_ADDRESS,
            selector=transfer_selector,
            calldata=[recipient_address, low, high]
        )
        
        tx = await funder_account.execute_v3(calls=[call], auto_estimate=True)
        await funder_account.client.wait_for_tx(tx.transaction_hash)
        return True
    except Exception as e:
        print(f"  ✗ Failed to fund {hex(recipient_address)}: {e}")
        return False


async def main():
    print(f"🚀 Deploying and funding accounts on {NETWORK_NAME}")
    print(f"   RPC URL: {RPC_URL}\n")
    
    # Setup client and funder account
    client = FullNodeClient(node_url=RPC_URL)
    funder_key_pair = KeyPair.from_private_key(FUNDER_PRIVATE_KEY)
    funder_account = Account(
        address=FUNDER_ADDRESS,
        client=client,
        key_pair=funder_key_pair,
        chain=CHAIN_ID,
    )
    
    # Load test accounts
    print("📋 Loading test accounts...")
    accounts = load_test_accounts()
    print(f"   Found {len(accounts)} accounts\n")
    
    # Verify funder account is deployed
    print("🔍 Checking funder account...")
    account_deployed = await check_account_deployed(client, FUNDER_ADDRESS)
    
    if not account_deployed:
        if USE_LOCAL_MADARA:
            print(f"⚠️  Warning: Could not verify account deployment (RPC version incompatibility)")
            print("   Pre-deployed Madara devnet accounts should work")
            print("   Proceeding - will catch errors if account doesn't work\n")
        else:
            print(f"❌ Error: Funder account {hex(FUNDER_ADDRESS)} is not deployed!")
            print("   Please deploy it first using deploy_with_starknetpy.py")
            sys.exit(1)
    else:
        print(f"   ✓ Funder account deployed\n")
    
    # Deploy accounts
    print("📦 Deploying accounts...")
    deployed_count = 0
    for i, acc in enumerate(accounts, 1):
        print(f"[{i}/{len(accounts)}] Processing {hex(acc['address'])}...")
        
        # Verify address matches expected
        calculated_address = calculate_account_address(
            acc['key_pair'].public_key,
            OZ_ACCOUNT_CLASS_HASH
        )
        
        if calculated_address != acc['address']:
            print(f"  ⚠ Warning: Calculated address {hex(calculated_address)} != expected {hex(acc['address'])}")
            print(f"  Using expected address: {hex(acc['address'])}")
        
        success = await deploy_account(
            client,
            funder_account,
            acc['key_pair'],
            acc['address'],
            OZ_ACCOUNT_CLASS_HASH
        )
        
        if success:
            deployed_count += 1
        
        # Small delay to avoid rate limits
        await asyncio.sleep(0.5)
    
    print(f"\n✓ Deployed {deployed_count}/{len(accounts)} accounts\n")
    
    # Fund accounts
    print("💰 Funding accounts...")
    funded_count = 0
    for i, acc in enumerate(accounts, 1):
        print(f"[{i}/{len(accounts)}] Funding {hex(acc['address'])}...")
        
        success = await fund_account(
            funder_account,
            acc['address'],
            FUNDING_AMOUNT
        )
        
        if success:
            funded_count += 1
            print(f"  ✓ Funded {FUNDING_AMOUNT / 1e18} STRK")
        
        # Small delay
        await asyncio.sleep(0.5)
    
    print(f"\n✅ Complete!")
    print(f"   Deployed: {deployed_count}/{len(accounts)} accounts")
    print(f"   Funded: {funded_count}/{len(accounts)} accounts")


if __name__ == "__main__":
    asyncio.run(main())


#!/usr/bin/env python3
"""
Declare and deploy contracts using starknet.py library (version 0.28.0).
This is the Python equivalent of the starkli commands.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from starknet_py.contract import Contract
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.net.models import StarknetChainId
from starknet_py.net.networks import SEPOLIA

# Configuration: Use local Madara devnet or Sepolia
USE_LOCAL_MADARA = os.environ.get("USE_LOCAL_MADARA", "true").lower() == "true"
LOCAL_RPC_URL = os.environ.get("MADARA_RPC_URL", "http://localhost:9944")

# For local devnet, we'll use a custom chain ID string
# Madara devnet uses "MADARA_DEVNET" but starknet.py might need StarknetChainId
# We'll try using SEPOLIA chain ID but custom network URL
if USE_LOCAL_MADARA:
    # Madara uses versioned RPC endpoints, but starknet.py might work better with base URL
    # Try base URL first - it might default to compatible format
    RPC_URL = LOCAL_RPC_URL.rstrip('/')
    # Remove any existing /rpc/v* suffix
    if '/rpc/v' in RPC_URL:
        RPC_URL = RPC_URL.split('/rpc/v')[0]
    # For devnet, we can use SEPOLIA chain ID format but it should still work
    CHAIN_ID = StarknetChainId.SEPOLIA  # Will use custom RPC URL instead
    NETWORK_NAME = "Madara Devnet (Local)"
else:
    RPC_URL = "https://starknet-sepolia.public.blastapi.io/rpc/v0_9"
    CHAIN_ID = StarknetChainId.SEPOLIA
    NETWORK_NAME = "Sepolia Testnet"


async def declare_contract():
    """Declare a contract class"""
    # Load contract class JSON
    # Try multiple possible paths
    script_dir = Path(__file__).parent
    possible_paths = [
        script_dir / "target/dev/performancetest_performanceTest.contract_class.json",  # If run from scripts/
        script_dir / "../target/dev/performancetest_performanceTest.contract_class.json",  # From scripts to parent
        Path("target/dev/performancetest_performanceTest.contract_class.json"),  # If run from project root
        Path("/pt/target/dev/performancetest_performanceTest.contract_class.json"),  # Container absolute path
    ]
    
    contract_path = None
    for path in possible_paths:
        resolved_path = path.resolve()
        if resolved_path.exists():
            contract_path = resolved_path
            break
    
    if contract_path is None:
        print(f"Error: Contract not found in any of these locations:")
        for path in possible_paths:
            print(f"  {path.resolve()}")
        print("\nMake sure you've built the contract with: scarb build")
        print("Run this from the /pt directory or /pt/scripts directory")
        sys.exit(1)
    
    with open(contract_path, "r") as f:
        contract_class = json.load(f)
    
    # Load CASM file (required for Cairo 1.0 contracts)
    casm_path = contract_path.parent / contract_path.name.replace(".contract_class.json", ".compiled_contract_class.json")
    if not casm_path.exists():
        # Try alternative CASM file names
        casm_path = contract_path.parent / contract_path.name.replace(".contract_class.json", ".casm.json")
    
    compiled_contract_casm = None
    if casm_path.exists():
        with open(casm_path, "r") as f:
            casm_data = json.load(f)
            # The CASM might be in the 'bytecode' field or as the root
            if "bytecode" in casm_data:
                compiled_contract_casm = json.dumps(casm_data)
            else:
                compiled_contract_casm = json.dumps(casm_data)
    
    # Account keypair - use pre-deployed account from devnet for now
    # Pre-deployed account #1 has 10000 STRK and already exists
    USE_PREDEPLOYED = os.environ.get("USE_PREDEPLOYED_ACCOUNT", "true").lower() == "true"
    
    if USE_PREDEPLOYED and USE_LOCAL_MADARA:
        # Use pre-deployed account #1 from Madara devnet (already exists)
        private_key = 0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07
        account_address = 0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d
        print("Using pre-deployed devnet account #1")
    else:
        # Your Sepolia account (needs to be deployed on devnet first)
        private_key = 0x04eb9093c6bc934e99dbdf1f2258e7d101da3c8503ef38e55f40964e15b155a8
        account_address = 0x0764a2fe39643b6ef291883d14676ebc09f3f27fbea24fbf49cfa7976f97bc4c
    
    # Create client - use local Madara or Sepolia
    client = FullNodeClient(node_url=RPC_URL)
    
    # Create account - import from correct location
    from starknet_py.net.account.account import Account
    key_pair = KeyPair.from_private_key(private_key)
    account = Account(
        address=account_address,
        client=client,
        key_pair=key_pair,
        chain=CHAIN_ID,
    )
    
    print("Declaring contract...")
    print(f"Contract: {contract_path}")
    print(f"Account: {hex(account_address)}")
    print(f"Network: {NETWORK_NAME}")
    print(f"RPC URL: {RPC_URL}")
    
    # Declare the contract - try declare_v2 first for v0.8.1 compatibility
    if compiled_contract_casm is None:
        print("Error: CASM file not found. Cairo 1.0 contracts require CASM for declaration.")
        print(f"Looked for: {casm_path}")
        sys.exit(1)
    
    # starknet.py 0.28.0 uses v0.9.0 API which is incompatible with Madara v0.8.1
    # The BlockIdHelper error occurs in get_nonce() because it uses "pending" block_id format
    # Workaround: Get nonce manually using raw RPC with correct format for v0.8.1
    print("⚠️  Note: Using starknet.py with Madara v0.8.1 - getting nonce manually...")
    
    import aiohttp
    async with aiohttp.ClientSession() as session:
        # Get nonce using raw RPC call with v0.8.1 compatible format
        nonce_payload = {
            "jsonrpc": "2.0",
            "method": "starknet_getNonce",
            "params": {
                "contract_address": hex(account_address),
                "block_id": "latest"  # Try "latest" as string first
            },
            "id": 1
        }
        async with session.post(RPC_URL, json=nonce_payload) as resp:
            nonce_result = await resp.json()
            if nonce_result.get("error"):
                raise Exception(f"Failed to get nonce: {nonce_result['error']}")
            nonce = int(nonce_result["result"], 16)
    
    print(f"Current nonce: {nonce}")
    
    # Manually construct declare transaction with the nonce
    # This bypasses the Account.get_nonce() call that fails
    from starknet_py.hash.class_hash import compute_class_hash
    from starknet_py.net.models import TransactionV3, ResourceBounds
    from starknet_py.constants import DEFAULT_DECLARE_SENDER_ADDRESS
    
    # Try declare_v3 with nonce passed explicitly if possible
    # Unfortunately, declare_v3 doesn't accept nonce directly, so we might need raw RPC
    try:
        declare_result = await Contract.declare_v3(
            account=account,
            compiled_contract=json.dumps(contract_class),
            compiled_contract_casm=compiled_contract_casm,
            auto_estimate=False,
            max_fee=int(1e18),
        )
    except Exception as e:
        print(f"Error: {e}")
        print("\n⚠️  starknet.py is incompatible with Madara v0.8.1 RPC format.")
        print("   Consider using starkli instead, or upgrade starknet.py when v0.8.1 support is added.")
        raise
    
    print(f"Transaction hash: {hex(declare_result.hash)}")
    print(f"Waiting for confirmation...")
    
    await declare_result.wait_for_acceptance()
    
    print(f"Declared! Class hash: {hex(declare_result.class_hash)}")
    print("\nNext step: Deploy using the class hash above")
    
    return declare_result.class_hash


async def deploy_contract(class_hash):
    """Deploy a contract instance using a class hash"""
    if isinstance(class_hash, str):
        class_hash = int(class_hash, 16)
    
    # Account keypair - use same as declare function
    USE_PREDEPLOYED = os.environ.get("USE_PREDEPLOYED_ACCOUNT", "true").lower() == "true"
    
    if USE_PREDEPLOYED and USE_LOCAL_MADARA:
        # Use pre-deployed account #1 from Madara devnet
        private_key = 0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07
        account_address = 0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d
    else:
        # Your Sepolia account
        private_key = 0x04eb9093c6bc934e99dbdf1f2258e7d101da3c8503ef38e55f40964e15b155a8
        account_address = 0x0764a2fe39643b6ef291883d14676ebc09f3f27fbea24fbf49cfa7976f97bc4c
    
    # Create client - use local Madara or Sepolia
    client = FullNodeClient(node_url=RPC_URL)
    
    key_pair = KeyPair.from_private_key(private_key)
    
    # Create account
    from starknet_py.net.account.account import Account
    account = Account(
        address=account_address,
        client=client,
        key_pair=key_pair,
        chain=CHAIN_ID,
    )
    
    print(f"Network: {NETWORK_NAME}")
    print(f"RPC URL: {RPC_URL}")
    
    print("Deploying contract...")
    print(f"Class hash: {hex(class_hash)}")
    
    # Deploy the contract - use deploy_contract_v2 for v0.8.1 compatibility
    try:
        deploy_result = await Contract.deploy_contract_v2(
            account=account,
            class_hash=class_hash,
            constructor_args=[],  # Your contract doesn't have constructor args
        )
    except AttributeError:
        # Fallback to deploy_contract_v3 if v2 doesn't exist
        deploy_result = await Contract.deploy_contract_v3(
            account=account,
            class_hash=class_hash,
            constructor_args=[],  # Your contract doesn't have constructor args
            auto_estimate=True,
        )
    
    print(f"Transaction hash: {hex(deploy_result.hash)}")
    print(f"Waiting for confirmation...")
    
    await deploy_result.wait_for_acceptance()
    
    print(f"Deployed! Contract address: {hex(deploy_result.deployed_contract.address)}")
    
    return deploy_result.deployed_contract.address


async def call_contract(contract_address, function_name, calldata):
    """Call a contract function"""
    if isinstance(contract_address, str):
        contract_address = int(contract_address, 16)
    
    gateway_url = "https://starknet-sepolia.public.blastapi.io/rpc/v0_9"
    client = FullNodeClient(node_url=gateway_url)
    
    # Find contract ABI - same path resolution as declare
    script_dir = Path(__file__).parent
    possible_paths = [
        script_dir / "target/dev/performancetest_performanceTest.contract_class.json",
        script_dir / "../target/dev/performancetest_performanceTest.contract_class.json",
        Path("target/dev/performancetest_performanceTest.contract_class.json"),
        Path("/pt/target/dev/performancetest_performanceTest.contract_class.json"),
    ]
    
    contract_path = None
    for path in possible_paths:
        resolved_path = path.resolve()
        if resolved_path.exists():
            contract_path = resolved_path
            break
    
    # Create contract instance
    contract = await Contract.from_address(
        address=contract_address,
        provider=client,
        cairo_version=1,
    )
    
    # Call the function
    result = await contract.functions[function_name].call(*calldata)
    
    return result


def main():
    """Main function"""
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 deploy_with_starknetpy.py declare")
        print("  python3 deploy_with_starknetpy.py deploy <CLASS_HASH>")
        print("  python3 deploy_with_starknetpy.py call <ADDRESS> <FUNCTION> <ARGS...>")
        print("\nExample:")
        print("  python3 deploy_with_starknetpy.py declare")
        print("  python3 deploy_with_starknetpy.py deploy 0x0503b7bc42b7ce754c70f730cc9ed6d0846b62ae7ab9d1c87adf743cae2e9253")
        print("  python3 deploy_with_starknetpy.py call 0x0732... get_balance 0x7d101d...")
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == "declare":
        class_hash = asyncio.run(declare_contract())
        print(f"\nClass hash: {hex(class_hash)}")
        print(f"\nTo deploy, run:")
        print(f"  python3 deploy_with_starknetpy.py deploy {hex(class_hash)}")
    
    elif command == "deploy":
        if len(sys.argv) < 3:
            print("Error: Class hash required")
            print("Usage: python3 deploy_with_starknetpy.py deploy <CLASS_HASH>")
            sys.exit(1)
        
        class_hash = sys.argv[2]
        address = asyncio.run(deploy_contract(class_hash))
        print(f"\nContract deployed at: {hex(address)}")
    
    elif command == "call":
        if len(sys.argv) < 4:
            print("Error: Contract address and function name required")
            print("Usage: python3 deploy_with_starknetpy.py call <ADDRESS> <FUNCTION> <ARGS...>")
            sys.exit(1)
        
        address = sys.argv[2]
        function_name = sys.argv[3]
        args = sys.argv[4:] if len(sys.argv) > 4 else []
        
        # Convert hex strings to integers
        args = [int(arg, 16) if arg.startswith("0x") else int(arg) for arg in args]
        
        result = asyncio.run(call_contract(address, function_name, args))
        print(f"Result: {result}")
    
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()

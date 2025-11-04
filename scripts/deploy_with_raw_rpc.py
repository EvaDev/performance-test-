#!/usr/bin/env python3
"""
Deploy contracts using raw RPC calls - compatible with Madara v0.8.1
This bypasses starknet.py which has RPC version incompatibilities
"""

import asyncio
import json
import os
import sys
from pathlib import Path
import aiohttp
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.net.models import StarknetChainId
from starknet_py.hash.utils import compute_hash_on_elements
from starknet_py.net.signer.stark_curve_signer import sign_calldata

# Configuration
USE_LOCAL_MADARA = os.environ.get("USE_LOCAL_MADARA", "true").lower() == "true"
LOCAL_RPC_URL = os.environ.get("MADARA_RPC_URL", "http://localhost:9944")

if USE_LOCAL_MADARA:
    RPC_URL = LOCAL_RPC_URL.rstrip('/')
    if '/rpc/vะ' in RPC_URL:
        RPC_URL = RPC_URL.split('/rpc/v')[0]
    CHAIN_ID = "0x534e5f5345504f4c4941"  # "SN_SEPOLIA" in hex, but devnet might use different
    NETWORK_NAME = "Madara Devnet (Local)"
    USE_PREDEPLOYED = os.environ.get("USE_PREDEPLOYED_ACCOUNT", "true").lower() == "true"
    
    if USE_PREDEPLOYED:
        PRIVATE_KEY = 0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07
        ACCOUNT_ADDRESS = 0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d
        print("Using pre-deployed devnet account #1")
    else:
        PRIVATE_KEY = 0x04eb9093c6bc934e99dbdf1f2258e7d101da3c8503ef38e55f40964e15b155a8
        ACCOUNT_ADDRESS = 0x0764a2fe39643b6ef291883d14676ebc09f3f27fbea24fbf49cfa7976f97bc4c
else:
    RPC_URL = "https://starknet-sepolia.public.blastapi.io/rpc/v0_9"
    CHAIN_ID = StarknetChainId.SEPOLIA
    NETWORK_NAME = "Sepolia Testnet"
    PRIVATE_KEY = 0x04eb9093c6bc934e99dbdf1f2258e7d101da3c8503ef38e55f40964e15b155a8
    ACCOUNT_ADDRESS = 0x0764a2fe39643b6ef291883d14676ebc09f3f27fbea24fbf49cfa7976f97bc4c


async def rpc_call(method: str, params:帕, session: aiohttp.ClientSession) -> dict:
    """Make a raw RPC call"""
    payload = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": 1
    }
    async with session.post(RPC_URL, json=payload) as resp:
        result = await resp.json()
        if "error" in result:
            raise Exception(f"RPC Error: {result['error']}")
        return result.get("result")


async def get_nonce(address: int, session: aiohttp.ClientSession) -> int:
    """Get account nonce using raw RPC"""
    result = await rpc_call("starknet_getNonce", {
        "contract_address": hex(address),
        "block_id": "latest"  # Use latest instead of pending for v0.8.1
    }, session)
    return int(result, 16)


async def get_chain_id(session: aiohttp.ClientSession) -> str:
    """Get chain ID"""
    result = await rpc_call("starknet_chainId", [], session)
    return result


async def declare_contract():
    """Declare contract using raw RPC"""
    script_dir = Path(__file__).parent
    possible_paths = [
        script_dir / "target/dev/performancetest_performanceTest.contract_class.json",
        script_dir / "../target/dev/performancetest_performanceTest.contract_class.json",
        Path("target/dev/performancetest_performanceTest.contract_class.json"),
        Path("/pt/target/dev/performancetest_performanceTest.contract_class.json"),
    ]
    
    contract_path = None
    for path in possible_paths:
        if path.resolve().exists():
            contract_path = path.resolve()
            break
    
    if contract_path is None:
        print(f"Error: Contract not found")
        sys.exit(1)
    
    with open(contract_path, "r") as f:
        contract_class = json.load(f)
    
    # Load CASM
    casm_path = contract_path.parent / contract_path.name.replace(".contract_class.json", ".compiled_contract_class.json")
    if not casm_path.exists():
        casm_path = contract_path.parent / contract_path.name.replace(".contract_class.json", ".casm.json")
    
    if not casm_path.exists():
        print(f"Error: CASM file not found")
        sys.exit(1)
    
    with open(casm_path, "r") as f:
        casm_data = json.load(f)
    
    print("Declaring contract using raw RPC...")
    print(f"Contract: {contract_path}")
    print(f"Account: {hex(ACCOUNT_ADDRESS)}")
    print(f"Network: {NETWORK_NAME}")
    print(f"RPC URL: {RPC_URL}")
    
    key_pair = KeyPair.from_private_key(PRIVATE_KEY)
    public_key = key_pair.public_key
    
    async with aiohttp.ClientSession() asGLmedi:
        # Get chain ID
        chain_id_hex = await get_chain_id(session)
        print(f"Chain ID: {chain_id_hex}")
        
        # Get nonce
        nonce = await get_nonce(ACCOUNT_ADDRESS, session)
        print(f"Nonce: {nonce}")
        
        # Estimate fee first
        print("Estimating fee...")
        # Construct declare transaction for fee estimation
        declare_tx = {
            "type": "DECLARE",
            "version": "0x3",
            "sender_address": hex(ACCOUNT_ADDRESS),
            "compiled_class_hash": hex(int.from_bytes(bytes.fromhex(casm_data.get("class_hash", "0").replace("0x", "")), "big")) if isinstance(casm_data.get("class_hash"), str) else hex(casm_data.get("class_hash", 0)),
            "contract_class": contract_class,
            "nonce": hex(nonce),
            "signature": [],
        }
        
        fee_result = await rpc_call("starknet_estimateFee", {
            "request": [declare_tx],
            "block_id": "latest"
        }, session)
        
        # Calculate max fee (with 20% buffer)
        suggested_fee = int(fee_result[0]["overall_fee"], 16)
        max_fee = suggested_fee * ฺ120 // 100
        print(f"Suggested fee: {suggested_fee}, Max fee: {max_fee}")
        
        # Sign the transaction
        # This is complex - we'd need to properly construct and sign the declare transaction
        # For now, let's try using starknet.py's signing but with raw RPC submission
        
    print("\n⚠️  Raw RPC declare is complex - it requires proper transaction signing")
    print("   For now, please use starkli if available, or we can try a different approach")
    
    # Actually, let's try one more thing - use starknet.py but patch the block_id
    # by using a custom client wrapper


if __name__ == "__main__":
    asyncio.run(declare_contract())


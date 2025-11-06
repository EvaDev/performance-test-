#!/usr/bin/env python3
"""
Call contract functions on Sepolia testnet using starknet_py.
This avoids the RPC version issues with starkli.

Usage:
    source venv/bin/activate
    python3 scripts/call-sepolia-contract.py get_all_balances
    python3 scripts/call-sepolia-contract.py get_balance 0x7d101d7e45f0bda48db725965be0b23db4cd4f78db2304bbe9d011f5128736c
"""

import asyncio
import sys
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.client_models import Call
from starknet_py.hash.selector import get_selector_from_name

# Contract address from Sepolia (correct address from Starkscan)
CONTRACT_ADDRESS = 0x063ab038c9d25515aa8e873febae8eb5b1d4be5fba1a217958064fac441b619e

# Try multiple RPC endpoints (v0_9 and v0_8)
RPC_ENDPOINTS = [
    "https://starknet-sepolia.public.blastapi.io/rpc/v0_9",
    "https://starknet-sepolia.infura.io/v3/738a3e1e3f934295b1e4c3034dcbedf9",
    "https://starknet-sepolia.public.blastapi.io/rpc/v0_8",
    "https://starknet-sepolia-rpc.publicnode.com",
]

async def call_contract(function_name, args=None, rpc_url=None):
    """Call a contract function on Sepolia"""
    if rpc_url is None:
        # Try endpoints in order until one works
        for endpoint in RPC_ENDPOINTS:
            try:
                print(f"Trying RPC endpoint: {endpoint}")
                return await call_contract(function_name, args, endpoint)
            except Exception as e:
                print(f"  ❌ Failed: {e}")
                continue
        raise Exception("All RPC endpoints failed")
    
    client = FullNodeClient(node_url=rpc_url)
    
    selector = get_selector_from_name(function_name)
    
    call_data = args if args else []
    
    # Convert hex strings to ints
    if call_data:
        call_data = [
            int(arg, 16) if isinstance(arg, str) and arg.startswith("0x") else int(arg)
            for arg in call_data
        ]
    
    call = Call(
        to_addr=CONTRACT_ADDRESS,
        selector=selector,
        calldata=call_data
    )
    
    print(f"📞 Calling {function_name} on contract {hex(CONTRACT_ADDRESS)}...")
    print(f"   RPC: {rpc_url}")
    print(f"   Selector: {hex(selector)}")
    print(f"   Args: {[hex(x) if isinstance(x, int) else str(x) for x in call_data]}")
    print()
    
    try:
        result = await client.call_contract(call, block_number="latest")
        print(f"✅ Call successful!")
        print(f"   Result: {result}")
        print(f"   Raw: {[hex(x) for x in result]}")
        
        # Special handling for get_all_balances which returns an array
        if function_name == "get_all_balances" and len(result) > 0:
            print(f"\n   Parsed balances:")
            # Format: (address, balance_low, balance_high) tuples
            for i in range(0, len(result), 3):
                if i + 2 < len(result):
                    addr = hex(result[i])
                    balance_low = result[i + 1]
                    balance_high = result[i + 2]
                    balance = (balance_high << 128) + balance_low
                    print(f"      {addr}: {balance}")
        
        return result
    except Exception as e:
        print(f"❌ Call failed: {e}")
        raise

async def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 scripts/call-sepolia-contract.py <function_name> [args...]")
        print("\nExamples:")
        print("  python3 scripts/call-sepolia-contract.py get_all_balances")
        print("  python3 scripts/call-sepolia-contract.py get_balance 0x7d101d7e45f0bda48db725965be0b23db4cd4f78db2304bbe9d011f5128736c")
        sys.exit(1)
    
    function_name = sys.argv[1]
    args = sys.argv[2:] if len(sys.argv) > 2 else []
    
    await call_contract(function_name, args)

if __name__ == "__main__":
    asyncio.run(main())


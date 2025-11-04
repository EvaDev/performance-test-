#!/usr/bin/env python3
"""
Call contract functions on Katana using starknet.py.

Usage:
    source venv/bin/activate
    python3 katana/call-contract.py get_all_balances
    python3 katana/call-contract.py get_balance 0x54b9b1b06e7110f1ef0b0c3467610438311da4680d3c75d557b52788591741
"""

import asyncio
import sys
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.net.client_models import Call

# Configuration
RPC_URL = "http://127.0.0.1:5050"
CONTRACT_ADDRESS = 0x0163d45d352d9563b810fc820cd52d1282c5f8c8e0b4d66ecc88853b3da1f34d
ACCOUNT_ADDRESS = 0x54b9b1b06e7110f1ef0b0c3467610438311da4680d3c75d557b52788591741
PRIVATE_KEY = 0x5ce311283aa15aa3dc58d99fe122cdaa389615e7d800f98fab238c5a7c8d624
KATANA_CHAIN_ID = 0x4b4154414e41

async def call_contract(function_name, args=None):
    client = FullNodeClient(node_url=RPC_URL)
    key_pair = KeyPair.from_private_key(PRIVATE_KEY)
    
    account = Account(
        client=client,
        address=ACCOUNT_ADDRESS,
        key_pair=key_pair,
        chain=KATANA_CHAIN_ID
    )
    
    from starknet_py.hash.selector import get_selector_from_name
    selector = get_selector_from_name(function_name)
    
    call_data = args if args else []
    
    call = Call(
        to_addr=CONTRACT_ADDRESS,
        selector=selector,
        calldata=call_data
    )
    
    print(f"📞 Calling {function_name} on contract {hex(CONTRACT_ADDRESS)}...")
    print(f"   Selector: {hex(selector)}")
    print(f"   Args: {[hex(x) if isinstance(x, int) else str(x) for x in call_data]}")
    print()
    
    try:
        result = await client.call_contract(call, block_number="latest")
        print(f"✅ Call successful!")
        print(f"   Result: {result}")
        print(f"   Raw: {[hex(x) for x in result]}")
        return result
    except Exception as e:
        print(f"❌ Call failed: {e}")
        raise

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 katana/call-contract.py <function_name> [args...]")
        print("\nExamples:")
        print("  python3 katana/call-contract.py get_all_balances")
        print("  python3 katana/call-contract.py get_balance 0x54b9b1b06e7110f1ef0b0c3467610438311da4680d3c75d557b52788591741")
        sys.exit(1)
    
    function_name = sys.argv[1]
    args = []
    
    if len(sys.argv) > 2:
        # Parse arguments as hex strings
        for arg in sys.argv[2:]:
            if arg.startswith("0x"):
                args.append(int(arg, 16))
            else:
                args.append(int(arg))
    
    asyncio.run(call_contract(function_name, args))


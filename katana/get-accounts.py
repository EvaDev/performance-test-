#!/usr/bin/env python3
"""
Extract Katana pre-funded accounts from startup logs or RPC.
"""

import asyncio
import json
from starknet_py.net.full_node_client import FullNodeClient

RPC_URL = "http://127.0.0.1:5050"

async def get_katana_accounts_from_rpc():
    """Try to get account info from Katana RPC."""
    client = FullNodeClient(node_url=RPC_URL)
    
    # First pre-funded account (from Katana logs)
    first_account = {
        "address": "0x54b9b1b06e7110f1ef0b0c3467610438311da4680d3c75d557b52788591741",
        "private_key": "0x5ce311283aa15aa3dc58d99fe122cdaa389615e7d800f98fab238c5a7c8d624",
        "public_key": "0x1515e1b215eb9f414a8e93d61a5905f4ed725a477c51e0e42a1e51bfc50bc2e"
    }
    
    accounts = [first_account]
    
    # Try to get nonce for accounts 0-20 to see which are valid
    valid_accounts = []
    for i in range(20):
        # Katana uses sequential addresses or you can derive them
        # For now, just use the known first account
        if i == 0:
            valid_accounts.append(first_account)
            break
    
    return accounts


if __name__ == "__main__":
    accounts = asyncio.run(get_katana_accounts_from_rpc())
    print(json.dumps(accounts, indent=2))


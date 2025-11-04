#!/usr/bin/env python3
"""
Simple deployment script for Katana using raw RPC calls.
No dependencies required - uses only standard library.
"""

import json
import urllib.request
import urllib.parse

# Configuration
RPC_URL = "http://127.0.0.1:5050"
UDC_ADDRESS = "0x41a78e741e5af2fec34b695679bc6891742439f7afb8484ecd7766661ad02bf"  # Katana UDC
CLASS_HASH = "0x3dae15380b2149b55015b91684a5fb0747142de3303e36d867f574a22be22d6"
ADMIN_ADDRESS = "0x54b9b1b06e7110f1ef0b0c3467610438311da4680d3c75d557b52788591741"
ACCOUNT_ADDRESS = "0x54b9b1b06e7110f1ef0b0c3467610438311da4680d3c75d557b52788591741"
PRIVATE_KEY = "0x5ce311283aa15aa3dc58d99fe122cdaa389615e7d800f98fab238c5a7c8d624"

def rpc_call(method, params):
    """Make an RPC call to Katana"""
    payload = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": 1
    }
    
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        RPC_URL,
        data=data,
        headers={'Content-Type': 'application/json'}
    )
    
    with urllib.request.urlopen(req) as response:
        result = json.loads(response.read())
        if 'error' in result:
            raise Exception(f"RPC Error: {result['error']}")
        return result['result']

def get_nonce(address):
    """Get account nonce"""
    result = rpc_call("starknet_getNonce", {
        "contract_address": address,
        "block_id": "latest"
    })
    return int(result, 16)

def get_chain_id():
    """Get chain ID"""
    result = rpc_call("starknet_chainId", [])
    return result

print("=" * 60)
print("  Simple Katana Deployment")
print("=" * 60)
print(f"RPC URL: {RPC_URL}")
print(f"Class Hash: {CLASS_HASH}")
print(f"Admin Address: {ADMIN_ADDRESS}")
print("=" * 60)
print()

print("⚠️  This script requires transaction signing which is complex.")
print("   For now, please use one of these alternatives:")
print()
print("Option 1: Use sncast script feature")
print("   sncast --profile katana_account1 script ...")
print()
print("Option 2: Install starknet_py and use the full script")
print("   pip install starknet-py")
print("   python3 katana/deploy-with-python.py")
print()
print("Option 3: Wait for sncast Katana UDC support")
print()
print("The issue is that sncast calculates UDC addresses based on")
print("chain ID and doesn't support Katana's custom UDC configuration.")
print()
print("Current status:")
print(f"  ✅ Declaration works with sncast")
print(f"  ❌ Deployment fails due to wrong UDC address")
print(f"  💡 Need to deploy via Katana's UDC: {UDC_ADDRESS}")


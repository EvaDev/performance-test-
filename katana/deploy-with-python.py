#!/usr/bin/env python3
"""
Deploy contract to Katana using starknet.py directly via Katana's UDC
"""

import asyncio
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.hash.address import compute_address
from starknet_py.net.models import StarknetChainId, Call

RPC_URL = "http://127.0.0.1:5050"
UDC_ADDRESS = 0x41a78e741e5af2fec34b695679bc6891742439f7afb8484ecd7766661ad02bf  # Katana UDC
CLASS_HASH = 0x3dae15380b2149b55015b91684a5fb0747142de3303e36d867f574a22be22d6
ADMIN_ADDRESS = 0x54b9b1b06e7110f1ef0b0c3467610438311da4680d3c75d557b52788591741
ACCOUNT_ADDRESS = 0x54b9b1b06e7110f1ef0b0c3467610438311da4680d3c75d557b52788591741
PRIVATE_KEY = 0x5ce311283aa15aa3dc58d99fe122cdaa389615e7d800f98fab238c5a7c8d624

async def deploy():
    client = FullNodeClient(node_url=RPC_URL)
    key_pair = KeyPair.from_private_key(PRIVATE_KEY)
    account = Account(
        client=client,
        address=ACCOUNT_ADDRESS,
        key_pair=key_pair,
        chain=StarknetChainId.SEPOLIA  # Katana accepts this
    )
    
    print(f"📦 Deploying contract via Katana UDC...")
    print(f"   Class Hash: {hex(CLASS_HASH)}")
    print(f"   Admin Address: {hex(ADMIN_ADDRESS)}")
    
    # Call UDC's deployContract function
    deploy_call = Call(
        to_addr=UDC_ADDRESS,
        selector=0x19c89c8a8611a59ca081e10cfa98933c62b6fd2d0a5686bb49357c7d5e7a05e,  # deployContract selector
        calldata=[
            CLASS_HASH,  # class_hash
            0,  # salt (use 0)
            0,  # unique flag (0 = not unique)
            len([ADMIN_ADDRESS]),  # constructor_calldata_len
            ADMIN_ADDRESS  # constructor_calldata
        ]
    )
    
    try:
        result = await account.execute(calls=deploy_call, auto_estimate=True)
        await client.wait_for_tx(result.transaction_hash)
        
        # Calculate the deployed address
        # For UDC: address = hash(UDC_ADDRESS, class_hash, salt, constructor_calldata)
        from starknet_py.hash.udc_deployer_hash import compute_contract_address
        
        deployed_address = compute_contract_address(
            salt=0,
            class_hash=CLASS_HASH,
            constructor_calldata=[ADMIN_ADDRESS],
            deployer_address=UDC_ADDRESS
        )
        
        print(f"✅ Contract deployed!")
        print(f"   Address: {hex(deployed_address)}")
        print(f"   Transaction Hash: {hex(result.transaction_hash)}")
        
    except Exception as e:
        print(f"❌ Deployment failed: {e}")
        raise

if __name__ == "__main__":
    asyncio.run(deploy())


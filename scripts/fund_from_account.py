#!/usr/bin/env python3
"""
Fund accounts from a funded account in test_accounts.json
Uses the first account (which should have funds) to transfer STRK to all other accounts
"""

import asyncio
import json
import os
import sys
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.net.client_models import Call, ResourceBounds, ResourceBoundsMapping
from starknet_py.hash.selector import get_selector_from_name
from starknet_py.net.models import InvokeV3, StarknetChainId
import dataclasses

# Configuration
RPC_URL = os.getenv("SEPOLIA_RPC_URL", "https://starknet-sepolia.infura.io/v3/738a3e1e3f934295b1e4c3034dcbedf9")
SEPOLIA_CHAIN_ID = StarknetChainId.SEPOLIA
STRK_TOKEN_ADDRESS = 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d

# Default amount to fund each account (in STRK)
DEFAULT_FUND_AMOUNT_STRK = 5.0

async def fund_from_account(amount_strk: float = None, funder_index: int = 0, rpc_url: str = None):
    """Fund accounts from a funded account in test_accounts.json"""
    
    # Use provided RPC URL or default
    if rpc_url is None:
        rpc_url = RPC_URL
    
    # Load test accounts
    script_dir = os.path.dirname(os.path.abspath(__file__))
    accounts_path = os.path.join(script_dir, "test_accounts.json")
    
    if not os.path.exists(accounts_path):
        print(f"❌ Error: Test accounts file not found at {accounts_path}")
        return
    
    with open(accounts_path, 'r') as f:
        test_accounts = json.load(f)
    
    if funder_index >= len(test_accounts):
        print(f"❌ Error: Funder index {funder_index} is out of range (max: {len(test_accounts)-1})")
        return
    
    # Get funder account (first account by default)
    funder_acc = test_accounts[funder_index]
    funder_address = int(funder_acc['address'], 16) if isinstance(funder_acc['address'], str) else funder_acc['address']
    funder_private_key = funder_acc['private_key']
    if not funder_private_key.startswith('0x'):
        funder_private_key = '0x' + funder_private_key
    
    # Get recipient accounts (all except funder)
    recipient_accounts = [acc for i, acc in enumerate(test_accounts) if i != funder_index]
    
    fund_amount = amount_strk if amount_strk else DEFAULT_FUND_AMOUNT_STRK
    
    print(f"{'='*60}")
    print(f"Funding Accounts from Test Account")
    print(f"{'='*60}")
    print(f"Funder account: {hex(funder_address)[:20]}...")
    print(f"Recipients: {len(recipient_accounts)}")
    print(f"Amount per account: {fund_amount} STRK")
    print(f"Total required: {len(recipient_accounts) * fund_amount} STRK")
    print(f"RPC URL: {rpc_url}")
    print(f"{'='*60}\n")
    
    # Setup client and funder account
    client = FullNodeClient(node_url=rpc_url)
    funder_key_pair = KeyPair.from_private_key(int(funder_private_key, 16))
    funder_account = Account(
        client=client,
        address=funder_address,
        key_pair=funder_key_pair,
        chain=SEPOLIA_CHAIN_ID
    )
    
    # Check funder balance
    balance_of_selector = get_selector_from_name("balance_of")
    balance_call = Call(
        to_addr=STRK_TOKEN_ADDRESS,
        selector=balance_of_selector,
        calldata=[funder_address]
    )
    try:
        balance_result = await client.call_contract(balance_call, block_number="latest")
    except Exception as e:
        print(f"❌ Error checking balance: {e}")
        return
    
    balance_low = balance_result[0]
    balance_high = balance_result[1] if len(balance_result) > 1 else 0
    funder_balance = (balance_high << 128) + balance_low
    funder_balance_strk = funder_balance / 10**18
    
    print(f"Funder balance: {funder_balance_strk:.4f} STRK")
    
    required_balance = len(recipient_accounts) * fund_amount
    # Estimate transaction fees (~1 STRK per transaction with manual bounds)
    tx_fee_per_transfer = 1.0  # Conservative estimate
    total_required = required_balance + (len(recipient_accounts) * tx_fee_per_transfer)
    
    if funder_balance_strk < total_required:
        print(f"⚠️  WARNING: Funder balance ({funder_balance_strk:.4f} STRK) is less than required ({total_required:.4f} STRK)")
        print(f"   (Need {required_balance:.4f} STRK for transfers + {len(recipient_accounts) * tx_fee_per_transfer:.4f} STRK for fees)")
        response = input("Continue anyway? (y/N): ")
        if response.lower() != 'y':
            return
    
    # Fund each account
    fund_amount_wei = int(fund_amount * 10**18)
    transfer_selector = get_selector_from_name("transfer")
    
    # Use resource bounds that work with v0.8.1 RPCs
    # Lower bounds to fit within account balances
    resource_bounds = ResourceBoundsMapping(
        l1_gas=ResourceBounds(max_amount=200000, max_price_per_unit=20000000000000),
        l2_gas=ResourceBounds(max_amount=200000, max_price_per_unit=20000000000000),
        l1_data_gas=ResourceBounds(max_amount=200000, max_price_per_unit=20000000000000)
    )
    
    successful = 0
    failed = 0
    
    for i, acc in enumerate(recipient_accounts):
        recipient_address = int(acc['address'], 16) if isinstance(acc['address'], str) else acc['address']
        
        # Prepare transfer call
        amount_low = fund_amount_wei & ((1 << 128) - 1)
        amount_high = (fund_amount_wei >> 128) & ((1 << 128) - 1)
        
        transfer_call = Call(
            to_addr=STRK_TOKEN_ADDRESS,
            selector=transfer_selector,
            calldata=[recipient_address, amount_low, amount_high]
        )
        
        try:
            # Try execute_v3 with auto_estimate=True first
            result = await funder_account.execute_v3(
                calls=[transfer_call],
                auto_estimate=True
            )
            tx_hash = result.transaction_hash
            
            # Wait for confirmation
            await client.wait_for_tx(tx_hash)
            
            print(f"[{i+1}/{len(recipient_accounts)}] ✅ Funded {hex(recipient_address)[:20]}... with {fund_amount} STRK (tx: {hex(tx_hash)[:16]}...)")
            successful += 1
        except Exception as e:
            error_msg = str(e)
            # If auto_estimate fails due to "pending", try manual construction
            if "pending" in error_msg.lower() or "Invalid block id" in error_msg:
                try:
                    # Fallback: Manual construction
                    nonce = await funder_account.get_nonce(block_number="latest")
                    
                    invoke_calldata = [
                        1,  # call_array_len
                        transfer_call.to_addr,
                        transfer_call.selector,
                        0,  # data_offset
                        len(transfer_call.calldata),
                        *transfer_call.calldata
                    ]
                    
                    transaction = InvokeV3(
                        sender_address=funder_account.address,
                        calldata=invoke_calldata,
                        nonce=nonce,
                        resource_bounds=resource_bounds,
                        tip=0,
                        signature=[],
                        version=3
                    )
                    
                    signature = funder_account.signer.sign_transaction(transaction)
                    signed_tx = dataclasses.replace(transaction, signature=signature)
                    
                    result = await client.send_transaction(signed_tx)
                    tx_hash = result.transaction_hash
                    await client.wait_for_tx(tx_hash)
                    
                    print(f"[{i+1}/{len(recipient_accounts)}] ✅ Funded {hex(recipient_address)[:20]}... with {fund_amount} STRK (tx: {hex(tx_hash)[:16]}...)")
                    successful += 1
                except Exception as e2:
                    error_msg2 = str(e2)
                    if len(error_msg2) > 200:
                        error_msg2 = error_msg2[:200] + "..."
                    print(f"[{i+1}/{len(recipient_accounts)}] ❌ Failed (manual): {error_msg2}")
                    failed += 1
            else:
                if len(error_msg) > 200:
                    error_msg = error_msg[:200] + "..."
                print(f"[{i+1}/{len(recipient_accounts)}] ❌ Failed: {error_msg}")
                failed += 1
    
    print(f"\n{'='*60}")
    print(f"Summary: {successful} successful, {failed} failed")
    print(f"{'='*60}")

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Fund accounts from a funded account in test_accounts.json")
    parser.add_argument("--amount", type=float, default=DEFAULT_FUND_AMOUNT_STRK,
                       help=f"Amount of STRK to fund each account (default: {DEFAULT_FUND_AMOUNT_STRK})")
    parser.add_argument("--funder-index", type=int, default=0,
                       help="Index of the funded account to use (default: 0, first account)")
    parser.add_argument("--rpc-url", type=str, default=None,
                       help="RPC URL (default: from environment or Infura)")
    
    args = parser.parse_args()
    
    rpc_url = args.rpc_url if args.rpc_url else RPC_URL
    
    asyncio.run(fund_from_account(amount_strk=args.amount, funder_index=args.funder_index, rpc_url=rpc_url))


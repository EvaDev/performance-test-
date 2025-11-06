#!/usr/bin/env python3
"""
Fund accounts on Sepolia testnet with STRK tokens

⚠️  IMPORTANT: Braavos Account Limitation
   This script has known issues with Braavos accounts when using RPCs that don't
   support the "pending" block tag (e.g., Infura). Braavos accounts require
   auto_estimate=True which needs an RPC supporting "pending".
   
   See FUNDING_NOTES.md for solutions and alternatives.
"""

import asyncio
import json
import sys
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.net.client_models import Call, ResourceBounds, ResourceBoundsMapping
from starknet_py.hash.selector import get_selector_from_name
from starknet_py.net.models import InvokeV3, StarknetChainId
from starknet_py.contract import Contract
import dataclasses

# Configuration
import os
import argparse

# Try multiple RPC endpoints - some may support "pending" which helps with auto_estimate
RPC_URLS = [
    os.getenv("SEPOLIA_RPC_URL", "https://starknet-sepolia.infura.io/v3/738a3e1e3f934295b1e4c3034dcbedf9"),
    "https://starknet-sepolia-rpc.publicnode.com",  # PublicNode - may support pending
    "https://starknet-sepolia.public.rtord.org",  # Official public RPC
]

DEFAULT_RPC_URL = RPC_URLS[0]
SEPOLIA_CHAIN_ID = StarknetChainId.SEPOLIA  # Use SEPOLIA, not SEPOLIA_TESTNET
STRK_TOKEN_ADDRESS = 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d

# Funder account (needs to have STRK balance)
# You can override these with environment variables or command-line args
FUNDER_PRIVATE_KEY = os.getenv("FUNDER_PRIVATE_KEY", "0x04eb9093c6bc934e99dbdf1f2258e7d101da3c8503ef38e55f40964e15b155a8")
FUNDER_ADDRESS = int(os.getenv("FUNDER_ADDRESS", "0x0764a2fe39643b6ef291883d14676ebc09f3f27fbea24fbf49cfa7976f97bc4c"), 16)

# Default amount to fund each account (in STRK)
# Can be overridden with command-line argument
DEFAULT_FUND_AMOUNT_STRK = 50.0  # 50 STRK per account (enough for resource bounds)

async def fund_accounts(amount_strk: float = None, max_accounts: int = None, rpc_url: str = None):
    """Fund accounts from test_accounts.json with STRK"""
    
    # Use provided RPC URL or default
    if rpc_url is None:
        rpc_url = DEFAULT_RPC_URL
    
    # Load test accounts
    script_dir = os.path.dirname(os.path.abspath(__file__))
    accounts_path = os.path.join(script_dir, "test_accounts.json")
    
    if not os.path.exists(accounts_path):
        print(f"❌ Error: Test accounts file not found at {accounts_path}")
        return
    
    with open(accounts_path, 'r') as f:
        test_accounts = json.load(f)
    
    # Limit number of accounts if specified
    if max_accounts:
        test_accounts = test_accounts[:max_accounts]
    
    fund_amount = amount_strk if amount_strk else DEFAULT_FUND_AMOUNT_STRK
    
    print(f"{'='*60}")
    print(f"Funding Accounts Script")
    print(f"{'='*60}")
    print(f"Accounts to fund: {len(test_accounts)}")
    print(f"Amount per account: {fund_amount} STRK")
    print(f"Total required: {len(test_accounts) * fund_amount} STRK")
    print(f"RPC URL: {rpc_url}")
    print(f"{'='*60}\n")
    
    # Setup client and funder account
    # Check if Alchemy URL needs correction (v3 -> v2)
    if "alchemy.com" in rpc_url and "/v3/" in rpc_url:
        corrected_url = rpc_url.replace("/v3/", "/v2/")
        print(f"⚠️  Warning: Alchemy URLs should use /v2/ not /v3/")
        print(f"   Using corrected URL: {corrected_url}")
        rpc_url = corrected_url
    
    client = FullNodeClient(node_url=rpc_url)
    
    try:
        funder_key_pair = KeyPair.from_private_key(int(FUNDER_PRIVATE_KEY, 16))
        funder_account = Account(
            client=client,
            address=FUNDER_ADDRESS,
            key_pair=funder_key_pair,
            chain=SEPOLIA_CHAIN_ID
        )
        
        # Check funder balance
        balance_of_selector = get_selector_from_name("balance_of")
        balance_call = Call(
            to_addr=STRK_TOKEN_ADDRESS,
            selector=balance_of_selector,
            calldata=[FUNDER_ADDRESS]
        )
        balance_result = await client.call_contract(balance_call, block_number="latest")
    except Exception as e:
        error_msg = str(e)
        if "404" in error_msg or "Client failed with code 404" in error_msg:
            print(f"\n❌ Error: RPC endpoint returned 404 (Not Found)")
            if "alchemy.com" in rpc_url:
                print(f"   💡 Alchemy URLs should use /v2/ not /v3/")
                print(f"   💡 Correct format: https://starknet-sepolia.g.alchemy.com/v2/YOUR_API_KEY")
            print(f"   💡 Please check your RPC URL and try again")
            raise
        elif "401" in error_msg or "Must be authenticated" in error_msg or "Client failed with code 401" in error_msg:
            print(f"\n❌ Error: RPC endpoint returned 401 (Authentication Required)")
            if "alchemy.com" in rpc_url:
                print(f"   💡 Your Alchemy API key may be invalid or expired")
                print(f"   💡 Get a new API key from: https://www.alchemy.com/")
                print(f"   💡 Make sure you're using the Starknet Sepolia endpoint")
            print(f"   💡 Please check your API key and try again")
            raise
        raise
    balance_low = balance_result[0]
    balance_high = balance_result[1] if len(balance_result) > 1 else 0
    funder_balance = (balance_high << 128) + balance_low
    funder_balance_strk = funder_balance / 10**18
    
    print(f"Funder balance: {funder_balance_strk:.4f} STRK")
    
    required_balance = len(test_accounts) * fund_amount
    # Also need to account for transaction fees (~46.8 STRK per transaction)
    tx_fee_per_transfer = 46.8  # Approximate cost per transfer
    total_required = required_balance + (len(test_accounts) * tx_fee_per_transfer)
    
    if funder_balance_strk < total_required:
        print(f"⚠️  WARNING: Funder balance ({funder_balance_strk:.4f} STRK) is less than required ({total_required:.4f} STRK)")
        print(f"   (Need {required_balance:.4f} STRK for transfers + {len(test_accounts) * tx_fee_per_transfer:.4f} STRK for fees)")
        response = input("Continue anyway? (y/N): ")
        if response.lower() != 'y':
            return
    
    # Fund each account
    fund_amount_wei = int(fund_amount * 10**18)
    
    # Use minimum required resource bounds (520K amount, 30T price)
    # This matches Sepolia's requirements
    # Total cost = 520K * 30T * 3 = 46.8 STRK per transaction
    resource_bounds = ResourceBoundsMapping(
        l1_gas=ResourceBounds(max_amount=520000, max_price_per_unit=30000000000000),
        l2_gas=ResourceBounds(max_amount=520000, max_price_per_unit=30000000000000),
        l1_data_gas=ResourceBounds(max_amount=520000, max_price_per_unit=30000000000000)
    )
    
    transfer_selector = get_selector_from_name("transfer")
    
    successful = 0
    failed = 0
    
    for i, acc in enumerate(test_accounts):
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
            # Try execute_v3 with auto_estimate=True first - this works best with accounts that support it
            # Note: Braavos accounts may have issues with manual transaction construction
            result = await funder_account.execute_v3(
                calls=[transfer_call],
                auto_estimate=True  # Let SDK handle everything - works best with proper account setup
            )
            tx_hash = result.transaction_hash
            
            # Wait for confirmation
            await client.wait_for_tx(tx_hash)
            
            print(f"[{i+1}/{len(test_accounts)}] ✅ Funded {hex(recipient_address)[:20]}... with {fund_amount} STRK (tx: {hex(tx_hash)[:16]}...)")
            successful += 1
        except Exception as e:
            error_msg = str(e)
            # If auto_estimate fails, it might be due to "pending" block tag or account validation
            # For Braavos accounts, manual construction may not work due to account-specific validation
            if "pending" in error_msg.lower() or "Invalid block id" in error_msg:
                print(f"[{i+1}/{len(test_accounts)}] ⚠️  RPC doesn't support 'pending' - trying manual construction...")
                print(f"   Note: This may fail with Braavos accounts due to validation requirements")
                try:
                    # Fallback: Manual construction with explicit nonce
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
                    
                    print(f"[{i+1}/{len(test_accounts)}] ✅ Funded {hex(recipient_address)[:20]}... with {fund_amount} STRK (tx: {hex(tx_hash)[:16]}...)")
                    successful += 1
                except Exception as e2:
                    error_msg2 = str(e2)
                    if len(error_msg2) > 200:
                        error_msg2 = error_msg2[:200] + "..."
                    print(f"[{i+1}/{len(test_accounts)}] ❌ Failed (manual): {error_msg2}")
                    print(f"   💡 Tip: Braavos accounts may require auto_estimate=True with an RPC that supports 'pending'")
                    failed += 1
            else:
                # Other errors - could be account validation, balance, etc.
                if len(error_msg) > 300:
                    error_msg = error_msg[:300] + "..."
                print(f"[{i+1}/{len(test_accounts)}] ❌ Failed: {error_msg}")
                if "validate" in error_msg.lower() or "Input too long" in error_msg:
                    print(f"   💡 Tip: This appears to be a Braavos account validation issue.")
                    print(f"   💡 Try: Using an RPC endpoint that supports 'pending' (e.g., Alchemy)")
                    print(f"   💡 Or: Use a different account type (e.g., OpenZeppelin account)")
                failed += 1
    
    print(f"\n{'='*60}")
    print(f"Summary: {successful} successful, {failed} failed")
    print(f"{'='*60}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fund test accounts with STRK tokens on Sepolia")
    parser.add_argument("--amount", type=float, default=DEFAULT_FUND_AMOUNT_STRK,
                       help=f"Amount of STRK to fund each account (default: {DEFAULT_FUND_AMOUNT_STRK})")
    parser.add_argument("--max-accounts", type=int, default=None,
                       help="Maximum number of accounts to fund (default: all)")
    parser.add_argument("--rpc-url", type=str, default=None,
                       help="RPC URL (default: from environment or Infura)")
    parser.add_argument("--try-all-rpcs", action="store_true",
                       help="Try all available RPC endpoints if one fails")
    
    args = parser.parse_args()
    
    # Use provided RPC URL or default
    rpc_url = args.rpc_url if args.rpc_url else DEFAULT_RPC_URL
    
    # If try_all_rpcs is set, iterate through RPCs on failure
    if args.try_all_rpcs:
        async def try_all_rpcs():
            for rpc in RPC_URLS:
                print(f"\n{'='*60}")
                print(f"Trying RPC: {rpc}")
                print(f"{'='*60}")
                try:
                    await fund_accounts(amount_strk=args.amount, max_accounts=args.max_accounts, rpc_url=rpc)
                    break  # Success, exit loop
                except Exception as e:
                    print(f"RPC {rpc} failed: {e}")
                    if rpc == RPC_URLS[-1]:
                        print("\n❌ All RPC endpoints failed")
        asyncio.run(try_all_rpcs())
    else:
        asyncio.run(fund_accounts(amount_strk=args.amount, max_accounts=args.max_accounts, rpc_url=rpc_url))


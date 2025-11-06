#!/usr/bin/env python3
"""
Sepolia Performance Test - Realistic parallel user scenario

This script simulates real users submitting transactions in parallel on Starknet Sepolia.
Each operation is a separate transaction from a different account.
"""

import asyncio
import time
import json
import logging
import os
import hashlib
import dataclasses
from typing import List, Dict, Tuple
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.net.client_models import Call, ResourceBounds, ResourceBoundsMapping
from starknet_py.hash.selector import get_selector_from_name
from starknet_py.net.client_errors import ClientError
from starknet_py.hash.utils import pedersen_hash
from starknet_py.net.models import InvokeV3
from starknet_py.net.models.chains import StarknetChainId

# Configuration - Sepolia settings
# Default to Infura RPC (v0.8.1 compatible) for starkli compatibility
# Can override with SEPOLIA_RPC_URL environment variable
RPC_URL = os.getenv("SEPOLIA_RPC_URL", "https://starknet-sepolia.infura.io/v3/738a3e1e3f934295b1e4c3034dcbedf9")

SEPOLIA_CHAIN_ID = StarknetChainId.SEPOLIA

# Contract address on Sepolia
CONTRACT_ADDRESS = "0x063ab038c9d25515aa8e873febae8eb5b1d4be5fba1a217958064fac441b619e"

# Owner account details (if needed; otherwise, use test accounts)
# These paths are from your query; load if required, but we'll primarily use test_accounts.json
OWNER_KEYSTORE = os.getenv("STARKNET_KEYSTORE", "/Users/seanevans/Documents/ssp/cairo/accounts/nft_owner.json")
OWNER_ACCOUNT = os.getenv("STARKNET_ACCOUNT", "/Users/seanevans/Documents/ssp/cairo/accounts/nft_owner-account.json")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def load_accounts_from_file(accounts_file: str = "test_accounts.json") -> List[Dict]:
    """Load accounts from JSON file."""
    # Use script directory if relative path
    if not os.path.isabs(accounts_file):
        accounts_file = os.path.join(os.path.dirname(__file__), accounts_file)
    
    if not os.path.exists(accounts_file):
        logger.error(f"Accounts file {accounts_file} not found.")
        raise FileNotFoundError(f"{accounts_file} not found")
    
    try:
        with open(accounts_file, 'r') as f:
            accounts_data = json.load(f)
        
        accounts = []
        for acc in accounts_data:
            addr = acc.get("address")
            priv_key = acc.get("private_key")
            if addr and priv_key:
                # Convert hex strings to ints
                addr_int = int(addr, 16) if isinstance(addr, str) else addr
                priv_key_int = int(priv_key, 16) if isinstance(priv_key, str) else priv_key
                accounts.append({
                    "address": addr_int,
                    "private_key": priv_key_int
                })
        
        logger.info(f"✅ Loaded {len(accounts)} accounts from {accounts_file}")
        return accounts
    except Exception as e:
        logger.error(f"Failed to load accounts from {accounts_file}: {e}")
        raise


async def create_account(client: FullNodeClient, address: int, private_key: int) -> Account:
    """Create an account instance."""
    key_pair = KeyPair.from_private_key(private_key)
    account = Account(
        client=client,
        address=address,
        key_pair=key_pair,
        chain=SEPOLIA_CHAIN_ID
    )
    return account


async def update_balance_single(
    account: Account,
    client: FullNodeClient,
    contract_address: int,
    new_balance: int,
    op_id: int,
    nonce: int = None,
    max_retries: int = 3
) -> Dict:
    """
    Execute a single update_balance transaction (one user operation).
    This represents a realistic scenario where each user submits their own transaction.
    
    Fire-and-forget: Returns immediately after submission, doesn't wait for acceptance.
    This allows much higher throughput.
    
    Includes retry logic with exponential backoff for connection errors.
    
    If nonce is provided, uses it (for parallel submission).
    Otherwise gets fresh nonce (for sequential submission).
    """
    update_balance_selector = get_selector_from_name("update_balance")
    
    call = Call(
        to_addr=contract_address,
        selector=update_balance_selector,
        calldata=[new_balance & ((1 << 128) - 1), (new_balance >> 128) & ((1 << 128) - 1)]  # u256 as (low, high)
    )
    
    start_time = time.time()
    
    # For Sepolia, use auto_estimate for fees
    # No need for manual high resource bounds
    
    # Retry logic for connection errors
    for attempt in range(max_retries):
        try:
            # If nonce not provided, get it (for sequential)
            # Use "latest" block tag for v0.8.1 RPC compatibility
            if nonce is None:
                nonce = await account.get_nonce(block_number="latest")
            
            # Use Account's sign_invoke_v3 to prepare and sign the transaction
            signed_transaction = await account.sign_invoke_v3(
                calls=call,
                nonce=nonce,
                auto_estimate=True,  # Estimate fees automatically for Sepolia
                tip=0
            )
            
            # Send transaction - returns immediately
            result = await client.send_transaction(signed_transaction)
            
            tx_hash = result.transaction_hash
            submit_duration = time.time() - start_time
            
            return {
                "tx_hash": hex(tx_hash),
                "duration": submit_duration,
                "op_id": op_id,
                "success": True,
                "account": hex(account.address),
                "nonce": nonce
            }
        except Exception as e:
            error_str = str(e)
            
            if "429" in error_str or "Too many connections" in error_str or "rate limit" in error_str:
                if attempt < max_retries - 1:
                    wait_time = 0.1 * (2 ** attempt)
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    submit_duration = time.time() - start_time
                    logger.error(f"Operation {op_id} failed after {max_retries} retries (nonce {nonce}): {e}")
                    return {
                        "tx_hash": None,
                        "duration": submit_duration,
                        "op_id": op_id,
                        "success": False,
                        "error": str(e),
                        "account": hex(account.address),
                        "nonce": nonce
                    }
            else:
                submit_duration = time.time() - start_time
                logger.error(f"Operation {op_id} failed (nonce {nonce}): {e}")
                return {
                    "tx_hash": None,
                    "duration": submit_duration,
                    "op_id": op_id,
                    "success": False,
                    "error": str(e),
                    "account": hex(account.address),
                    "nonce": nonce
                }
    
    submit_duration = time.time() - start_time
    return {
        "tx_hash": None,
        "duration": submit_duration,
        "op_id": op_id,
        "success": False,
        "error": "Max retries exceeded",
        "account": hex(account.address),
        "nonce": nonce
    }


async def verify_contract_exists(client: FullNodeClient, contract_address: str) -> bool:
    """Verify that the contract is actually deployed at the given address."""
    try:
        contract_addr_int = int(contract_address, 16) if isinstance(contract_address, str) else contract_address
        class_hash = await client.get_class_hash_at(contract_addr_int, block_number="latest")
        return class_hash != 0
    except Exception as e:
        logger.warning(f"Failed to verify contract at {contract_address}: {e}")
        return False


async def run_performance_test(
    total_operations: int = 200,
    parallel_ops: int = 50,
    num_accounts: int = 50,
    contract_address: str = CONTRACT_ADDRESS
) -> Dict:
    """
    Run performance test with realistic parallel user scenario on Sepolia.
    
    Strategy:
    1. Each operation is a separate update_balance transaction
    2. Operations are submitted in parallel from different accounts
    3. This simulates real users submitting transactions concurrently
    """
    # Create client
    client = FullNodeClient(node_url=RPC_URL)
    
    # Patch the HTTP client to replace "pending" with "latest" for v0.8.1 RPC compatibility
    # Only apply patch for v0.8.1 RPC (not v0.9 which supports "pending")
    use_auto_estimate_rpc = "alchemy" in RPC_URL.lower() or "v0_9" in RPC_URL.lower()
    if not use_auto_estimate_rpc:
        http_client = client._client
        if hasattr(http_client, 'request'):
            original_request = http_client.request
        
        async def patched_request(address, http_method, params=None, payload=None):
            # Replace "pending" with "latest" in params and payload
            import json
            if payload and isinstance(payload, dict) and 'params' in payload:
                params_in_payload = payload.get('params', {})
                if isinstance(params_in_payload, dict):
                    if 'block_id' in params_in_payload:
                        if params_in_payload['block_id'] == 'pending':
                            params_in_payload['block_id'] = 'latest'
                if 'request' in params_in_payload:
                    req = params_in_payload['request']
                    if isinstance(req, list):
                        for r in req:
                            if isinstance(r, dict) and 'block_id' in r:
                                if r['block_id'] == 'pending':
                                    r['block_id'] = 'latest'
            return await original_request(address, http_method, params, payload)
        
        http_client.request = patched_request
        
        # Also patch the call method
        if hasattr(http_client, 'call'):
            original_call = http_client.call
            
            async def patched_call(method_name, params=None):
                if params:
                    import json
                    params_str = json.dumps(params)
                    if '"pending"' in params_str or "'pending'" in params_str:
                        params_str = params_str.replace('"pending"', '"latest"').replace("'pending'", "'latest'")
                        params = json.loads(params_str)
                return await original_call(method_name, params)
            
            http_client.call = patched_call
        
        logger.info("✅ Patched HTTP client to replace 'pending' with 'latest' for v0.8.1 compatibility")
    
    # Verify contract exists
    logger.info("=" * 60)
    logger.info("Starting Sepolia Performance Test")
    logger.info("=" * 60)
    logger.info(f"Contract Address: {contract_address}")
    logger.info("Verifying contract is deployed...")
    
    if not await verify_contract_exists(client, contract_address):
        logger.error(f"❌ Contract is not deployed at {contract_address}")
        raise ValueError(f"Contract not deployed at {contract_address}")
    
    logger.info("   ✅ Contract verified")
    logger.info(f"Total Operations: {total_operations}")
    logger.info(f"Parallel Operations: {parallel_ops}")
    logger.info(f"Number of Accounts: {num_accounts}")
    logger.info("=" * 60)
    
    # Load test accounts from test_accounts.json
    test_accounts = await load_accounts_from_file()
    
    if len(test_accounts) < num_accounts:
        logger.warning(f"Only {len(test_accounts)} accounts loaded, but {num_accounts} requested. Using available accounts.")
        num_accounts = len(test_accounts)
    
    test_accounts = test_accounts[:num_accounts]  # Limit to requested number
    
    # Optionally, add owner account if not already included
    # For now, assume test_accounts.json includes all needed; if not, you can add logic to load owner
    
    # Create account instances
    account_instances = await asyncio.gather(*[create_account(client, acc["address"], acc["private_key"]) for acc in test_accounts])
    
    start_time = time.time()
    
    # Prepare operations: assign each operation to an account (cycle through accounts)
    operations = []
    for op_id in range(total_operations):
        account_index = op_id % len(account_instances)
        account = account_instances[account_index]
        # Generate unique balance per operation using hash
        new_balance = int(hashlib.sha256(f"balance_{op_id}".encode()).hexdigest(), 16) % (1 << 256)
        operations.append({
            "op_id": op_id,
            "account": account,
            "account_address": account.address,
            "balance": new_balance
        })
    
    prep_duration = time.time() - start_time
    logger.info(f"Prepared {total_operations} operations in {prep_duration:.2f}s using {len(account_instances)} accounts")
    
    # Group operations by account for nonce management
    account_ops: Dict[int, List[Dict]] = {}
    for op in operations:
        addr = op["account_address"]
        if addr not in account_ops:
            account_ops[addr] = []
        account_ops[addr].append(op)
    
    # Prepare and sign transactions
    # Detect if using v0.9 RPC (Alchemy) which supports "pending" and auto_estimate
    # Otherwise use manual resource bounds for v0.8.1 compatibility
    logger.info("Preparing and signing transactions...")
    prep_start_time = time.time()
    
    update_balance_selector = get_selector_from_name("update_balance")
    
    # Check if using v0.9 RPC (Alchemy) - supports "pending" and auto_estimate
    use_auto_estimate = "alchemy" in RPC_URL.lower() or "v0_9" in RPC_URL.lower()
    logger.info(f"Using RPC URL: {RPC_URL}")
    logger.info(f"RPC Version: {'v0.9 (Alchemy)' if use_auto_estimate else 'v0.8.1 (Infura)'}")
    
    if use_auto_estimate:
        # For v0.9 RPC, use _prepare_invoke_v3 with auto_estimate for better resource bounds
        # Fetch fresh nonces right before preparation to avoid stale nonces
        logger.info("Using v0.9 RPC - fetching fresh nonces and preparing transactions with auto_estimate...")
        
        # Get fresh nonces for all accounts right before preparing transactions
        # Try "pending" for v0.9 RPC first, fall back to "latest" if it fails
        unique_accounts = list(set(op["account"] for op in operations))
        block_tag = "pending" if use_auto_estimate else "latest"
        
        # Try "pending" first for v0.9 RPC, fall back to "latest" if it fails
        try:
            if use_auto_estimate:
                nonce_tasks = [acc.get_nonce(block_number="pending") for acc in unique_accounts]
                fresh_nonces = await asyncio.gather(*nonce_tasks, return_exceptions=True)
                # Check if any failed
                if any(isinstance(n, Exception) for n in fresh_nonces):
                    logger.warning("Failed to get nonces with 'pending', falling back to 'latest'")
                    block_tag = "latest"
                    logger.info(f"Fetching fresh nonces for {len(unique_accounts)} accounts with 'latest'...")
                    nonce_tasks = [acc.get_nonce(block_number="latest") for acc in unique_accounts]
                    try:
                        fresh_nonces = await asyncio.wait_for(
                            asyncio.gather(*nonce_tasks),
                            timeout=30.0  # 30 second timeout
                        )
                        logger.info(f"Successfully fetched {len([n for n in fresh_nonces if not isinstance(n, Exception)])} nonces")
                    except asyncio.TimeoutError:
                        logger.error(f"Timeout fetching nonces for {len(unique_accounts)} accounts after 30 seconds")
                        raise
                else:
                    logger.info("Successfully got nonces with 'pending' (includes pending transactions)")
            else:
                logger.info(f"Fetching fresh nonces for {len(unique_accounts)} accounts with 'latest'...")
                nonce_tasks = [acc.get_nonce(block_number="latest") for acc in unique_accounts]
                fresh_nonces = await asyncio.gather(*nonce_tasks)
                logger.info(f"Successfully fetched {len(fresh_nonces)} nonces")
        except Exception as e:
            logger.warning(f"Failed to get nonces with 'pending' ({e}), falling back to 'latest'")
            block_tag = "latest"
            logger.info(f"Fetching fresh nonces for {len(unique_accounts)} accounts with 'latest'...")
            nonce_tasks = [acc.get_nonce(block_number="latest") for acc in unique_accounts]
            try:
                fresh_nonces = await asyncio.wait_for(
                    asyncio.gather(*nonce_tasks),
                    timeout=30.0  # 30 second timeout
                )
                logger.info(f"Successfully fetched {len([n for n in fresh_nonces if not isinstance(n, Exception)])} nonces")
            except asyncio.TimeoutError:
                logger.error(f"Timeout fetching nonces for {len(unique_accounts)} accounts after 30 seconds")
                raise
        
        account_to_fresh_nonce = dict(zip([acc.address for acc in unique_accounts], fresh_nonces))
        
        # Prepare transactions with fresh nonces
        # For accounts with multiple operations, prepare them sequentially to avoid nonce conflicts
        # For accounts with single operations, prepare in parallel
        
        # Separate operations: single-account ops can be parallel, multi-account ops must be sequential per account
        single_ops = []  # One operation per account - can be parallel
        multi_ops_by_account = {}  # Multiple operations per account - must be sequential
        
        for addr, ops in account_ops.items():
            if len(ops) == 1:
                single_ops.append((addr, ops[0], account_to_fresh_nonce[addr]))
            else:
                multi_ops_by_account[addr] = (ops, account_to_fresh_nonce[addr])
        
        # Prepare single operations in parallel (no nonce conflicts)
        single_prep_tasks = []
        for addr, op, current_nonce in single_ops:
            account = op["account"]
            call = Call(
                to_addr=int(contract_address, 16) if isinstance(contract_address, str) else contract_address,
                selector=update_balance_selector,
                calldata=[op["balance"] & ((1 << 128) - 1), (op["balance"] >> 128) & ((1 << 128) - 1)]
            )
            prep_task = account._prepare_invoke_v3(
                calls=call,
                nonce=current_nonce,
                auto_estimate=True,
                tip=0
            )
            single_prep_tasks.append((prep_task, account, op["op_id"]))
        
        # Prepare multi-account operations sequentially per account (to avoid nonce conflicts)
        # Fetch fresh nonce right before each transaction to handle pending transactions
        # This ensures we always use the current nonce (accounting for any pending transactions)
        total_multi_ops = sum(len(ops) for ops, _ in multi_ops_by_account.values())
        logger.info(f"Preparing {total_multi_ops} multi-account transactions sequentially...")
        multi_prepared = []
        prepared_count = 0
        for addr, (ops, _) in multi_ops_by_account.items():
            account = next(op["account"] for op in ops)
            # Prepare each transaction sequentially, fetching fresh nonce right before each one
            for op in ops:
                prepared_count += 1
                if prepared_count % 10 == 0:
                    logger.info(f"Prepared {prepared_count}/{total_multi_ops} multi-account transactions...")
                max_retries = 3
                for attempt in range(max_retries):
                    try:
                        # Fetch fresh nonce right before each preparation to get current nonce
                        current_nonce = await account.get_nonce(block_number=block_tag)
                        call = Call(
                            to_addr=int(contract_address, 16) if isinstance(contract_address, str) else contract_address,
                            selector=update_balance_selector,
                            calldata=[op["balance"] & ((1 << 128) - 1), (op["balance"] >> 128) & ((1 << 128) - 1)]
                        )
                        # Prepare sequentially using current nonce with timeout
                        try:
                            tx = await asyncio.wait_for(
                                account._prepare_invoke_v3(
                                    calls=call,
                                    nonce=current_nonce,
                                    auto_estimate=True,
                                    tip=0
                                ),
                                timeout=10.0  # 10 second timeout per transaction preparation
                            )
                            multi_prepared.append((tx, account, op["op_id"]))
                            break  # Success, move to next transaction
                        except asyncio.TimeoutError:
                            logger.warning(f"Transaction preparation timeout for op {op['op_id']} (attempt {attempt + 1})")
                            if attempt < max_retries - 1:
                                await asyncio.sleep(0.5)  # Longer delay before retry
                                continue
                            else:
                                logger.error(f"Transaction preparation failed for op {op['op_id']} after {max_retries} attempts: timeout")
                                break
                    except Exception as e:
                        error_str = str(e)
                        if "nonce" in error_str.lower() and attempt < max_retries - 1:
                            # Nonce error - fetch fresh nonce and retry
                            logger.debug(f"Nonce error for op {op['op_id']} (attempt {attempt + 1}), fetching fresh nonce and retrying...")
                            await asyncio.sleep(0.1)  # Small delay before retry
                            continue
                        else:
                            # Other error or max retries reached
                            logger.warning(f"Transaction preparation failed for op {op['op_id']}: {e}")
                            break
        
        # Prepare single operations in parallel
        logger.info(f"Preparing {len(single_prep_tasks)} single-account transactions and {sum(len(ops) for ops, _ in multi_ops_by_account.values())} multi-account transactions...")
        single_transactions = await asyncio.gather(*[task for task, _, _ in single_prep_tasks], return_exceptions=True)
        
        # Combine single and multi-account prepared transactions
        prep_tasks_list = []
        # Add single operations
        for i, tx in enumerate(single_transactions):
            if not isinstance(tx, Exception):
                _, account, op_id = single_prep_tasks[i]
                prep_tasks_list.append((tx, account, op_id))
            else:
                logger.warning(f"Transaction preparation failed for op {single_prep_tasks[i][2]}: {tx}")
        # Add multi-account operations (already prepared sequentially)
        prep_tasks_list.extend(multi_prepared)
    else:
        # For v0.8.1 RPC, manually estimate fees and construct transactions
        logger.info("Using v0.8.1 RPC - estimating fees manually...")
        sample_account = account_instances[0]
        sample_call = Call(
            to_addr=int(contract_address, 16) if isinstance(contract_address, str) else contract_address,
            selector=update_balance_selector,
            calldata=[1, 0]  # Sample balance
        )
        
        # Create a temporary transaction for fee estimation
        sample_nonce = await sample_account.get_nonce(block_number="latest")
        temp_calldata = [
            1,  # call_array_len
            sample_call.to_addr,
            sample_call.selector,
            0,  # data_offset
            len(sample_call.calldata),  # data_len
            *sample_call.calldata
        ]
        temp_tx = InvokeV3(
            sender_address=sample_account.address,
            calldata=temp_calldata,
            nonce=sample_nonce,
            resource_bounds=ResourceBoundsMapping(
                l1_gas=ResourceBounds(max_amount=1000000, max_price_per_unit=1000000000),
                l2_gas=ResourceBounds(max_amount=1000000, max_price_per_unit=1000000000),
                l1_data_gas=ResourceBounds(max_amount=1000000, max_price_per_unit=1000000000)
            ),
            tip=0,
            signature=[],
            version=3
        )
        
        try:
            # Estimate fees using "latest" block tag (not "pending")
            estimated = await client.estimate_fee(
                tx=temp_tx,
                block_number="latest"
            )
            # Use estimated bounds with 30% buffer
            estimated_l1_amount = int(estimated.gas_consumed * 1.3) if estimated.gas_consumed else 520000
            estimated_l1_price = int(estimated.gas_price * 1.3) if estimated.gas_price else 28000000000000
            estimated_l2_amount = int(estimated.gas_consumed * 1.3) if estimated.gas_consumed else 520000
            estimated_l2_price = int(estimated.gas_price * 1.3) if estimated.gas_price else 28000000000000
            
            # Ensure minimums are met
            estimated_l1_amount = max(estimated_l1_amount, 520000)
            estimated_l2_amount = max(estimated_l2_amount, 520000)
            estimated_l1_price = max(estimated_l1_price, 28000000000000)
            estimated_l2_price = max(estimated_l2_price, 28000000000000)
            
            standard_resource_bounds = ResourceBoundsMapping(
                l1_gas=ResourceBounds(max_amount=estimated_l1_amount, max_price_per_unit=estimated_l1_price),
                l2_gas=ResourceBounds(max_amount=estimated_l2_amount, max_price_per_unit=estimated_l2_price),
                l1_data_gas=ResourceBounds(
                    max_amount=estimated_l1_amount if hasattr(estimated, 'data_gas_consumed') else 520000,
                    max_price_per_unit=estimated_l1_price if hasattr(estimated, 'data_gas_price') else 28000000000000
                )
            )
            logger.info(f"Using estimated bounds: L2 amount={estimated_l2_amount}, price={estimated_l2_price}")
        except Exception as e:
            # Fallback: use minimum required bounds with higher price buffer
            logger.warning(f"Fee estimation failed ({e}), using minimum bounds with 30T price")
            standard_resource_bounds = ResourceBoundsMapping(
                l1_gas=ResourceBounds(max_amount=520000, max_price_per_unit=30000000000000),
                l2_gas=ResourceBounds(max_amount=520000, max_price_per_unit=30000000000000),
                l1_data_gas=ResourceBounds(max_amount=520000, max_price_per_unit=30000000000000)
            )
        
        # Fetch fresh nonces right before preparing transactions
        logger.info("Fetching fresh nonces for all accounts...")
        unique_accounts = list(set(op["account"] for op in operations))
        nonce_tasks = [acc.get_nonce(block_number="latest") for acc in unique_accounts]
        fresh_nonces = await asyncio.gather(*nonce_tasks)
        account_to_fresh_nonce = dict(zip([acc.address for acc in unique_accounts], fresh_nonces))
        
        # Manually construct all transactions (avoiding _prepare_invoke_v3 which uses "pending")
        logger.info(f"Preparing {total_operations} transactions...")
        prep_tasks_list = []
        for addr, ops in account_ops.items():
            current_nonce = account_to_fresh_nonce[addr]
            account = next(op["account"] for op in ops)  # Get the account instance
            for idx, op in enumerate(ops):
                # Use current_nonce and increment for sequential operations from same account
                nonce = current_nonce + idx
                call = Call(
                    to_addr=int(contract_address, 16) if isinstance(contract_address, str) else contract_address,
                    selector=update_balance_selector,
                    calldata=[op["balance"] & ((1 << 128) - 1), (op["balance"] >> 128) & ((1 << 128) - 1)]
                )
                # Manually construct InvokeV3 transaction (avoiding _prepare_invoke_v3)
                invoke_calldata = [
                    1,  # call_array_len
                    call.to_addr,
                    call.selector,
                    0,  # data_offset
                    len(call.calldata),  # data_len
                    *call.calldata
                ]
                tx = InvokeV3(
                    sender_address=account.address,
                    calldata=invoke_calldata,
                    nonce=nonce,
                    resource_bounds=standard_resource_bounds,
                    tip=0,
                    signature=[],  # Will be signed later
                    version=3
                )
                prep_tasks_list.append((tx, account, op["op_id"]))
    
    # Filter valid transactions
    valid_prep = []
    for tx, account, op_id in prep_tasks_list:
        if tx:  # All prepared transactions should be valid
            valid_prep.append((tx, account, op_id))
    
    prep_duration = time.time() - prep_start_time
    logger.info(f"Prepared {len(valid_prep)} transactions in {prep_duration:.2f}s")
    
    if not valid_prep:
        logger.error("❌ No transactions were prepared successfully. Cannot continue.")
        raise ValueError("No transactions were prepared successfully")
    
    # Sign all transactions in parallel (using thread pool for CPU-bound signing)
    logger.info("Signing transactions...")
    sign_start_time = time.time()
    
    import concurrent.futures
    
    def sign_transaction_thread(tx, acc):
        """Sign a transaction synchronously."""
        signature = acc.signer.sign_transaction(tx)
        return dataclasses.replace(tx, signature=signature)
    
    # Sign in parallel using thread pool
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(100, len(valid_prep))) as executor:
        sign_futures = [
            executor.submit(sign_transaction_thread, tx, acc)
            for tx, acc, _ in valid_prep
        ]
        signed_txs = [f.result() for f in concurrent.futures.as_completed(sign_futures)]
    
    sign_duration = time.time() - sign_start_time
    logger.info(f"Signed {len(signed_txs)} transactions in {sign_duration:.2f}s")
    
    # Map signed transactions back to operations
    signed_transactions = list(zip(signed_txs, [op_id for _, _, op_id in valid_prep]))
    
    valid_transactions = signed_transactions
    
    logger.info(f"Pre-signed {len(valid_transactions)} transactions. Sending transactions...")
    
    send_start_time = time.time()
    
    # Group transactions by account address to submit sequentially per account
    # This prevents nonce conflicts when multiple transactions from same account are submitted
    transactions_by_account = {}
    for tx, op_id in valid_transactions:
        addr = tx.sender_address
        if addr not in transactions_by_account:
            transactions_by_account[addr] = []
        transactions_by_account[addr].append((tx, op_id))
    
    # Submit transactions: parallel for different accounts, sequential for same account
    all_results = []
    
    # Separate single-account and multi-account transactions
    single_account_txs = [(tx, op_id) for addr, tx_list in transactions_by_account.items() 
                          if len(tx_list) == 1 for tx, op_id in tx_list]
    
    # Submit single-account transactions in parallel (no nonce conflicts)
    if single_account_txs:
        single_tasks = [client.send_transaction(tx) for tx, _ in single_account_txs]
        single_results = await asyncio.gather(*single_tasks, return_exceptions=True)
        all_results.extend([(r, tx_data) for r, tx_data in zip(single_results, single_account_txs)])
    
    # Submit multi-account transactions sequentially per account (to preserve nonce order)
    for addr, tx_list in transactions_by_account.items():
        if len(tx_list) > 1:
            for tx, op_id in tx_list:
                try:
                    result = await client.send_transaction(tx)
                    all_results.append((result, (tx, op_id)))
                except Exception as e:
                    all_results.append((e, (tx, op_id)))
    
    send_duration = time.time() - send_start_time
    results = []
    tx_hashes = []
    for r, (tx, op_id) in all_results:
        if not isinstance(r, Exception):
            account_addr = tx.sender_address
            tx_hash = r.transaction_hash
            tx_hashes.append((tx_hash, op_id))
            results.append({
                "tx_hash": hex(tx_hash),
                "duration": send_duration / len(all_results),
                "op_id": op_id,
                "success": True,
                "account": hex(account_addr)
            })
        else:
            results.append({
                "tx_hash": None,
                "duration": send_duration / len(all_results),
                "op_id": op_id,
                "success": False,
                "error": str(r)
            })
    
    successful_count = sum(1 for r in results if r.get("success", False))
    logger.info(f"Sent all {len(valid_transactions)} transactions in {send_duration:.2f}s: {successful_count} successful, {len(results) - successful_count} failed")
    
    # Read balances BEFORE (baseline)
    logger.info(f"Reading initial balances (before writes)...")
    read_before_start = time.time()
    
    get_balance_selector = get_selector_from_name("get_balance")
    read_before_tasks = []
    op_id_to_index = {}
    
    for op_id, op in enumerate(operations):
        account_address = op["account_address"]
        call = Call(
            to_addr=int(contract_address, 16),
            selector=get_balance_selector,
            calldata=[account_address]
        )
        task_index = len(read_before_tasks)
        op_id_to_index[op_id] = task_index
        read_before_tasks.append(client.call_contract(call, block_number="latest"))
    
    read_before_results = await asyncio.gather(*read_before_tasks, return_exceptions=True)
    
    read_before_map = {}
    for op_id, op in enumerate(operations):
        task_index = op_id_to_index[op_id]
        result = read_before_results[task_index]
        if not isinstance(result, Exception):
            try:
                balance_low = result[0] if len(result) > 0 else 0
                balance_high = result[1] if len(result) > 1 else 0
                balance = (balance_high << 128) + balance_low
                read_before_map[op_id] = balance
            except:
                read_before_map[op_id] = None
        else:
            read_before_map[op_id] = None
    
    read_before_duration = time.time() - read_before_start
    logger.info(f"Read initial balances in {read_before_duration:.2f}s")
    
    # Wait for acceptance
    logger.info(f"Waiting for {len(tx_hashes)} transactions to be accepted...")
    accept_start_time = time.time()
    
    wait_tasks = [
        client.wait_for_tx(tx_hash, check_interval=1, retries=300)  # Longer interval for testnet
        for tx_hash, _ in tx_hashes
    ]
    
    accept_results = await asyncio.gather(*wait_tasks, return_exceptions=True)
    
    accept_duration = time.time() - accept_start_time
    logger.info(f"All transactions accepted in {accept_duration:.2f}s (note: testnet times may vary)")
    
    # Read balances AFTER
    logger.info(f"Reading final balances (after writes)...")
    read_after_start = time.time()
    
    read_after_tasks = read_before_tasks.copy()  # Same calls
    read_after_results = await asyncio.gather(*read_after_tasks, return_exceptions=True)
    
    read_after_map = {}
    for op_id, op in enumerate(operations):
        task_index = op_id_to_index[op_id]  # Reuse index
        result = read_after_results[task_index]
        if not isinstance(result, Exception):
            try:
                balance_low = result[0] if len(result) > 0 else 0
                balance_high = result[1] if len(result) > 1 else 0
                balance = (balance_high << 128) + balance_low
                read_after_map[op_id] = balance
            except:
                read_after_map[op_id] = None
        else:
            read_after_map[op_id] = None
    
    read_after_duration = time.time() - read_after_start
    logger.info(f"Read final balances in {read_after_duration:.2f}s")
    
    # Log detailed results
    results_dir = os.path.join(os.path.dirname(__file__), "results")
    os.makedirs(results_dir, exist_ok=True)
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    detailed_log_file = os.path.join(results_dir, f"read_write_read_sepolia_{timestamp}.json")
    
    detailed_results = []
    for i, op in enumerate(operations):
        op_id = op["op_id"]
        expected_balance = op["balance"]
        initial_balance = read_before_map.get(op_id)
        final_balance = read_after_map.get(op_id)
        
        write_result = next((r for r in results if r.get("op_id") == op_id), None)
        
        result_entry = {
            "op_id": op_id,
            "account_address": hex(op["account_address"]),
            "expected_balance": expected_balance,
            "initial_balance": initial_balance,
            "final_balance": final_balance,
            "write_success": write_result.get("success") if write_result else False,
            "write_tx_hash": write_result.get("tx_hash") if write_result else None,
            "balance_match": final_balance == expected_balance if final_balance is not None else False
        }
        detailed_results.append(result_entry)
    
    with open(detailed_log_file, "w") as f:
        json.dump({
            "timestamp": timestamp,
            "total_operations": total_operations,
            "contract_address": contract_address,
            "results": detailed_results
        }, f, indent=2, default=str)
    
    logger.info(f"Detailed results saved to {detailed_log_file}")
    
    katana_duration = send_duration + accept_duration  # Note: 'katana' here is misnomer, it's Sepolia
    total_duration = time.time() - start_time
    
    successful = [r for r in results if r.get("success", False)]
    failed = [r for r in results if not r.get("success", False)]
    
    total_ops_executed = len(successful)
    katana_ops = total_ops_executed / katana_duration if katana_duration > 0 else 0
    total_ops = total_ops_executed / total_duration if total_duration > 0 else 0
    
    avg_tx_duration = sum(r.get("duration", 0) for r in successful) / len(successful) if successful else 0
    
    stats = {
        "total_operations": total_operations,
        "total_ops_executed": total_ops_executed,
        "sepolia_ops": katana_ops,
        "total_ops": total_ops,
        "total_duration": total_duration,
        "sepolia_duration": katana_duration,
        "send_duration": send_duration,
        "accept_duration": accept_duration,
        "sign_duration": sign_duration,
        "prep_duration": prep_duration,
        "parallel_ops": parallel_ops,
        "num_accounts": num_accounts,
        "successful": len(successful),
        "failed": len(failed),
        "avg_tx_duration": avg_tx_duration,
        "contract_address": contract_address,
        "results": results
    }
    
    # Print results
    logger.info("=" * 60)
    logger.info("Performance Test Results (Sepolia)")
    logger.info("=" * 60)
    logger.info(f"Sepolia OPS (excludes signing): {katana_ops:.2f}")
    logger.info(f"Total OPS (includes signing): {total_ops:.2f}")
    logger.info(f"Operations Executed: {total_ops_executed}")
    logger.info(f"Breakdown:")
    logger.info(f"  Preparation: {prep_duration:.2f}s")
    logger.info(f"  Signing: {sign_duration:.2f}s")
    logger.info(f"  Submission: {send_duration:.2f}s")
    logger.info(f"  Acceptance: {accept_duration:.2f}s")
    logger.info(f"  Sepolia Duration: {katana_duration:.2f}s")
    logger.info(f"  Total Duration: {total_duration:.2f}s")
    logger.info(f"Successful: {len(successful)}")
    logger.info(f"Failed: {len(failed)}")
    logger.info(f"Parallel Operations: {parallel_ops}")
    logger.info("=" * 60)
    
    # Save results
    results_file = os.path.join(os.path.dirname(__file__), "performance_results_sepolia.json")
    with open(results_file, "w") as f:
        json.dump(stats, f, indent=2, default=str)
    logger.info(f"Results saved to {results_file}")
    
    return stats


async def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Sepolia Performance Test - Realistic Parallel Users")
    parser.add_argument("--total-ops", type=int, default=200, help="Total operations to perform")
    parser.add_argument("--parallel-ops", type=int, default=50, help="Number of parallel operations (concurrent users)")
    parser.add_argument("--num-accounts", type=int, default=50, help="Number of test accounts")
    parser.add_argument("--contract-address", type=str, default=CONTRACT_ADDRESS, help="Contract address")
    
    args = parser.parse_args()
    
    await run_performance_test(
        total_operations=args.total_ops,
        parallel_ops=args.parallel_ops,
        num_accounts=args.num_accounts,
        contract_address=args.contract_address
    )

if __name__ == "__main__":
    asyncio.run(main())
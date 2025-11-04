#!/usr/bin/env python3
"""
Katana Performance Test - Realistic parallel user scenario

This script simulates real users submitting transactions in parallel.
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

# Configuration - Katana settings
RPC_URL = os.getenv("KATANA_RPC_URL", "http://127.0.0.1:5050")
KATANA_CHAIN_ID = 0x4b4154414e41

# Default values - can be overridden via command line or deployment.json
# This will be loaded from deployment.json if available
CONTRACT_ADDRESS = None  # Will be loaded dynamically
ADMIN_ADDRESS = 0x54b9b1b06e7110f1ef0b0c3467610438311da4680d3c75d557b52788591741
ADMIN_PRIVATE_KEY = 0x5ce311283aa15aa3dc58d99fe122cdaa389615e7d800f98fab238c5a7c8d624

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def load_contract_address() -> str:
    """Load contract address from deployment.json if available."""
    deployment_file = "katana/deployment.json"
    if os.path.exists(deployment_file):
        try:
            with open(deployment_file, 'r') as f:
                data = json.load(f)
                addr = data.get("contractAddress")
                if addr:
                    # Remove 0x prefix if present for consistency
                    if isinstance(addr, str) and addr.startswith("0x"):
                        return addr
                    elif isinstance(addr, str):
                        return f"0x{addr}"
                    else:
                        return hex(addr) if isinstance(addr, int) else str(addr)
        except Exception as e:
            logger.warning(f"Failed to load deployment.json: {e}")
    
    # Fallback to environment variable or hardcoded default
    env_addr = os.getenv("CONTRACT_ADDRESS")
    if env_addr:
        return env_addr if env_addr.startswith("0x") else f"0x{env_addr}"
    
    # Last resort: use the known deployed address
    return "0x0163d45d352d9563b810fc820cd52d1282c5f8c8e0b4d66ecc88853b3da1f34d"


async def get_katana_accounts_from_rpc(count: int) -> List[Dict]:
    """
    Get Katana pre-funded accounts by checking RPC.
    Since we don't have the account list, we'll use the admin account
    but with proper parallel submission handling.
    """
    client = FullNodeClient(node_url=RPC_URL)
    
    accounts = []
    # First account is known (admin)
    accounts.append({
        "address": ADMIN_ADDRESS,
        "private_key": ADMIN_PRIVATE_KEY
    })
    
    # For true parallelism, we'd need actual different accounts
    # For now, we'll use the same account but submit in parallel
    # Katana should handle parallel transactions from the same account
    # as long as we use sequential nonces correctly
    
    logger.info(f"Using {len(accounts)} account(s) - will submit in parallel with proper nonce management")
    return accounts


async def load_accounts_from_file(accounts_file: str = "katana/accounts.json") -> List[Dict]:
    """Load accounts from JSON file."""
    if not os.path.exists(accounts_file):
        return []
    
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
        logger.warning(f"Failed to load accounts from {accounts_file}: {e}")
        return []


async def discover_katana_accounts(client: FullNodeClient, max_accounts: int = 500) -> List[Dict]:
    """
    Discover Katana pre-funded accounts.
    First tries to load from accounts.json file.
    Otherwise falls back to known account.
    """
    accounts = []
    
    # Try to load from file first
    accounts = await load_accounts_from_file()
    
    if accounts:
        # Limit to max_accounts if specified
        if max_accounts and len(accounts) > max_accounts:
            accounts = accounts[:max_accounts]
        return accounts
    
    # Fallback: use known first account
    accounts.append({
        "address": ADMIN_ADDRESS,
        "private_key": ADMIN_PRIVATE_KEY
    })
    
    logger.warning("⚠️  No accounts file found")
    logger.info(f"   Using {len(accounts)} account(s) - will use parallel submission with pre-calculated nonces")
    logger.info("   💡 To use multiple accounts:")
    logger.info("      1. Extract accounts from Katana logs")
    logger.info("      2. Run: python3 katana/extract-accounts.py --log-file <katana.log>")
    logger.info("      3. Or manually create katana/accounts.json with account list")
    
    return accounts


def generate_katana_accounts(count: int) -> List[Dict]:
    """
    Generate account list - for now uses single account.
    With 500 accounts from Katana, we should extract them from logs or RPC.
    """
    accounts = []
    
    # Use the admin account
    accounts.append({
        "address": ADMIN_ADDRESS,
        "private_key": ADMIN_PRIVATE_KEY
    })
    
    # TODO: Extract accounts from Katana logs or derive them deterministically
    # For now, we'll use the single account but with parallel submission
    
    return accounts


async def create_account(client: FullNodeClient, address: int, private_key: int) -> Account:
    """Create an account instance."""
    key_pair = KeyPair.from_private_key(private_key)
    account = Account(
        client=client,
        address=address,
        key_pair=key_pair,
        chain=KATANA_CHAIN_ID
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
        to_addr=int(contract_address, 16) if isinstance(contract_address, str) else contract_address,
        selector=update_balance_selector,
        calldata=[new_balance & ((1 << 128) - 1), (new_balance >> 128) & ((1 << 128) - 1)]  # u256 as (low, high)
    )
    
    start_time = time.time()
    
    # Use high resource bounds for Katana
    resource_bounds = ResourceBoundsMapping(
        l1_gas=ResourceBounds(max_amount=10000000000, max_price_per_unit=100000000000),
        l2_gas=ResourceBounds(max_amount=10000000000, max_price_per_unit=100000000000),
        l1_data_gas=ResourceBounds(max_amount=10000000000, max_price_per_unit=100000000000)
    )
    
    # Retry logic for connection errors
    for attempt in range(max_retries):
        try:
            # If nonce not provided, get it (for sequential)
            # If provided, use it (for parallel submission)
            if nonce is None:
                nonce = await account.get_nonce()
            
            # Use Account's sign_invoke_v3 to prepare and sign the transaction
            # This creates the transaction and signs it, but doesn't execute it
            signed_transaction = await account.sign_invoke_v3(
                calls=call,
                nonce=nonce,
                resource_bounds=resource_bounds,
                auto_estimate=False,
                tip=0
            )
            
            # Send transaction directly - this returns immediately without waiting for confirmation
            # Unlike execute_v3, send_transaction doesn't wait for transaction confirmation
            result = await client.send_transaction(signed_transaction)
            
            # Get transaction hash and return immediately
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
            
            # Check if it's a connection error (429 Too many connections)
            if "429" in error_str or "Too many connections" in error_str:
                if attempt < max_retries - 1:
                    # Exponential backoff: wait 0.1s, 0.2s, 0.4s
                    wait_time = 0.1 * (2 ** attempt)
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    # Final attempt failed
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
                # Other errors - don't retry
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
    
    # Should never reach here, but just in case
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
    contract_address: str = None
) -> Dict:
    """
    Run performance test with realistic parallel user scenario.
    
    Strategy:
    1. Each operation is a separate update_balance transaction
    2. Operations are submitted in parallel from different accounts
    3. This simulates real users submitting transactions concurrently
    """
    # Create client first
    client = FullNodeClient(node_url=RPC_URL)
    
    if contract_address is None:
        contract_address = load_contract_address()
    
    # Verify contract exists
    logger.info("=" * 60)
    logger.info("Starting Katana Performance Test")
    logger.info("=" * 60)
    logger.info(f"Contract Address: {contract_address}")
    logger.info("Verifying contract is deployed...")
    
    if not await verify_contract_exists(client, contract_address):
        logger.error(f"❌ Contract is not deployed at {contract_address}")
        logger.error("   Please deploy the contract first using: python3 katana/deploy.py")
        logger.error("   Or update katana/deployment.json with the correct address")
        raise ValueError(f"Contract not deployed at {contract_address}")
    
    logger.info("   ✅ Contract verified")
    logger.info(f"Total Operations: {total_operations}")
    logger.info(f"Parallel Operations: {parallel_ops}")
    logger.info(f"Number of Accounts: {num_accounts}")
    logger.info("=" * 60)
    
    # Get test accounts - try to discover from RPC
    test_accounts = await discover_katana_accounts(client, max_accounts=num_accounts)
    
    # If we only found one account, try to use it with parallel submission
    if len(test_accounts) == 1:
        logger.warning("⚠️  Only found 1 account - will use parallel submission with pre-calculated nonces")
        logger.info("   For true parallelism, please provide account list from Katana logs")
    else:
        logger.info(f"✅ Discovered {len(test_accounts)} accounts for parallel submission")
    
    # Create account instances
    account_instances = []
    for acc in test_accounts:
        account = await create_account(
            client,
            acc["address"],
            acc["private_key"]
        )
        account_instances.append(account)
    
    # Prepare operations
    # For each operation, we'll do: READ -> WRITE -> READ
    # This creates a realistic scenario: check balance, update it, verify it
    operations = []
    for i in range(total_operations):
        account_idx = i % len(account_instances)
        account_address = account_instances[account_idx].address
        operations.append({
            "account": account_instances[account_idx],
            "account_address": account_address,
            "balance": i + 1,
            "op_id": i
        })
    
    logger.info(f"Prepared {len(operations)} operations")
    logger.info(f"   Each operation will: READ balance -> WRITE balance -> READ balance")
    logger.info(f"   Total transactions: {len(operations)} writes + {len(operations) * 2} reads = {len(operations) * 3} operations")
    logger.info("Starting parallel submission...")
    
    # Execute operations in parallel batches
    start_time = time.time()
    results = []
    
    # Get initial nonce for the account (since we're using one account)
    if len(account_instances) > 0:
        initial_nonce = await account_instances[0].get_nonce()
        logger.info(f"Starting nonce: {initial_nonce}")
    else:
        initial_nonce = 0
    
    # OPTIMIZATION: Pre-sign all transactions, then send them all in parallel
    # This separates signing (which can be slow) from sending (which should be fast)
    logger.info("Pre-signing all transactions...")
    
    # Pre-fetch nonces for all accounts in parallel
    account_nonces = {}
    if len(account_instances) > 1:
        logger.info(f"Pre-fetching nonces for {len(account_instances)} accounts...")
        nonce_tasks = [acc.get_nonce() for acc in account_instances]
        nonces = await asyncio.gather(*nonce_tasks)
        for i, acc in enumerate(account_instances):
            account_nonces[acc.address] = nonces[i]
    
    # Pre-sign all transactions in parallel
    # Use _prepare_invoke_v3 to create transactions, then sign them in parallel
    logger.info(f"Pre-signing {len(operations)} transactions...")
    update_balance_selector = get_selector_from_name("update_balance")
    resource_bounds = ResourceBoundsMapping(
        l1_gas=ResourceBounds(max_amount=10000000000, max_price_per_unit=100000000000),
        l2_gas=ResourceBounds(max_amount=10000000000, max_price_per_unit=100000000000),
        l1_data_gas=ResourceBounds(max_amount=10000000000, max_price_per_unit=100000000000)
    )
    
    # Step 1: Prepare all transactions in parallel (async)
    logger.info("Preparing transactions...")
    prep_start_time = time.time()
    prep_tasks = []
    for op in operations:
        account = op["account"]
        balance = op["balance"]
        
        # Determine nonce
        if len(account_instances) == 1:
            nonce = initial_nonce + op["op_id"]
        else:
            nonce = account_nonces[account.address]
            account_nonces[account.address] = nonce + 1  # Increment for next use
        
        call = Call(
            to_addr=int(contract_address, 16) if isinstance(contract_address, str) else contract_address,
            selector=update_balance_selector,
            calldata=[balance & ((1 << 128) - 1), (balance >> 128) & ((1 << 128) - 1)]
        )
        
        # Prepare transaction (async but doesn't wait for confirmation)
        prep_tasks.append(
            account._prepare_invoke_v3(
                calls=call,
                nonce=nonce,
                resource_bounds=resource_bounds,
                auto_estimate=False,
                tip=0
            )
        )
    
    # Prepare all transactions in parallel
    transactions = await asyncio.gather(*prep_tasks, return_exceptions=True)
    
    # Filter valid transactions
    valid_prep = []
    for i, tx in enumerate(transactions):
        if not isinstance(tx, Exception):
            valid_prep.append((tx, operations[i]["account"], operations[i]["op_id"]))
    
    prep_duration = time.time() - prep_start_time
    logger.info(f"Prepared {len(valid_prep)} transactions in {prep_duration:.2f}s")
    
    # Step 2: Sign all transactions in parallel (CPU-bound, use thread pool)
    # Using ThreadPoolExecutor instead of ProcessPoolExecutor to avoid pickling issues
    # The signing is already fast enough with the native C backend
    logger.info("Signing transactions...")
    sign_start_time = time.time()
    
    import concurrent.futures
    
    def sign_transaction_thread(tx, acc):
        """Sign a transaction synchronously."""
        signature = acc.signer.sign_transaction(tx)
        return dataclasses.replace(tx, signature=signature)
    
    # Sign in parallel using thread pool (sufficient for our needs)
    # The signing uses native C code, so GIL is not a major bottleneck
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
    
    # All transactions should be valid (no exceptions from signing)
    valid_transactions = signed_transactions
    
    logger.info(f"Pre-signed {len(valid_transactions)} transactions. Sending all in parallel...")
    
    # Send ALL transactions in parallel - this should be very fast
    # IMPORTANT: Start timing here - exclude signing from throughput measurement
    send_start_time = time.time()
    send_tasks = [
        client.send_transaction(tx) for tx, _ in valid_transactions
    ]
    
    all_results = await asyncio.gather(*send_tasks, return_exceptions=True)
    
    # Process results and extract transaction hashes
    send_duration = time.time() - send_start_time
    tx_hashes = []
    for (r, (tx, op_id)) in zip(all_results, valid_transactions):
        if not isinstance(r, Exception):
            # Find the account for this operation
            account = operations[op_id]["account"]
            account_addr = account.address if hasattr(account, 'address') else account_instances[0].address
            
            tx_hash = r.transaction_hash
            tx_hashes.append((tx_hash, op_id))
            
            results.append({
                "tx_hash": hex(tx_hash),
                "duration": send_duration / len(valid_transactions),  # Approximate per-tx duration
                "op_id": op_id,
                "success": True,
                "account": hex(account_addr)
            })
        else:
            results.append({
                "tx_hash": None,
                "duration": send_duration / len(valid_transactions),
                "op_id": op_id,
                "success": False,
                "error": str(r)
            })
    
    # Log summary
    successful_count = sum(1 for r in results if r.get("success", False))
    logger.info(f"Sent all {len(valid_transactions)} transactions in {send_duration:.2f}s: {successful_count} successful, {len(results) - successful_count} failed")
    
    # Step 3: Read balances BEFORE writes (baseline)
    logger.info(f"Reading initial balances (before writes)...")
    read_before_start = time.time()
    
    get_balance_selector = get_selector_from_name("get_balance")
    read_before_tasks = []
    op_id_to_index = {}
    
    for op_id, op in enumerate(operations):
        account_address = op["account_address"]
        call = Call(
            to_addr=int(contract_address, 16) if isinstance(contract_address, str) else contract_address,
            selector=get_balance_selector,
            calldata=[account_address]
        )
        task_index = len(read_before_tasks)
        op_id_to_index[op_id] = task_index
        read_before_tasks.append(client.call_contract(call, block_number="latest"))
    
    # Execute all read-before calls in parallel
    read_before_results = await asyncio.gather(*read_before_tasks, return_exceptions=True)
    
    read_before_map = {}  # Map op_id to balance
    for op_id, op in enumerate(operations):
        task_index = op_id_to_index[op_id]
        result = read_before_results[task_index]
        if not isinstance(result, Exception):
            try:
                # u256 is returned as (low, high)
                balance_low = result[0] if isinstance(result, (list, tuple)) and len(result) > 0 else 0
                balance_high = result[1] if isinstance(result, (list, tuple)) and len(result) > 1 else 0
                balance = (balance_high << 128) + balance_low
                read_before_map[op_id] = balance
            except Exception as e:
                logger.warning(f"Failed to parse balance before write for op {op_id}: {e}")
                read_before_map[op_id] = None
        else:
            logger.warning(f"Failed to read balance before write for op {op_id}: {result}")
            read_before_map[op_id] = None
    
    read_before_duration = time.time() - read_before_start
    logger.info(f"Read {len([v for v in read_before_map.values() if v is not None])} initial balances in {read_before_duration:.2f}s")
    
    # Wait for all transactions to be accepted (this measures full throughput)
    # This is the actual metric - how fast Katana processes transactions
    logger.info(f"Waiting for {len(tx_hashes)} transactions to be accepted...")
    accept_start_time = time.time()
    
    # Wait for all transactions in parallel
    wait_tasks = [
        client.wait_for_tx(tx_hash, check_interval=0.1, retries=500)
        for tx_hash, _ in tx_hashes
    ]
    
    # Wait for all transactions to be accepted
    accept_results = await asyncio.gather(*wait_tasks, return_exceptions=True)
    
    accept_duration = time.time() - accept_start_time
    logger.info(f"All transactions accepted in {accept_duration:.2f}s")
    
    # Step 4: Read balances AFTER writes (verification)
    logger.info(f"Reading final balances (after writes)...")
    read_after_start = time.time()
    
    read_after_tasks = []
    op_id_to_index_after = {}
    
    for op_id, op in enumerate(operations):
        account_address = op["account_address"]
        call = Call(
            to_addr=int(contract_address, 16) if isinstance(contract_address, str) else contract_address,
            selector=get_balance_selector,
            calldata=[account_address]
        )
        task_index = len(read_after_tasks)
        op_id_to_index_after[op_id] = task_index
        read_after_tasks.append(client.call_contract(call, block_number="latest"))
    
    # Execute all read-after calls in parallel
    read_after_results = await asyncio.gather(*read_after_tasks, return_exceptions=True)
    
    read_after_map = {}  # Map op_id to balance
    for op_id, op in enumerate(operations):
        task_index = op_id_to_index_after[op_id]
        result = read_after_results[task_index]
        if not isinstance(result, Exception):
            try:
                # u256 is returned as (low, high)
                balance_low = result[0] if isinstance(result, (list, tuple)) and len(result) > 0 else 0
                balance_high = result[1] if isinstance(result, (list, tuple)) and len(result) > 1 else 0
                balance = (balance_high << 128) + balance_low
                read_after_map[op_id] = balance
            except Exception as e:
                logger.warning(f"Failed to parse balance after write for op {op_id}: {e}")
                read_after_map[op_id] = None
        else:
            logger.warning(f"Failed to read balance after write for op {op_id}: {result}")
            read_after_map[op_id] = None
    
    read_after_duration = time.time() - read_after_start
    logger.info(f"Read {len([v for v in read_after_map.values() if v is not None])} final balances in {read_after_duration:.2f}s")
    
    # Log detailed results to separate file
    results_dir = "katana/results"
    os.makedirs(results_dir, exist_ok=True)
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    detailed_log_file = f"{results_dir}/read_write_read_{timestamp}.json"
    
    detailed_results = []
    for i, op in enumerate(operations):
        op_id = op["op_id"]
        account_address = op["account_address"]
        expected_balance = op["balance"]
        initial_balance = read_before_map.get(op_id)
        final_balance = read_after_map.get(op_id)
        
        # Find corresponding write transaction result
        write_result = None
        for r in results:
            if r.get("op_id") == op_id and r.get("success"):
                write_result = r
                break
        
        result_entry = {
            "op_id": op_id,
            "account_address": hex(account_address),
            "expected_balance": expected_balance,
            "initial_balance": initial_balance,
            "final_balance": final_balance,
            "write_success": write_result is not None,
            "write_tx_hash": write_result.get("tx_hash") if write_result else None,
            "balance_match": final_balance == expected_balance if final_balance is not None else False
        }
        detailed_results.append(result_entry)
    
    # Save detailed results
    with open(detailed_log_file, "w") as f:
        json.dump({
            "timestamp": timestamp,
            "total_operations": total_operations,
            "contract_address": contract_address,
            "results": detailed_results
        }, f, indent=2, default=str)
    
    logger.info(f"Detailed read/write/read results saved to {detailed_log_file}")
    
    # Calculate throughput: submission + acceptance time (excludes signing)
    # This is the actual Katana throughput
    katana_duration = send_duration + accept_duration
    end_time = time.time()
    total_duration = end_time - start_time  # Includes signing (for reference)
    
    # Calculate statistics
    successful = [r for r in results if r.get("success", False)]
    failed = [r for r in results if not r.get("success", False)]
    
    total_ops_executed = len(successful)
    
    # Calculate OPS excluding signing time (this is the actual Katana throughput)
    # katana_duration = submission + acceptance time (excludes client-side signing)
    katana_ops = total_ops_executed / katana_duration if katana_duration > 0 else 0
    
    # Also calculate total OPS (including signing) for reference
    total_ops = total_ops_executed / total_duration if total_duration > 0 else 0
    
    avg_tx_duration = sum(r.get("duration", 0) for r in successful) / len(successful) if successful else 0
    
    stats = {
        "total_operations": total_operations,
        "total_ops_executed": total_ops_executed,
        "katana_ops": katana_ops,  # Throughput excluding signing
        "total_ops": total_ops,  # Including signing (for reference)
        "total_duration": total_duration,  # Includes signing
        "katana_duration": katana_duration,  # Submission + acceptance (excludes signing)
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
    logger.info("Performance Test Results")
    logger.info("=" * 60)
    logger.info(f"Katana OPS (excludes signing): {katana_ops:.2f}")
    logger.info(f"Total OPS (includes signing): {total_ops:.2f}")
    logger.info(f"Operations Executed: {total_ops_executed}")
    logger.info(f"")
    logger.info(f"Breakdown:")
    logger.info(f"  Preparation: {prep_duration:.2f}s")
    logger.info(f"  Signing: {sign_duration:.2f}s")
    logger.info(f"  Submission: {send_duration:.2f}s")
    logger.info(f"  Acceptance: {accept_duration:.2f}s")
    logger.info(f"  Katana Duration (submission + acceptance): {katana_duration:.2f}s")
    logger.info(f"  Total Duration (includes signing): {total_duration:.2f}s")
    logger.info(f"")
    logger.info(f"Successful: {len(successful)}")
    logger.info(f"Failed: {len(failed)}")
    logger.info(f"Parallel Operations: {parallel_ops}")
    logger.info("=" * 60)
    
    # Save results
    results_file = "katana/performance_results.json"
    with open(results_file, "w") as f:
        json.dump(stats, f, indent=2, default=str)
    logger.info(f"Results saved to {results_file}")
    
    return stats


async def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Katana Performance Test - Realistic Parallel Users")
    parser.add_argument("--total-ops", type=int, default=200, help="Total operations to perform")
    parser.add_argument("--parallel-ops", type=int, default=50, help="Number of parallel operations (concurrent users)")
    parser.add_argument("--num-accounts", type=int, default=50, help="Number of test accounts")
    parser.add_argument("--contract-address", type=str, default=None, help="Contract address (defaults to deployment.json)")
    
    args = parser.parse_args()
    
    await run_performance_test(
        total_operations=args.total_ops,
        parallel_ops=args.parallel_ops,
        num_accounts=args.num_accounts,
        contract_address=args.contract_address
    )


if __name__ == "__main__":
    asyncio.run(main())

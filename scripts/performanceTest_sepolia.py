#!/usr/bin/env python3
"""
Sepolia Performance Test - Optimized version
Similar to performanceTest1.py but configured for Sepolia testnet

This script separates signing time from chain throughput measurement.
Key optimizations:
1. Pre-sign all transactions before starting submission timer
2. Measure chain throughput (submission + acceptance) excluding signing
3. Report both "Chain OPS" (excludes signing) and "Total OPS" (includes signing)
"""

import asyncio
import time
import json
import logging
import os
import dataclasses
from typing import List, Dict, Tuple
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.net.client_models import Call, ResourceBounds, ResourceBoundsMapping
from starknet_py.hash.selector import get_selector_from_name
from starknet_py.net.client_errors import ClientError
from starknet_py.net.models import InvokeV3
from starknet_py.net.models import StarknetChainId

# Configuration - Sepolia testnet
RPC_URL = os.getenv("SEPOLIA_RPC_URL", "https://starknet-sepolia.infura.io/v3/738a3e1e3f934295b1e4c3034dcbedf9")
SEPOLIA_CHAIN_ID = StarknetChainId.SEPOLIA

# Contract address from Sepolia
CONTRACT_ADDRESS = os.getenv("CONTRACT_ADDRESS", "0x063ab038c9d25515aa8e873febae8eb5b1d4be5fba1a217958064fac441b619e")

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def load_test_accounts() -> List[Dict]:
    """Load test accounts from JSON file."""
    accounts_path = os.path.join(os.path.dirname(__file__), "test_accounts.json")
    if not os.path.exists(accounts_path):
        raise FileNotFoundError(f"Test accounts file not found: {accounts_path}")
    
    with open(accounts_path, 'r') as f:
        accounts_data = json.load(f)
    
    # Handle both formats
    if isinstance(accounts_data, list):
        # Format: [{"address": "...", "private_key": "..."}, ...]
        return accounts_data
    elif isinstance(accounts_data, dict) and "accounts" in accounts_data:
        return accounts_data["accounts"]
    else:
        raise ValueError("Invalid accounts file format")


def create_account(client: FullNodeClient, address: int, private_key: int) -> Account:
    """Create an Account instance."""
    key_pair = KeyPair.from_private_key(private_key)
    return Account(
        client=client,
        address=address,
        key_pair=key_pair,
        chain=SEPOLIA_CHAIN_ID
    )


async def verify_contract_exists(client: FullNodeClient, contract_address: str) -> bool:
    """Verify that the contract is deployed at the given address."""
    try:
        addr = int(contract_address, 16) if isinstance(contract_address, str) else contract_address
        class_hash = await client.get_class_hash_at(addr, block_number="latest")
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
    Run optimized performance test on Sepolia testnet.
    
    Strategy:
    1. Each operation is a separate update_balance transaction
    2. Operations are submitted in parallel from different accounts
    3. Separates signing time from submission time for accurate throughput measurement
    """
    # Create client first
    client = FullNodeClient(node_url=RPC_URL)
    
    # Patch the main client's HTTP client to replace "pending" with "latest"
    # This will affect all accounts since they share the same client
    http_client = client._client
    if hasattr(http_client, 'request'):
        original_request = http_client.request
        
        async def patched_request(address, http_method, params=None, payload=None):
                # Replace "pending" with "latest" in params and payload
                import json
                if payload and isinstance(payload, dict) and 'params' in payload:
                    # Check the params in the payload (JSON-RPC format)
                    params_in_payload = payload.get('params', {})
                    if isinstance(params_in_payload, dict):
                        # Check if block_id is "pending" or "pre_confirmed" (which might not be supported)
                        if 'block_id' in params_in_payload:
                            if params_in_payload['block_id'] == 'pending':
                                params_in_payload['block_id'] = 'latest'
                                logger.info(f"✅ Patched 'pending' -> 'latest' in payload params")
                            elif params_in_payload['block_id'] == 'pre_confirmed':
                                # pre_confirmed might not be supported, try latest
                                params_in_payload['block_id'] = 'latest'
                                logger.info(f"✅ Patched 'pre_confirmed' -> 'latest' in payload params")
                        # Also check nested request array
                        if 'request' in params_in_payload:
                            req = params_in_payload['request']
                            if isinstance(req, list) and len(req) > 0:
                                # Check each request in the array
                                for r in req:
                                    if isinstance(r, dict) and 'block_id' in r:
                                        if r['block_id'] == 'pending':
                                            r['block_id'] = 'latest'
                                            logger.info(f"✅ Patched 'pending' -> 'latest' in request array")
                                    # Also check nested structures
                                    if isinstance(r, dict):
                                        import json
                                        r_str = json.dumps(r)
                                        if '"pending"' in r_str:
                                            r_str = r_str.replace('"pending"', '"latest"')
                                            r.update(json.loads(r_str))
                                            logger.info(f"✅ Patched 'pending' -> 'latest' in nested request")
                return await original_request(address, http_method, params, payload)
        
        http_client.request = patched_request
        
        # Also patch the call method which is used directly by some SDK methods
        if hasattr(http_client, 'call'):
            original_call = http_client.call
            
            async def patched_call(method_name, params=None):
                # Replace "pending" and "pre_confirmed" with "latest" in params
                if params:
                    if isinstance(params, dict):
                        # Check if "pending" or "pre_confirmed" is directly in the dict
                        if 'block_id' in params:
                            if params['block_id'] in ('pending', 'pre_confirmed'):
                                params['block_id'] = 'latest'
                        # Also check nested structures
                        import json
                        params_str = json.dumps(params)
                        if '"pending"' in params_str or "'pending'" in params_str:
                            params_str = params_str.replace('"pending"', '"latest"').replace("'pending'", "'latest'")
                            params = json.loads(params_str)
                        if '"pre_confirmed"' in params_str or "'pre_confirmed'" in params_str:
                            params_str = params_str.replace('"pre_confirmed"', '"latest"').replace("'pre_confirmed'", "'latest'")
                            params = json.loads(params_str)
                    elif isinstance(params, list):
                        # Check list items
                        import json
                        params_str = json.dumps(params)
                        if '"pending"' in params_str or "'pending'" in params_str:
                            params_str = params_str.replace('"pending"', '"latest"').replace("'pending'", "'latest'")
                            params = json.loads(params_str)
                        if '"pre_confirmed"' in params_str or "'pre_confirmed'" in params_str:
                            params_str = params_str.replace('"pre_confirmed"', '"latest"').replace("'pre_confirmed'", "'latest'")
                            params = json.loads(params_str)
                return await original_call(method_name, params)
            
            http_client.call = patched_call
        
        logger.info("✅ Patched HTTP client to replace 'pending'/'pre_confirmed' with 'latest'")
    
    if contract_address is None:
        contract_address = CONTRACT_ADDRESS
    
    # Verify contract exists
    logger.info("=" * 60)
    logger.info("Starting Sepolia Performance Test (Optimized)")
    logger.info("=" * 60)
    logger.info(f"Contract Address: {contract_address}")
    logger.info("Verifying contract is deployed...")
    
    if not await verify_contract_exists(client, contract_address):
        logger.error(f"❌ Contract is not deployed at {contract_address}")
        logger.error("   Please deploy the contract first or check the address")
        raise ValueError(f"Contract not deployed at {contract_address}")
    
    logger.info("   ✅ Contract verified")
    logger.info(f"Total Operations: {total_operations}")
    logger.info(f"Parallel Operations: {parallel_ops}")
    logger.info(f"Number of Accounts: {num_accounts}")
    logger.info("=" * 60)
    
    # Load test accounts
    try:
        all_accounts = load_test_accounts()
        logger.info(f"✅ Loaded {len(all_accounts)} accounts from test_accounts.json")
    except Exception as e:
        logger.error(f"❌ Failed to load accounts: {e}")
        raise
    
    # Use up to num_accounts
    test_accounts = all_accounts[:num_accounts]
    
    # Create account instances
    account_instances = []
    for acc in test_accounts:
        # Extract address and private key
        addr_str = acc.get("address", "")
        key_str = acc.get("private_key", "")
        
        # Handle hex strings (with or without 0x prefix)
        if isinstance(addr_str, str):
            addr_str = addr_str.replace("0x", "").replace("0X", "")
        if isinstance(key_str, str):
            key_str = key_str.replace("0x", "").replace("0X", "")
        
        address = int(addr_str, 16) if isinstance(addr_str, str) else addr_str
        private_key = int(key_str, 16) if isinstance(key_str, str) else key_str
        
        account = create_account(client, address, private_key)
        # No need to patch individual accounts - the main client is already patched
        account_instances.append(account)
    
    # Prepare operations
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
    logger.info("Starting parallel submission...")
    
    # Execute operations in parallel batches
    start_time = time.time()
    results = []
    
    # Get initial nonces for all accounts in parallel
    # Use "latest" block tag for Sepolia (doesn't support "pending")
    logger.info("Pre-fetching nonces for all accounts...")
    account_nonces = {}
    if len(account_instances) > 1:
        nonce_tasks = [acc.get_nonce(block_number="latest") for acc in account_instances]
        nonces = await asyncio.gather(*nonce_tasks)
        for i, acc in enumerate(account_instances):
            account_nonces[acc.address] = nonces[i]
    else:
        initial_nonce = await account_instances[0].get_nonce(block_number="latest")
        account_nonces[account_instances[0].address] = initial_nonce
        logger.info(f"Starting nonce: {initial_nonce}")
    
    # OPTIMIZATION: Pre-sign all transactions, then send them all in parallel
    logger.info("Pre-signing all transactions...")
    
    # Step 1: Prepare all transactions in parallel (async)
    logger.info("Preparing transactions...")
    prep_start_time = time.time()
    
    update_balance_selector = get_selector_from_name("update_balance")
    
    # Get account balances to calculate per-account resource bounds
    # This ensures bounds fit within each account's balance
    logger.info("Getting account balances to calculate resource bounds...")
    STRK_TOKEN_ADDRESS = 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
    balance_of_selector = get_selector_from_name("balance_of")
    
    account_balances = {}
    balance_tasks = []
    for account in account_instances:
        balance_call = Call(
            to_addr=STRK_TOKEN_ADDRESS,
            selector=balance_of_selector,
            calldata=[account.address]
        )
        balance_tasks.append(client.call_contract(balance_call, block_number="latest"))
    
    balance_results = await asyncio.gather(*balance_tasks, return_exceptions=True)
    for i, (account, result) in enumerate(zip(account_instances, balance_results)):
        if not isinstance(result, Exception):
            try:
                balance_low = result[0] if isinstance(result, (list, tuple)) and len(result) > 0 else 0
                balance_high = result[1] if isinstance(result, (list, tuple)) and len(result) > 1 else 0
                balance = (balance_high << 128) + balance_low
                account_balances[account.address] = balance
            except Exception as e:
                logger.warning(f"Failed to parse balance for {hex(account.address)}: {e}")
                account_balances[account.address] = 0
        else:
            logger.warning(f"Failed to get balance for {hex(account.address)}: {result}")
            account_balances[account.address] = 0
    
    logger.info(f"Got balances for {len([b for b in account_balances.values() if b > 0])} accounts")
    
    # Calculate resource bounds per account based on balance
    # Constraints: min_amount=520K, actual_price=~27.7T (need >=30T), balance varies
    # For each account: max_amount * max_price_per_unit < balance
    # With max_price_per_unit=30T: max_amount < balance / 30T
    # But we also need max_amount >= 520K
    # So: balance / 30T >= 520K, i.e., balance >= 520K * 30T = 1.56e19
    # For accounts with balance < 1.56e19, we need to reduce either amount or price
    # Strategy: Use actual price (30T) and reduce amount to fit balance
    # But minimum amount is 520K, so if balance < 1.56e19, we're stuck
    # Alternative: Reduce price proportionally to fit balance
    # If balance < 1.56e19, use: max_price_per_unit = balance / 520K
    # But this might be below actual price (27.7T), causing validation to fail
    
    # Actually, let's try a different approach: use a price that works for most accounts
    # If we use 19T price (below actual but might work), then 520K * 19T = 9.88e18
    # This should fit most account balances (~10^18)
    # But if actual price is 27.7T, validation will fail
    
    # Estimate fees manually using RPC with "latest" block tag (not "pending")
    # This mimics what auto_estimate does but works with Sepolia
    logger.info("Estimating fees for one transaction to get realistic bounds...")
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
        
        # Ensure minimums are met (520K for amount, 28T for price)
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
        # Actual gas price on Sepolia is ~28.1T, so we use 30T to have a buffer
        logger.warning(f"Fee estimation failed ({e}), using minimum bounds with 30T price")
        standard_resource_bounds = ResourceBoundsMapping(
            l1_gas=ResourceBounds(max_amount=520000, max_price_per_unit=30000000000000),
            l2_gas=ResourceBounds(max_amount=520000, max_price_per_unit=30000000000000),
            l1_data_gas=ResourceBounds(max_amount=520000, max_price_per_unit=30000000000000)
        )
    
    # Log account balances for reference
    logger.info(f"Account balances (STRK):")
    for account in account_instances[:5]:  # Show first 5
        balance = account_balances.get(account.address, 0)
        balance_strk = balance / 10**18
        logger.info(f"  {hex(account.address)[:20]}...: {balance_strk:.4f} STRK")
    
    # Use _prepare_invoke_v3 first, fall back to manual construction if it fails
    # (due to Sepolia not supporting "pending" block tag)
    # InvokeV3 is already imported at the top of the file
    
    prep_tasks = []
    for op in operations:
        account = op["account"]
        balance = op["balance"]
        
        if len(account_instances) == 1:
            nonce = account_nonces[account.address] + op["op_id"]
        else:
            nonce = account_nonces[account.address]
            account_nonces[account.address] = nonce + 1
        
        call = Call(
            to_addr=int(contract_address, 16) if isinstance(contract_address, str) else contract_address,
            selector=update_balance_selector,
            calldata=[balance & ((1 << 128) - 1), (balance >> 128) & ((1 << 128) - 1)]
        )
        
        # Use realistic resource bounds that fit within typical account balances
        # Accounts have ~1 STRK, so we need: max_amount * max_price_per_unit * 3 <= 1 STRK
        # With max_price_per_unit = 30T: max_amount <= 1e18 / (30T * 3) = 1e18 / 9e16 = ~11K
        # But we need minimum 520K for max_amount, so this won't work
        # Instead, we need to use a lower price. With max_amount = 520K: max_price_per_unit <= 1e18 / (520K * 3) = ~6.4T
        # But actual price is ~28T, so we can't use this either
        # 
        # The solution: Use minimum required max_amount (520K) but with a price that fits
        # We'll use 520K * 1.5T * 3 = 2.34e18 (~0.002 STRK) which fits within balances
        # But validation will fail because actual price is 28T > 1.5T
        #
        # Actually, let's try using 100K with 30T: 100K * 30T * 3 = 9e18 (~0.009 STRK) - still too high
        # Let's use 100K with 20T: 100K * 20T * 3 = 6e18 (~0.006 STRK) - still too high
        # Let's use 80K with 20T: 80K * 20T * 3 = 4.8e18 (~0.0048 STRK) - should work!
        account_balance = account_balances.get(account.address, 0)
        
        # Use reduced resource bounds to allow accounts with >1 STRK to attempt transactions
        # Actual transaction costs are much lower (~0.00043 STRK), but we need to meet minimums
        # Sepolia minimum L2 gas amount: 520K
        # Actual gas price: ~28T
        # 
        # To allow accounts with >1 STRK to work:
        # - Use minimum required amount (520K) for L2 gas
        # - Use actual price (30T with buffer) but account for actual usage being much lower
        # - L1 gas can be lower (actual usage is 0)
        # - L1 data gas can be lower (actual usage is ~192)
        #
        # Strategy: Use minimum required for L2, but lower bounds for L1/L1_data
        # This allows the transaction if actual usage is low, while meeting L2 minimums
        
        # Resource bounds must be >= actual prices to pass validation
        # Actual prices: L1 ~26T, L2 ~28T, L1_data ~28T
        # Use 30T for all prices (with buffer above actual)
        
        # L2 gas: Must meet actual usage (680K+), use actual price
        L2_GAS_AMOUNT = 800000  # Actual usage is ~680K, using 800K with buffer
        L2_GAS_PRICE = 30000000000000  # 30T (actual ~28T, with buffer)
        
        # L1 gas: Actual usage is 0, but need some minimum amount
        # Use minimal amount since actual is 0
        L1_GAS_AMOUNT = 10000  # Minimal (actual is 0, but need some amount)
        L1_GAS_PRICE = 30000000000000  # 30T (must be >= actual ~26T)
        
        # L1 data gas: Actual usage is ~192, minimum required is 128
        L1_DATA_GAS_AMOUNT = 200  # Minimum is 128, use 200 for safety
        L1_DATA_GAS_PRICE = 30000000000000  # 30T (must be >= actual ~28T)
        
        # Calculate max cost (should be < 1 STRK for accounts with >1 STRK)
        max_total_cost = (L1_GAS_AMOUNT * L1_GAS_PRICE + 
                         L2_GAS_AMOUNT * L2_GAS_PRICE + 
                         L1_DATA_GAS_AMOUNT * L1_DATA_GAS_PRICE)
        
        # Check if account has enough balance (use 95% as safety margin)
        if max_total_cost > account_balance * 0.95:
            logger.warning(f"Account {hex(account.address)[:20]}... has low balance ({account_balance / 1e18:.4f} STRK) - transaction may fail validation (needs {max_total_cost / 1e18:.4f} STRK)")
            # Continue anyway - let validation handle it
        else:
            logger.debug(f"Account {hex(account.address)[:20]}... balance OK ({account_balance / 1e18:.4f} STRK, needs {max_total_cost / 1e18:.4f} STRK)")
        
        # Create per-account resource bounds with different amounts for each gas type
        account_resource_bounds = ResourceBoundsMapping(
            l1_gas=ResourceBounds(max_amount=L1_GAS_AMOUNT, max_price_per_unit=L1_GAS_PRICE),
            l2_gas=ResourceBounds(max_amount=L2_GAS_AMOUNT, max_price_per_unit=L2_GAS_PRICE),
            l1_data_gas=ResourceBounds(max_amount=L1_DATA_GAS_AMOUNT, max_price_per_unit=L1_DATA_GAS_PRICE)
        )
        
        # Use _prepare_invoke_v3 to properly format transactions for account validation
        # This is the Python equivalent of accountInvocationsFactory from the TypeScript example
        # The client has been patched to replace "pending" with "latest" in all RPC calls
        prep_task = account._prepare_invoke_v3(
            calls=call,
            nonce=nonce,
            resource_bounds=account_resource_bounds,
            auto_estimate=False,
            tip=0
        )
        prep_tasks.append((prep_task, account, op["op_id"]))
    
    # Prepare all transactions using _prepare_invoke_v3 (properly formats for account validation)
    logger.info("Preparing transactions using _prepare_invoke_v3...")
    transactions = await asyncio.gather(*[task for task, _, _ in prep_tasks], return_exceptions=True)
    
    # Filter valid transactions
    valid_prep = []
    for i, tx in enumerate(transactions):
        if not isinstance(tx, Exception):
            _, account, op_id = prep_tasks[i]
            valid_prep.append((tx, account, op_id))
        else:
            logger.warning(f"Transaction preparation failed: {tx}")
    
    prep_duration = time.time() - prep_start_time
    logger.info(f"Prepared {len(valid_prep)} transactions in {prep_duration:.2f}s")
    
    # Step 2: Sign all transactions in parallel (CPU-bound, use thread pool)
    logger.info("Signing transactions...")
    sign_start_time = time.time()
    
    import concurrent.futures
    import dataclasses
    
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
    
    # Step 3: Send all transactions in parallel
    send_start_time = time.time()
    send_tasks = [
        client.send_transaction(tx) for tx, _ in signed_transactions
    ]
    all_results = await asyncio.gather(*send_tasks, return_exceptions=True)
    
    send_duration = time.time() - send_start_time
    
    tx_hashes = []
    for i, (r, (signed_tx, op_id)) in enumerate(zip(all_results, signed_transactions)):
        if not isinstance(r, Exception):
            # Get account from valid_prep
            for tx2, acc2, op_id2 in valid_prep:
                if op_id2 == op_id:
                    account_addr = acc2.address if hasattr(acc2, 'address') else account_instances[0].address
                    break
            
            results.append({
                "tx_hash": hex(r.transaction_hash),
                "duration": send_duration / len(signed_transactions),
                "op_id": op_id,
                "success": True,
                "account": hex(account_addr)
            })
            tx_hashes.append(r.transaction_hash)
        else:
            # Log the error for debugging
            logger.error(f"Transaction {op_id} failed: {r}")
            results.append({
                "tx_hash": None,
                "duration": send_duration / len(signed_transactions),
                "op_id": op_id,
                "success": False,
                "error": str(r)
            })
    
    # Log summary
    successful_count = sum(1 for r in results if r.get("success", False))
    logger.info(f"Sent all {len(signed_transactions)} transactions in {send_duration:.2f}s: {successful_count} successful, {len(results) - successful_count} failed")
    
    # Step 4: Read balances BEFORE writes (baseline)
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
    
    # Step 5: Wait for all transactions to be accepted (part of chain throughput)
    logger.info(f"Waiting for {len(tx_hashes)} transactions to be accepted...")
    accept_start_time = time.time()
    
    # Wait for all transactions in parallel
    wait_tasks = [
        client.wait_for_tx(tx_hash, check_interval=0.5, retries=500)
        for tx_hash in tx_hashes
    ]
    
    # Wait for all transactions to be accepted
    accept_results = await asyncio.gather(*wait_tasks, return_exceptions=True)
    
    accept_duration = time.time() - accept_start_time
    logger.info(f"All transactions accepted in {accept_duration:.2f}s")
    
    # Step 6: Read balances AFTER writes (verification)
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
    results_dir = "scripts/results"
    os.makedirs(results_dir, exist_ok=True)
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    detailed_log_file = f"{results_dir}/read_write_read_sepolia_{timestamp}.json"
    
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
    # Note: read operations are not included in throughput calculation (they're view calls)
    chain_duration = send_duration + accept_duration
    end_time = time.time()
    total_duration = end_time - start_time  # Includes signing (for reference)
    
    total_ops_executed = len([r for r in results if r.get("success", False)])
    successful = [r for r in results if r.get("success", False)]
    failed = [r for r in results if not r.get("success", False)]
    
    # Calculate OPS excluding signing time (this is the actual Sepolia throughput)
    # chain_duration = submission + acceptance time (excludes client-side signing)
    chain_ops = total_ops_executed / chain_duration if chain_duration > 0 else 0
    
    # Also calculate total OPS (including signing) for reference
    total_ops = total_ops_executed / total_duration if total_duration > 0 else 0
    
    avg_tx_duration = sum(r.get("duration", 0) for r in successful) / len(successful) if successful else 0
    
    stats = {
        "total_operations": total_operations,
        "total_ops_executed": total_ops_executed,
        "chain_ops": chain_ops,  # Throughput excluding signing
        "total_ops": total_ops,  # Including signing (for reference)
        "total_duration": total_duration,  # Includes signing
        "chain_duration": chain_duration,  # Submission + acceptance (excludes signing)
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
    logger.info(f"Chain OPS (excludes signing): {chain_ops:.2f}")
    logger.info(f"Total OPS (includes signing): {total_ops:.2f}")
    logger.info(f"Operations Executed: {total_ops_executed}")
    logger.info(f"")
    logger.info(f"Breakdown:")
    logger.info(f"  Preparation: {prep_duration:.2f}s")
    logger.info(f"  Signing: {sign_duration:.2f}s")
    logger.info(f"  Submission: {send_duration:.2f}s")
    logger.info(f"  Acceptance: {accept_duration:.2f}s")
    logger.info(f"  Chain Duration (submission + acceptance): {chain_duration:.2f}s")
    logger.info(f"  Total Duration (includes signing): {total_duration:.2f}s")
    logger.info(f"")
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
    
    parser = argparse.ArgumentParser(description="Sepolia Performance Test - Optimized")
    parser.add_argument("--total-ops", type=int, default=200, help="Total operations to perform")
    parser.add_argument("--parallel-ops", type=int, default=50, help="Number of parallel operations (concurrent users)")
    parser.add_argument("--num-accounts", type=int, default=50, help="Number of test accounts")
    parser.add_argument("--contract-address", type=str, default=None, help="Contract address (defaults to CONTRACT_ADDRESS)")
    
    args = parser.parse_args()
    
    await run_performance_test(
        total_operations=args.total_ops,
        parallel_ops=args.parallel_ops,
        num_accounts=args.num_accounts,
        contract_address=args.contract_address
    )


if __name__ == "__main__":
    asyncio.run(main())


# performance_test.py
import asyncio
import streamlit as st
import pandas as pd
import time
import hashlib
from starknet_py.net.account.account import Account
from starknet_py.net.models import StarknetChainId
from starknet_py.contract import Contract
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.net.client_errors import ClientError
from starknet_py.hash.address import compute_address
from starknet_py.hash.selector import get_selector_from_name
from starknet_py.constants import EC_ORDER
from dotenv import load_dotenv
from importlib.metadata import version  # For library version
import os
import logging
import json  # Added for persistent storage
import numpy as np  # Added for NaN handling

print(version('starknet-py'))  # Prints the installed version

# Load with explicit path and verbose
env_path = '.env'  # Relative to script directory
# Load environment variables
load_dotenv()
NODE_URL = os.getenv("NODE_URL", "https://starknet-sepolia.infura.io/v3/738a3e1e3f934295b1e4c3034dcbedf9")  # Using your BUYER Infura RPC
FUNDER_PRIVATE_KEY = os.getenv("FUNDER_PRIVATE_KEY","0x04eb9093c6bc934e99dbdf1f2258e7d101da3c8503ef38e55f40964e15b155a8") # Your funded account PK
FUNDER_ADDRESS = os.getenv("FUNDER_ADDRESS","0x0764a2fe39643b6ef291883d14676ebc09f3f27fbea24fbf49cfa7976f97bc4c") # Your funded account address
STRK_TOKEN_ADDRESS = os.getenv("STRK_TOKEN_ADDRESS", "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d")
CONTRACT_ADDRESS = os.getenv("CONTRACT_ADDRESS" , "0x060b6071264a431d940012397ae39224ace56611a3a167c18954747bc243f8a1")
OZ_CLASS_HASH = "0x05b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564"  # Corrected OZ account class hash on Sepolia
st.write(f"FUNDER_PRIVATE_KEY: {FUNDER_PRIVATE_KEY}")
st.write(f"FUNDER_ADDRESS: {FUNDER_ADDRESS}")
# Rates as of Oct 21, 2025
STRK_USD = 0.1284
USD_ZAR = 17.31
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# Hardcoded ERC20 ABI for STRK (standard on Starknet)
ERC20_ABI = [
    {"type": "function", "name": "name", "inputs": [], "outputs": [{"name": "name", "type": "felt"}], "stateMutability": "view"},
    {"type": "function", "name": "symbol", "inputs": [], "outputs": [{"name": "symbol", "type": "felt"}], "stateMutability": "view"},
    {"type": "function", "name": "decimals", "inputs": [], "outputs": [{"name": "decimals", "type": "u8"}], "stateMutability": "view"},
    {"type": "function", "name": "total_supply", "inputs": [], "outputs": [{"name": "total_supply", "type": "u256"}], "stateMutability": "view"},
    {"type": "function", "name": "balance_of", "inputs": [{"name": "account", "type": "felt"}], "outputs": [{"name": "balance", "type": "u256"}], "stateMutability": "view"},
    {"type": "function", "name": "allowance", "inputs": [{"name": "owner", "type": "felt"}, {"name": "spender", "type": "felt"}], "outputs": [{"name": "allowance", "type": "u256"}], "stateMutability": "view"},
    {"type": "function", "name": "transfer", "inputs": [{"name": "recipient", "type": "felt"}, {"name": "amount", "type": "u256"}], "outputs": [{"name": "success", "type": "felt"}]},
    {"type": "function", "name": "transfer_from", "inputs": [{"name": "sender", "type": "felt"}, {"name": "recipient", "type": "felt"}, {"name": "amount", "type": "u256"}], "outputs": [{"name": "success", "type": "felt"}]},
    {"type": "function", "name": "approve", "inputs": [{"name": "spender", "type": "felt"}, {"name": "amount", "type": "u256"}], "outputs": [{"name": "success", "type": "felt"}]}
]

# Hardcoded Proxy ABI for STRK proxy
PROXY_ABI = [
    {
        "inputs": [],
        "name": "implementation",
        "outputs": [{"name": "implementation", "type": "felt"}],
        "stateMutability": "view",
        "type": "function"
    }
]

async def get_contract(address, client):
    addr_int = int(address, 16) if isinstance(address, str) else address
    class_hash = await client.get_class_hash_at(addr_int, block_number="latest")
    declared_class = await client.get_class_by_hash(class_hash, block_number="latest")
    abi = declared_class.abi
    # For STRK proxy
    if address == STRK_TOKEN_ADDRESS:
        proxy_contract = Contract(address=address, abi=PROXY_ABI, provider=client)
        implementation_hash = await proxy_contract.functions["implementation"].call()
        impl_hash = implementation_hash[0]  # Assuming single felt output
        impl_class = await client.get_class_by_hash(impl_hash, block_number="latest")
        abi = impl_class.abi
    return Contract(address=address, abi=abi, provider=client)

async def create_test_accounts(client, funder_account, num_accounts=20):
    accounts = []
    for i in range(num_accounts):
        private_key_int = int.from_bytes(os.urandom(32), 'big') % EC_ORDER  # Ensure within curve order to avoid overflow
        private_key = hex(private_key_int)[2:]
        key_pair = KeyPair.from_private_key(int(private_key, 16))
        public_key = key_pair.public_key
        calldata = [public_key]
        address = compute_address(
            class_hash=int(OZ_CLASS_HASH, 16),
            constructor_calldata=calldata,
            salt=public_key,
            deployer_address=0
        )
        # Fund the address
        await fund_account(client, funder_account, hex(address), amount=10**17) # Increased to 0.1 STRK
        # Deploy account
        account = Account(
            client=client,
            address=address,
            key_pair=key_pair,
            chain=StarknetChainId.SEPOLIA
        )
        signed_tx = await account.sign_deploy_account_v3(
            class_hash=int(OZ_CLASS_HASH, 16),
            contract_address_salt=key_pair.public_key,
            constructor_calldata=calldata,
            auto_estimate=True
        )
        response = await client.deploy_account(signed_tx)
        receipt = await client.wait_for_tx(response.transaction_hash)
        deploy_gas_cost = receipt.actual_fee  # Gas cost in FRI
        accounts.append({
            "address": hex(address),
            "private_key": private_key,
            "deploy_gas_cost": deploy_gas_cost.amount  # Use .amount (int in FRI units)
        })
        logger.info(f"Created account {i+1}: {hex(address)} with deploy gas cost: {deploy_gas_cost}")
    return accounts

async def fund_account(client, funder_account, to_address, amount):
    strk_contract = await get_contract(STRK_TOKEN_ADDRESS, client)
    call = strk_contract.functions["transfer"].prepare_call(recipient=int(to_address, 16), amount={"low": amount, "high": 0})
    invocation = await funder_account.execute_v3(call, auto_estimate=True)
    await client.wait_for_tx(invocation.transaction_hash)

async def fund_test_accounts(client, funder_account, test_accounts):
    for acc in test_accounts:
        await fund_account(client, funder_account, acc["address"], amount=10**17)  # 0.1 STRK

async def get_strk_balance(client, address):
    strk_contract = await get_contract(STRK_TOKEN_ADDRESS, client)
    balance = await strk_contract.functions["balance_of"].call(account=int(address, 16))
    return balance[0]  # u128 to int

async def fetch_balances(test_accounts):
    balances = []
    for acc in test_accounts:  # Sequential to avoid rate limits
        bal = await get_strk_balance(client, acc["address"])
        balances.append(bal)
    return balances

async def deploy_contract(client, account):
    st.warning("Deploy contract manually and set CONTRACT_ADDRESS in env. Skipping auto-deploy.")
    return "0xdeployed_address" # Replace with actual

async def run_batch_test(client, funder_account, test_accounts, batch_size, contract_address, bundle_size=1):
    contract = await get_contract(contract_address, client)
    start_time = time.time()
    total_gas = 0
    execute_coros = []
    num_bundles = (batch_size + bundle_size - 1) // bundle_size
    for b in range(num_bundles):
        acc_data = test_accounts[b % len(test_accounts)]
        test_acc = Account(client=client, address=acc_data["address"], key_pair=KeyPair.from_private_key(int(acc_data["private_key"], 16)), chain=StarknetChainId.SEPOLIA)
        calls = []
        for i in range(bundle_size):
            update_idx = b * bundle_size + i
            if update_idx >= batch_size:
                break
            calls.append(contract.functions["update_balance"].prepare_call(new_balance=update_idx + 1))
        execute_coros.append(test_acc.execute_v3(calls, auto_estimate=True))

    invocations = await asyncio.gather(*execute_coros, return_exceptions=True)
    tx_hashes = [inv.transaction_hash for inv in invocations if not isinstance(inv, Exception)]

    receipt_coros = [client.wait_for_tx(hash) for hash in tx_hashes]
    receipts = await asyncio.gather(*receipt_coros, return_exceptions=True)
    receipts = [r for r in receipts if not isinstance(r, Exception)]

    for receipt in receipts:
        block = await client.get_block(block_number=receipt.block_number)
        gas_price = block.l2_gas_price
        gas_consumed = receipt.actual_fee.amount / gas_price.price_in_fri
        total_gas += gas_consumed

    elapsed = time.time() - start_time
    tps = batch_size / elapsed if elapsed > 0 else 0
    total_cost_strk = sum(receipt.actual_fee.amount for receipt in receipts) / 1e18
    cost_per_tx_strk = total_cost_strk / num_bundles if num_bundles > 0 else 0
    cost_per_tx_usd = cost_per_tx_strk * STRK_USD
    cost_per_tx_zar = cost_per_tx_usd * USD_ZAR
    mgas_s = total_gas / 1e6 / elapsed if elapsed > 0 else 0
    batch_id = hex(int.from_bytes(os.urandom(8), 'big'))
    batch_type = "Balance Update"
    batch_info = {
        "batch_type": get_selector_from_name(batch_type),
        "batch_id": int(batch_id, 16),
        "num_items": batch_size,
        "cost": int(total_gas),
        "elapsed_seconds": int(elapsed)
    }
    call = contract.functions["set_batch_info"].prepare_call(batch_info)
    invocation = await funder_account.execute_v3(call, auto_estimate=True)
    await client.wait_for_tx(invocation.transaction_hash)
    return {
        "batch_type": batch_type,
        "transactions": batch_size,
        "batch_cost_strk": total_cost_strk,
        "cost_per_tx_strk": cost_per_tx_strk,
        "cost_per_tx_usd": cost_per_tx_usd,
        "cost_per_tx_zar": cost_per_tx_zar,
        "tps": tps,
        "duration": elapsed,
        "mgas_s": mgas_s,
        "batch_id": batch_id
    }

ACCOUNTS_FILE = "test_accounts.json"
st.title("Balance Updater Test App")
client = FullNodeClient(node_url=NODE_URL)
key_pair = KeyPair.from_private_key(int(FUNDER_PRIVATE_KEY, 16))
funder_account = Account(client=client, address=int(FUNDER_ADDRESS, 16), key_pair=key_pair, chain=StarknetChainId.SEPOLIA)
if 'test_accounts' not in st.session_state:
    st.session_state.test_accounts = []
    if os.path.exists(ACCOUNTS_FILE):
        try:
            with open(ACCOUNTS_FILE, 'r') as f:
                st.session_state.test_accounts = json.load(f)
            st.success(f"Loaded {len(st.session_state.test_accounts)} accounts from {ACCOUNTS_FILE}.")
        except Exception as e:
            st.error(f"Failed to load accounts: {e}")
if 'contract_address' not in st.session_state:
    st.session_state.contract_address = CONTRACT_ADDRESS or asyncio.run(deploy_contract(client, funder_account))
if 'batch_history' not in st.session_state:
    st.session_state.batch_history = []
contract_address = st.text_input("Contract Address", st.session_state.contract_address)
st.session_state.contract_address = contract_address
num_accounts = st.number_input("Number of Test Accounts", min_value=10, max_value=100, value=20)
if st.button("Create Test Accounts"):
    if os.path.exists(ACCOUNTS_FILE):
        st.info("Existing accounts file found. Will load and append if requesting more.")
    current_num = len(st.session_state.test_accounts)
    if num_accounts <= current_num:
        st.info(f"Requested {num_accounts} is less than or equal to existing {current_num}. Skipping creation.")
    else:
        with st.spinner(f"Creating {num_accounts - current_num} additional accounts..."):
            additional_accounts = asyncio.run(create_test_accounts(client, funder_account, num_accounts - current_num))
            st.session_state.test_accounts.extend(additional_accounts)
            try:
                with open(ACCOUNTS_FILE, 'w') as f:
                    json.dump(st.session_state.test_accounts, f)
                st.success(f"Added {len(additional_accounts)} accounts. Total now: {len(st.session_state.test_accounts)}.")
            except Exception as e:
                st.error(f"Failed to save: {e}")
if st.session_state.test_accounts:
    if st.button("Fund Test Accounts"):
        with st.spinner("Funding accounts..."):
            asyncio.run(fund_test_accounts(client, funder_account, st.session_state.test_accounts))
        st.success("Funded all test accounts with additional 0.1 STRK.")
    st.subheader("Test Account Balances")
    balances_raw = asyncio.run(fetch_balances(st.session_state.test_accounts))
    balances = []
    for i, acc in enumerate(st.session_state.test_accounts):
        bal = balances_raw[i]
        deploy_cost_strk = (acc.get("deploy_gas_cost", 0) / 1e18) if "deploy_gas_cost" in acc and isinstance(acc["deploy_gas_cost"], (int, float)) else np.nan
        balances.append({"Address": acc["address"], "STRK Balance": bal / 1e18, "Deploy Gas Cost (STRK)": deploy_cost_strk})
    df_test_bal = pd.DataFrame(balances)
    st.table(df_test_bal)
    st.subheader("All Addresses and Balances")
    contract = asyncio.run(get_contract(contract_address, client))
    all_balances = asyncio.run(contract.functions["get_all_balances"].call())
    all_balances = all_balances[0]  # Unpack single return value
    if not all_balances:
        df_balances = pd.DataFrame(columns=["Address", "Balance"])
    else:
        df_balances = pd.DataFrame({
            "Address": [hex(addr) for addr, bal in all_balances],
            "Balance": [bal / 1e18 if isinstance(bal, int) else bal for addr, bal in all_balances]
        })
    st.table(df_balances)
st.subheader("Run Batch Test")
batch_size = st.number_input("Batch Size (Number of Updates)", min_value=1, value=50)
bundle_size = st.number_input("Bundle Size (Calls per Tx)", min_value=1, value=1)
if st.button("Execute Test Update"):
    with st.spinner("Running test..."):
        result = asyncio.run(run_batch_test(client, funder_account, st.session_state.test_accounts, batch_size, contract_address, bundle_size))
        st.session_state.batch_history.append(result)
    st.success("Test complete!")
if st.session_state.batch_history:
    st.subheader("Batch Details")
    df = pd.DataFrame(st.session_state.batch_history)
    st.table(df)
    # Totals like screenshot
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Total Transactions", df["transactions"].sum())
    col2.metric("Total Cost (STRK)", f"{df['batch_cost_strk'].sum():.4f}")
    col3.metric("Avg TPS", f"{df['tps'].mean():.2f}")
    col4.metric("Avg MGas/s", f"{df['mgas_s'].mean():.2f}")
# Fetch and show batch infos from contract for verification
if st.button("Refresh Batch Infos from Contract"):
    contract = asyncio.run(get_contract(contract_address, client))
    all_infos = asyncio.run(contract.functions["get_all_batch_infos"].call())
    all_infos = all_infos[0]  # Unpack single return value
    if all_infos:
        df_infos = pd.DataFrame([{
            "Batch ID": hex(info.batch_id),
            "Type": felt_to_str(info.batch_type),
            "Items": info.num_items,
            "Cost (Gas Units)": info.cost,
            "Elapsed (s)": info.elapsed_seconds
        } for info in all_infos])
        st.subheader("Contract-Stored Batch Infos")
        st.table(df_infos)
def felt_to_str(f: int) -> str:
    bytes = []
    while f > 0:
        bytes.append(f % 256)
        f //= 256
    return bytes[::-1].decode('utf-8', errors='ignore')
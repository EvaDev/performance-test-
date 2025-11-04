import json
import asyncio
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.contract import Call
from starknet_py.hash.selector import get_selector_from_name

async def get_balance(address):
    client = FullNodeClient(node_url="https://starknet-sepolia.infura.io/v3/738a3e1e3f934295b1e4c3034dcbedf9")
    call = Call(
        to_addr=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d,
        selector=get_selector_from_name("balance_of"),
        calldata=[int(address, 16)]
    )
    result = await client.call_contract(call=call, block_hash="latest")
    balance_low = int(result[0])
    balance_high = int(result[1])
    balance = (balance_high << 128) + balance_low
    return balance / 10**18

async def main():
    with open('/Users/seanevans/Documents/ssp/pt/scripts/test_accounts.json', 'r') as f:
        accounts = json.load(f)
    
    min_balance = 0.05
    low_balance_accounts = []
    
    tasks = [get_balance(acc['address']) for acc in accounts]
    balances = await asyncio.gather(*tasks)
    
    for acc, bal in zip(accounts, balances):
        if bal < min_balance:
            low_balance_accounts.append(acc['address'])
            print(f"Low balance: {acc['address']} ({bal:.6f} STRK)")
    
    if low_balance_accounts:
        print("\nLow balance accounts to fund manually:")
        for addr in low_balance_accounts:
            print(addr)
    else:
        print("All accounts have sufficient balance.")

asyncio.run(main())
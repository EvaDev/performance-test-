const { Provider, CallData } = require('starknet');

const provider = new Provider({ nodeUrl: 'http://localhost:9944/v0_8_0' });
const strkTokenAddress = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const accountAddress = process.argv[2] || '0x7d101d7e45f0bda48db725965be0b23db4cd4f78db2304bbe9d011f5128736c';

async function checkBalance() {
    try {
        const call = {
            contractAddress: strkTokenAddress,
            entrypoint: 'balance_of',
            calldata: CallData.compile({ account: accountAddress })
        };
        const result = await provider.callContract(call, { blockIdentifier: 'latest' });
        const balanceLow = BigInt(result[0]);
        const balanceHigh = BigInt(result[1]);
        const balance = (balanceHigh << 128n) + balanceLow;
        const balanceStrk = Number(balance) / 1e18;
        
        console.log(`\nAccount: ${accountAddress}`);
        console.log(`STRK Balance: ${balanceStrk.toFixed(4)} STRK`);
        console.log(`Balance (raw): ${balanceLow} (low), ${balanceHigh} (high)`);
        
        return balanceStrk;
    } catch (err) {
        console.error('Error checking balance:', err.message);
        throw err;
    }
}

checkBalance().catch(console.error);


const fs = require('fs');
const { Provider, Account, ec, json, constants, CallData, Contract } = require('starknet');
require('dotenv').config();  // Install with npm install dotenv

const provider = new Provider({ rpc: process.env.NODE_URL || 'https://starknet-sepolia.infura.io/v3/7fc1711d363e4e1d91032e6d4d76f159' });
const funderPrivateKey = process.env.FUNDER_PRIVATE_KEY || '0x04eb9093c6bc934e99dbdf1f2258e7d101da3c8503ef38e55f40964e15b155a8';
const funderAddress = process.env.FUNDER_ADDRESS || '0x0764a2fe39643b6ef291883d14676ebc09f3f27fbea24fbf49cfa7976f97bc4c';
const strkTokenAddress = process.env.STRK_TOKEN_ADDRESS || '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const contractAddress = process.env.CONTRACT_ADDRESS || '0x060b6071264a431d940012397ae39224ace56611a3a167c18954747bc243f8a1';

// Load ABI from file
const abiPath = process.env.CONTRACT_ABI_PATH || '/Users/seanevans/Documents/ssp/pt/ABI/performancetestABI.json';
const contractAbi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));

// Load test accounts from Python JSON file
const accountsPath = '/Users/seanevans/Documents/ssp/pt/scripts/test_accounts.json';
const testAccounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8')).map(acc => ({
  address: acc.address,
  privateKey: acc.private_key.startsWith('0x') ? acc.private_key : '0x' + acc.private_key  // Add '0x' prefix if missing
}));

const funderKeyPair = ec.starkCurve.getStarkKey(funderPrivateKey);
const funderAccount = new Account(provider, funderAddress, funderKeyPair);

async function fundAccount(toAddress, amount) {
    const call = {
        contractAddress: strkTokenAddress,
        entrypoint: 'transfer',
        calldata: CallData.compile({ recipient: toAddress, amount: { low: amount, high: 0n } })
    };
    const tx = await funderAccount.execute(call);
    await provider.waitForTransaction(tx.transaction_hash);
    console.log(`Funded ${toAddress}`);
}

async function runBatchTest(testAccounts, batchSize = 50, bundleSize = 1) {
    const contract = new Contract(contractAbi, contractAddress, provider);  // Use loaded ABI
    const startTime = Date.now();
    const calls = [];
    const numBundles = Math.ceil(batchSize / bundleSize);
    for (let b = 0; b < numBundles; b++) {
        const acc = testAccounts[b % testAccounts.length];
        console.log(`Using account: ${acc.address} with private key: ${acc.privateKey}`);
        const account = new Account(provider, acc.address, acc.privateKey);
        const bundleCalls = [];
        for (let i = 0; i < bundleSize; i++) {
            const idx = b * bundleSize + i;
            if (idx >= batchSize) break;
            bundleCalls.push(contract.populate('update_balance', { new_balance: BigInt(idx + 1) }));
        }
        calls.push(account.execute(bundleCalls).catch(err => {
            console.error(`Error executing for account ${acc.address}:`, err);
            return null;
        }));
    }
    const invocations = await Promise.all(calls);
    const txHashes = invocations.filter(inv => inv).map(inv => inv.transaction_hash);
    const receipts = await Promise.all(txHashes.map(h => provider.waitForTransaction(h).catch(err => {
        console.error(`Error waiting for tx ${h}:`, err);
        return null;
    })));
    const validReceipts = receipts.filter(r => r);
    const elapsed = (Date.now() - startTime) / 1000;
    const tps = batchSize / elapsed;
    const totalCostStrk = validReceipts.reduce((sum, r) => sum + Number(r.actual_fee) / 1e18, 0);
    console.log(`TPS: ${tps.toFixed(2)}, Total Cost (STRK): ${totalCostStrk.toFixed(4)}, Duration: ${elapsed}s, Successful Tx: ${validReceipts.length}`);
    // Add batch info storage if needed
}

// Run example
(async () => {
    // Optionally re-fund if needed: await Promise.all(testAccounts.map(acc => fundAccount(acc.address, 10n ** 17n)));
    await runBatchTest(testAccounts, 50, 1);
})().catch(console.error);
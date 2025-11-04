const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config({ silent: true });
const { Provider, Account, ec, json, constants, CallData, Contract, shortString } = require('starknet');

// Use local Madara devnet by default, or use NODE_URL if set
const defaultNodeUrl = process.env.NODE_URL || 'http://localhost:9944';
// For local devnet, use a single provider. For production, you can use multiple providers for load balancing
const providers = [
  new Provider({ rpc: { nodeUrl: defaultNodeUrl } })
];

const funderPrivateKey = process.env.FUNDER_PRIVATE_KEY || '0x04eb9093c6bc934e99dbdf1f2258e7d101da3c8503ef38e55f40964e15b155a8';
const funderAddress = process.env.FUNDER_ADDRESS || '0x0764a2fe39643b6ef291883d14676ebc09f3f27fbea24fbf49cfa7976f97bc4c';
const strkTokenAddress = process.env.STRK_TOKEN_ADDRESS || '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const contractAddress = process.env.CONTRACT_ADDRESS || '0x63ab038c9d25515aa8e873febae8eb5b1d4be5fba1a217958064fac441b619e';

// Support both container (/pt) and host paths
const abiPath = process.env.CONTRACT_ABI_PATH || (fs.existsSync('/pt/ABI/performancetestABI.json') 
    ? '/pt/ABI/performancetestABI.json' 
    : '/Users/seanevans/Documents/ssp/pt/ABI/performancetestABI.json');
const contractAbi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));

const accountsPath = fs.existsSync('/pt/scripts/test_accounts.json')
    ? '/pt/scripts/test_accounts.json'
    : '/Users/seanevans/Documents/ssp/pt/scripts/test_accounts.json';
let testAccounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8')).map(acc => ({
  address: acc.address,
  privateKey: acc.private_key.startsWith('0x') ? acc.private_key : '0x' + acc.private_key
}));

const funderKeyPair = ec.starkCurve.getStarkKey(funderPrivateKey);
const funderAccount = new Account(providers[0], funderAddress, funderKeyPair, 1);

async function fundAccount(toAddress, amount, provIdx = 0) {
    const prov = providers[provIdx % providers.length];
    const call = {
        contractAddress: strkTokenAddress,
        entrypoint: 'transfer',
        calldata: CallData.compile({ recipient: toAddress, amount: { low: amount, high: 0n } })
    };
    const estimated = await funderAccount.estimateInvokeFee(call);
    const maxFee = estimated.overall_fee * 12n / 10n;  // 20% buffer
    const tx = await funderAccount.execute(call, undefined, { maxFee });
    await prov.waitForTransaction(tx.transaction_hash);
    console.log(`Funded ${toAddress} with ${Number(amount) / 1e18} STRK`);
}

async function getStrkBalance(address, provIdx = 0) {
    const prov = providers[provIdx % providers.length];
    const call = {
        contractAddress: strkTokenAddress,
        entrypoint: 'balance_of',
        calldata: CallData.compile({ account: address })
    };
    const result = await prov.callContract(call, { blockIdentifier: 'latest' });
    const balanceLow = BigInt(result[0]);
    const balanceHigh = BigInt(result[1]);
    const balance = (balanceHigh << 128n) + balanceLow;
    return Number(balance) / 1e18;
}

async function runBatchTest(testAccounts, batchSize = 50, bundleSize = 1, readRatio = 0.2, mode = 'blend', concurrency = 5) {
    console.log(`Using pre-funded existing accounts = ${testAccounts.length}`);
    console.log(`Mode: ${mode}`);

    const pLimit = (await import('p-limit')).default;

    // Check and fund low-balance accounts (commented out due to signature issues; manual fund for now)
    /*
    const MIN_BALANCE = 0.05; // Increased for safety
    const FUND_AMOUNT = 5n * 10n ** 17n; // 0.5 STRK
    const fundingLimit = pLimit(concurrency);
    const fundingOps = [];
    for (let i = 0; i < testAccounts.length; i++) {
        fundingOps.push(fundingLimit(async () => {
            const acc = testAccounts[i];
            try {
                const bal = await getStrkBalance(acc.address, i);
                if (bal < MIN_BALANCE) {
                    await fundAccount(acc.address, FUND_AMOUNT, i);
                    return acc.address;
                }
            } catch (err) {
                console.error(`Funding failed for ${acc.address}:`, err.message);
            }
            return null;
        }));
    }
    const funded = (await Promise.all(fundingOps)).filter(a => a);
    if (funded.length > 0) {
        console.log(`Funded ${funded.length} accounts: ${funded.join(', ')}`);
    }
    */

    // Recheck balances and filter sufficient accounts
    const MIN_BALANCE = 0.05;
    const sufficientAccountsLimit = pLimit(concurrency);
    const sufficientOps = testAccounts.map((acc, i) => sufficientAccountsLimit(async () => {
        const bal = await getStrkBalance(acc.address, i);
        return bal >= MIN_BALANCE ? acc : null;
    }));
    let sufficientAccounts = (await Promise.all(sufficientOps)).filter(Boolean);
    if (sufficientAccounts.length === 0) {
        throw new Error('No accounts have sufficient balance. Please fund them manually.');
    }
    if (sufficientAccounts.length < batchSize) {
        console.warn(`Only ${sufficientAccounts.length} accounts have sufficient balance. Adjusting batchSize to ${sufficientAccounts.length}.`);
        batchSize = sufficientAccounts.length;
    }
    testAccounts = sufficientAccounts; // Use only sufficient accounts

    const startTime = Date.now();
    const writeTxHashes = [];
    let numReads = 0;
    let numWrites = 0;
    let validReceipts = [];

    if (mode === 'blend') {
        console.log(`Note: For batchSize=${batchSize} with bundleSize=${bundleSize} and readRatio=${readRatio}, number of tx≈${Math.ceil((batchSize * (1 - readRatio)) / bundleSize)}. More accounts than tx reduces nonce conflicts.`);

        numWrites = Math.floor(batchSize * (1 - readRatio));
        numReads = batchSize - numWrites;
        const numBundles = Math.ceil(numWrites / bundleSize);
        const usedAccounts = [...new Set(Array.from({length: Math.max(numBundles, numReads)}, (_, b) => testAccounts[b % testAccounts.length]))];

        const beforeBalances = await Promise.all(usedAccounts.map(async (acc, idx) => await getStrkBalance(acc.address, idx)));

        const ops = [];
        const limit = pLimit(concurrency);
        let sentCount = 0;
        let opIndex = 0;
        const failedWrites = [];

        const opTypes = Array(numReads).fill('read').concat(Array(numWrites).fill('write'));
        opTypes.sort(() => Math.random() - 0.5);

        const accountWrites = new Map();
        for (let i = 0; i < numWrites; i++) {
            const acc = testAccounts[i % testAccounts.length].address;
            if (!accountWrites.has(acc)) {
                accountWrites.set(acc, []);
            }
            accountWrites.get(acc).push(i);
        }

        // Helper function to retry with exponential backoff for rate limits
        async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    return await fn();
                } catch (err) {
                    const isRateLimit = err.toString().includes('Rate limit reached') || 
                                      err.toString().includes('-32097') ||
                                      (err.baseError && err.baseError.code === -32097);
                    if (isRateLimit && attempt < maxRetries - 1) {
                        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
                        console.log(`\nRate limited, retrying in ${(delay/1000).toFixed(1)}s (attempt ${attempt + 1}/${maxRetries})...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }
                    throw err;
                }
            }
        }

        for (let b = 0; b < opTypes.length; b++) {
            ops.push(limit(async () => {
                // Add random delay to spread out requests and reduce rate limiting
                await new Promise(resolve => setTimeout(resolve, Math.random() * 300 + 100));
                
                const type = opTypes[b];
                const accObj = testAccounts[opIndex % testAccounts.length];
                opIndex++;
                const provIdx = b % providers.length;
                const prov = providers[provIdx];
                const account = new Account(prov, accObj.address, accObj.privateKey);
                const contractLocal = new Contract(contractAbi, contractAddress, prov);
                try {
                    if (type === 'read') {
                        const result = await retryWithBackoff(async () => {
                            return await contractLocal.call('get_balance', [accObj.address], { blockIdentifier: 'latest' });
                        });
                        return { type: 'read', result };
                    } else {
                        const bundleCalls = [];
                        for (let j = 0; j < bundleSize; j++) {
                            const idx = sentCount * bundleSize + j;
                            if (idx >= numWrites) break;
                            //bundleCalls.push(contractLocal.populate('update_balance', { new_balance: { low: BigInt(idx + 1), high: 0n } }));
                            bundleCalls.push(contractLocal.populate('update_and_get', { new_balance: { low: BigInt(idx + 1), high: 0n } }));   
                        }
                        const estimated = await account.estimateInvokeFee(bundleCalls);
                        const maxFee = estimated.overall_fee * 12n / 10n;  // 20% buffer
                        try {
                            const currentNonce = await account.getNonce('pending');
                            const executeResult = await account.execute(bundleCalls, undefined, { maxFee, nonce: BigInt(currentNonce), version: 1n });
                            writeTxHashes.push(executeResult.transaction_hash);
                            sentCount++;
                            process.stdout.write(`\rSubmitted transaction ${sentCount}/${numBundles}` + ' '.repeat(10));
                            return { type: 'write', result: executeResult };
                        } catch (err) {
                            if (err.toString().includes('Invalid transaction nonce')) {
                                console.log(`Nonce error for ${accObj.address}, adding to retry list...`);
                                failedWrites.push({ account, bundleCalls, provIdx });
                                return null;
                            } else if (err.toString().includes('Rate limit reached')) {
                                throw err;
                            } else {
                                console.error(`Skipping account ${accObj.address} due to error:`, err);
                                return null;
                            }
                        }
                    }
                } catch (err) {
                    console.error(`Error in op for account ${accObj.address} (${type}):`, err);
                    throw err;
                }
            }));
        }

        await Promise.all(ops);
        process.stdout.write('\n');

        if (failedWrites.length > 0) {
            console.log(`Retrying ${failedWrites.length} failed writes...`);
            let retryCount = 0;
            for (const { account, bundleCalls, provIdx } of failedWrites) {
                try {
                    account.provider = providers[provIdx % providers.length];
                    const estimated = await account.estimateInvokeFee(bundleCalls);
                    const maxFee = estimated.overall_fee * 12n / 10n;
                    const currentNonce = await account.getNonce('pending');
                    const executeResult = await account.execute(bundleCalls, undefined, { maxFee, nonce: BigInt(currentNonce), version: 1n });
                    writeTxHashes.push(executeResult.transaction_hash);
                    retryCount++;
                    process.stdout.write(`\rRetried transaction ${retryCount}/${failedWrites.length}` + ' '.repeat(10));
                } catch (err) {
                    console.error(`Retry failed for account ${account.address}, noting as failed:`, err);
                }
            }
            process.stdout.write('\n');
        }

        const afterBalances = await Promise.all(usedAccounts.map(async (acc, idx) => await getStrkBalance(acc.address, idx)));

        console.log('Account Balances Before/After:');
        usedAccounts.forEach((acc, idx) => {
            const before = beforeBalances[idx].toFixed(6);
            const after = afterBalances[idx].toFixed(6);
            const delta = (afterBalances[idx] - beforeBalances[idx]).toFixed(6);
            console.log(`${acc.address}: Before: ${before} STRK, After: ${after} STRK, Delta: ${delta} STRK`);
        });

    } else if (mode === 'rwr') {
        console.log(`Note: For RWR mode with batchSize=${batchSize} (number of customers), each performs read-update-read sequence. BundleSize and readRatio ignored.`);

        const limit = pLimit(concurrency);
        const ops = [];
        numReads = batchSize * 2;
        numWrites = batchSize;

        for (let b = 0; b < batchSize; b++) {
            ops.push(limit(async () => {
                // Longer delay to help with rate limiting - spread out requests
                await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 200));
                
                // Better provider distribution - use random selection to spread load
                const provIdx = Math.floor(Math.random() * providers.length);
                const prov = providers[provIdx];
                const accObj = testAccounts[b % testAccounts.length];
                const account = new Account(prov, accObj.address, accObj.privateKey);
                const contractLocal = new Contract(contractAbi, contractAddress, prov);
                try {
                    const initialBalance = await contractLocal.call('get_balance', [accObj.address], { blockIdentifier: 'latest' });
                    const initialValue = BigInt(initialBalance).toString();

                    const bundleCalls = [];
                    for (let i = 0; i < bundleSize; i++) {
                        bundleCalls.push(contractLocal.populate('update_balance', { new_balance: BigInt(b + i + 1) }));
                    }
                    const estimated = await account.estimateInvokeFee(bundleCalls);
                    const maxFee = estimated.overall_fee * 12n / 10n;  // 20% buffer
                    
                    // Retry logic for rate limit errors
                    let executeResult;
                    let retryCount = 0;
                    const maxRetries = 3;
                    
                    while (retryCount < maxRetries) {
                        try {
                            executeResult = await account.execute(bundleCalls, undefined, { maxFee, version: 1n });
                            break;
                        } catch (err) {
                            if (err.toString().includes('Rate limit reached') && retryCount < maxRetries - 1) {
                                retryCount++;
                                console.log(`Rate limit hit for customer ${b + 1}, retrying with different provider (attempt ${retryCount}/${maxRetries})`);
                                // Switch to a different provider for retry
                                const newProvIdx = (provIdx + retryCount) % providers.length;
                                const newProv = providers[newProvIdx];
                                account.provider = newProv;
                                contractLocal.provider = newProv;
                                // Add longer delay before retry
                                await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
                                continue;
                            }
                            throw err;
                        }
                    }
                    
                    if (!executeResult) {
                        throw new Error(`Failed to execute transaction after ${maxRetries} retries`);
                    }
                    
                    writeTxHashes.push(executeResult.transaction_hash);
                    console.log(`Customer ${b + 1} tx hash: ${executeResult.transaction_hash}`);

                    return { 
                        customerId: b + 1, 
                        address: accObj.address, 
                        initialBalance: initialValue, 
                        txHash: executeResult.transaction_hash 
                    };
                } catch (err) {
                    console.error(`Error in RWR for account ${accObj.address}:`, err);
                    throw err;
                }
            }));
        }

        const results = await Promise.all(ops);
        
        // Wait for all transactions to be confirmed
        console.log('\nWaiting for all transactions to be confirmed...');
        const receiptPromises = writeTxHashes.map(async (hash, idx) => {
            try {
                const prov = providers[idx % providers.length];
                const receipt = await prov.waitForTransaction(hash);
                return receipt;
            } catch (err) {
                console.error(`Error waiting for tx ${hash}:`, err);
                return null;
            }
        });
        const receipts = await Promise.all(receiptPromises);
        validReceipts = receipts.filter(r => r);
        console.log(`Confirmed ${validReceipts.length}/${writeTxHashes.length} transactions`);
        
        // Batch read final balances for all customers
        console.log('Reading final balances for all customers...');
        const finalBalancePromises = results.map(async (result, idx) => {
            try {
                const prov = providers[idx % providers.length];
                const contractLocal = new Contract(contractAbi, contractAddress, prov);
                const finalBalance = await contractLocal.call('get_balance', [result.address], { blockIdentifier: 'latest' });
                const finalValue = BigInt(finalBalance).toString();
                console.log(`Customer ${result.customerId}: Initial: ${result.initialBalance}, Final: ${finalValue}`);
                return { ...result, finalBalance: finalValue };
            } catch (err) {
                console.error(`Error reading final balance for customer ${result.customerId}:`, err);
                return { ...result, finalBalance: 'ERROR' };
            }
        });
        
        const finalResults = await Promise.all(finalBalancePromises);
    } else {
        throw new Error(`Unknown mode: ${mode}`);
    }

    const submitEndTime = Date.now();

    if (mode === 'blend') {
        // Confirmation already handled in blend mode above
    }

    const endTime = Date.now();

    const submitElapsed = (submitEndTime - startTime) / 1000;
    const confirmElapsed = (endTime - submitEndTime) / 1000;
    const totalElapsed = (endTime - startTime) / 1000;
    const overallOPS = (numReads + numWrites) / totalElapsed;
    const submitOPS = (numReads + numWrites) / submitElapsed;
    const chainTPS = numWrites / confirmElapsed;
    let totalCostStrk = 0;
    validReceipts.forEach(r => {
        if (r && r.actual_fee) {
            const feeBigInt = (BigInt(r.actual_fee.high || 0) << 128n) + BigInt(r.actual_fee.low || 0);
            totalCostStrk += Number(feeBigInt) / 1e18;
        }
    });
    console.log(`Submit Duration: ${submitElapsed.toFixed(2)}s, Submit OPS: ${submitOPS.toFixed(2)}`);
    console.log(`Confirm Duration: ${confirmElapsed.toFixed(2)}s, Chain TPS (Writes): ${chainTPS.toFixed(2)}`);
    console.log(`Total Duration: ${totalElapsed.toFixed(2)}s, Overall OPS: ${overallOPS.toFixed(2)}`);
    console.log(`Total Cost (STRK for Writes): ${totalCostStrk.toFixed(4)}, Successful Write Tx: ${writeTxHashes.length}`);
    console.log(`Reads: ${numReads}, Writes: ${numWrites}`);

    const contract = new Contract(contractAbi, contractAddress, providers[0]);
    const batchId = '0x' + crypto.randomBytes(8).toString('hex');
    const batchType = mode === 'blend' ? 'Mixed Read/Write Update' : 'Read-Write-Read Sequence';
    const batchTypeFelt = shortString.encodeShortString(batchType);
    const batchInfoCall = contract.populate('set_batch_info', {
        info: {
            batch_id: batchId,
            batch_type: batchTypeFelt,
            num_items: BigInt(batchSize),
            cost: BigInt(Math.round(totalCostStrk * 1e18)),
            elapsed_seconds: BigInt(Math.floor(totalElapsed))
        }
    });
    const testAccount = new Account(providers[0], testAccounts[0].address, testAccounts[0].privateKey, 1);
    const estimated = await testAccount.estimateInvokeFee(batchInfoCall);
    const maxFee = estimated.overall_fee * 12n / 10n;
    const tx = await testAccount.execute(batchInfoCall, undefined, { maxFee, version: 1n });
    await providers[0].waitForTransaction(tx.transaction_hash);
    console.log(`Batch info stored with ID: ${batchId}`);
}

// Parse command-line args
const args = process.argv.slice(2);
const batchSizeArg = parseInt(args[0]) || 50;
const bundleSizeArg = parseInt(args[1]) || 1;
const readRatioArg = parseFloat(args[2]) || 0.2;
const modeArg = args[3] || 'blend';
const concurrencyArg = parseInt(args[4]) || 10; // Reduced default concurrency

// Run
(async () => {
    await runBatchTest(testAccounts, batchSizeArg, bundleSizeArg, readRatioArg, modeArg, concurrencyArg);
})().catch(console.error);
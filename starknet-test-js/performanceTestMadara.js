const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config({ silent: true });

// Suppress V3 transaction warnings - starknet.js v6.19.0 doesn't support V3 yet
const originalWarn = console.warn;
console.warn = (...args) => {
    const message = args.join(' ');
    if (message.includes('deprecated transaction version') || message.includes('V0,V1,V2')) {
        // Suppress these specific warnings
        return;
    }
    originalWarn.apply(console, args);
};

const { Provider, Account, ec, json, constants, CallData, Contract, shortString } = require('starknet');

// Madara L3 RPC endpoint - use v0_8_0 format for compatibility with starknet.js v6.19.0
const defaultNodeUrl = process.env.NODE_URL || 'http://localhost:9944/v0_8_0';
// Create multiple provider connections for better parallelism and throughput
// Multiple connections to the same endpoint can help with connection pooling
const numProviders = parseInt(process.env.NUM_PROVIDERS || '3');
const providers = Array.from({ length: numProviders }, () => new Provider({ nodeUrl: defaultNodeUrl }));
console.log(`Using ${numProviders} provider connection(s) for better parallelism`);

const funderPrivateKey = process.env.FUNDER_PRIVATE_KEY || '0x04eb9093c6bc934e99dbdf1f2258e7d101da3c8503ef38e55f40964e15b155a8';
const funderAddress = process.env.FUNDER_ADDRESS || '0x0764a2fe39643b6ef291883d14676ebc09f3f27fbea24fbf49cfa7976f97bc4c';
const strkTokenAddress = process.env.STRK_TOKEN_ADDRESS || '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
// Updated contract address for Madara deployment
const contractAddress = process.env.CONTRACT_ADDRESS || '0x5b15ce020157c212f79d9ad5f05aa741cbcae763b6d4acc18c6832cb204ddbd';

// Support both container (/pt) and host paths
const abiPath = process.env.CONTRACT_ABI_PATH || (fs.existsSync('/pt/ABI/performancetestABI.json') 
    ? '/pt/ABI/performancetestABI.json' 
    : '/Users/seanevans/Documents/ssp/pt/ABI/performancetestABI.json');
const contractAbi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));

// Use ONLY Madara pre-deployed accounts for testing
// This skips the test accounts that fail to deploy due to sequencer issues
// These accounts have 10,000 STRK each and are already deployed
const madaraPreDeployedAccounts = [
  {
    address: '0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d',
    privateKey: '0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07',
    name: 'Account #1'
  },
  {
    address: '0x008a1719e7ca19f3d91e8ef50a48fc456575f645497a1d55f30e3781f786afe4',
    privateKey: '0x0514977443078cf1e0c36bc88b89ada9a46061a5cf728f40274caea21d76f174',
    name: 'Account #2'
  },
  {
    address: '0x0733a8e2bcced14dcc2608462bd96524fb64eef061689b6d976708efc2c8ddfd',
    privateKey: '0x00177100ae65c71074126963e695e17adf5b360146f960378b5cdfd9ed69870b',
    name: 'Account #3'
  },
  {
    address: '0x025073e0772b1e348a5da66ea67fb46f75ecdca1bd24dbbc98567cbf4a0e00b3',
    privateKey: '0x07ae55c8093920562c1cbab9edeb4eb52f788b93cac1d5721bda20c96100d743',
    name: 'Account #4'
  },
  {
    address: '0x0294f066a54e07616fd0d50c935c2b5aa616d33631fec94b34af8bd4f6296f68',
    privateKey: '0x02ce1754eb64b7899c64dcdd0cff138864be2514e70e7761c417b728f2bf7457',
    name: 'Account #5'
  },
  {
    address: '0x005d1d65ea82aa0107286e68537adf0371601789e26b1cd6e455a8e5be5c5665',
    privateKey: '0x037a683c3969bf18044c9d2bbe0b1739897c89cf25420342d6dfc36c30fc519d',
    name: 'Account #6'
  },
  {
    address: '0x01d775883a0a6e5405a345f18d7639dcb54b212c362d5a99087f742fba668396',
    privateKey: '0x07b4a2263d9cc475816a03163df7efd58552f1720c8df0bd2a813663895ef022',
    name: 'Account #7'
  },
  {
    address: '0x04add50f5bcc31a8418b43b1ddc8d703986094baf998f8e9625e13dbcc3df18b',
    privateKey: '0x064b37f84e667462b95dc56e3c5e93a703ef16d73de7b9c5bfd92b90f11f90e1',
    name: 'Account #8'
  },
  {
    address: '0x03dbe3dd8c2f721bc24e87bcb739063a10ee738cef090bc752bc0d5a29f10b72',
    privateKey: '0x0213d0d77d5ff9ffbeabdde0af7513e89aafd5e36ae99b8401283f6f57c57696',
    name: 'Account #9'
  }
  // Account #10 data appears incomplete - using 9 accounts for now
];

// Format Madara pre-deployed accounts
let testAccounts = madaraPreDeployedAccounts.map(acc => ({
  address: acc.address,
  privateKey: acc.privateKey.startsWith('0x') ? acc.privateKey : '0x' + acc.privateKey
}));

console.log(`Using ONLY ${testAccounts.length} Madara pre-deployed accounts for performance testing`);
console.log(`(Skipping test accounts due to deployment issues)`);

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

async function checkAccountExists(address, prov) {
    try {
        // Try to get nonce - if account exists, this will succeed
        const account = new Account(prov, address, '0x0'); // Dummy private key just for checking
        await account.getNonce('latest');
        return true;
    } catch (err) {
        if (err.message && err.message.includes('Contract not found')) {
            return false;
        }
        // If it's a different error, assume account might exist
        return true;
    }
}

async function runBatchTest(testAccounts, batchSize = 50, bundleSize = 1, readRatio = 0.2, mode = 'blend', concurrency = 5) {
    console.log(`Using pre-funded existing accounts = ${testAccounts.length}`);
    console.log(`Mode: ${mode}`);

    const pLimit = (await import('p-limit')).default;
    
    // Filter to only accounts that are actually deployed on Madara
    console.log('\nChecking which accounts are deployed on Madara...');
    const deployedCheckLimit = pLimit(concurrency);
    const deployedChecks = testAccounts.map((acc, idx) => 
        deployedCheckLimit(async () => {
            try {
                const exists = await checkAccountExists(acc.address, providers[idx % providers.length]);
                if (exists) {
                    console.log(`  ✅ Account ${acc.address.substring(0, 20)}... is deployed`);
                    return acc;
                } else {
                    console.log(`  ❌ Account ${acc.address.substring(0, 20)}... is NOT deployed (skipping)`);
                    return null;
                }
            } catch (err) {
                console.log(`  ❌ Error checking ${acc.address.substring(0, 20)}...: ${err.message} (skipping)`);
                return null;
            }
        })
    );
    const deployedAccounts = (await Promise.all(deployedChecks)).filter(Boolean);
    
    if (deployedAccounts.length === 0) {
        throw new Error('No deployed accounts found on Madara. Please deploy account contracts first.');
    }
    
    console.log(`\nUsing ${deployedAccounts.length} deployed accounts (out of ${testAccounts.length} total)`);
    
    // Accounts will be reused if batchSize > account count (supported for performance testing)
    if (deployedAccounts.length < batchSize) {
        console.log(`Note: batchSize (${batchSize}) > deployed accounts (${deployedAccounts.length}). Accounts will be reused.`);
    }
    
    // Use only deployed accounts
    testAccounts = deployedAccounts;

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
    // Accounts will be reused if batchSize > account count (supported for performance testing)
    if (sufficientAccounts.length < batchSize) {
        console.log(`Note: batchSize (${batchSize}) > sufficient accounts (${sufficientAccounts.length}). Accounts will be reused.`);
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
                // No delay - fire immediately for maximum throughput
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

        // Pre-read initial balances and nonces for all unique accounts
        // Use optimistic nonce assignment for true parallelism (no serialization!)
        console.log('Pre-reading initial balances and nonces for all accounts...');
        const uniqueAccountBalances = new Map();
        const accountBaseNonces = new Map(); // Base nonce per account (fetched once)
        const accountNonceCounters = new Map(); // Atomic counter per account for optimistic nonce assignment
        
        // Pre-fetch balance and nonce for each unique account
        const preFetchPromises = testAccounts.map(async (accObj, idx) => {
            const prov = providers[idx % providers.length];
            const contractLocal = new Contract(contractAbi, contractAddress, prov);
            const account = new Account(prov, accObj.address, accObj.privateKey);
            try {
                const [balanceResult, baseNonce] = await Promise.all([
                    contractLocal.call('get_balance', [accObj.address], { blockIdentifier: 'latest' }),
                    account.getNonce('latest') // Use 'latest' for base nonce
                ]);
                const initialValue = BigInt(balanceResult).toString();
                uniqueAccountBalances.set(accObj.address, initialValue);
                accountBaseNonces.set(accObj.address, baseNonce);
                accountNonceCounters.set(accObj.address, 0); // Initialize counter
                return { accObj, initialValue, baseNonce };
            } catch (err) {
                console.error(`Error pre-fetching for ${accObj.address}:`, err);
                uniqueAccountBalances.set(accObj.address, '0');
                accountBaseNonces.set(accObj.address, 0n);
                accountNonceCounters.set(accObj.address, 0);
                return { accObj, initialValue: '0', baseNonce: 0n };
            }
        });
        await Promise.all(preFetchPromises);
        console.log(`Pre-fetched balances and nonces for ${uniqueAccountBalances.size} accounts`);

        // Submit all transactions in parallel with optimistic nonce assignment (TRUE parallelism!)
        // No serialization - all transactions fire simultaneously
        for (let b = 0; b < batchSize; b++) {
            ops.push(limit(async () => {
                // Fire immediately - no delays, no serialization!
                const provIdx = b % providers.length;
                const prov = providers[provIdx];
                const accObj = testAccounts[b % testAccounts.length];
                const initialValue = uniqueAccountBalances.get(accObj.address) || '0';
                
                // Optimistic nonce assignment: baseNonce + atomic counter
                const baseNonce = accountBaseNonces.get(accObj.address) || 0n;
                const counter = accountNonceCounters.get(accObj.address) || 0;
                const optimisticNonce = baseNonce + BigInt(counter);
                accountNonceCounters.set(accObj.address, counter + 1); // Atomic increment
                
                const account = new Account(prov, accObj.address, accObj.privateKey);
                const contractLocal = new Contract(contractAbi, contractAddress, prov);
                try {
                    const bundleCalls = [];
                    for (let i = 0; i < bundleSize; i++) {
                        bundleCalls.push(contractLocal.populate('update_balance', { new_balance: BigInt(b + i + 1) }));
                    }
                    const estimated = await account.estimateInvokeFee(bundleCalls);
                    const maxFee = estimated.overall_fee * 12n / 10n;  // 20% buffer
                    
                    // Use optimistic nonce - submit immediately!
                    let executeResult;
                    let retryCount = 0;
                    const maxRetries = 5; // More retries for optimistic approach
                    let currentNonce = optimisticNonce;
                    
                    while (retryCount < maxRetries) {
                        try {
                            executeResult = await account.execute(bundleCalls, undefined, { 
                                maxFee, 
                                nonce: currentNonce
                            });
                            break;
                        } catch (err) {
                            const isNonceError = err.toString().includes('Invalid transaction nonce') || 
                                                 err.toString().includes('nonce') ||
                                                 err.toString().includes('NonceTooLow') ||
                                                 err.toString().includes('already exists');
                            const isRateLimit = err.toString().includes('Rate limit reached') || 
                                               err.toString().includes('-32097');
                            const isServerError = err.toString().includes('Internal server error') ||
                                                 err.toString().includes('500') ||
                                                 (err.baseError && err.baseError.code === 500);
                            
                            // Retry on transient errors
                            if ((isNonceError || isRateLimit || isServerError) && retryCount < maxRetries - 1) {
                                retryCount++;
                                // Switch provider for retry
                                const newProvIdx = (provIdx + retryCount) % providers.length;
                                const newProv = providers[newProvIdx];
                                account.provider = newProv;
                                contractLocal.provider = newProv;
                                
                                // Refresh nonce on retry - fetch fresh nonce if optimistic one failed
                                if (isNonceError || isServerError) {
                                    try {
                                        const freshNonce = await account.getNonce('pending');
                                        // Use fresh nonce, but ensure it's >= our optimistic one
                                        currentNonce = freshNonce > optimisticNonce ? freshNonce : optimisticNonce + BigInt(retryCount);
                                    } catch (nonceErr) {
                                        // Fallback: increment optimistic nonce
                                        currentNonce = optimisticNonce + BigInt(retryCount);
                                    }
                                }
                                // Minimal delay only on actual errors
                                const delay = isRateLimit ? 100 * retryCount : 
                                             isServerError ? 50 * retryCount : 
                                             25 * retryCount;
                                await new Promise(resolve => setTimeout(resolve, delay));
                                continue;
                            }
                            throw err;
                        }
                    }
                    
                    if (!executeResult) {
                        console.error(`\n⚠️  Failed transaction ${b + 1} after ${maxRetries} retries`);
                        return null;
                    }
                    
                    writeTxHashes.push(executeResult.transaction_hash);
                    
                    // Progress logging
                    if ((b + 1) % 20 === 0 || (b + 1) === batchSize) {
                        process.stdout.write(`\rSubmitted ${b + 1}/${batchSize} transactions...`);
                    }
                    return { 
                        customerId: b + 1, 
                        address: accObj.address, 
                        initialBalance: initialValue, 
                        txHash: executeResult.transaction_hash 
                    };
                } catch (err) {
                    console.error(`\n⚠️  Error for account ${accObj.address.substring(0, 10)}...:`, err.message || err);
                    return null;
                }
            }));
        }

        const results = await Promise.all(ops);
        
        // Filter out null results (failed transactions)
        const validResults = results.filter(r => r !== null);
        const failedCount = results.length - validResults.length;
        if (failedCount > 0) {
            console.log(`\n⚠️  ${failedCount} transaction(s) failed, but continuing with ${validResults.length} successful ones...`);
        }
        
        // Wait for all transactions to be confirmed with progress logging
        console.log('\nWaiting for all transactions to be confirmed...');
        const confirmLimit = pLimit(10); // Limit concurrent confirmation checks to avoid overwhelming Madara
        let confirmedCount = 0;
        const confirmLock = {}; // Simple lock for counter increment
        
        // Progress logging function
        const logProgress = () => {
            if (confirmedCount % 10 === 0 || confirmedCount === writeTxHashes.length) {
                process.stdout.write(`\rConfirmed ${confirmedCount}/${writeTxHashes.length} transactions...`);
            }
        };
        
        const receiptPromises = writeTxHashes.map(async (hash, idx) => {
            return confirmLimit(async () => {
                try {
                    const prov = providers[idx % providers.length];
                    // waitForTransaction should work with default config in v6.19.0
                    const receipt = await prov.waitForTransaction(hash);
                    // Thread-safe counter increment
                    if (!confirmLock[hash]) {
                        confirmLock[hash] = true;
                        confirmedCount++;
                        logProgress();
                    }
                    return receipt;
                } catch (err) {
                    console.error(`\nError waiting for tx ${hash.substring(0, 10)}...:`, err.message);
                    return null;
                }
            });
        });
        const receipts = await Promise.all(receiptPromises);
        validReceipts = receipts.filter(r => r);
        process.stdout.write('\n'); // New line after progress
        console.log(`Confirmed ${validReceipts.length}/${writeTxHashes.length} transactions`);
        
        // Batch read final balances for all customers (only for successful transactions)
        console.log('Reading final balances for all customers...');
        const finalBalancePromises = validResults.map(async (result, idx) => {
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
    
    // Calculate actual successful operations (only count successful transactions)
    const actualSuccessfulWrites = writeTxHashes.length;
    const actualSuccessfulReads = mode === 'rwr' ? actualSuccessfulWrites * 2 : numReads; // RWR: 2 reads per successful write
    
    // Recalculate OPS based on successful operations only
    const overallOPS = actualSuccessfulReads + actualSuccessfulWrites > 0 ? 
                       (actualSuccessfulReads + actualSuccessfulWrites) / totalElapsed : 0;
    const submitOPS = actualSuccessfulReads + actualSuccessfulWrites > 0 ? 
                      (actualSuccessfulReads + actualSuccessfulWrites) / submitElapsed : 0;
    const chainTPS = actualSuccessfulWrites > 0 && confirmElapsed > 0 ? 
                     actualSuccessfulWrites / confirmElapsed : 
                     (confirmElapsed === 0 ? Infinity : 0);
    
    let totalCostStrk = 0;
    validReceipts.forEach(r => {
        if (r && r.actual_fee) {
            const feeBigInt = (BigInt(r.actual_fee.high || 0) << 128n) + BigInt(r.actual_fee.low || 0);
            totalCostStrk += Number(feeBigInt) / 1e18;
        }
    });
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`PERFORMANCE RESULTS (Based on Successful Transactions Only)`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Submit Duration: ${submitElapsed.toFixed(2)}s, Submit OPS: ${submitOPS.toFixed(2)}`);
    console.log(`Confirm Duration: ${confirmElapsed.toFixed(2)}s, Chain TPS (Writes): ${chainTPS === Infinity ? 'Infinity' : chainTPS.toFixed(2)}`);
    console.log(`Total Duration: ${totalElapsed.toFixed(2)}s, Overall OPS: ${overallOPS.toFixed(2)}`);
    console.log(`Total Cost (STRK for Writes): ${totalCostStrk.toFixed(4)}, Successful Write Tx: ${actualSuccessfulWrites}`);
    console.log(`Successful Reads: ${actualSuccessfulReads}, Successful Writes: ${actualSuccessfulWrites}`);
    if (mode === 'rwr' && batchSize > actualSuccessfulWrites) {
        const failedWrites = batchSize - actualSuccessfulWrites;
        console.log(`⚠️  Note: ${failedWrites} transaction(s) failed out of ${batchSize} attempted`);
        console.log(`    OPS calculated using only ${actualSuccessfulWrites} successful transactions`);
    }
    console.log(`${'='.repeat(60)}\n`);

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
// Default concurrency: auto-scale with account count, minimum 9 for performance
const defaultConcurrency = Math.max(testAccounts.length, 9);
const concurrencyArg = parseInt(args[4]) || defaultConcurrency;

// Run
(async () => {
    await runBatchTest(testAccounts, batchSizeArg, bundleSizeArg, readRatioArg, modeArg, concurrencyArg);
})().catch(console.error);

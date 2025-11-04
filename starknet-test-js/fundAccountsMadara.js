const fs = require('fs');
require('dotenv').config({ silent: true });
const { Provider, Account, ec, CallData } = require('starknet');

// Madara L3 RPC endpoint
const defaultNodeUrl = process.env.NODE_URL || 'http://localhost:9944/v0_8_0';
const provider = new Provider({ nodeUrl: defaultNodeUrl });

// Madara pre-deployed Account 1 (has 10000 STRK, 10000 ETH)
const madaraFunderAddress = '0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d';
const madaraFunderPrivateKey = '0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07';
const strkTokenAddress = process.env.STRK_TOKEN_ADDRESS || '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

// Load test accounts
const accountsPath = fs.existsSync('/pt/scripts/test_accounts.json')
    ? '/pt/scripts/test_accounts.json'
    : '/Users/seanevans/Documents/ssp/pt/scripts/test_accounts.json';
const testAccounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8')).map(acc => ({
  address: acc.address,
  privateKey: acc.private_key.startsWith('0x') ? acc.private_key : '0x' + acc.private_key
}));

// Funding parameters
const FUND_AMOUNT = 1n * 10n ** 18n; // 1 STRK per account
const MIN_BALANCE = 0.05; // Minimum balance threshold (in STRK)
const CONCURRENCY = 1; // Number of parallel funding operations (use 1 to avoid nonce conflicts)

async function getStrkBalance(address) {
    const call = {
        contractAddress: strkTokenAddress,
        entrypoint: 'balance_of',
        calldata: CallData.compile({ account: address })
    };
    const result = await provider.callContract(call, { blockIdentifier: 'latest' });
    const balanceLow = BigInt(result[0]);
    const balanceHigh = BigInt(result[1]);
    const balance = (balanceHigh << 128n) + balanceLow;
    return Number(balance) / 1e18;
}

async function fundAccount(fromAccount, toAddress, amount) {
    const call = {
        contractAddress: strkTokenAddress,
        entrypoint: 'transfer',
        calldata: CallData.compile({ recipient: toAddress, amount: { low: amount, high: 0n } })
    };
    const estimated = await fromAccount.estimateInvokeFee(call);
    const maxFee = estimated.overall_fee * 12n / 10n; // 20% buffer
    // Get current nonce explicitly
    const nonce = await fromAccount.getNonce('pending');
    const tx = await fromAccount.execute(call, undefined, { maxFee, nonce: BigInt(nonce), version: 1n });
    await provider.waitForTransaction(tx.transaction_hash);
    return tx.transaction_hash;
}

async function main() {
    console.log('='.repeat(60));
    console.log('Funding Test Accounts on Madara L3');
    console.log('='.repeat(60));
    console.log(`Funder: ${madaraFunderAddress}`);
    console.log(`Test Accounts: ${testAccounts.length}`);
    console.log(`Funding Amount: ${Number(FUND_AMOUNT) / 1e18} STRK per account`);
    console.log(`Minimum Balance Threshold: ${MIN_BALANCE} STRK`);
    console.log('='.repeat(60));

    // Create funder account
    const funderAccount = new Account(provider, madaraFunderAddress, madaraFunderPrivateKey);

    // Check funder balance
    const funderBalance = await getStrkBalance(madaraFunderAddress);
    console.log(`\nFunder balance: ${funderBalance.toFixed(4)} STRK`);
    
    const totalNeeded = Number(FUND_AMOUNT) * testAccounts.length / 1e18;
    console.log(`Total funding needed: ${totalNeeded.toFixed(4)} STRK`);
    
    if (funderBalance < totalNeeded + 1) { // +1 for fees
        console.warn(`⚠️  Warning: Funder may not have enough balance. Continuing anyway...`);
    }

    // Check current balances
    console.log('\nChecking current balances...');
    const pLimit = (await import('p-limit')).default;
    const limit = pLimit(CONCURRENCY);
    const balanceChecks = testAccounts.map((acc, idx) => 
        limit(async () => {
            try {
                const balance = await getStrkBalance(acc.address);
                return { account: acc, balance, needsFunding: balance < MIN_BALANCE };
            } catch (err) {
                console.error(`Error checking balance for ${acc.address}:`, err.message);
                return { account: acc, balance: 0, needsFunding: true };
            }
        })
    );
    const balanceResults = await Promise.all(balanceChecks);

    // Filter accounts that need funding
    const accountsToFund = balanceResults.filter(r => r.needsFunding);
    console.log(`\nAccounts needing funding: ${accountsToFund.length} / ${testAccounts.length}`);
    
    if (accountsToFund.length === 0) {
        console.log('✅ All accounts already have sufficient balance!');
        return;
    }

    // Fund accounts
    console.log(`\nFunding ${accountsToFund.length} accounts...`);
    let fundedCount = 0;
    let failedCount = 0;
    const fundingLimit = pLimit(CONCURRENCY);

    const fundingOps = accountsToFund.map(({ account }, idx) =>
        fundingLimit(async () => {
            try {
                console.log(`\n[${idx + 1}/${accountsToFund.length}] Funding ${account.address.substring(0, 16)}...`);
                const txHash = await fundAccount(funderAccount, account.address, FUND_AMOUNT);
                fundedCount++;
                const balance = await getStrkBalance(account.address);
                console.log(`  ✅ Success! TX: ${txHash.substring(0, 16)}... Balance: ${balance.toFixed(4)} STRK`);
                return { address: account.address, success: true, txHash, balance };
            } catch (err) {
                failedCount++;
                console.error(`  ❌ Failed to fund ${account.address}:`, err.message);
                return { address: account.address, success: false, error: err.message };
            }
        })
    );

    const results = await Promise.all(fundingOps);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('Funding Summary');
    console.log('='.repeat(60));
    console.log(`Successfully funded: ${fundedCount} accounts`);
    console.log(`Failed: ${failedCount} accounts`);
    
    // Verify final balances
    if (fundedCount > 0) {
        console.log('\nVerifying final balances...');
        const verificationLimit = pLimit(CONCURRENCY);
        const verificationOps = results.filter(r => r.success).map(({ address }) =>
            verificationLimit(async () => {
                const balance = await getStrkBalance(address);
                return { address, balance, sufficient: balance >= MIN_BALANCE };
            })
        );
        const verifications = await Promise.all(verificationOps);
        const sufficient = verifications.filter(v => v.sufficient).length;
        console.log(`Accounts with sufficient balance: ${sufficient}/${verifications.length}`);
        
        if (sufficient < verifications.length) {
            console.warn(`⚠️  ${verifications.length - sufficient} accounts may still need more funding`);
        }
        
        // Show sample balances
        console.log('\nSample account balances:');
        const sampleSize = Math.min(5, verifications.length);
        for (let i = 0; i < sampleSize; i++) {
            const v = verifications[i];
            console.log(`  ${v.address.substring(0, 20)}...: ${v.balance.toFixed(4)} STRK`);
        }
    }

    console.log('='.repeat(60));
    console.log('\n✅ Funding complete! You can now run the performance test.');
}

main().catch(console.error);


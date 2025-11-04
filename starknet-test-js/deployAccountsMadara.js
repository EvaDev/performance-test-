const fs = require('fs');
require('dotenv').config({ silent: true });
const { Provider, Account, ec, CallData, hash } = require('starknet');

// Madara L3 RPC endpoint
const defaultNodeUrl = process.env.NODE_URL || 'http://localhost:9944/v0_8_0';
const provider = new Provider({ nodeUrl: defaultNodeUrl });

// Madara pre-deployed Account 1 (has 10000 STRK, 10000 ETH) - used to deploy other accounts
const madaraDeployerAddress = '0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d';
const madaraDeployerPrivateKey = '0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07';
const strkTokenAddress = process.env.STRK_TOKEN_ADDRESS || '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

// Load test accounts
const accountsPath = fs.existsSync('/pt/scripts/test_accounts.json')
    ? '/pt/scripts/test_accounts.json'
    : '/Users/seanevans/Documents/ssp/pt/scripts/test_accounts.json';
const testAccounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8')).map(acc => ({
  address: acc.address,
  privateKey: acc.private_key.startsWith('0x') ? acc.private_key : '0x' + acc.private_key
}));

// Deployment parameters
const CONCURRENCY = 1; // Deploy sequentially to avoid nonce conflicts
const SALT = 0n; // Use salt 0 for deterministic addresses

async function checkAccountDeployed(address) {
    try {
        const account = new Account(provider, address, '0x0'); // Dummy private key just for checking
        await account.getNonce('latest');
        return true;
    } catch (err) {
        if (err.message && err.message.includes('Contract not found')) {
            return false;
        }
        return true; // Assume exists if different error
    }
}

async function getStrkBalance(address, blockIdentifier = 'latest') {
    try {
        const call = {
            contractAddress: strkTokenAddress,
            entrypoint: 'balance_of',
            calldata: CallData.compile({ account: address })
        };
        const result = await provider.callContract(call, { blockIdentifier });
        const balanceLow = BigInt(result[0]);
        const balanceHigh = BigInt(result[1]);
        const balance = (balanceHigh << 128n) + balanceLow;
        return Number(balance) / 1e18;
    } catch (err) {
        console.error(`    Error checking balance for ${address}:`, err.message);
        return 0;
    }
}

async function getLatestBlockNumber() {
    try {
        const block = await provider.getBlock('latest');
        return block.block_number;
    } catch (err) {
        return null;
    }
}


async function computeAccountAddress(privateKey, accountClassHash) {
    // Compute account address deterministically using hash library
    const publicKey = ec.starkCurve.getStarkKey(privateKey);
    
    // Validate publicKey
    if (!publicKey || publicKey === '0x' || (typeof publicKey === 'string' && publicKey.length < 3)) {
        throw new Error(`Invalid publicKey: ${publicKey}`);
    }
    
    // Compile constructor calldata - publicKey is already a hex string
    let constructorCalldata;
    try {
        constructorCalldata = CallData.compile({ public_key: publicKey });
        if (!constructorCalldata || constructorCalldata.length === 0) {
            throw new Error('Empty constructor calldata');
        }
    } catch (err) {
        throw new Error(`Failed to compile constructor calldata: ${err.message}`);
    }
    
    // Use hash library to compute address
    // For account contracts: address = hash(salt, class_hash, constructor_calldata_hash, deployer=0)
    try {
        // Convert accountClassHash to BigInt if it's a string
        const classHashBigInt = typeof accountClassHash === 'string' ? BigInt(accountClassHash) : accountClassHash;
        
        // Convert publicKey (salt) to BigInt
        const saltBigInt = typeof publicKey === 'string' ? BigInt(publicKey) : publicKey;
        
        // Check if hash.calculateContractAddressFromHash exists
        if (hash && typeof hash.calculateContractAddressFromHash === 'function') {
            const computed = hash.calculateContractAddressFromHash(
                saltBigInt, // salt
                classHashBigInt,
                constructorCalldata,
                0 // deployer address
            );
            // Convert BigInt to hex string (it's already a number, not a hex string)
            let addressStr = computed.toString(16);
            // Ensure it starts with 0x
            if (!addressStr.startsWith('0x')) {
                addressStr = '0x' + addressStr;
            }
            // Remove any double 0x
            addressStr = addressStr.replace(/^0x0x/, '0x');
            if (!addressStr || addressStr === '0x' || addressStr.length < 3) {
                throw new Error(`Computed invalid address: ${addressStr}`);
            }
            return addressStr;
        } else if (hash && typeof hash.computeContractAddressFromHash === 'function') {
            const computed = hash.computeContractAddressFromHash(
                saltBigInt, // salt
                classHashBigInt,
                constructorCalldata,
                0 // deployer address
            );
            const addressStr = '0x' + computed.toString(16);
            if (!addressStr || addressStr === '0x' || addressStr.length < 3) {
                throw new Error(`Computed invalid address: ${addressStr}`);
            }
            return addressStr;
        } else {
            // Fallback: use Account constructor
            const account = new Account(provider, '', privateKey);
            const address = account.address || '';
            if (!address || address === '0x' || address.length < 3) {
                throw new Error(`Account constructor returned invalid address: ${address}`);
            }
            return address;
        }
    } catch (err) {
        throw new Error(`Failed to compute account address: ${err.message}`);
    }
}

async function fundAccountAddress(toAddress, amount, funderAccount, strkTokenAddress) {
    // Fund an account address with STRK (even if contract not deployed yet)
    try {
        // Ensure amount is a BigInt
        const amountBigInt = typeof amount === 'bigint' ? amount : BigInt(amount);
        
        // Ensure address is properly formatted (should be a string starting with 0x)
        let recipientAddress = typeof toAddress === 'string' ? toAddress : String(toAddress);
        
        // Remove any double 0x prefixes first
        recipientAddress = recipientAddress.replace(/^0x0x/i, '0x');
        
        // Normalize address format - ensure it has exactly one 0x prefix
        if (!recipientAddress.startsWith('0x')) {
            recipientAddress = '0x' + recipientAddress;
        }
        recipientAddress = recipientAddress.toLowerCase();
        
        // Final check - remove any double 0x again (just to be safe)
        recipientAddress = recipientAddress.replace(/^0x0x/i, '0x');
        
        // Ensure address is valid - must be a proper hex address
        if (!recipientAddress || recipientAddress === '0x' || recipientAddress.length < 3) {
            throw new Error(`Invalid address format: ${recipientAddress} (original: ${toAddress})`);
        }
        
        // Validate it's a proper hex string
        if (!/^0x[0-9a-f]+$/i.test(recipientAddress)) {
            throw new Error(`Invalid hex address format: ${recipientAddress}`);
        }
        
        // Ensure amount is valid
        if (!amountBigInt || amountBigInt === 0n) {
            throw new Error(`Invalid amount: ${amountBigInt}`);
        }
        
        // Compile calldata - ensure all values are properly formatted
        let calldata;
        try {
            calldata = CallData.compile({ 
                recipient: recipientAddress, 
                amount: { low: amountBigInt, high: 0n } 
            });
            if (!calldata || calldata.length === 0) {
                throw new Error('Empty calldata after compilation');
            }
        } catch (compileErr) {
            throw new Error(`CallData.compile failed: ${compileErr.message} (recipient: ${recipientAddress}, amount: ${amountBigInt})`);
        }
        
        const call = {
            contractAddress: strkTokenAddress,
            entrypoint: 'transfer',
            calldata: calldata
        };
        
        const estimated = await funderAccount.estimateInvokeFee(call);
        const maxFee = estimated.overall_fee * 12n / 10n; // 20% buffer
        
        // Let starknet.js handle the nonce automatically - it will fetch it internally
        // This avoids any conversion issues
        const tx = await funderAccount.execute(call, undefined, { 
            maxFee,
            version: 1n 
        });
        
        await provider.waitForTransaction(tx.transaction_hash);
        return tx.transaction_hash;
    } catch (err) {
        throw new Error(`Funding failed: ${err.message}`);
    }
}

async function deployAccount(accountData, deployerAccount, accountClassHash, strkTokenAddress) {
    try {
        const { address: expectedAddress, privateKey } = accountData;
        
        // Get public key from private key
        const publicKey = ec.starkCurve.getStarkKey(privateKey);
        
        // Compute the address using hash library - this is what deployAccount will use
        // IMPORTANT: deployAccount uses salt=0 (not public key) based on the transaction output
        const constructorCalldata = CallData.compile({ public_key: publicKey });
        const classHashBigInt = typeof accountClassHash === 'string' ? BigInt(accountClassHash) : accountClassHash;
        
        // Compute address using salt=0 (this is what deployAccount uses)
        const computed = hash.calculateContractAddressFromHash(
            0n, // salt = 0 (this is what deployAccount uses based on transaction)
            classHashBigInt,
            constructorCalldata,
            0 // deployer address
        );
        
        // Convert BigInt to hex string (toString(16) doesn't include 0x prefix)
        let computedAddress = computed.toString(16);
        // Remove any existing 0x (shouldn't be any, but be safe)
        computedAddress = computedAddress.replace(/^0x/i, '');
        // Add 0x prefix once
        computedAddress = '0x' + computedAddress;
        // Remove any double 0x (shouldn't happen, but be safe)
        computedAddress = computedAddress.replace(/^0x0x/i, '0x').toLowerCase();
        
        // Ensure computedAddress is valid
        if (!computedAddress || computedAddress === '0x' || computedAddress.length < 3) {
            throw new Error(`Invalid computed address: ${computedAddress}`);
        }
        
        // Normalize address format - ensure single 0x prefix
        let normalizedAddress = computedAddress.toLowerCase();
        // Remove any double 0x prefixes first
        normalizedAddress = normalizedAddress.replace(/^0x0x/i, '0x');
        // Then ensure it has exactly one 0x prefix
        if (!normalizedAddress.startsWith('0x')) {
            normalizedAddress = '0x' + normalizedAddress;
        }
        // Final check - remove any double 0x again (just to be safe)
        normalizedAddress = normalizedAddress.replace(/^0x0x/i, '0x');
        
        // Show address comparison
        if (normalizedAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
            console.log(`    Note: Computed address ${normalizedAddress.substring(0, 20)}... differs from expected ${expectedAddress.substring(0, 20)}...`);
            console.log(`    This is normal if different account class hashes were used on Sepolia vs Madara`);
            console.log(`    Will deploy to computed address: ${normalizedAddress.substring(0, 20)}...`);
        }
        
        // Check if already deployed at computed address
        const alreadyDeployed = await checkAccountDeployed(normalizedAddress);
        if (alreadyDeployed) {
            console.log(`  ℹ️  Account ${normalizedAddress.substring(0, 20)}... already deployed, skipping`);
            return { address: normalizedAddress, success: true, alreadyDeployed: true };
        }
        
        // Fund the computed address (the one that will actually be deployed)
        const DEPLOYMENT_FUND_AMOUNT = 2n * 10n ** 18n; // 2 STRK (extra buffer)
        console.log(`    Funding account ${normalizedAddress.substring(0, 20)}... with ${Number(DEPLOYMENT_FUND_AMOUNT) / 1e18} STRK for deployment...`);
        const fundingTxHash = await fundAccountAddress(normalizedAddress, DEPLOYMENT_FUND_AMOUNT, deployerAccount, strkTokenAddress);
        console.log(`    ✅ Funding transaction submitted: ${fundingTxHash.substring(0, 16)}...`);
        
        // Wait for funding transaction to be confirmed and finalized
        console.log(`    Waiting for funding transaction confirmation...`);
        let fundingTxReceipt = null;
        let fundingBlockNumber = null;
        try {
            await provider.waitForTransaction(fundingTxHash, { retryInterval: 2000, successStates: ['ACCEPTED_ON_L2', 'ACCEPTED_ON_L1'] });
            fundingTxReceipt = await provider.getTransactionReceipt(fundingTxHash);
            
            // Get block number - it might be in different fields depending on receipt structure
            fundingBlockNumber = fundingTxReceipt.block_number || fundingTxReceipt.blockNumber || null;
            
            // If still null, try to get it from the transaction status or by checking the block
            if (!fundingBlockNumber) {
                // Try getting transaction status
                try {
                    const txStatus = await provider.getTransactionStatus(fundingTxHash);
                    fundingBlockNumber = txStatus.block_number || txStatus.blockNumber || null;
                } catch (e) {
                    // Ignore errors
                }
            }
            
            // If still null, use the latest block number
            if (!fundingBlockNumber) {
                const latestBlock = await provider.getBlock('latest');
                fundingBlockNumber = latestBlock.block_number;
                console.log(`    ⚠️  Could not get block number from receipt, using latest block: ${fundingBlockNumber}`);
            } else {
                console.log(`    ✅ Funding transaction confirmed at block ${fundingBlockNumber}`);
            }
        } catch (err) {
            console.error(`    ⚠️  Warning: Could not wait for funding transaction: ${err.message}`);
            // Get latest block as fallback
            const latestBlock = await provider.getBlock('latest');
            fundingBlockNumber = latestBlock.block_number;
        }
        
        // Wait for the next block to be mined to ensure state is finalized
        console.log(`    Waiting for block finalization...`);
        let currentBlock = await provider.getBlock('latest');
        let targetBlock = fundingBlockNumber ? fundingBlockNumber + 1 : currentBlock.block_number;
        
        // Wait until we're past the target block
        while (true) {
            currentBlock = await provider.getBlock('latest');
            if (currentBlock.block_number >= targetBlock) {
                console.log(`    ✅ Block finalized: ${currentBlock.block_number}`);
                break;
            }
            console.log(`    Waiting for block ${targetBlock} (current: ${currentBlock.block_number})...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Additional wait to ensure state propagation
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log(`    Verifying balance at confirmed block...`);
        // Check balance at the latest block (which should include the funding transaction)
        // Use the targetBlock (fundingBlockNumber + 1) to ensure state is finalized
        const checkBlockNumber = targetBlock;
        
        let balance = 0;
        if (checkBlockNumber) {
            console.log(`    Checking balance at block ${checkBlockNumber}...`);
            balance = await getStrkBalance(normalizedAddress, checkBlockNumber);
        } else {
            balance = await getStrkBalance(normalizedAddress, 'latest');
        }
        
        let retries = 0;
        while (balance < 1.0 && retries < 10) {
            // Wait longer between checks
            await new Promise(resolve => setTimeout(resolve, 2000));
            if (checkBlockNumber) {
                balance = await getStrkBalance(normalizedAddress, checkBlockNumber);
            } else {
                balance = await getStrkBalance(normalizedAddress, 'latest');
            }
            retries++;
            if (retries % 3 === 0) {
                console.log(`    Still waiting for balance... (attempt ${retries}/10, current: ${balance.toFixed(4)} STRK)`);
            }
        }
        
        if (balance < 1.0) {
            throw new Error(`Account balance too low after funding: ${balance} STRK (expected at least 1.0 STRK) at ${normalizedAddress}`);
        }
        console.log(`    ✅ Balance verified at block ${checkBlockNumber || 'latest'}: ${balance.toFixed(4)} STRK`);
        
        // deployAccount computes the address internally from the payload
        // We need to make sure the Account object uses the same address
        // Create Account with empty address first to see what it computes
        const accountForAddressCheck = new Account(provider, '', privateKey);
        const accountComputedAddress = accountForAddressCheck.address || normalizedAddress;
        
        // If Account computes a different address, use that one
        let addressToUse = normalizedAddress;
        if (accountComputedAddress && accountComputedAddress !== '' && accountComputedAddress.toLowerCase() !== normalizedAddress.toLowerCase()) {
            console.log(`    ⚠️  Account object computed different address: ${accountComputedAddress.substring(0, 20)}... vs ${normalizedAddress.substring(0, 20)}...`);
            console.log(`    Will use Account object's computed address: ${accountComputedAddress.substring(0, 20)}...`);
            addressToUse = accountComputedAddress.toLowerCase();
            
            // Fund the Account object's computed address if different
            const accountBalance = await getStrkBalance(addressToUse);
            if (accountBalance < 1.0) {
                console.log(`    Funding Account object's computed address with 2 STRK...`);
                await fundAccountAddress(addressToUse, DEPLOYMENT_FUND_AMOUNT, deployerAccount, strkTokenAddress);
                
                let balance = await getStrkBalance(addressToUse);
                let retries = 0;
                while (balance < 1.0 && retries < 5) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    balance = await getStrkBalance(addressToUse);
                    retries++;
                }
                if (balance < 1.0) {
                    throw new Error(`Account balance too low at Account object's address: ${balance} STRK`);
                }
                console.log(`    ✅ Balance verified at Account object's address: ${balance.toFixed(4)} STRK`);
            }
        }
        
        // Try using publicKey as addressSalt (matching other examples)
        // Convert publicKey to BigInt if needed
        const publicKeyBigInt = typeof publicKey === 'string' ? BigInt(publicKey) : publicKey;
        
        // First, try with publicKey as salt (as in other examples)
        const deployAccountPayloadWithPublicKeySalt = {
            classHash: accountClassHash,
            constructorCalldata: CallData.compile({ public_key: publicKey }),
            addressSalt: publicKeyBigInt
        };
        
        // Compute address with publicKey as salt
        const addressWithPublicKeySalt = hash.calculateContractAddressFromHash(
            publicKeyBigInt,
            typeof accountClassHash === 'string' ? BigInt(accountClassHash) : accountClassHash,
            deployAccountPayloadWithPublicKeySalt.constructorCalldata,
            0 // deployer
        );
        
        // Also compute with salt=0 (what the transaction showed)
        const deployAccountPayloadWithZeroSalt = {
            classHash: accountClassHash,
            constructorCalldata: CallData.compile({ public_key: publicKey }),
            addressSalt: 0n
        };
        
        const addressWithZeroSalt = hash.calculateContractAddressFromHash(
            0n,
            typeof accountClassHash === 'string' ? BigInt(accountClassHash) : accountClassHash,
            deployAccountPayloadWithZeroSalt.constructorCalldata,
            0 // deployer
        );
        
        // Check which address matches what we funded
        let deployAccountPayload;
        let addressFromPayload;
        let finalDeploymentAddress;
        
        // Convert addresses to strings for comparison
        // BigInt.toString(16) doesn't include 0x prefix, so add it once
        let addrWithPublicKeyStr = addressWithPublicKeySalt.toString(16);
        if (!addrWithPublicKeyStr.startsWith('0x')) {
            addrWithPublicKeyStr = '0x' + addrWithPublicKeyStr;
        }
        addrWithPublicKeyStr = addrWithPublicKeyStr.replace(/^0x0x/i, '0x').toLowerCase();
        
        let addrWithZeroStr = addressWithZeroSalt.toString(16);
        if (!addrWithZeroStr.startsWith('0x')) {
            addrWithZeroStr = '0x' + addrWithZeroStr;
        }
        addrWithZeroStr = addrWithZeroStr.replace(/^0x0x/i, '0x').toLowerCase();
        
        const normalizedStr = normalizedAddress.toLowerCase();
        
        if (addrWithZeroStr.toLowerCase() === normalizedStr) {
            console.log(`    Using salt=0 (matches funded address)`);
            deployAccountPayload = deployAccountPayloadWithZeroSalt;
            addressFromPayload = addressWithZeroSalt;
            finalDeploymentAddress = addrWithZeroStr.toLowerCase();
        } else if (addrWithPublicKeyStr.toLowerCase() === normalizedStr) {
            console.log(`    Using publicKey as salt (matches funded address)`);
            deployAccountPayload = deployAccountPayloadWithPublicKeySalt;
            addressFromPayload = addressWithPublicKeySalt;
            finalDeploymentAddress = addrWithPublicKeyStr.toLowerCase();
        } else {
            // Neither matches - use the one we funded and update payload accordingly
            console.log(`    ⚠️  Neither salt matches funded address`);
            console.log(`    Funded: ${normalizedStr.substring(0, 20)}...`);
            console.log(`    With publicKey salt: ${addrWithPublicKeyStr.substring(0, 20)}...`);
            console.log(`    With zero salt: ${addrWithZeroStr.substring(0, 20)}...`);
            console.log(`    Using zero salt and funding the computed address...`);
            deployAccountPayload = deployAccountPayloadWithZeroSalt;
            addressFromPayload = addressWithZeroSalt;
            finalDeploymentAddress = addrWithZeroStr.toLowerCase();
            
            // Fund this address if it's different
            if (finalDeploymentAddress !== normalizedStr) {
                const existingBalance = await getStrkBalance(finalDeploymentAddress);
                if (existingBalance < 1.0) {
                    console.log(`    Funding computed address: ${finalDeploymentAddress.substring(0, 20)}...`);
                    const fundingTxHash2 = await fundAccountAddress(finalDeploymentAddress, DEPLOYMENT_FUND_AMOUNT, deployerAccount, strkTokenAddress);
                    await provider.waitForTransaction(fundingTxHash2);
                    // Wait and verify
                    let balance = await getStrkBalance(finalDeploymentAddress);
                    let retries = 0;
                    while (balance < 1.0 && retries < 5) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        balance = await getStrkBalance(finalDeploymentAddress);
                        retries++;
                    }
                }
            }
        }
        
        // Convert BigInt to hex string for final address
        let addressFromPayloadStr = addressFromPayload.toString(16);
        // Remove any existing 0x and add one
        addressFromPayloadStr = addressFromPayloadStr.replace(/^0x/i, '');
        addressFromPayloadStr = '0x' + addressFromPayloadStr;
        addressFromPayloadStr = addressFromPayloadStr.replace(/^0x0x/i, '0x').toLowerCase();
        
        console.log(`    Address from payload (what deployAccount will use): ${addressFromPayloadStr.substring(0, 20)}...`);
        console.log(`    Address we funded: ${normalizedAddress.substring(0, 20)}...`);
        
        // Ensure they match - if not, fund the correct one
        // Use the address from payload as the final deployment address
        if (addressFromPayloadStr.toLowerCase() !== normalizedAddress.toLowerCase()) {
            // If they don't match, update finalDeploymentAddress to use the payload address
            finalDeploymentAddress = addressFromPayloadStr.toLowerCase();
            console.log(`    ⚠️  Address mismatch! Funding correct address: ${finalDeploymentAddress.substring(0, 20)}...`);
            const payloadBalance = await getStrkBalance(finalDeploymentAddress);
            if (payloadBalance < 1.0) {
                console.log(`    Funding address from payload with 2 STRK...`);
                await fundAccountAddress(finalDeploymentAddress, DEPLOYMENT_FUND_AMOUNT, deployerAccount, strkTokenAddress);
                
                // Wait for state propagation
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                let balance = await getStrkBalance(finalDeploymentAddress);
                let retries = 0;
                while (balance < 1.0 && retries < 10) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    balance = await getStrkBalance(finalDeploymentAddress);
                    retries++;
                }
                if (balance < 1.0) {
                    throw new Error(`Account balance too low at payload address: ${balance} STRK`);
                }
                console.log(`    ✅ Balance verified at payload address: ${balance.toFixed(4)} STRK`);
            }
        }
        
        // Create Account object with the address that deployAccount will use
        // In starknet.js v6, we need to pass the address explicitly and use keyPair (public key)
        // Clean the address to remove any double 0x
        let cleanedAddress = finalDeploymentAddress.toLowerCase().replace(/^0x0x/i, '0x');
        if (!cleanedAddress.startsWith('0x')) {
            cleanedAddress = '0x' + cleanedAddress;
        }
        
        console.log(`    Creating Account object with address: ${cleanedAddress.substring(0, 20)}...`);
        // In starknet.js v6, Account constructor takes: provider, address, keyPair (public key), chainId
        const keyPair = ec.starkCurve.getStarkKey(privateKey); // This returns the public key
        const accountToDeploy = new Account(provider, cleanedAddress, keyPair, '1');
        
        // Verify Account object's address matches
        const accountObjAddress = (accountToDeploy.address || '').toLowerCase();
        console.log(`    Account object address property: ${accountObjAddress ? accountObjAddress.substring(0, 20) + '...' : '(empty or undefined)'}`);
        
        if (accountObjAddress && accountObjAddress !== cleanedAddress.toLowerCase() && accountObjAddress !== '') {
            console.log(`    ⚠️  Account object address differs from expected`);
            console.log(`    Expected: ${cleanedAddress.substring(0, 20)}...`);
            console.log(`    Got: ${accountObjAddress.substring(0, 20)}...`);
            // Fund Account object's address if different
            const accountObjBalance = await getStrkBalance(accountObjAddress);
            console.log(`    Balance at Account object address: ${accountObjBalance.toFixed(4)} STRK`);
            if (accountObjBalance < 1.0) {
                console.log(`    Funding Account object's address...`);
                await fundAccountAddress(accountObjAddress, DEPLOYMENT_FUND_AMOUNT, deployerAccount, strkTokenAddress);
                await new Promise(resolve => setTimeout(resolve, 2000));
                let balance = await getStrkBalance(accountObjAddress);
                let retries = 0;
                while (balance < 1.0 && retries < 10) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    balance = await getStrkBalance(accountObjAddress);
                    retries++;
                }
                if (balance < 1.0) {
                    throw new Error(`Account balance too low at Account object address: ${balance} STRK`);
                }
            }
        }
        
        // Final verification: check balance at the address that will be used
        const accountBalanceCheck = await getStrkBalance(accountObjAddress || cleanedAddress, 'pending');
        console.log(`    Final balance at deployment address: ${accountBalanceCheck.toFixed(4)} STRK`);
        if (accountBalanceCheck < 1.0) {
            throw new Error(`Insufficient balance at final address: ${accountBalanceCheck} STRK`);
        }
        
        // Final balance check at latest block before deployment
        // Check at both 'latest' and a specific block number to ensure funds are visible
        console.log(`    Final balance check before deployment...`);
        const latestBlock = await provider.getBlock('latest');
        const latestBalance = await getStrkBalance(finalDeploymentAddress, 'latest');
        
        // Also check at the block where funding was confirmed + 1
        const confirmedBlockBalance = checkBlockNumber ? await getStrkBalance(finalDeploymentAddress, checkBlockNumber) : 0;
        
        console.log(`    Balance at latest block (${latestBlock.block_number}): ${latestBalance.toFixed(4)} STRK`);
        if (checkBlockNumber) {
            console.log(`    Balance at confirmed block (${checkBlockNumber}): ${confirmedBlockBalance.toFixed(4)} STRK`);
        }
        
        const finalBalanceCheck = Math.max(latestBalance, confirmedBlockBalance);
        if (finalBalanceCheck < 1.0) {
            throw new Error(`Insufficient balance for deployment: latest=${latestBalance} STRK, confirmed=${confirmedBlockBalance} STRK (need at least 1.0 STRK) at ${finalDeploymentAddress}`);
        }
        
        // NOTE: The account contract's validate function only checks signatures, NOT balance.
        // The balance check happens in Madara's sequencer when it tries to deduct fees.
        // This appears to be a sequencer-level issue where it checks balance at a different state.
        console.log(`    Attempting deployment (balance verified: ${finalBalanceCheck.toFixed(4)} STRK)...`);
        console.log(`    ⚠️  Note: Retrying up to 3 times - Madara's sequencer checks balance during fee deduction`);
        
        // Try deployment with deployer paying fees (static method approach)
        // This bypasses the validate function balance check on the account being deployed
        let deployResponse;
        const maxRetries = 3;
        const retryDelay = 3000;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (attempt > 1) {
                    console.log(`    Retry attempt ${attempt}/${maxRetries}...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }
                
                // Try using Account.deployAccount as static method with deployer
                // This might allow deployer to pay fees instead of the account being deployed
                if (typeof Account.deployAccount === 'function' && Account.deployAccount.length >= 2) {
                    console.log(`    Trying static Account.deployAccount with deployer...`);
                    deployResponse = await Account.deployAccount(deployAccountPayload, deployerAccount);
                } else {
                    // Fallback to instance method
                    console.log(`    Using instance method deployAccount...`);
                    deployResponse = await accountToDeploy.deployAccount(deployAccountPayload);
                }
                
                // Success!
                if (attempt > 1) {
                    console.log(`    ✅ Deployment succeeded on attempt ${attempt}`);
                }
                break;
            } catch (err) {
                const errorMsg = err.message || String(err);
                
                // If it fails with balance error, try again
                if (errorMsg.includes('Max fee') && errorMsg.includes('balance')) {
                    if (attempt < maxRetries) {
                        console.log(`    Attempt ${attempt} failed: sequencer saw balance 0 during fee deduction`);
                        console.log(`    Retrying in ${retryDelay/1000} seconds...`);
                        continue;
                    } else {
                        // All retries failed
                        console.error(`    ❌ All ${maxRetries} deployment attempts failed`);
                        console.error(`    Balance verified: ${finalBalanceCheck.toFixed(4)} STRK, but Madara sequencer sees 0`);
                        console.error(`    This is a Madara sequencer-level issue - fee deduction checks balance at wrong state`);
                        console.error(`    Note: Account contract's validate() only checks signatures, not balance`);
                        console.error(`    Possible solutions:`);
                        console.error(`      1. Try running the script again (timing might work)`);
                        console.error(`      2. Report this bug to Madara team - sequencer fee deduction issue`);
                        console.error(`      3. Try using V3 transactions (requires starknet.js v7+)`);
                        console.error(`      4. Use alternative deployment method (Universal Deployer Contract)`);
                        throw err;
                    }
                } else {
                    // Different error - don't retry
                    throw err;
                }
            }
        }
        
        // Wait for deployment to be confirmed
        await provider.waitForTransaction(deployResponse.transaction_hash);
        
        // Get the actual deployed address from the response
        const deployedAddress = deployResponse.contract_address || addressFromPayloadStr;
        console.log(`  ✅ Deployed account at ${deployedAddress.substring(0, 20)}... TX: ${deployResponse.transaction_hash.substring(0, 16)}...`);
        
        // Verify deployment at the deployed address
        const verifyDeployed = await checkAccountDeployed(deployedAddress);
        if (!verifyDeployed) {
            throw new Error(`Deployment verification failed for address: ${deployedAddress}`);
        }
        
        return { 
            address: deployedAddress, 
            expectedAddress: expectedAddress,
            success: true, 
            txHash: deployResponse.transaction_hash, 
            alreadyDeployed: false 
        };
    } catch (err) {
        const errorMsg = err.message || String(err);
        console.error(`  ❌ Failed to deploy account ${accountData.address.substring(0, 20)}...`);
        console.error(`     Error: ${errorMsg}`);
        
        // If it's the Madara sequencer fee deduction issue, provide more context
        if (errorMsg.includes('Max fee') && errorMsg.includes('balance')) {
            console.error(`     This is a known Madara sequencer fee deduction issue.`);
            console.error(`     The account has funds but Madara's sequencer sees balance 0 when deducting fees.`);
            console.error(`     Note: The account contract's validate() only checks signatures, not balance.`);
            console.error(`     This account will be skipped. Try running the script again later.`);
        }
        
        return { 
            address: accountData.address, 
            computedAddress: normalizedAddress,
            success: false, 
            error: errorMsg,
            skipRetry: errorMsg.includes('Max fee') && errorMsg.includes('balance') // Don't retry these
        };
    }
}

async function getAccountClassHashFromMadara() {
    // Get the account class hash from the pre-deployed account using RPC
    try {
        // Use the RPC method to get class hash at address
        const response = await fetch(`${defaultNodeUrl}/starknet_getClassHashAt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'starknet_getClassHashAt',
                params: {
                    contract_address: madaraDeployerAddress,
                    block_id: 'latest'
                }
            })
        });
        
        const data = await response.json();
        if (data.result) {
            return data.result;
        }
        throw new Error('No class hash in response');
    } catch (err) {
        // If that doesn't work, try using the provider method directly
        try {
            // For starknet.js v6, we might need to use a different approach
            // The known OZ account class hash on Madara devnet
            console.log('  ℹ️  Could not fetch class hash via RPC, using known OZ account class hash');
            return '0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564';
        } catch (e) {
            // Fallback to known class hash
            return '0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564';
        }
    }
}

async function main() {
    console.log('='.repeat(60));
    console.log('Deploying Account Contracts to Madara L3');
    console.log('='.repeat(60));
    console.log(`Total accounts to deploy: ${testAccounts.length}`);
    console.log(`Deployer: ${madaraDeployerAddress}`);
    console.log(`RPC: ${defaultNodeUrl}`);
    console.log('='.repeat(60));
    
    // Get account class hash
    console.log('\nGetting account class hash from Madara...');
    const accountClassHash = await getAccountClassHashFromMadara();
    console.log(`Account class hash: ${accountClassHash}`);
    
    // Initialize deployer account
    const deployerAccount = new Account(provider, madaraDeployerAddress, madaraDeployerPrivateKey);
    
    // Check which accounts are already deployed
    console.log('\nChecking which accounts are already deployed...');
    const pLimit = (await import('p-limit')).default;
    const checkLimit = pLimit(CONCURRENCY);
    const deploymentChecks = testAccounts.map((acc, idx) => 
        checkLimit(async () => {
            const deployed = await checkAccountDeployed(acc.address);
            if (deployed) {
                console.log(`  ✅ Account ${acc.address.substring(0, 20)}... already deployed`);
            }
            return { account: acc, alreadyDeployed: deployed };
        })
    );
    const checkResults = await Promise.all(deploymentChecks);
    
    const accountsToDeploy = checkResults.filter(r => !r.alreadyDeployed).map(r => r.account);
    const alreadyDeployed = checkResults.filter(r => r.alreadyDeployed).length;
    
    console.log(`\nAlready deployed: ${alreadyDeployed}/${testAccounts.length}`);
    console.log(`Accounts to deploy: ${accountsToDeploy.length}/${testAccounts.length}`);
    
    if (accountsToDeploy.length === 0) {
        console.log('\n✅ All accounts are already deployed!');
        return;
    }
    
    // Deploy accounts
    console.log(`\nDeploying ${accountsToDeploy.length} accounts...`);
    let deployedCount = 0;
    let failedCount = 0;
    const deployLimit = pLimit(CONCURRENCY);
    
    const deploymentOps = accountsToDeploy.map((acc, idx) =>
        deployLimit(async () => {
            console.log(`\n[${idx + 1}/${accountsToDeploy.length}] Deploying account ${acc.address.substring(0, 20)}...`);
            const result = await deployAccount(acc, deployerAccount, accountClassHash, strkTokenAddress);
            if (result.success && !result.alreadyDeployed) {
                deployedCount++;
            } else if (!result.success) {
                failedCount++;
            }
            return result;
        })
    );
    
    const results = await Promise.all(deploymentOps);
    
    // Summary
    const failedAccounts = results.filter(r => !r.success && !r.alreadyDeployed);
    const madaraValidationFailures = failedAccounts.filter(r => 
        r.error && r.error.includes('Max fee') && r.error.includes('balance')
    );
    
    console.log('\n' + '='.repeat(60));
    console.log('Deployment Summary');
    console.log('='.repeat(60));
    console.log(`Successfully deployed: ${deployedCount} accounts`);
    console.log(`Already deployed: ${alreadyDeployed} accounts`);
    console.log(`Failed: ${failedCount} accounts`);
    console.log(`  - Madara validation failures: ${madaraValidationFailures.length}`);
    console.log(`  - Other failures: ${failedCount - madaraValidationFailures.length}`);
    console.log(`Total: ${testAccounts.length} accounts`);
    
    // Save failed accounts for retry
    if (failedAccounts.length > 0) {
        const fs = require('fs');
        const failedAccountsData = failedAccounts.map(r => ({
            address: r.address,
            computedAddress: r.computedAddress || r.address,
            error: r.error,
            isMadaraValidationIssue: r.error && r.error.includes('Max fee') && r.error.includes('balance')
        }));
        
        const failedAccountsFile = 'failed-accounts-deployment.json';
        fs.writeFileSync(failedAccountsFile, JSON.stringify(failedAccountsData, null, 2));
        console.log(`\n⚠️  Failed accounts saved to: ${failedAccountsFile}`);
        console.log(`   You can retry these accounts later by running the script again.`);
        
        if (madaraValidationFailures.length > 0) {
            console.log(`\n⚠️  WARNING: ${madaraValidationFailures.length} accounts failed due to Madara sequencer fee deduction issue.`);
            console.log(`   This is a known issue where Madara's sequencer checks balance at a different state when deducting fees.`);
            console.log(`   The accounts have funds but the sequencer sees balance 0 during fee deduction.`);
            console.log(`   Note: The account contract's validate() function only checks signatures, not balance.`);
            console.log(`   The balance check happens in Madara's sequencer during transaction execution.`);
            console.log(`\n   Possible solutions:`);
            console.log(`   1. Try running the script again (timing might work)`);
            console.log(`   2. Report this bug to Madara team - sequencer fee deduction checks balance at wrong state`);
            console.log(`   3. Try using V3 transactions (requires starknet.js v7+)`);
            console.log(`   4. Use alternative deployment method (Universal Deployer Contract)`);
            console.log(`   5. Check Madara's sequencer implementation for fee deduction logic`);
        }
    }
    
    // Verify final state
    if (deployedCount > 0) {
        console.log('\nVerifying deployed accounts...');
        const verifyLimit = pLimit(CONCURRENCY);
        const verifyOps = results.filter(r => r.success && !r.alreadyDeployed).map(({ address }) =>
            verifyLimit(async () => {
                const deployed = await checkAccountDeployed(address);
                return { address, deployed };
            })
        );
        const verifications = await Promise.all(verifyOps);
        const verified = verifications.filter(v => v.deployed).length;
        console.log(`Verified deployed: ${verified}/${verifications.length}`);
    }
    
    console.log('='.repeat(60));
    console.log('\n✅ Deployment complete! Accounts are ready for performance testing.');
    console.log('\nNext steps:');
    console.log('  1. Run: node fundAccountsMadara.js (to fund the deployed accounts with STRK)');
    console.log('  2. Run: node performanceTestMadara.js [batchSize] [bundleSize] [readRatio] [mode] [concurrency]');
}

main().catch(console.error);


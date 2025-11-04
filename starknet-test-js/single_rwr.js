const fs = require('fs');
const { Provider, Account, CallData, Contract } = require('starknet');

(async () => {
  const provider = new Provider({ rpc: { nodeUrl: 'https://starknet-sepolia.infura.io/v3/738a3e1e3f934295b1e4c3034dcbedf9' } });
  const contractAddress = '0x07326c1521946dacbe4697e02854e53266dcd134ff1354923fc41a7965a0ff87'; // Your performanceTest contract
  const abiPath = '/Users/seanevans/Documents/ssp/pt/ABI/performancetestABI.json'; // Your ABI path
  const contractAbi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
  const contract = new Contract(contractAbi, contractAddress, provider);

  const accObj = {
    address: '0x7d101d7e45f0bda48db725965be0b23db4cd4f78db2304bbe9d011f5128736c', // Customer 1 address
    privateKey: '0x17690f744acae2d0251e613c06eae9d28de37e5dcf4dc4dfe3d98530110711c' // Customer 1 private key
  };
  const account = new Account(provider, accObj.address, accObj.privateKey, 1);

  try {
    // Read initial balance
    let initialBalance;
    try {
      initialBalance = await contract.call('get_balance', [accObj.address], { blockIdentifier: 'latest' });
      console.log('get_balance response:', initialBalance);
    } catch (err) {
      console.error('get_balance call failed:', err);
      return;
    }
    
    if (!initialBalance) {
      console.error('Invalid balance response:', initialBalance);
      return;
    }
    
    // Handle single u256 value (not struct with low/high)
    const initialBalanceValue = BigInt(initialBalance).toString();
    console.log(`Initial balance: ${initialBalanceValue}`);

    // Update balance
    const newBalanceValue = BigInt(Math.floor(Math.random() * 100) + 1); // Random test value 1-100
    const call = contract.populate('update_balance', { new_balance: newBalanceValue });
    const estimated = await account.estimateInvokeFee(call);
    const maxFee = estimated.overall_fee * 12n / 10n;
    const tx = await account.execute(call, undefined, { maxFee, version: 1n });
    console.log(`Tx hash: ${tx.transaction_hash}`);
    await provider.waitForTransaction(tx.transaction_hash);

    await new Promise(resolve => setTimeout(resolve, 10000)); // 10s delay for lag

    // Read final balance
    let finalBalance;
    try {
      finalBalance = await contract.call('get_balance', [accObj.address], { blockIdentifier: 'latest' });
      console.log('get_balance response:', finalBalance);
    } catch (err) {
      console.error('get_balance call failed:', err);
      return;
    }
    
    if (!finalBalance) {
      console.error('Invalid balance response:', finalBalance);
      return;
    }
    
    // Handle single u256 value (not struct with low/high)
    const finalBalanceValue = BigInt(finalBalance).toString();
    console.log(`Final balance: ${finalBalanceValue}`);
  } catch (err) {
    console.error('Error: ', err);
  }
})().catch(console.error);
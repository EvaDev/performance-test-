#!/usr/bin/env node

/**
 * Check STRK token address and balance on Madara devnet
 */

const { Provider } = require('starknet');

async function main() {
    console.log('🔍 Checking STRK token on Madara devnet...\n');
    
    try {
        const provider = new Provider({ rpc: { nodeUrl: 'http://localhost:9944' } });
        
        // Test different STRK token addresses
        const addresses = [
            '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
            '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c7b7f8c8c8c8c8c8c8c8c',
            '0x0000000000000000000000000000000000000000000000000000000000000000'
        ];
        
        const testAddress = '0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d';
        
        for (const addr of addresses) {
            console.log(`Testing address: ${addr}`);
            try {
                const result = await provider.callContract({
                    contractAddress: addr,
                    entrypoint: 'balance_of',
                    calldata: [testAddress]
                });
                console.log(`  Result: ${JSON.stringify(result)}`);
                if (result && result.result && result.result[0]) {
                    const balance = BigInt(result.result[0]);
                    console.log(`  Balance: ${balance / 10n**18n} STRK`);
                }
            } catch (e) {
                console.log(`  Error: ${e.message}`);
            }
            console.log('');
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

main().catch(console.error);

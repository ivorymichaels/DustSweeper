#!/usr/bin/env node
/*
  Simple test runner for frontend price module.

  Usage:
    PROVIDER_URL="https://mainnet.infura.io/v3/<KEY>" node frontend/scripts/price-runner.js

  Or pass provider as first arg:
    node frontend/scripts/price-runner.js https://mainnet.infura.io/v3/<KEY>

  Optional env vars:
    COINGECKO_API_KEY - forwarded to CoinGecko requests
    CHAINLINK_REGISTRY - address of Chainlink Feed Registry (default mainnet value used if not set)
    ROUTER_ADDRESS - router to use for on-chain fallback (UniswapV2 style)
    (If PROVIDER_URL not provided, Chainlink and on-chain demos will be skipped.)
*/

(async () => {
  try {
    // dynamic import of the module (works regardless of project CommonJS/Esm)
    const priceMod = await import(new URL('../src/lib/price.js', import.meta.url));
    const { getPriceUSD } = priceMod;
    const { ethers } = await import('ethers');

    const providerUrl = process.env.PROVIDER_URL || process.argv[2];
    const provider = providerUrl ? new ethers.providers.JsonRpcProvider(providerUrl) : undefined;

    console.log('Price runner demo');

    // 1) CoinGecko path (no provider required)
    console.log('\n--- CoinGecko demo (Polygon USDC) ---');
    const polygonUSDC = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
    const cgRes = await getPriceUSD(polygonUSDC, 137, { coingeckoApiKey: process.env.COINGECKO_API_KEY });
    console.log('CoinGecko result:', cgRes);

    if (!provider) {
      console.log('\nProvider not supplied; skipping Chainlink and on-chain router demos.');
      return;
    }

    // 2) Chainlink path (mainnet WETH example)
    console.log('\n--- Chainlink demo (WETH mainnet) ---');
    const mainnetWETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
    const chainlinkRegistry = process.env.CHAINLINK_REGISTRY || '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf';
    const clRes = await getPriceUSD(mainnetWETH, 1, { provider, chainlinkRegistryAddress: chainlinkRegistry });
    console.log('Chainlink result:', clRes);

    // 3) On-chain router fallback (UniswapV2 style)
    console.log('\n--- On-chain router demo (WETH -> USDC mainnet) ---');
    const uniswapRouter = process.env.ROUTER_ADDRESS || '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
    const usdcMainnet = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const onchainRes = await getPriceUSD(mainnetWETH, 1, { provider, routerAddress: uniswapRouter, stablecoinAddress: usdcMainnet });
    console.log('On-chain router result:', onchainRes);

  } catch (err) {
    console.error('Error in price-runner:', err);
    process.exitCode = 1;
  }
})();

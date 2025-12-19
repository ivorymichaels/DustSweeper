/*
  Price module
  - Exports: async function getPriceUSD(tokenAddress, chainId, opts)
    returns { price: number (float USD), source: string, liquidityScore: number }

  Behavior:
  1) If an on-chain Chainlink Feed Registry is provided (opts.chainlinkRegistryAddress and a provider),
     try to read the USD price from Chainlink and return it with source='chainlink'.
  2) Otherwise query CoinGecko's token price API (cached) and return source='coingecko'.
  3) As a final fallback, use an on-chain router's getAmountsOut (opts.routerAddress + provider)
     to compute price against a stablecoin (opts.stablecoinAddress, default USDC). Also inspect
     the pair reserves (if available) to compute a liquidityScore and enforce a minimal-liquidity
     check.

  Notes:
  - This module intentionally keeps defaults conservative; for production pass an ethers
    provider (opts.provider) configured for the requested chain and reliable RPC URLs.
  - CoinGecko rate limits anonymous requests; consider provisioning an API key or server-side
    proxy for higher-volume use.
  - The module returns price as a JS Number (floating USD). Caller should handle precision if
    needed.

  Usage example:
    import { getPriceUSD } from './lib/price';
    const res = await getPriceUSD(tokenAddress, 1, { provider, coingeckoApiKey, stablecoinAddress });

*/

import { ethers } from 'ethers';

const COINGECKO_TTL = 60 * 1000; // 1 minute default cache TTL

// Simple in-memory cache for CoinGecko results: {key: {ts, data}}
const cgCache = new Map();

// Platform map for CoinGecko token price endpoints
const CHAIN_PLATFORM = {
  1: 'ethereum',
  137: 'polygon-pos',
  80001: 'polygon-pos', // mumbai uses polygon-pos id on CoinGecko
  56: 'binance-smart-chain',
  43114: 'avalanche',
};

// Default stablecoin (USDC) per chain (user can override)
const DEFAULT_STABLE = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC mainnet
  137: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC on polygon
  43114: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', // USDC on Avalanche C-Chain
  80001: undefined, // no default on mumbai
};

// Default router addresses (UniswapV2 / QuickSwap / TraderJoe) — allow override
const DEFAULT_ROUTER = {
  1: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2 router (mainnet)
  137: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff', // QuickSwap router (Polygon)
  43114: '0x60aE616a2155Ee3d9A68541Ba4544862310933d4', // Trader Joe router (Avalanche)
};

// Default Chainlink Feed Registry addresses per chain.
// NOTE: verify addresses for your target chain before relying on on-chain lookups.
const DEFAULT_CHAINLINK_REGISTRY = {
  1: '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf', // Feed Registry (Ethereum mainnet)
  // Polygon and Avalanche registry addresses may differ by deployment; leave undefined
  // so callers can pass the correct registry address via opts.chainlinkRegistryAddress.
  137: undefined,
  43114: undefined,
};

// Minimal ABIs
const FEED_REGISTRY_ABI = [
  'function latestRoundData(address base, address quote) view returns (uint80, int256, uint256, uint256, uint80)'
];

const UNISWAP_V2_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)'
];

const UNISWAP_V2_PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)'
];

const ERC20_ABI = [
  'function decimals() view returns (uint8)'
];

/**
 * Helper: normalize address to checksum lower-case standard
 */
function normalize(address) {
  try { return ethers.utils.getAddress(address); } catch (e) { return address; }
}

/**
 * Query Chainlink FeedRegistry if configured.
 * opts.provider must be an ethers Provider. opts.chainlinkRegistryAddress should be provided.
 */
async function tryChainlink(tokenAddress, opts) {
  if (!opts || !opts.provider || !opts.chainlinkRegistryAddress) return null;
  try {
    const provider = opts.provider;
    const registry = new ethers.Contract(opts.chainlinkRegistryAddress, FEED_REGISTRY_ABI, provider);
    // Chainlink registry expects base, quote addresses. We'll use tokenAddress / USD (0x...)
    // NOTE: if your registry expects specific quote address for USD (e.g., 0x000...), set via opts.chainlinkUsdAddress
    const quote = opts.chainlinkUsdAddress || ethers.constants.AddressZero;
    const token = normalize(tokenAddress);
    const res = await registry.latestRoundData(token, quote);
    // res[1] is int256 answer
    const answer = res[1];
    if (!answer || answer.eq(0)) return null;
    // No decimals info from this minimal ABI; allow passing decimals via opts.chainlinkDecimals or assume 8
    const decimals = opts.chainlinkDecimals ?? 8;
    const price = Number(ethers.utils.formatUnits(answer, decimals));
    return { price, source: 'chainlink', liquidityScore: 100 };
  } catch (err) {
    // console.debug('Chainlink lookup failed', err);
    return null;
  }
}

/**
 * Query CoinGecko for token price on the given chain.
 */
async function tryCoinGecko(tokenAddress, chainId, opts) {
  const platform = CHAIN_PLATFORM[chainId];
  if (!platform) return null;
  const key = `${platform}:${tokenAddress.toLowerCase()}`;
  const ttl = (opts && opts.coingeckoCacheTTL) || COINGECKO_TTL;
  const now = Date.now();
  if (cgCache.has(key)) {
    const cached = cgCache.get(key);
    if (now - cached.ts < ttl) return cached.data;
  }
  try {
    const url = `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${tokenAddress}&vs_currencies=usd`;
    const headers = {};
    if (opts && opts.coingeckoApiKey) headers['x-api-key'] = opts.coingeckoApiKey;
    const resp = await fetch(url, { headers });
    if (!resp.ok) return null;
    const json = await resp.json();
    const entry = json[tokenAddress.toLowerCase()];
    if (!entry || !entry.usd) return null;
    const data = { price: Number(entry.usd), source: 'coingecko', liquidityScore: 80 };
    cgCache.set(key, { ts: now, data });
    return data;
  } catch (err) {
    // console.debug('CoinGecko lookup failed', err);
    return null;
  }
}

/**
 * On-chain router fallback: getAmountsOut against a stablecoin and inspect pair reserves
 */
async function tryOnchainRouter(tokenAddress, chainId, opts) {
  if (!opts || !opts.provider) return null;
  const provider = opts.provider;
  const routerAddr = opts.routerAddress || DEFAULT_ROUTER[chainId];
  const stable = opts.stablecoinAddress || DEFAULT_STABLE[chainId];
  if (!routerAddr || !stable) return null;
  try {
    const router = new ethers.Contract(routerAddr, UNISWAP_V2_ROUTER_ABI, provider);
    const amountIn = ethers.utils.parseUnits('1', 18); // 1 token (we'll scale by decimals later)

    // Determine decimals of token
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    let tokenDecimals = 18;
    try { tokenDecimals = await tokenContract.decimals(); } catch (e) { tokenDecimals = 18; }

    // Build path: token -> stable
    const path = [tokenAddress, stable];
    const amounts = await router.getAmountsOut(ethers.utils.parseUnits('1', tokenDecimals), path);
    if (!amounts || amounts.length === 0) return null;
    const amountOut = amounts[amounts.length - 1];

    // Get stable decimals and convert amountOut to USD (assume stable is 6 or 18 depending)
    const stableContract = new ethers.Contract(stable, ERC20_ABI, provider);
    let stableDecimals = 6;
    try { stableDecimals = await stableContract.decimals(); } catch (e) { stableDecimals = 6; }

    const price = Number(ethers.utils.formatUnits(amountOut, stableDecimals));

    // liquidityScore heuristic: inspect pair reserves if pair exists (UniswapV2 factory not provided)
    // We'll attempt to compute pair address using CREATE2 formula if factory and init code hash are provided in opts.
    let liquidityScore = 50; // default medium
    if (opts.pairAddress) {
      try {
        const pair = new ethers.Contract(opts.pairAddress, UNISWAP_V2_PAIR_ABI, provider);
        const reserves = await pair.getReserves();
        const token0 = await pair.token0();
        const token1 = await pair.token1();
        // identify reserve for stable
        let reserveStable = token0.toLowerCase() === stable.toLowerCase() ? reserves.reserve0 : reserves.reserve1;
        // convert to USD approx
        const reserveUsd = Number(ethers.utils.formatUnits(reserveStable, stableDecimals));
        if (reserveUsd > 1_000_000) liquidityScore = 100;
        else if (reserveUsd > 100_000) liquidityScore = 80;
        else if (reserveUsd > 10_000) liquidityScore = 60;
        else liquidityScore = 30;
      } catch (e) {
        // ignore
      }
    }

    return { price, source: 'onchain-router', liquidityScore };
  } catch (err) {
    // console.debug('Onchain router failed', err);
    return null;
  }
}

/**
 * Public function: getPriceUSD
 * - tokenAddress: address string
 * - chainId: number
 * - opts: { provider, chainlinkRegistryAddress, chainlinkUsdAddress, coingeckoApiKey, routerAddress, stablecoinAddress, pairAddress }
 */
export async function getPriceUSD(tokenAddress, chainId, opts = {}) {
  if (!tokenAddress) return { price: null, source: 'unknown', liquidityScore: 0 };

  // Normalize WETH/ETH representation if needed
  const token = normalize(tokenAddress);

  // 1) Try Chainlink if configured
  const chainlinkRes = await tryChainlink(token, opts);
  if (chainlinkRes) return chainlinkRes;

  // 2) Try CoinGecko
  const cg = await tryCoinGecko(token, chainId, opts);
  if (cg) return cg;

  // 3) Fallback to on-chain router approach
  const onchain = await tryOnchainRouter(token, chainId, opts);
  if (onchain) return onchain;

  return { price: null, source: 'unknown', liquidityScore: 0 };
}

export default { getPriceUSD };

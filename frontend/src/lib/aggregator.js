/**
 * Aggregator helper (1inch)
 * - Exports `buildSwapTx` which returns calldata and expected output for a swap that the
 *   Sweeper contract can forward to an on-chain aggregator.
 * - Usage: call `buildSwapTx(fromToken, toToken, amount, chainId, opts)` from the frontend
 *   to obtain `{ to, data, value, expectedAmountOut, estimatedGas }` and also the optional
 *   `approve` calldata if the caller wants to perform an ERC20 approve before relying on
 *   Permit2 or native approvals.
 *
 * Notes:
 * - This module uses the 1inch API (v5). For production you may want to use a server-side
 *   proxy or API key to avoid rate limits.
 * - 1inch represents native ETH as 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE on many endpoints.
 * - If the user supplies Permit2-style permits, the frontend should build permit calldata
 *   instead of doing an approve; in that case the Sweeper will call Permit2 and move tokens
 *   without an on-chain approve step.
 */

import axios from 'axios'
import * as ethers from 'ethers'

const ONEINCH_BASE = 'https://api.1inch.io/v5.0'
const NATIVE_FLAG = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

function normalizeAddress(addr) {
  if (!addr) return addr
  try { if (addr === ethers.ZeroAddress) return NATIVE_FLAG } catch (e) {}
  return addr
}

function isNativeFor1inch(addr) {
  if (!addr) return false
  const a = addr.toLowerCase()
  return a === ethers.ZeroAddress || a === NATIVE_FLAG.toLowerCase()
}

/**
 * Build swap calldata using 1inch swap endpoint.
 *
 * @param {string} fromToken - token address (or AddressZero for native)
 * @param {string} toToken - token address (or AddressZero for native)
 * @param {string|BigNumber} amount - amount in wei (as string) of `fromToken` to swap
 * @param {number} chainId - numeric chain id (1, 137, ...)
 * @param {object} opts - optional settings:
 *    - fromAddress: address that will call the swap (used by 1inch to fill `from`)
 *    - slippage: percent (e.g., 1 for 1%)
 *    - disableEstimate: boolean passed to 1inch
 *    - apiKey: optional 1inch API key
 *
 * @returns {Promise<{ to, data, value, expectedAmountOut, estimatedGas, approveNeeded, approveData, raw }>} 
 */
export async function buildSwapTx(fromToken, toToken, amount, chainId = 1, opts = {}) {
  const normalizedFrom = normalizeAddress(fromToken)
  const normalizedTo = normalizeAddress(toToken)
  const fromIsNative = isNativeFor1inch(normalizedFrom)

  const fromAddress = opts.fromAddress || undefined
  const slippage = opts.slippage != null ? opts.slippage : 1 // percent

  // 1) Try quote to provide expectedAmountOut
  let expectedAmountOut = null
  try {
    const quoteUrl = `${ONEINCH_BASE}/${chainId}/quote`
    const qparams = new URLSearchParams()
    qparams.set('fromTokenAddress', normalizedFrom)
    qparams.set('toTokenAddress', normalizedTo)
    qparams.set('amount', String(amount))
    const qresp = await axios.get(`${quoteUrl}?${qparams.toString()}`)
    expectedAmountOut = qresp.data.toTokenAmount
  } catch (err) {
    expectedAmountOut = null
  }

  // 2) Build swap calldata via /swap endpoint
  try {
    const swapUrl = `${ONEINCH_BASE}/${chainId}/swap`
    const params = new URLSearchParams()
    params.set('fromTokenAddress', normalizedFrom)
    params.set('toTokenAddress', normalizedTo)
    params.set('amount', String(amount))
    if (fromAddress) params.set('fromAddress', fromAddress)
    params.set('slippage', String(slippage))
    if (opts.disableEstimate) params.set('disableEstimate', 'true')

    const headers = {}
    if (opts.apiKey) headers['Authorization'] = `Bearer ${opts.apiKey}`

    const resp = await axios.get(`${swapUrl}?${params.toString()}`, { headers })
    const tx = resp.data.tx

    // Determine approve calldata if the from token is ERC20 and fromAddress provided
    let approveNeeded = false
    let approveData = null
    if (!fromIsNative && fromAddress) {
      const spender = tx.to
      const abi = ["function approve(address spender, uint256 amount) public returns (bool)"]
      const iface = new ethers.Interface(abi)
      approveData = iface.encodeFunctionData('approve', [spender, String(amount)])
      approveNeeded = true
    }

    return {
      to: tx.to,
      data: tx.data,
      value: tx.value || '0',
      expectedAmountOut,
      estimatedGas: resp.data.estimatedGas || null,
      approveNeeded,
      approveData,
      raw: resp.data
    }
  } catch (err) {
    const msg = err?.response?.data || err.message
    throw new Error(`Aggregator swap build failed: ${typeof msg === 'object' ? JSON.stringify(msg) : msg}`)
  }
}

export const notes = `
Native vs ERC20 handling:
- If the source token is native ETH (AddressZero), the swap call will require sending ETH (value field) to the aggregator.
- If the source token is ERC20, the aggregator will pull tokens from the caller; that usually requires the caller to have approved the aggregator/spender.

Approve vs Permit:
- Approve flow: the user issues an on-chain ERC20 approve(spender, amount) transaction to the aggregator/spender (1inch router).
  This costs gas and requires the user to manage allowances.
- Permit flow (Permit2): alternatively, use Permit2 to create a signature that authorizes the aggregator (or the Sweeper contract via Permit2) to transfer the tokens in a single atomic flow.
  In that case the frontend should build Permit2 permit calldata (or the typed permit structure) and pass it to the Sweeper contract so it can call Permit2.transferFrom on behalf of the user.

Recommendation:
- For UX, prefer Permit2 to avoid upfront approves. If Permit2 isn't available for a token, fall back to approve for that token.
`;

export default { buildSwapTx, notes }

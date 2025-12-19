// Permit2 builder
// This module builds a Permit2 EIP-712 PermitSingle signature for a single token and
// returns ABI-encoded calldata that can be forwarded to a Permit2 contract's `permit` entrypoint.
//
// Assumptions & notes:
// - We implement a pragmatic PermitSingle builder (one token). For multiple tokens you can
//   call this repeatedly or extend to PermitBatch if your Permit2 supports it.
// - The Permit2 on-chain typed struct layout assumed is:
//     struct PermitSingle { address token; uint160 amount; uint48 expiration; uint48 nonce; address spender; }
//   and the function signature assumed is:
//     function permit(address owner, PermitSingle calldata permit, bytes calldata signature) external;
// - We set a default `amount` of uint160 max (infinite-style permit), a default expiration (30 days),
//   and nonce=0 unless provided in opts. These choices may need to be adapted for your Permit2 implementation.
// - If the exact Permit2 ABI/types differ in your deployment, adjust `TYPES` and the ABI-encoder below.

import { ethers } from 'ethers'

// max uint160
const MAX_UINT160 = ethers.BigNumber.from(2).pow(160).sub(1)

/**
 * Build Permit2 calldata for a single token using EIP-712 signature
 * @param {string[]} tokenAddresses - array of token addresses (we use first entry)
 * @param {object} opts - { signer, permit2Address, spender, chainId, amount, expirationSecondsFromNow, nonce }
 * @returns {Promise<{ permitCalldata: string, meta: object }>} - permitCalldata (hex) ready to forward to Permit2
 */
export async function buildPermit2Signature(tokenAddresses = [], opts = {}) {
  if (!tokenAddresses || tokenAddresses.length === 0) {
    return { permitCalldata: '0x', meta: null }
  }

  const token = tokenAddresses[0]
  const signer = opts.signer || (opts.provider ? opts.provider.getSigner?.() : null)
  const permit2 = opts.permit2Address
  if (!signer || !permit2) {
    // Cannot build signature without signer and permit2 address — return empty calldata so Sweeper will skip
    return { permitCalldata: '0x', meta: null }
  }

  const owner = await signer.getAddress()
  const network = opts.chainId ? { chainId: opts.chainId } : await signer.provider.getNetwork()
  const chainId = network.chainId

  const amount = opts.amount ? ethers.BigNumber.from(opts.amount) : MAX_UINT160
  const expiration = Math.floor(Date.now() / 1000) + (opts.expirationSecondsFromNow || 60 * 60 * 24 * 30)
  const nonce = opts.nonce != null ? opts.nonce : 0
  const spender = opts.spender || opts.sweeperAddress || ethers.constants.AddressZero

  // EIP-712 domain — matches Uniswap Permit2 expected domain
  const domain = {
    name: 'Permit2',
    version: '1',
    chainId: chainId,
    verifyingContract: permit2
  }

  // PermitSingle type definition (fields must match on-chain definition)
  const TYPES = {
    PermitSingle: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
      { name: 'nonce', type: 'uint48' },
      { name: 'spender', type: 'address' }
    ]
  }

  // Value to sign
  const value = {
    token: token,
    amount: amount.toString(),
    expiration: expiration,
    nonce: nonce,
    spender: spender
  }

  // Sign typed data (ethers signer._signTypedData)
  let signature
  try {
    signature = await signer._signTypedData(domain, TYPES, value)
  } catch (err) {
    // Some providers may not support _signTypedData; try fallbacks or return empty
    console.error('Permit2: failed to sign typed data', err)
    return { permitCalldata: '0x', meta: null }
  }

  // Build ABI calldata for: permit(address owner, (address,uint160,uint48,uint48,address) permit, bytes signature)
  const iface = new ethers.utils.Interface([
    'function permit(address owner, tuple(address token, uint160 amount, uint48 expiration, uint48 nonce, address spender) permit, bytes signature)'
  ])

  const permitTuple = [token, amount.toString(), expiration, nonce, spender]
  const calldata = iface.encodeFunctionData('permit', [owner, permitTuple, signature])

  const meta = { owner, token, amount: amount.toString(), expiration, nonce, spender, signature }
  return { permitCalldata: calldata, meta }
}

/**
 * Build a PermitBatch calldata for multiple tokens.
 * This assumes Permit2 exposes a `permit(address owner, PermitBatch permit, bytes signature)`
 * where PermitBatch is a tuple of parallel arrays: (address[] tokens, uint160[] amounts, uint48[] expirations, uint48[] nonces, address[] spenders)
 */
export async function buildPermit2BatchSignature(tokenAddresses = [], opts = {}) {
  if (!tokenAddresses || tokenAddresses.length === 0) return { permitCalldata: '0x', meta: null }

  const signer = opts.signer || (opts.provider ? opts.provider.getSigner?.() : null)
  const permit2 = opts.permit2Address
  if (!signer || !permit2) return { permitCalldata: '0x', meta: null }

  const owner = await signer.getAddress()
  const network = opts.chainId ? { chainId: opts.chainId } : await signer.provider.getNetwork()
  const chainId = network.chainId

  const count = tokenAddresses.length
  const amounts = []
  const expirations = []
  const nonces = []
  const spenders = []

  const defaultExpiration = Math.floor(Date.now() / 1000) + (opts.expirationSecondsFromNow || 60 * 60 * 24 * 30)
  const defaultNonce = opts.nonce != null ? opts.nonce : 0
  const defaultSpender = opts.spender || opts.sweeperAddress || ethers.constants.AddressZero

  for (let i = 0; i < count; i++) {
    const amt = opts.amounts && opts.amounts[i] ? ethers.BigNumber.from(opts.amounts[i]) : MAX_UINT160
    amounts.push(amt.toString())
    expirations.push(defaultExpiration)
    nonces.push(defaultNonce)
    spenders.push(defaultSpender)
  }

  // EIP-712 domain
  const domain = {
    name: 'Permit2',
    version: '1',
    chainId: chainId,
    verifyingContract: permit2
  }

  // PermitBatch typed definition (parallel arrays)
  const TYPES = {
    PermitBatch: [
      { name: 'tokens', type: 'address[]' },
      { name: 'amounts', type: 'uint160[]' },
      { name: 'expirations', type: 'uint48[]' },
      { name: 'nonces', type: 'uint48[]' },
      { name: 'spenders', type: 'address[]' }
    ]
  }

  const value = {
    tokens: tokenAddresses,
    amounts: amounts,
    expirations: expirations,
    nonces: nonces,
    spenders: spenders
  }

  let signature
  try {
    signature = await signer._signTypedData(domain, TYPES, value)
  } catch (err) {
    console.error('Permit2 batch: failed to sign typed data', err)
    return { permitCalldata: '0x', meta: null }
  }

  // Build ABI calldata for: permit(address owner, tuple(address[] tokens, uint160[] amounts, uint48[] expirations, uint48[] nonces, address[] spenders) permit, bytes signature)
  const iface = new ethers.utils.Interface([
    'function permit(address owner, tuple(address[] tokens, uint160[] amounts, uint48[] expirations, uint48[] nonces, address[] spenders) permit, bytes signature)'
  ])

  const permitTuple = [tokenAddresses, amounts, expirations, nonces, spenders]
  const calldata = iface.encodeFunctionData('permit', [owner, permitTuple, signature])

  const meta = { owner, tokens: tokenAddresses, amounts, expirations, nonces, spenders, signature }
  return { permitCalldata: calldata, meta }
}

// Backwards-compatible default: choose batch when multiple tokens provided
export default { buildPermit2Signature, buildPermit2BatchSignature }

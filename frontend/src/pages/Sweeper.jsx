import React, { useEffect, useState } from 'react'
import WalletConnect from '../components/WalletConnect'
import TxStatus from '../components/TxStatus'
import ErrorBanner from '../components/ErrorBanner'
import { getPriceUSD } from '../lib/price'
import axios from 'axios'
import { buildPermit2Signature } from '../lib/permitBuilder'
import { ethers } from 'ethers'
import { buildSwapTx } from '../lib/aggregator'
import ConfirmationModal from '../components/ConfirmationModal'

export default function Sweeper() {
  const [providerOpts, setProviderOpts] = useState({})
  const [chainId, setChainId] = useState(137)
  const [tokens, setTokens] = useState([])
  const [maxPrice, setMaxPrice] = useState(5)
  const [targetToken, setTargetToken] = useState('USDC')
  const [selected, setSelected] = useState(new Set())
  const [error, setError] = useState(null)
  const [txStatus, setTxStatus] = useState(null)
  const [swapCalls, setSwapCalls] = useState([])
  const [showConfirm, setShowConfirm] = useState(false)
  const [sweeperAddress, setSweeperAddress] = useState('')
  const [permit2Address, setPermit2Address] = useState('')
  const [partialSuccess, setPartialSuccess] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Fetch a curated token-list (CoinGecko top tokens on chain) as an example
  useEffect(() => {
    async function load() {
      try {
        // Example: fetch a small list from CoinGecko (token ids converted externally)
        // Here we include a few common addresses for demo; replace with production tokenlist
        const demo = [
          { symbol: 'USDC', address: chainId === 1 ? '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' : '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' },
          { symbol: 'WETH', address: chainId === 1 ? '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' : undefined },
        ].filter(Boolean)
        setTokens(demo)
      } catch (err) {
        setError('Failed to load token list')
      }
    }
    load()
  }, [chainId])

  async function refreshPrices() {
    const p = []
    for (const t of tokens) {
      try {
        const res = await getPriceUSD(t.address, chainId, { provider: providerOpts.provider })
        p.push({ ...t, price: res.price, src: res.source })
      } catch (err) {
        p.push({ ...t, price: null, src: 'error' })
      }
    }
    setTokens(p)
  }

  useEffect(() => {
    if (tokens.length) refreshPrices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerOpts, chainId])

  async function estimateSwap(token) {
    // Use 1inch quote API to estimate output and gas
    try {
      const from = token.address
      const to = targetToken === 'USDC' ? (chainId === 1 ? '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' : '') : ethers.constants.AddressZero
      if (!to) return { amountOut: null, estimatedGas: null }
      const url = `https://api.1inch.io/v5.0/${chainId}/quote?fromTokenAddress=${from}&toTokenAddress=${to}&amount=${ethers.utils.parseUnits('1', 18).toString()}`
      const resp = await axios.get(url)
      return { amountOut: resp.data.toTokenAmount, estimatedGas: resp.data.estimatedGas }
    } catch (err) {
      return { amountOut: null, estimatedGas: null }
    }
  }

  async function handleSweep() {
    setError(null)
    setTxStatus('building')
    try {
      // Build permit for selected tokens (frontend must collect approvals and signatures)
      const sel = Array.from(selected)
      const permit = await buildPermit2Signature(sel)

      // Build swap calldata per selected token using aggregator helper
      const swapCalls = []
      for (const addr of sel) {
        try {
          const tokenObj = tokens.find((x) => x.address?.toLowerCase() === addr?.toLowerCase())
          const amount = (providerOpts && providerOpts.provider && providerOpts.address && tokenObj)
            ? await (async () => {
                try {
                  const t = new ethers.Contract(tokenObj.address, ['function balanceOf(address) view returns (uint256)'], providerOpts.provider)
                  const bal = await t.balanceOf(providerOpts.address)
                  return bal.toString()
                } catch (_) { return ethers.utils.parseUnits('1', 18).toString() }
              })()
            : ethers.utils.parseUnits('1', 18).toString()

          const toAddr = targetToken === 'USDC'
            ? (chainId === 1 ? '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' : '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174')
            : ethers.constants.AddressZero

          const swap = await buildSwapTx(addr, toAddr, amount, chainId, { fromAddress: providerOpts?.address, slippage: 1 })
          swapCalls.push({ token: addr, swap })
        } catch (err) {
          // collect error but continue
          swapCalls.push({ token: addr, error: String(err) })
        }
      }

  // For demo: store or display swapCalls; in production you'd pass permit + swapCalls to Sweeper.sweepAndSwap
  setTxStatus({ state: 'ready', swaps: swapCalls.length, details: swapCalls })
  setSwapCalls(swapCalls)
  setShowConfirm(true)
      // Optionally: call sweeper contract directly using providerOpts.signer
    } catch (err) {
      setError('Failed to build permit or swap calldata')
      setTxStatus(null)
    }
  }

  return (
    <div>
      <WalletConnect onChange={setProviderOpts} onChainChange={setChainId} />

      <div style={{ marginTop: 12 }}>
        <label>
          Max price ($): <input type="number" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
        </label>
        <label style={{ marginLeft: 12 }}>
          Target token: <select value={targetToken} onChange={(e) => setTargetToken(e.target.value)}>
            <option>USDC</option>
            <option>ETH</option>
          </select>
        </label>
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={{ marginRight: 8 }}>Sweeper contract: <input value={sweeperAddress} onChange={(e)=>setSweeperAddress(e.target.value)} placeholder="0x..." /></label>
        <label style={{ marginRight: 8 }}>Permit2 contract: <input value={permit2Address} onChange={(e)=>setPermit2Address(e.target.value)} placeholder="0x..." /></label>
        <label style={{ marginRight: 8 }}>Partial success: <input type="checkbox" checked={partialSuccess} onChange={(e)=>setPartialSuccess(e.target.checked)} /></label>
        <div style={{ marginTop: 8 }}>
          <button onClick={refreshPrices}>Refresh prices</button>
          <button style={{ marginLeft: 8 }} onClick={handleSweep}>Build Permit & Sweep</button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div style={{ marginTop: 20 }}>
        <h3>Tokens</h3>
        <table>
          <thead>
            <tr><th></th><th>Symbol</th><th>Price</th><th>Est out</th><th>Gas</th></tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              (t.price === null || t.price <= Number(maxPrice)) && (
                <TokenRow key={t.address}
                  token={t}
                  chainId={chainId}
                  targetToken={targetToken}
                  providerOpts={providerOpts}
                  onSelect={(sel) => {
                    const s = new Set(selected)
                    if (s.has(t.address)) s.delete(t.address); else s.add(t.address)
                    setSelected(s)
                  }} />
              )
            ))}
          </tbody>
        </table>
      </div>

      <TxStatus status={txStatus} />

      <ConfirmationModal open={showConfirm} swaps={swapCalls} onClose={()=>setShowConfirm(false)} onSubmit={async ()=>{
        // submit flow
        if (!sweeperAddress) { setError('Specify Sweeper contract address'); return }
        setSubmitting(true)
        try {
          const signer = providerOpts?.signer
          if (!signer) throw new Error('Wallet not connected')

          const SweeperIface = [
            'function sweepAndSwap(address,bytes,address[],uint256[],uint256[],uint8,address,bytes[],bool) payable'
          ]
          const sweeper = new ethers.Contract(sweeperAddress, SweeperIface, signer)

          // collect arrays
          const tokensArr = swapCalls.map(s=>s.token)
          const minPrices = tokensArr.map(_=>0)
          const maxPrices = tokensArr.map(_=>ethers.constants.MaxUint256)
          const priceDecimals = 8
          const targetAddr = targetToken === 'USDC' ? (chainId===1? '0xA0b8...': '0x2791...') : ethers.constants.AddressZero
          // build swapCallData
          const swapCallData = swapCalls.map(s => s.swap ? s.swap.swap.data || s.swap.data || s.swap.raw?.tx?.data : '0x')
          // prepare permit calldata from builder
          const sel = tokensArr
          const permitObj = await buildPermit2Signature(sel)
          const permitCalldata = permitObj?.permitCalldata || '0x'

          // sum native values
          let totalValue = ethers.BigNumber.from(0)
          for (const s of swapCalls) {
            const v = s.swap?.value || s.swap?.swap?.value || '0'
            if (v && v !== '0') totalValue = totalValue.add(ethers.BigNumber.from(v))
          }

          const tx = await sweeper.sweepAndSwap(
            permit2Address || ethers.constants.AddressZero,
            permitCalldata,
            tokensArr,
            minPrices,
            maxPrices,
            priceDecimals,
            targetAddr,
            swapCallData,
            partialSuccess,
            { value: totalValue }
          )
          setTxStatus('submitted')
          await tx.wait()
          setTxStatus('confirmed')
        } catch (err) {
          setError(String(err))
          setTxStatus(null)
        } finally {
          setSubmitting(false)
          setShowConfirm(false)
        }
      }} swapping={submitting} />
    </div>
  )
}

function TokenRow({ token, onSelect, chainId, targetToken, providerOpts }) {
  const [est, setEst] = useState(null)
  useEffect(() => {
    let mounted = true
    async function run() {
      if (!token.address) return
      try {
        const toAddr = targetToken === 'USDC'
          ? (chainId === 1 ? '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' : '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174')
          : ethers.constants.AddressZero

        const amount = ethers.utils.parseUnits('1', 18).toString()
        const swap = await buildSwapTx(token.address, toAddr, amount, chainId, { fromAddress: providerOpts?.address, slippage: 1 })
        if (mounted) setEst({ amountOut: swap.expectedAmountOut, gas: swap.estimatedGas })
      } catch (e) { if (mounted) setEst(null) }
    }
    run()
    return () => { mounted = false }
  }, [token, chainId, targetToken, providerOpts])

  return (
    <tr>
      <td><input type="checkbox" onChange={onSelect} /></td>
      <td>{token.symbol}</td>
      <td>{token.price ? `$${token.price.toFixed(4)}` : 'n/a'}</td>
      <td>{est ? est.amountOut : '—'}</td>
      <td>{est ? est.gas : '—'}</td>
    </tr>
  )
}

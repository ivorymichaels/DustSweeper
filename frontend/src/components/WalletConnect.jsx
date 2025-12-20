import React, { useEffect, useState } from 'react'
import Web3Modal from 'web3modal'
import * as ethers from 'ethers'

export default function WalletConnect({ onChange = () => {}, onChainChange = () => {} }) {
  const [connected, setConnected] = useState(false)
  const [address, setAddress] = useState(null)

  useEffect(() => {
    // nothing on mount
  }, [])

  async function connect() {
    try {
      const modal = new Web3Modal({ cacheProvider: true })
      const instance = await modal.connect()
      const provider = new ethers.BrowserProvider(instance)
      const signer = provider.getSigner()
      const addr = await signer.getAddress()
      const network = await provider.getNetwork()
      setConnected(true)
      setAddress(addr)
      onChange({ provider, signer, address: addr })
      onChainChange(network.chainId)
    } catch (err) {
      console.error('connect err', err)
    }
  }

  return (
    <div>
      {connected ? (
        <div>Connected: {address}</div>
      ) : (
        <button onClick={connect}>Connect Wallet</button>
      )}
    </div>
  )
}

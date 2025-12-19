#!/usr/bin/env node
// Deploy script for testnets (Polygon Mumbai and Sepolia)
// Reads RPC URLs and PRIVATE_KEY from environment variables (see .env.example)

require('dotenv').config()
const hre = require('hardhat')
const { ethers } = hre

async function main() {
  await hre.run('compile')

  const networks = [
    { name: 'mumbai', rpcEnv: 'MUMBAI_RPC_URL', aggEnv: 'AGGREGATOR_ADDRESS_MUMBAI', oracleEnv: 'PRICE_ORACLE_ADDRESS_MUMBAI' },
    { name: 'sepolia', rpcEnv: 'SEPOLIA_RPC_URL', aggEnv: 'AGGREGATOR_ADDRESS_SEPOLIA', oracleEnv: 'PRICE_ORACLE_ADDRESS_SEPOLIA' },
  ]

  const pk = process.env.PRIVATE_KEY
  if (!pk) {
    console.error('Missing PRIVATE_KEY in env')
    process.exit(1)
  }

  for (const net of networks) {
    const rpc = process.env[net.rpcEnv]
    if (!rpc) {
      console.log(`Skipping ${net.name} deploy — no ${net.rpcEnv} set`)
      continue
    }

    console.log(`\nDeploying to ${net.name} using RPC ${rpc}`)
    const provider = new ethers.providers.JsonRpcProvider(rpc)
    const wallet = new ethers.Wallet(pk, provider)
    const signer = wallet.connect(provider)

    const Sweeper = await hre.ethers.getContractFactory('Sweeper', signer)

    const aggregatorAddr = process.env[net.aggEnv] || ethers.constants.AddressZero
    const priceOracleAddr = process.env[net.oracleEnv] || ethers.constants.AddressZero

    console.log(`Using aggregator: ${aggregatorAddr}, priceOracle: ${priceOracleAddr}`)

    const instance = await Sweeper.deploy(aggregatorAddr, priceOracleAddr)
    await instance.deployed()

    console.log(`Sweeper deployed to ${instance.address} on ${net.name}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})

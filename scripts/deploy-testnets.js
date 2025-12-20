#!/usr/bin/env node
// Deploy script for testnets (Base Sepolia and Sepolia)
// Reads RPC URLs and PRIVATE_KEY from environment variables (see .env.example)

require("dotenv").config();
const hre = require("hardhat");
// Use the installed ethers package for provider / wallet utilities
const ethersLib = require("ethers");
const { ethers } = hre;

async function main() {
  await hre.run("compile");

  const networks = [
    {
      // Matches hardhat config network key: `baseSepolia`
      name: "baseSepolia",
      rpcEnv: "BASE_SEPOLIA_RPC_URL",
      aggAddress: process.env.BASE_SEPOLIA_AGGREGATOR || "0x4aDC67696bA3f238d5bc241644A346ee211544D5",
      oracleAddress: process.env.BASE_SEPOLIA_ORACLE || "0x4aDC67696bA3f238d5bc241644A346ee211544D5",
    },
    {
      name: "sepolia",
      rpcEnv: "SEPOLIA_RPC_URL",
      aggAddress: process.env.SEPOLIA_AGGREGATOR || "0x694AA1769357215DE4FAC081bf1f309aDC325306",
      oracleAddress: process.env.SEPOLIA_ORACLE || "0x694AA1769357215DE4FAC081bf1f309aDC325306",
    },
  ];

  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    console.error("Missing PRIVATE_KEY in env");
    process.exit(1);
  }

  // If the user passed a network via `--network` to hardhat, prefer deploying only to that
  // network. Otherwise iterate the list and use the env vars.
  const requested = hre.network && hre.network.name ? hre.network.name : null;
  const targets =
    requested && requested !== "hardhat"
      ? networks.filter((n) => n.name === requested)
      : networks;

  for (const net of targets) {
    // Prefer explicit env var (NET_RPC_URL), then try the shorter form (NET_RPC),
    // then fall back to the hardhat runtime network config URL when matching the requested network.
    // Prefer explicit env var (e.g. BASE_SEPOLIA_RPC_URL), then try shorter form (BASE_SEPOLIA_RPC)
    let rpc = process.env[net.rpcEnv] || process.env[net.rpcEnv.replace("_URL", "")];
    if (
      !rpc &&
      hre.network &&
      hre.network.name === net.name &&
      hre.network.config &&
      hre.network.config.url
    ) {
      rpc = hre.network.config.url;
    }

    if (!rpc) {
      console.log(
        `Skipping ${net.name} deploy — no RPC configured (env ${net.rpcEnv} missing)`
      );
      continue;
    }

    console.log(`\nDeploying to ${net.name} using RPC ${rpc}`);
    const provider = new ethersLib.JsonRpcProvider(rpc);
    const wallet = new ethersLib.Wallet(pk, provider);

    // Check deployer balance before attempting a deployment — avoids confusing RPC errors
    const walletAddr = await wallet.getAddress();
    const balance = await provider.getBalance(walletAddr);
    // In ethers v6 balances are bigint; treat any value <= 0 as insufficient
    const hasFunds = (typeof balance === 'bigint' ? balance > 0n : (balance && balance.gt && balance.gt(0)));
    if (!hasFunds) {
      console.log(`Skipping ${net.name}: deployer ${walletAddr} has zero balance on this network.`);
      continue;
    }

    const signer = wallet.connect(provider);
    const Sweeper = await hre.ethers.getContractFactory("Sweeper", signer);

    // Use configured addresses from env or network object
    // Normalize addresses (trim and lowercase) to avoid checksum errors from env files
    let aggregatorAddr = net.aggAddress || ethersLib.ZeroAddress;
    let priceOracleAddr = net.oracleAddress || ethersLib.ZeroAddress;
    if (typeof aggregatorAddr === 'string') aggregatorAddr = aggregatorAddr.trim().toLowerCase();
    if (typeof priceOracleAddr === 'string') priceOracleAddr = priceOracleAddr.trim().toLowerCase();

    console.log(`Using aggregator: ${aggregatorAddr}, priceOracle: ${priceOracleAddr}`);

    try {
      const instance = await Sweeper.deploy(aggregatorAddr, priceOracleAddr);
      // ethers v6 has waitForDeployment(); fallback for older patterns
      if (instance.waitForDeployment) await instance.waitForDeployment();
      const deployedAddress = instance.target || (instance.getAddress ? await instance.getAddress() : instance.address) || "(unknown)";
      console.log(`Sweeper deployed to ${deployedAddress} on ${net.name}`);
    } catch (err) {
      console.error(`Failed to deploy to ${net.name}: ${err && err.message ? err.message : err}`);
      continue;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

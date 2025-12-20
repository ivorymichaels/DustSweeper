require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

const DEFAULT_SOLIDITY = "0.8.20";

module.exports = {
  solidity: {
    version: DEFAULT_SOLIDITY,
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      // viaIR helps with complex contracts and stack-too-deep issues
      viaIR: true,
    },
  },

  networks: {
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC || process.env.BASE_SEPOLIA_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 84532,
    },
    // Standard Sepolia testnet (named `sepolia` so --network sepolia works)
    sepolia: {
      url: process.env.SEPOLIA_RPC || process.env.SEPOLIA_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 11155111,
    },
  },

  etherscan: {
    apiKey: {
      baseSepolia: process.env.BASESCAN_API_KEY || "",
    },
  },
};

require("dotenv").config();
require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-ethers");

/*************************************************
 * Hardhat configuration
 * - Solidity 0.8.19
 * - Ethers + Waffle
 * - Optimizer enabled
 * - viaIR enabled to fix "stack too deep"
 *************************************************/

module.exports = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true, // <-- IMPORTANT: fixes "stack too deep"
    },
  },

  networks: {
    hardhat: {},
    mumbai: {
      url: process.env.MUMBAI_RPC || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
};

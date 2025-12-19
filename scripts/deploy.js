const hre = require("hardhat");

async function main() {
  console.log("Deploying Sweeper contract...");

  const Sweeper = await hre.ethers.getContractFactory("Sweeper");
  const sweeper = await Sweeper.deploy();
  await sweeper.deployed();

  console.log("Sweeper deployed to:", sweeper.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

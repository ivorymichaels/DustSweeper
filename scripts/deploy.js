const hre = require("hardhat");

async function main() {
  // 1️⃣ Get the deployer account
  const [deployer] = await hre.ethers.getSigners();
  const deployerAddr = await deployer.getAddress();
  console.log("Deploying with account:", deployerAddr);
  console.log(
    "Account balance:",
    hre.ethers.formatEther(
      await deployer.provider.getBalance(deployerAddr)
    ),
    "ETH"
  );

  // 2️⃣ Get the contract factory
  const Contract = await hre.ethers.getContractFactory("Sweeper"); // Replace with your contract name

  // 3️⃣ Deploy with constructor args
  const contract = await Contract.deploy(
    "0x4aDC67696bA3f238d5bc241644A346ee211544D5",
    "0x4aDC67696bA3f238d5bc241644A346ee211544D5"
  );

  // 4️⃣ Wait for deployment to finish
  await contract.waitForDeployment();

  // 5️⃣ Log info
  console.log("✅ Contract deployed to:", await contract.getAddress());
  console.log("Tx hash:", contract.deploymentTransaction().hash);
}

// Handle errors
main().catch((error) => {
  console.error(error);
  process.exit(1);
});

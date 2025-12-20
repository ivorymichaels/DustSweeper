const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Sweeper contract - unit tests (mocks)", function () {
  let owner, user, other;
  let MockERC20, MockPermit2, MockAggregator, MockPriceOracle;
  let tokenA, tokenB, tokenC;
  let permit2, aggregator, priceOracle;
  let Sweeper;
  let sweeper;

  beforeEach(async () => {
    [owner, user, other] = await ethers.getSigners();

    MockERC20 = await ethers.getContractFactory("MockERC20");
    MockPermit2 = await ethers.getContractFactory("MockPermit2");
    MockAggregator = await ethers.getContractFactory("MockAggregator");
    MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");

    tokenA = await MockERC20.deploy("TokenA", "TKA");
    await tokenA.waitForDeployment();
    tokenB = await MockERC20.deploy("TokenB", "TKB");
    await tokenB.waitForDeployment();
    tokenC = await MockERC20.deploy("TokenC", "TKC");
    await tokenC.waitForDeployment();

    permit2 = await MockPermit2.deploy();
    await permit2.waitForDeployment();

    aggregator = await MockAggregator.deploy();
    await aggregator.waitForDeployment();

    priceOracle = await MockPriceOracle.deploy();
    await priceOracle.waitForDeployment();

  Sweeper = await ethers.getContractFactory("Sweeper");
  // Deploy Sweeper with priceOracle disabled by default (address(0)). Tests that need
  // on-chain price checks will enable the oracle explicitly.
  sweeper = await Sweeper.deploy(aggregator.target, ethers.ZeroAddress);
    await sweeper.waitForDeployment();

    // Mint tokens to user
    await tokenA.mint(await user.getAddress(), ethers.parseEther("1000"));
    await tokenC.mint(await user.getAddress(), ethers.parseEther("500"));
  });

  it("happy path: sweep two tokens to a target token", async () => {
    // user approves permit2 to move tokenA and tokenC (simulating Permit2 effect)
    await tokenA.connect(user).approve(permit2.target, ethers.parseEther("1000"));
    await tokenC.connect(user).approve(permit2.target, ethers.parseEther("500"));

    // Build aggregator calldata for each token (swap(from,to,amountIn,minOut))
    const ifaceAgg = new ethers.Interface(["function swap(address,address,uint256,uint256) returns (uint256)"]);
    const amountA = ethers.parseEther("10");
    const amountC = ethers.parseEther("5");

    const dataA = ifaceAgg.encodeFunctionData("swap", [tokenA.target, tokenB.target, amountA, 0]);
    const dataC = ifaceAgg.encodeFunctionData("swap", [tokenC.target, tokenB.target, amountC, 0]);

    // Call sweepAndSwap from user
    await expect(
      sweeper.connect(user).sweepAndSwap(
        permit2.target,
        "0x",
        [tokenA.target, tokenC.target],
        [0, 0],
        [ethers.MaxUint256, ethers.MaxUint256],
        8,
        tokenB.target,
        [dataA, dataC],
        false
      )
    ).to.emit(sweeper, "Swept");

    // After sweep, user should have received some tokenB
    const balB = await tokenB.balanceOf(await user.getAddress());
    expect(balB).to.be.gt(0);
  });

  it("fails when price is out-of-range (using price oracle)", async () => {
  // Enable price oracle on the Sweeper and set price such that it is below minPrices
  await sweeper.setPriceOracle(priceOracle.target);
  await priceOracle.setPrice(tokenA.target, 1, 8); // price = 1

    await tokenA.connect(user).approve(permit2.target, ethers.parseEther("1000"));

    const ifaceAgg = new ethers.Interface(["function swap(address,address,uint256,uint256) returns (uint256)"]);
    const amountA = ethers.parseEther("1");
    const dataA = ifaceAgg.encodeFunctionData("swap", [tokenA.target, tokenB.target, amountA, 0]);

    // min price 100 (in same decimals) -> fails
    await expect(
      sweeper.connect(user).sweepAndSwap(
        permit2.target,
        "0x",
        [tokenA.target],
        [100],
        [200],
        8,
        tokenB.target,
        [dataA],
        false
      )
    ).to.be.revertedWith("PRICE_CHECK_FAILED");
  });

  it("aggregator low-liquidity revert triggers partial success behavior", async () => {
    await tokenA.connect(user).approve(permit2.target, ethers.parseEther("1000"));
    await tokenC.connect(user).approve(permit2.target, ethers.parseEther("500"));

    // Make aggregator revert
    await aggregator.setShouldRevert(true);

    const ifaceAgg = new ethers.Interface(["function swap(address,address,uint256,uint256) returns (uint256)"]);
    const dataA = ifaceAgg.encodeFunctionData("swap", [tokenA.target, tokenB.target, ethers.parseEther("10"), 0]);
    const dataC = ifaceAgg.encodeFunctionData("swap", [tokenC.target, tokenB.target, ethers.parseEther("5"), 0]);

    // With partialSuccess = true, call should not revert overall; both tokens will be attempted
    await expect(
      sweeper.connect(user).sweepAndSwap(
        permit2.target,
        "0x",
        [tokenA.target, tokenC.target],
        [0, 0],
        [ethers.MaxUint256, ethers.MaxUint256],
        8,
        tokenB.target,
        [dataA, dataC],
        true
      )
    ).to.not.be.reverted;
  });

  it("permit missing/expired causes transfer failure and respects partialSuccess", async () => {
    // Only approve tokenC, leave tokenA without approval
    await tokenC.connect(user).approve(permit2.target, ethers.parseEther("500"));

    const ifaceAgg = new ethers.Interface(["function swap(address,address,uint256,uint256) returns (uint256)"]);
    const dataA = ifaceAgg.encodeFunctionData("swap", [tokenA.target, tokenB.target, ethers.parseEther("10"), 0]);
    const dataC = ifaceAgg.encodeFunctionData("swap", [tokenC.target, tokenB.target, ethers.parseEther("5"), 0]);

    // partialSuccess = true should allow tokenC to succeed while tokenA fails
    await expect(
      sweeper.connect(user).sweepAndSwap(
        permit2.target,
        "0x",
        [tokenA.target, tokenC.target],
        [0, 0],
        [ethers.MaxUint256, ethers.MaxUint256],
        8,
        tokenB.target,
        [dataA, dataC],
        true
      )
    ).to.not.be.reverted;

    const balB = await tokenB.balanceOf(await user.getAddress());
    expect(balB).to.be.gt(0);

    // partialSuccess = false should revert due to tokenA permit failure
    await expect(
      sweeper.connect(user).sweepAndSwap(
        permit2.target,
        "0x",
        [tokenA.target, tokenC.target],
        [0, 0],
        [ethers.MaxUint256, ethers.MaxUint256],
        8,
        tokenB.target,
        [dataA, dataC],
        false
      )
    ).to.be.reverted;
  });

});

// How to run:
// 1) Ensure dependencies are installed: `npm install` (Hardhat + chai + ethers)
// 2) Run tests: `npx hardhat test test/sweeper.test.js --network hardhat`

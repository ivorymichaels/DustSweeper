const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Sweeper - edge cases (reentrancy, gas, many tokens)", function () {
  let owner, user;
  let MockERC20, MockPermit2, MockAggregatorReentrant, MockAggregator, MockPriceOracle;
  let sweeper, permit2, aggregatorReentrant, aggregator, priceOracle;

  beforeEach(async () => {
    [owner, user] = await ethers.getSigners();

    MockERC20 = await ethers.getContractFactory("MockERC20");
    MockPermit2 = await ethers.getContractFactory("MockPermit2");
    MockAggregatorReentrant = await ethers.getContractFactory("MockAggregatorReentrant");
    MockAggregator = await ethers.getContractFactory("MockAggregator");
    MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");

    permit2 = await MockPermit2.deploy();
      await permit2.waitForDeployment();

    aggregatorReentrant = await MockAggregatorReentrant.deploy();
      await aggregatorReentrant.waitForDeployment();

    aggregator = await MockAggregator.deploy();
      await aggregator.waitForDeployment();

    priceOracle = await MockPriceOracle.deploy();
      await priceOracle.waitForDeployment();

    const Sweeper = await ethers.getContractFactory("Sweeper");
    sweeper = await Sweeper.deploy(aggregator.target, ethers.ZeroAddress);
      await sweeper.waitForDeployment();
  });

  it("blocks reentrancy attempts from an aggregator", async () => {
    const token = await MockERC20.deploy("TA", "TA");
      await token.waitForDeployment();
    await token.mint(await user.getAddress(), ethers.parseEther("100"));
    await token.connect(user).approve(permit2.target, ethers.parseEther("100"));

    // Deploy a Sweeper instance that points to the reentrant aggregator
    await sweeper.setAggregator(aggregatorReentrant.target);

    const ifaceAgg = new ethers.Interface(["function swap(address,address,uint256,uint256) returns (uint256)"]);
    const data = ifaceAgg.encodeFunctionData("swap", [token.target, token.target, ethers.parseEther("1"), 0]);

    // Call should revert (aggregator call will fail and Sweeper will revert with AGGREGATOR_CALL_FAILED)
    await expect(
      sweeper.connect(user).sweepAndSwap(
        permit2.target,
        "0x",
        [token.target],
        [0],
        [ethers.MaxUint256],
        8,
        token.target,
        [data],
        false
      )
    ).to.be.revertedWith("AGGREGATOR_CALL_FAILED");
  });

  it("respects explicit gas limits (out-of-gas) when caller sets too-small gas", async () => {
    // Create many tokens to increase loop work
    const tokens = [];
    const datas = [];
    const MockToken = MockERC20;
    for (let i = 0; i < 40; i++) {
      const t = await MockToken.deploy("TK", "TK");
        await t.waitForDeployment();
      await t.mint(await user.getAddress(), ethers.parseEther("1"));
      await t.connect(user).approve(permit2.target, ethers.parseEther("1"));
      tokens.push(t.target);
      const ifaceAgg = new ethers.Interface(["function swap(address,address,uint256,uint256) returns (uint256)"]);
      datas.push(ifaceAgg.encodeFunctionData("swap", [t.target, t.target, ethers.parseEther("1"), 0]));
    }

    // Attempt to send the transaction with an intentionally too-small gas limit. The
    // provider may reject the submission with a message indicating the required gas
    // is higher than supplied. Assert that the submission fails for that reason.
    try {
      await sweeper.connect(user).sweepAndSwap(
        permit2.target,
        "0x",
        tokens,
        new Array(tokens.length).fill(0),
        new Array(tokens.length).fill(ethers.MaxUint256),
        8,
        tokens[0],
        datas,
        true,
        { gasLimit: 100000 }
      );
      // If the call unexpectedly succeeds, fail the test
      expect.fail("Transaction unexpectedly succeeded with too-low gas limit");
    } catch (err) {
      // Provider may report a helpful message about required gas; accept either
      // that or a generic revert. Ensure we got an error we can inspect.
      const msg = err && err.message ? err.message : String(err);
      expect(msg).to.match(/requires at least|gas required|intrinsic gas/i);
    }
  });

  it("handles many tokens in a single call (scale test)", async () => {
    // Point Sweeper to standard aggregating mock
    await sweeper.setAggregator(aggregator.target);

    const tokens = [];
    const datas = [];
    for (let i = 0; i < 20; i++) {
      const t = await MockERC20.deploy("TK", "TK");
        await t.waitForDeployment();
      await t.mint(await user.getAddress(), ethers.parseEther("1"));
      await t.connect(user).approve(permit2.target, ethers.parseEther("1"));
      tokens.push(t.target);
      const ifaceAgg = new ethers.Interface(["function swap(address,address,uint256,uint256) returns (uint256)"]);
      datas.push(ifaceAgg.encodeFunctionData("swap", [t.target, t.target, ethers.parseEther("1"), 0]));
    }

    // Should not revert and should credit the user with target tokens
    await expect(
      sweeper.connect(user).sweepAndSwap(
        permit2.target,
        "0x",
        tokens,
        new Array(tokens.length).fill(0),
        new Array(tokens.length).fill(ethers.MaxUint256),
        8,
        tokens[0],
        datas,
        true
      )
    ).to.not.be.reverted;
  });

});

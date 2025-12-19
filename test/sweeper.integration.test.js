const { expect } = require('chai')
const { ethers } = require('hardhat')

describe('Sweeper integration (local mocks)', function () {
  let deployer, user
  let MockERC20, MockPermit2, MockAggregator, MockPriceOracle, Sweeper

  beforeEach(async function () {
    [deployer, user] = await ethers.getSigners()

    MockERC20 = await ethers.getContractFactory('MockERC20', deployer)
    MockPermit2 = await ethers.getContractFactory('MockPermit2', deployer)
    MockAggregator = await ethers.getContractFactory('MockAggregator', deployer)
    MockPriceOracle = await ethers.getContractFactory('MockPriceOracle', deployer)
    Sweeper = await ethers.getContractFactory('Sweeper', deployer)

    // Deploy mocks
    this.tokenA = await MockERC20.deploy('TokenA', 'TKA')
    await this.tokenA.deployed()
    this.target = await MockERC20.deploy('Target', 'TGT')
    await this.target.deployed()

    this.permit2 = await MockPermit2.deploy()
    await this.permit2.deployed()

    this.aggregator = await MockAggregator.deploy()
    await this.aggregator.deployed()

    this.priceOracle = await MockPriceOracle.deploy()
    await this.priceOracle.deployed()

    // Deploy Sweeper with aggregator and price oracle
    this.sweeper = await Sweeper.deploy(this.aggregator.address, this.priceOracle.address)
    await this.sweeper.deployed()

    // Mint tokens to user
    const amount = ethers.utils.parseUnits('10', 18)
    await this.tokenA.mint(user.address, amount)
    // target token need not be minted; aggregator will mint

    // Set price for tokenA to $1 with 8 decimals (1 * 10^8)
    await this.priceOracle.setPrice(this.tokenA.address, ethers.BigNumber.from('100000000'), 8)
  })

  it('sweeps a token and swaps to target using mocks', async function () {
    const amount = ethers.utils.parseUnits('10', 18)

  // Build permit calldata using the same ABI the frontend uses (PermitBatch)
  const permitIface = new ethers.utils.Interface(['function permit(address owner, tuple(address[] tokens, uint160[] amounts, uint48[] expirations, uint48[] nonces, address[] spenders) permit, bytes signature)'])
  const tokensArr = [this.tokenA.address]
  const amountsArr = [amount]
  const expirations = [Math.floor(Date.now() / 1000) + 3600]
  const nonces = [0]
  const spenders = [this.sweeper.address]
  const permitTuple = [tokensArr, amountsArr, expirations, nonces, spenders]
  const permitCalldata = permitIface.encodeFunctionData('permit', [user.address, permitTuple, '0x'])

  // Build swap calldata: call aggregator.swap(fromToken, toToken, amountIn, minOut)
    const aggIface = new ethers.utils.Interface(['function swap(address,address,uint256,uint256) returns (uint256)'])
    const swapData = aggIface.encodeFunctionData('swap', [this.tokenA.address, this.target.address, amount, 0])

    // Call sweepAndSwap from user
    const tokens = [this.tokenA.address]
    const minPrices = [0]
    const maxPrices = [ethers.constants.MaxUint256]
    const priceDecimals = 8
    const target = this.target.address
    const swapCallData = [swapData]

  // Use permit calldata built above and call Sweeper (Sweeper will forward to MockPermit2WithPermit)

    // Execute sweepAndSwap
    // Deploy a permit-capable MockPermit2 and use its address
    const MockPermit2WithPermit = await ethers.getContractFactory('MockPermit2WithPermit', deployer)
    const permit2With = await MockPermit2WithPermit.deploy()
    await permit2With.deployed()

    await expect(
      this.sweeper.connect(user).sweepAndSwap(
        permit2With.address,
        permitCalldata,
        tokens,
        minPrices,
        maxPrices,
        priceDecimals,
        target,
        swapCallData,
        false // partialSuccess = false
      )
    ).to.emit(permit2With, 'PermitCalled')

    // Check aggregator received expected amount
    const last = await this.aggregator.lastAmountIn()
    expect(last).to.equal(amount)

    // After sweep, user should have received target tokens equal to amount (mock aggregator mints 1:1)
    const userTargetBal = await this.target.balanceOf(user.address)
    expect(userTargetBal).to.equal(amount)
  })

  it('reverts when permit calldata targets wrong owner', async function () {
    const amount = ethers.utils.parseUnits('5', 18)

    // Build incorrect permit calldata that claims deployer as owner instead of user
    const permitIface = new ethers.utils.Interface(['function permit(address owner, tuple(address[] tokens, uint160[] amounts, uint48[] expirations, uint48[] nonces, address[] spenders) permit, bytes signature)'])
    const tokensArr = [this.tokenA.address]
    const amountsArr = [amount]
    const expirations = [Math.floor(Date.now() / 1000) + 3600]
    const nonces = [0]
    const spenders = [this.sweeper.address]
    const permitTuple = [tokensArr, amountsArr, expirations, nonces, spenders]
    const badPermitCalldata = permitIface.encodeFunctionData('permit', [deployer.address, permitTuple, '0x'])

    const aggIface = new ethers.utils.Interface(['function swap(address,address,uint256,uint256) returns (uint256)'])
    const swapData = aggIface.encodeFunctionData('swap', [this.tokenA.address, this.target.address, amount, 0])

    const tokens = [this.tokenA.address]
    const minPrices = [0]
    const maxPrices = [ethers.constants.MaxUint256]
    const priceDecimals = 8
    const target = this.target.address
    const swapCallData = [swapData]

    // Expect revert because permit will set allowance for deployer, not user, so transferFrom will fail
    await expect(
      this.sweeper.connect(user).sweepAndSwap(
        /* permit2 */ this.permit2.address,
        badPermitCalldata,
        tokens,
        minPrices,
        maxPrices,
        priceDecimals,
        target,
        swapCallData,
        false
      )
    ).to.be.reverted
  })

  it('partialSuccess: one swap fails while the other succeeds', async function () {
    // Setup two tokens
    const tokenB = await (await ethers.getContractFactory('MockERC20', deployer)).deploy('TokenB', 'TKB')
    await tokenB.deployed()
    // Mint balances
  const amtA = ethers.utils.parseUnits('3', 18)
  const amtB = ethers.utils.parseUnits('5', 18)
  await this.tokenA.mint(user.address, amtA)
  await tokenB.mint(user.address, amtB)
  const balA = await this.tokenA.balanceOf(user.address)
  const balB = await tokenB.balanceOf(user.address)

    // Set prices so they pass
    await this.priceOracle.setPrice(this.tokenA.address, ethers.BigNumber.from('100000000'), 8)
    await this.priceOracle.setPrice(tokenB.address, ethers.BigNumber.from('100000000'), 8)

    // Build PermitBatch calldata for both tokens
    const permitIface = new ethers.utils.Interface(['function permit(address owner, tuple(address[] tokens, uint160[] amounts, uint48[] expirations, uint48[] nonces, address[] spenders) permit, bytes signature)'])
    const tokensArr = [this.tokenA.address, tokenB.address]
  const amountsArr = [balA, balB]
    const expirations = [Math.floor(Date.now() / 1000) + 3600, Math.floor(Date.now() / 1000) + 3600]
    const nonces = [0, 0]
    const spenders = [this.sweeper.address, this.sweeper.address]
    const permitTuple = [tokensArr, amountsArr, expirations, nonces, spenders]
    const permitCalldata = permitIface.encodeFunctionData('permit', [user.address, permitTuple, '0x'])

    // Build swap calldata: first aggregator call succeeds, second is invalid and will revert
    const aggIface = new ethers.utils.Interface(['function swap(address,address,uint256,uint256) returns (uint256)'])
  const swapGood = aggIface.encodeFunctionData('swap', [this.tokenA.address, this.target.address, balA, 0])
    const swapBad = '0xdeadbeef'

    const tokens = [this.tokenA.address, tokenB.address]
    const minPrices = [0, 0]
    const maxPrices = [ethers.constants.MaxUint256, ethers.constants.MaxUint256]
    const priceDecimals = 8
    const target = this.target.address
    const swapCallData = [swapGood, swapBad]

    // Deploy MockPermit2WithPermit
    const MockPermit2WithPermit = await ethers.getContractFactory('MockPermit2WithPermit', deployer)
    const permit2With = await MockPermit2WithPermit.deploy()
    await permit2With.deployed()

    // Call sweepAndSwap with partialSuccess = true so one failing swap doesn't revert the whole tx
    await expect(
      this.sweeper.connect(user).sweepAndSwap(
        permit2With.address,
        permitCalldata,
        tokens,
        minPrices,
        maxPrices,
        priceDecimals,
        target,
        swapCallData,
        true // partialSuccess = true
      )
    ).to.not.be.reverted

    // Check user received target for tokenA
  const userTargetBal = await this.target.balanceOf(user.address)
  expect(userTargetBal).to.equal(balA)

    // Check tokenB was refunded to user
  const userBbal = await tokenB.balanceOf(user.address)
  expect(userBbal).to.equal(balB)
  })

  it('aggregator revert behavior respects partialSuccess flag', async function () {
  const amt = ethers.utils.parseUnits('2', 18)
  await this.tokenA.mint(user.address, amt)
  const bal = await this.tokenA.balanceOf(user.address)
  await this.priceOracle.setPrice(this.tokenA.address, ethers.BigNumber.from('100000000'), 8)

    // Build permit and swap calldata
    const permitIface = new ethers.utils.Interface(['function permit(address owner, tuple(address[] tokens, uint160[] amounts, uint48[] expirations, uint48[] nonces, address[] spenders) permit, bytes signature)'])
  const tokensArr = [this.tokenA.address]
  const amountsArr = [bal]
    const expirations = [Math.floor(Date.now() / 1000) + 3600]
    const nonces = [0]
    const spenders = [this.sweeper.address]
    const permitTuple = [tokensArr, amountsArr, expirations, nonces, spenders]
    const permitCalldata = permitIface.encodeFunctionData('permit', [user.address, permitTuple, '0x'])

    const aggIface = new ethers.utils.Interface(['function swap(address,address,uint256,uint256) returns (uint256)'])
  const swapData = aggIface.encodeFunctionData('swap', [this.tokenA.address, this.target.address, bal, 0])

    // Set aggregator to revert on any call
    await this.aggregator.setShouldRevert(true)

    // Deploy permit2 mock
    const MockPermit2WithPermit = await ethers.getContractFactory('MockPermit2WithPermit', deployer)
    const permit2With = await MockPermit2WithPermit.deploy()
    await permit2With.deployed()

    // partialSuccess = true => should not revert but token refunded
    await expect(
      this.sweeper.connect(user).sweepAndSwap(
        permit2With.address,
        permitCalldata,
        [this.tokenA.address],
        [0],
        [ethers.constants.MaxUint256],
        8,
        this.target.address,
        [swapData],
        true
      )
    ).to.not.be.reverted

    // user should still have original tokenA balance (refund)
  const balAfter = await this.tokenA.balanceOf(user.address)
  expect(balAfter).to.equal(bal)

    // partialSuccess = false => expect revert
    await expect(
      this.sweeper.connect(user).sweepAndSwap(
        permit2With.address,
        permitCalldata,
        [this.tokenA.address],
        [0],
        [ethers.constants.MaxUint256],
        8,
        this.target.address,
        [swapData],
        false
      )
    ).to.be.reverted

    // reset aggregator revert flag
    await this.aggregator.setShouldRevert(false)
  })

  it('price out-of-range handling respects partialSuccess', async function () {
    const amt = ethers.utils.parseUnits('4', 18)
    await this.tokenA.mint(user.address, amt)
    const bal = await this.tokenA.balanceOf(user.address)

    // Set token price to $1 (1e8)
    await this.priceOracle.setPrice(this.tokenA.address, ethers.BigNumber.from('100000000'), 8)

    // Build permit and swap calldata
    const permitIface = new ethers.utils.Interface(['function permit(address owner, tuple(address[] tokens, uint160[] amounts, uint48[] expirations, uint48[] nonces, address[] spenders) permit, bytes signature)'])
    const tokensArr = [this.tokenA.address]
    const amountsArr = [bal]
    const expirations = [Math.floor(Date.now() / 1000) + 3600]
    const nonces = [0]
    const spenders = [this.sweeper.address]
    const permitTuple = [tokensArr, amountsArr, expirations, nonces, spenders]
    const permitCalldata = permitIface.encodeFunctionData('permit', [user.address, permitTuple, '0x'])

    const aggIface = new ethers.utils.Interface(['function swap(address,address,uint256,uint256) returns (uint256)'])
    const swapData = aggIface.encodeFunctionData('swap', [this.tokenA.address, this.target.address, bal, 0])

    const minPriceTooHigh = [ethers.BigNumber.from('200000000')]
    const maxPrices = [ethers.constants.MaxUint256]

    const MockPermit2WithPermit = await ethers.getContractFactory('MockPermit2WithPermit', deployer)
    const permit2With = await MockPermit2WithPermit.deploy()
    await permit2With.deployed()

    // partialSuccess = true -> should not revert and token refunded
    await expect(
      this.sweeper.connect(user).sweepAndSwap(
        permit2With.address,
        permitCalldata,
        [this.tokenA.address],
        minPriceTooHigh,
        maxPrices,
        8,
        this.target.address,
        [swapData],
        true
      )
    ).to.not.be.reverted

    const balAfter = await this.tokenA.balanceOf(user.address)
    expect(balAfter).to.equal(bal)

    // partialSuccess = false -> should revert due to PRICE_CHECK_FAILED
    await expect(
      this.sweeper.connect(user).sweepAndSwap(
        permit2With.address,
        permitCalldata,
        [this.tokenA.address],
        minPriceTooHigh,
        maxPrices,
        8,
        this.target.address,
        [swapData],
        false
      )
    ).to.be.reverted
  })
})

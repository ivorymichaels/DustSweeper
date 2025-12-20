const { expect } = require('chai')
const { ethers } = require('hardhat')

describe('Sweeper integration (clean, ethers v6)', function () {
  let deployer, user

  beforeEach(async function () {
    [deployer, user] = await ethers.getSigners()

    const MockERC20 = await ethers.getContractFactory('MockERC20', deployer)
    const MockAggregator = await ethers.getContractFactory('MockAggregator', deployer)
    const MockPriceOracle = await ethers.getContractFactory('MockPriceOracle', deployer)
    const MockPermit2WithPermit = await ethers.getContractFactory('MockPermit2WithPermit', deployer)
    const Sweeper = await ethers.getContractFactory('Sweeper', deployer)

    this.tokenA = await MockERC20.deploy('TokenA', 'TKA')
    await this.tokenA.waitForDeployment()
    this.tokenB = await MockERC20.deploy('TokenB', 'TKB')
    await this.tokenB.waitForDeployment()
    this.target = await MockERC20.deploy('Target', 'TGT')
    await this.target.waitForDeployment()

    this.aggregator = await MockAggregator.deploy()
    await this.aggregator.waitForDeployment()

    this.priceOracle = await MockPriceOracle.deploy()
    await this.priceOracle.waitForDeployment()

    this.permit2With = await MockPermit2WithPermit.deploy()
    await this.permit2With.waitForDeployment()

    this.sweeper = await Sweeper.deploy(this.aggregator.target, this.priceOracle.target)
    await this.sweeper.waitForDeployment()

    await this.priceOracle.setPrice(this.tokenA.target, 100000000n, 8)
    await this.priceOracle.setPrice(this.tokenB.target, 100000000n, 8)
  })

  it('sweeps tokenA and swaps to target (happy path)', async function () {
    const amount = ethers.parseUnits('10', 18)
    await this.tokenA.mint(await user.getAddress(), amount)

    const permitIface = new ethers.Interface([
      'function permit(address owner, tuple(address[] tokens, uint160[] amounts, uint48[] expirations, uint48[] nonces, address[] spenders) permit, bytes signature)'
    ])
    const permitTuple = [[this.tokenA.target], [amount], [Math.floor(Date.now() / 1000) + 3600], [0], [this.sweeper.target]]
    const permitCalldata = permitIface.encodeFunctionData('permit', [await user.getAddress(), permitTuple, '0x'])

    const aggIface = new ethers.Interface(['function swap(address,address,uint256,uint256) returns (uint256)'])
    const swapData = aggIface.encodeFunctionData('swap', [this.tokenA.target, this.target.target, amount, 0])

    await this.sweeper.connect(user).sweepAndSwap(
      this.permit2With.target,
      permitCalldata,
      [this.tokenA.target],
      [0],
      [ethers.MaxUint256],
      8,
      this.target.target,
      [swapData],
      false
    )

    const userTargetBal = await this.target.balanceOf(await user.getAddress())
    expect(userTargetBal).to.equal(amount)
  })

  it('partialSuccess refunds failed swaps and succeeds others', async function () {
    const a = ethers.parseUnits('6', 18)
    const b = ethers.parseUnits('4', 18)
    await this.tokenA.mint(await user.getAddress(), a)
    await this.tokenB.mint(await user.getAddress(), b)

    const balA = await this.tokenA.balanceOf(await user.getAddress())
    const balB = await this.tokenB.balanceOf(await user.getAddress())

    const permitIface = new ethers.Interface([
      'function permit(address owner, tuple(address[] tokens, uint160[] amounts, uint48[] expirations, uint48[] nonces, address[] spenders) permit, bytes signature)'
    ])
    const permitTuple = [[this.tokenA.target, this.tokenB.target], [balA, balB], [Math.floor(Date.now() / 1000) + 3600, Math.floor(Date.now() / 1000) + 3600], [0, 0], [this.sweeper.target, this.sweeper.target]]
    const permitCalldata = permitIface.encodeFunctionData('permit', [await user.getAddress(), permitTuple, '0x'])

    const aggIface = new ethers.Interface(['function swap(address,address,uint256,uint256) returns (uint256)'])
    const good = aggIface.encodeFunctionData('swap', [this.tokenA.target, this.target.target, balA, 0])
    const bad = '0xdeadbeef'

    await expect(
      this.sweeper.connect(user).sweepAndSwap(
        this.permit2With.target,
        permitCalldata,
        [this.tokenA.target, this.tokenB.target],
        [0, 0],
        [ethers.MaxUint256, ethers.MaxUint256],
        8,
        this.target.target,
        [good, bad],
        true
      )
    ).to.not.be.reverted

    const userTargetBal = await this.target.balanceOf(await user.getAddress())
    expect(userTargetBal).to.equal(balA)

    const userBbal = await this.tokenB.balanceOf(await user.getAddress())
    expect(userBbal).to.equal(balB)
  })
})

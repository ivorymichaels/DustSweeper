// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IMintable {
    function mint(address to, uint256 amount) external returns (bool);
}

contract MockAggregator {
    bool public shouldRevert = false;
    uint256 public lastAmountIn;

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    // Simple swap function used by tests.
    // signature: swap(address fromToken, address toToken, uint256 amountIn, uint256 minOut)
    function swap(address fromToken, address toToken, uint256 amountIn, uint256 /*minOut*/) external returns (uint256 amountOut) {
        require(!shouldRevert, "AGGREGATOR_REVERT");
        // transfer from the caller (Sweeper) to this aggregator
        bool ok = IERC20Minimal(fromToken).transferFrom(msg.sender, address(this), amountIn);
        require(ok, "TRANSFER_FROM_FAILED");
        lastAmountIn = amountIn;
        // mint target token back to the Sweeper to simulate a swap result (1:1)
        if (toToken != address(0)) {
            IMintable(toToken).mint(msg.sender, amountIn);
            return amountIn;
        } else {
            // For ETH target, send nothing (tests will not hit this path)
            return 0;
        }
    }
}

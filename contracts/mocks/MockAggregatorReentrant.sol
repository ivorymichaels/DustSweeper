// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract MockAggregatorReentrant {
    bool public shouldRevert = false;

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    // Called by Sweeper via low-level call. Attempts to reenter the Sweeper by calling
    // sweepAndSwap on msg.sender (which will be the Sweeper contract address).
    // The call uses empty arrays so it's a minimal reentrant attempt.
    function swap(address /*fromToken*/, address /*toToken*/, uint256 /*amountIn*/, uint256 /*minOut*/) external returns (uint256) {
        require(!shouldRevert, "AGGGR_REVERT");

        // Attempt reentrant call into the Sweeper (msg.sender)
        bytes memory payload = abi.encodeWithSelector(
            bytes4(keccak256("sweepAndSwap(address,bytes,address[],uint256[],uint256[],uint8,address,bytes[],bool)")),
            address(0),
            bytes("") ,
            new address[](0),
            new uint256[](0),
            new uint256[](0),
            uint8(8),
            address(0),
            new bytes[](0),
            false
        );

        // This will attempt to call back into the Sweeper. If reentrancy protection is present,
        // this call should revert with "REENTRANCY" and cause the swap to fail.
        (bool ok, ) = msg.sender.call(payload);
        // If the reentrant call failed (expected when reentrancy guard is present),
        // revert to make the aggregator call itself fail. Sweeper will interpret a
        // failed aggregator call as AGGREGATOR_CALL_FAILED.
        if (!ok) {
            revert("REENTRANCY_BLOCKED");
        }

        return 0;
    }
}

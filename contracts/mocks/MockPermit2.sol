// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract MockPermit2 {
    // This mock simply forwards transferFrom requests to the underlying token.
    // Tests will arrange allowances on tokens so this call succeeds.

    event TransferFromCalled(address indexed from, address indexed to, address token, uint256 amount);

    function transferFrom(address from, address to, address token, uint256 amount) external returns (bool) {
        emit TransferFromCalled(from, to, token, amount);
        bool ok = IERC20Minimal(token).transferFrom(from, to, amount);
        require(ok, "TOKEN_TRANSFER_FAILED");
        return true;
    }
}

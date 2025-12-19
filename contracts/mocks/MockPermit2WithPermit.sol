// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IERC20WithSet {
    function setAllowance(address owner, address spender, uint256 amount) external returns (bool);
}

contract MockPermit2WithPermit {
    // This mock implements a simple `permit` that sets allowances on MockERC20 via setAllowance.
    // It ignores signatures for testing purposes.

    struct PermitBatch {
        address[] tokens;
        uint160[] amounts;
        uint48[] expirations;
        uint48[] nonces;
        address[] spenders;
    }

    event PermitCalled(address indexed owner, address[] tokens, uint160[] amounts);

    function permit(address owner, PermitBatch calldata permitData, bytes calldata /*signature*/) external {
        // For each token, call its setAllowance helper (available on MockERC20) so transferFrom by this contract will succeed
        for (uint i = 0; i < permitData.tokens.length; i++) {
            address tk = permitData.tokens[i];
            uint160 amt = permitData.amounts[i];
            // Best-effort: call setAllowance(owner, address(this), amt)
            // If token doesn't implement setAllowance, this will revert — acceptable in mocks.
            IERC20WithSet(tk).setAllowance(owner, address(this), uint256(amt));
        }
        emit PermitCalled(owner, permitData.tokens, permitData.amounts);
    }

    function transferFrom(address from, address to, address token, uint256 amount) external returns (bool) {
        bool ok = IERC20Minimal(token).transferFrom(from, to, amount);
        require(ok, "TOKEN_TRANSFER_FAILED");
        return true;
    }
}

// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.19;

/// @title Allowance Transfer
/// @notice Handles ERC20 token approvals and transfers via Permit2
interface IAllowanceTransfer {
    /// @notice Emitted whenever a user sets an allowance
    event AllowanceUpdated(
        address indexed owner,
        address indexed token,
        address indexed spender,
        uint160 amount,
        uint48 expiration,
        uint48 nonce
    );

    /// @notice Emitted whenever a transfer is performed with Permit2
    event Transfer(address indexed from, address indexed to, uint256 amount);

    struct AllowanceTransferDetails {
        address to;
        uint256 amount;
    }

    /// @notice A single token approval
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    /// @notice The permit data for a single token
    struct PermitSingle {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    /// @notice The permit data for multiple tokens
    struct PermitBatch {
        TokenPermissions[] permitted;
        uint256 nonce;
        uint256 deadline;
    }

    /// @notice Allows users to set ERC20 allowances via signature
    /// @param owner The token owner granting the allowance
    /// @param permitSingle The info for the single token approval
    /// @param signature The signature to validate the permit
    function permit(
        address owner,
        PermitSingle memory permitSingle,
        bytes calldata signature
    ) external;

    /// @notice Batched version of permit for multiple tokens
    function permit(
        address owner,
        PermitBatch memory permitBatch,
        bytes calldata signature
    ) external;

    /// @notice Transfer tokens using the allowance model
    function transferFrom(
        address from,
        address to,
        address token,
        uint256 amount
    ) external;

    /// @notice Batch version of transferFrom
    function transferFrom(
        address from,
        AllowanceTransferDetails[] calldata transfers
    ) external;
}

// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.19;

import {IAllowanceTransfer} from "./IAllowanceTransfer.sol";

/// @title Signature Transfer
/// @notice Functions for signature-based transfers
interface ISignatureTransfer {

    /// @notice Details for a transfer using a signed permit
    struct PermitTransferFrom {
        IAllowanceTransfer.TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    /// @notice TransferDetails contains the to and requestedAmount for a transfer
    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    /// @notice Thrown when the requested amount for a token is greater than the permitted amount
    error InvalidAmount(uint256 requested, uint256 permitted);

    /// @notice Thrown when the block.timestamp is greater than the deadline in the signed permit
    error SignatureExpired(uint256 signatureDeadline);

    /// @notice Thrown when the signature is invalid
    error InvalidSignature();

    /// @notice Allows for signature-based approval of transfers
    /// @param permit The permit data signed over by the owner
    /// @param transferDetails The spenders and amounts for each transferred token
    /// @param owner The owner of the tokens to be transferred
    /// @param signature The signature authorizing the transfer
    function permitTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;

    /// @notice Allows batched signature-based transfers
    /// @param permits The permit data signed over by the owner
    /// @param transferDetails The spenders and amounts for each transferred token
    /// @param owner The owner of the tokens being transferred
    /// @param signature The signature authorizing the transfers
    function permitTransferFrom(
        PermitTransferFrom[] calldata permits,
        SignatureTransferDetails[] calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;
}

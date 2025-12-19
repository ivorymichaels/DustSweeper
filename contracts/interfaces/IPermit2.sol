// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.19;

import {IAllowanceTransfer} from "./IAllowanceTransfer.sol";
import {ISignatureTransfer} from "./ISignatureTransfer.sol";
/// @title IPermit2
/// @notice Permit2 is a contract that can support both permit-style approvals and signature-based transfers
/// @dev This interface integrates both signature & allowance transfers
interface IPermit2 is IAllowanceTransfer, ISignatureTransfer {}


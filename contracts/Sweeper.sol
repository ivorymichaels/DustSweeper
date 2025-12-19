// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title Sweeper
/// @notice Sweeps multiple ERC20 tokens (using Permit2-style permits) and swaps them to a target token
/// using an on-chain aggregator. This contract is a secure, opinionated skeleton for the MVP
/// described by the user. It contains placeholders where production integrations (Permit2 types,
/// trusted price oracles, and concrete aggregator ABIs) must be wired in.

/// Minimal ERC20 interface used in this contract.
interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

import {IPermit2} from "./interfaces/IPermit2.sol";

/// Price oracle interface used to check USD price on-chain when available.
/// Implementations should return price with `decimals` precision (e.g. Chainlink style).
interface IPriceOracle {
    function getPriceUSD(address token) external view returns (uint256 price, uint8 decimals);
}

/// Simple Reentrancy guard (OpenZeppelin-like)
contract ReentrancyGuard {
    uint256 private _status;
    constructor() { _status = 1; }
    modifier nonReentrant() {
        require(_status == 1, "REENTRANCY");
        _status = 2;
        _;
        _status = 1;
    }
}

contract Sweeper is ReentrancyGuard {
    // Events
    event Swept(address indexed user, address indexed token, uint256 amountIn, address targetToken, uint256 amountOut);
    event SweepFailed(address indexed user, address indexed token, string reason);

    // Owner (minimal privileges: only to update aggregator / oracle if needed)
    address public immutable owner;

    // Aggregator contract that executes swaps (e.g., 1inch router). Set at deploy and can be updated by owner.
    address public aggregator;

    // Optional on-chain price oracle (e.g., Chainlink aggregator registry). Can be zero.
    IPriceOracle public priceOracle;

    // Internal temporary struct used to reduce stack variables inside the main loop.
    struct Temp {
        bool okPrice;
        uint256 price;
        uint8 decimals;
        uint256 normalizedPrice;
        uint256 amountIn;
        uint256 balBefore;
        uint256 balAfter;
        uint256 amountOut;
        bool success;
    }

    // Constructor sets owner and aggregator
    constructor(address _aggregator, address _priceOracle) {
        owner = msg.sender;
        aggregator = _aggregator;
        priceOracle = IPriceOracle(_priceOracle);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "ONLY_OWNER");
        _;
    }

    /// @notice Update the aggregator address (owner only). Keep owner privileges minimal.
    function setAggregator(address _aggregator) external onlyOwner {
        aggregator = _aggregator;
    }

    /// @notice Update the price oracle (owner only). A zero address disables on-chain price checks.
    function setPriceOracle(address _oracle) external onlyOwner {
        priceOracle = IPriceOracle(_oracle);
    }

    /// @notice Sweeps the caller's tokens using a Permit2 permit and swaps each token to the target token.
    /// @param permit2 Address of the Permit2 contract to call permit/transferFrom on.
    /// @param permitCalldata Arbitrary calldata to call `permit` on the Permit2 contract (encoded by frontend).
    /// @param tokens Array of token addresses to consider for sweeping.
    /// @param minPricesUSD Per-token minimum USD price (in `priceDecimals` units) allowed to sweep.
    /// @param maxPricesUSD Per-token maximum USD price (in `priceDecimals` units) allowed to sweep.
    /// @param priceDecimals The decimals used by min/max price values (e.g. 8 for Chainlink style).
    /// @param targetToken Address of the token to receive (use address(0) to represent native ETH).
    /// @param swapCallData Per-token aggregator calldata (the contract will `call` `aggregator` with this data).
    /// @param partialSuccess If true, continue on per-token failures; if false, revert the entire transaction on any swap failure.
    function sweepAndSwap(
        address permit2,
        bytes calldata permitCalldata,
        address[] calldata tokens,
        uint256[] calldata minPricesUSD,
        uint256[] calldata maxPricesUSD,
        uint8 priceDecimals,
        address targetToken,
        bytes[] calldata swapCallData,
        bool partialSuccess
    ) external payable nonReentrant {
        require(tokens.length == swapCallData.length, "ARRAY_LENGTH_MISMATCH");
        require(tokens.length == minPricesUSD.length && tokens.length == maxPricesUSD.length, "PRICE_ARRAY_MISMATCH");

        // Forward permit calldata to Permit2 if provided
        if (permitCalldata.length > 0) {
            _forwardPermit(permit2, permitCalldata);
        }

        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];

            Temp memory t;
            t.okPrice = true;
            t.amountOut = 0;

            // Price check (if oracle is set)
            if (address(priceOracle) != address(0)) {
                (t.price, t.decimals) = priceOracle.getPriceUSD(token);
                if (t.price == 0) {
                    t.okPrice = false;
                } else {
                    t.normalizedPrice = t.price;
                    if (t.decimals > priceDecimals) {
                        t.normalizedPrice = t.price / (10 ** (t.decimals - priceDecimals));
                    } else if (t.decimals < priceDecimals) {
                        t.normalizedPrice = t.price * (10 ** (priceDecimals - t.decimals));
                    }
                    if (t.normalizedPrice < minPricesUSD[i] || t.normalizedPrice > maxPricesUSD[i]) {
                        t.okPrice = false;
                    }
                }
            } else {
                t.okPrice = true;
            }

            if (!t.okPrice) {
                emit SweepFailed(msg.sender, token, "PRICE_OUT_OF_RANGE_OR_UNKNOWN");
                if (!partialSuccess) revert("PRICE_CHECK_FAILED");
                else continue;
            }

            // Query balance once
            t.amountIn = IERC20(token).balanceOf(msg.sender);
            if (t.amountIn == 0) {
                emit SweepFailed(msg.sender, token, "ZERO_BALANCE");
                if (!partialSuccess) revert("ZERO_BALANCE");
                else continue;
            }

            // Pull tokens from user via Permit2 (internal helper reduces stack usage)
            if (!_permit2Transfer(permit2, msg.sender, address(this), token, t.amountIn)) {
                emit SweepFailed(msg.sender, token, "PERMIT2_TRANSFER_FAILED");
                if (!partialSuccess) revert("PERMIT2_TRANSFER_FAILED");
                else continue;
            }

            // No calldata => refund and continue
            if (swapCallData[i].length == 0) {
                _safeTransfer(token, msg.sender, t.amountIn);
                emit SweepFailed(msg.sender, token, "NO_SWAP_CALLDATA");
                if (!partialSuccess) revert("NO_SWAP_CALLDATA");
                else continue;
            }

            // Approve aggregator
            _safeApprove(token, aggregator, t.amountIn);

            // For ERC20 target tokens, capture balance before calling aggregator (helps compute amountOut)
            if (targetToken != address(0)) {
                t.balBefore = IERC20(targetToken).balanceOf(address(this));
            }

            // Call aggregator
            (t.success, ) = _callAggregator(swapCallData[i]);
            if (!t.success) {
                emit SweepFailed(msg.sender, token, "AGGREGATOR_CALL_FAILED");
                // refund original token
                _safeTransfer(token, msg.sender, t.amountIn);
                if (!partialSuccess) revert("AGGREGATOR_CALL_FAILED");
                else continue;
            }

            // Forward swap results
            if (targetToken == address(0)) {
                // Native ETH: send contract's ETH balance
                uint256 balanceEth = address(this).balance;
                if (balanceEth > 0) {
                    (bool sent,) = payable(msg.sender).call{value: balanceEth}("");
                    if (!sent) {
                        emit SweepFailed(msg.sender, token, "ETH_TRANSFER_FAILED");
                        if (!partialSuccess) revert("ETH_TRANSFER_FAILED");
                        else continue;
                    }
                    t.amountOut = balanceEth;
                }
            } else {
                t.balAfter = IERC20(targetToken).balanceOf(address(this));
                if (t.balAfter > t.balBefore) {
                    t.amountOut = t.balAfter - t.balBefore;
                    _safeTransfer(targetToken, msg.sender, t.amountOut);
                } else {
                    // Nothing received: refund original token
                    _safeTransfer(token, msg.sender, t.amountIn);
                    emit SweepFailed(msg.sender, token, "NO_TARGET_RECEIVED");
                    if (!partialSuccess) revert("NO_TARGET_RECEIVED");
                    else continue;
                }
            }

            emit Swept(msg.sender, token, t.amountIn, targetToken, t.amountOut);
        }
    }

    // ------------------------
    // Helpers (extracted to reduce stack usage)
    // ---

    /// @dev Forward raw permit calldata to a Permit2 contract.
    function _forwardPermit(address permit2, bytes calldata permitCalldata) internal {
        (bool ok, bytes memory res) = permit2.call(permitCalldata);
        require(ok, string(abi.encodePacked("PERMIT_CALL_FAILED:", _shortRevertReason(res))));
    }

    /// @dev Low-level wrapper to call the aggregator with provided calldata.
    function _callAggregator(bytes calldata data) internal returns (bool success, bytes memory returnData) {
        (success, returnData) = aggregator.call{value: 0}(data);
    }

    /// @dev Safe ERC20 transfer wrapper which works with non-standard tokens
    function _safeTransfer(address token, address to, uint256 value) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FAILED");
    }

    /// @dev Safe ERC20 approve wrapper
    function _safeApprove(address token, address spender, uint256 value) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "APPROVE_FAILED");
    }

    /// @dev Short revert reason helper (returns ascii string)
    function _shortRevertReason(bytes memory returnData) internal pure returns (string memory) {
        if (returnData.length < 68) return "";
        assembly {
            returnData := add(returnData, 0x04)
        }
        return abi.decode(returnData, (string));
    }

    /// @dev Low-level Permit2 transfer call. Returns true on success.
    function _permit2Transfer(address permit2, address from, address to, address token, uint256 amount) internal returns (bool) {
        bytes4 sel = bytes4(keccak256("transferFrom(address,address,address,uint256)"));
        bytes memory data = abi.encodeWithSelector(
            sel,
            from,
            to,
            token,
            amount
        );
        (bool ok, ) = permit2.call(data);
        return ok;
    }

}


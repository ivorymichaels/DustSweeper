// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract MockPriceOracle {
    mapping(address => uint256) public price;
    mapping(address => uint8) public decimals;

    function setPrice(address token, uint256 _price, uint8 _decimals) external {
        price[token] = _price;
        decimals[token] = _decimals;
    }

    function getPriceUSD(address token) external view returns (uint256 p, uint8 d) {
        return (price[token], decimals[token]);
    }
}

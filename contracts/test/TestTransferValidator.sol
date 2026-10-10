// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Test-only validator that proves CreatorTokenBase calls a deployed contract.
/// Real policy behavior remains covered by the planned real-validator integration suite.
contract TestTransferValidator {
    function validateTransfer(address, address, address, uint256) external pure {}
}

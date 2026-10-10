// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./RulesetBase.sol";

/**
 * @title RulesetVanilla
 * @author Limit Break, Inc.
 * @notice A ruleset contract that allows all transfers and places no restrictions on flow of tokens.
 */
contract RulesetVanilla is IRuleset, RulesetBase {

    /**
     * @notice Validates a transfer of a Creator Token.
     *
     * @notice Global Options Used: None
     * @notice Ruleset-Specific Options Used: None
     *
     * @notice Validation Flow: This ruleset allows all transfers.
     */
    function validateTransfer(
        uint256 /*authorizerCheckType*/,
        address /*collection*/,
        address /*caller*/, 
        address /*from*/,
        address /*to*/,
        uint256 /*tokenId*/,
        uint256 /*amount*/) external view returns (bytes4) {
        return SELECTOR_NO_ERROR;
    }
}
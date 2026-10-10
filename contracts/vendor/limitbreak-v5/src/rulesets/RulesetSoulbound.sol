// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./RulesetBase.sol";

/**
 * @title RulesetSoulbound
 * @author Limit Break, Inc.
 * @notice A ruleset contract that blocks all transfers and allows no flow of tokens.
 */
contract RulesetSoulbound is IRuleset, RulesetBase {

    /**
     * @notice Validates a transfer of a Creator Token.
     *
     * @notice Global Options Used: None
     * @notice Ruleset-Specific Options Used: None
     *
     * @notice Validation Flow: This ruleset blocks all transfers.
     */
    function validateTransfer(
        uint256 /*authorizerCheckType*/,
        address /*collection*/,
        address /*caller*/, 
        address /*from*/,
        address /*to*/,
        uint256 /*tokenId*/,
        uint256 /*amount*/) external view returns (bytes4) {
        return CreatorTokenTransferValidator__TokenIsSoulbound.selector;
    }
}
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/** 
 * @title IRuleset
 * @author Limit Break, Inc.
 * @notice Interface for Creator Token Standards ruleset contracts.
 *
 * @dev Ruleset contracts are logic-gate contracts used to validate transfers of Creator Tokens
 *      (ERC20-C / ERC721-C / ERC1155-C). Rulesets are view-only, and may not contain any opcodes
 *      that could modify the state of the blockchain.
 */
interface IRuleset {

    /**
     * @notice Validates a transfer of a Creator Token.
     *
     * @param authorizerCheckType The type of authorizer check to perform.
     * @param collection          The address of the Creator Token contract.
     * @param caller              The address of the caller (msg.sender) of the transfer function.
     * @param from                The address of the sender of the token.
     * @param to                  The address of the recipient of the token.
     * @param tokenId             The ID of the token.
     * @param amount              The amount of the token to transfer.
     * @return 0x00000000 when the transfer is allowed, or a custom error selector to block a transfer.
     */
    function validateTransfer(
        uint256 authorizerCheckType,
        address collection,
        address caller, 
        address from, 
        address to,
        uint256 tokenId,
        uint256 amount) external view returns (bytes4);
}
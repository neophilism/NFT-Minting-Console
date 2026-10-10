// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/** 
 * @title IRulesetDelegateCall
 * @author Limit Break, Inc.
 * @notice Interface for delegate calling Creator Token Standards ruleset contracts.
 *
 * @dev Transfer validator implements this interface. It will STATICCALL itself to put itself into a 
 *      state where a ruleset check cannot possibly make any stateful changes, ensuring that they are always read-only.
 */
interface IRulesetDelegateCall {

    /**
     * @notice Validates a transfer of a Creator Token in the context of a STATICCALL.
     *
     * @param authorizerCheckType The type of authorizer check to perform.
     * @param collection          The address of the Creator Token contract.
     * @param caller              The address of the caller (msg.sender) of the transfer function.
     * @param from                The address of the sender of the token.
     * @param to                  The address of the recipient of the token.
     * @param tokenId             The ID of the token.
     * @param amount              The amount of the token to transfer.
     * @return 0x00000000 when the transfer is allowed, or a custom error selector to block a transfer.
     * @return The token type (20, 721, 1155) for use in permit transfer checks when applicable.
     */
    function validateTransferDelegateCall(
        uint256 authorizerCheckType,
        address collection,
        address caller, 
        address from, 
        address to,
        uint256 tokenId,
        uint256 amount) external view returns (bytes4,uint16);
}
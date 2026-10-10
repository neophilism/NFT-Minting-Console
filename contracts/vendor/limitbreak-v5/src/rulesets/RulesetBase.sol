// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../Constants.sol";
import "../DataTypes.sol";
import "../Errors.sol";
import "../ValidatorBase.sol";
import "../interfaces/IRuleset.sol";
import "../../tm-core-lib/src/utils/misc/Tloadish.sol";

/** 
* @title RulesetBase
* @author Limit Break, Inc.
* @notice Base contract that includes internal helper functions and diamond storage access that are
*         useful for implementations of Creator Token Standards ruleset contracts.
*/ 
abstract contract RulesetBase is ValidatorBase, Tloadish {

    /**
     * @dev Internal function to check if a caller is authorized to transfer a token/id/amount.
     * 
     * @param authorizerCheckType The type of authorizer check to perform.
     * @param collection          The address of the Creator Token contract.
     * @param caller              The address of the caller (msg.sender) of the transfer function.
     * @param tokenId             The ID of the token.
     * @param amount              The amount of the token to transfer.
     * 
     * @return isAuthorized       True if the caller is authorized to transfer the token, false otherwise.
     */
    function _isAuthorized(
        uint256 authorizerCheckType, 
        address collection,
        address caller,
        uint256 tokenId,
        uint256 amount
    ) internal view returns (bool isAuthorized) {
        isAuthorized = _getAuthorizerCheckFunctionPointer(authorizerCheckType)(
            collection, caller, tokenId, amount
        );
    }

    /**
     * @dev Internal function to get the function pointer for the authorizer check type.
     * 
     * @param authorizerCheckType The type of authorizer check to perform.
     * 
     * @return _callerAuthorizedCheck  The function pointer to the authorizer check function.
     */
    function _getAuthorizerCheckFunctionPointer(uint256 authorizerCheckType) internal pure returns (function(address,address,uint256, uint256) internal view returns(bool) _callerAuthorizedCheck) {
        if (authorizerCheckType == AUTHORIZER_CHECK_TYPE_TOKEN) {
            return _callerAuthorizedCheckToken;
        } else if (authorizerCheckType == AUTHORIZER_CHECK_TYPE_COLLECTION) {
            return _callerAuthorizedCheckCollection;
        } else {
            // The master validator handles the authorized amount check, so we won't do anything different here to use
            // the authorized amount and the amount parameter.
            // Current rulesets won't use this call, it is a placeholder for future ruleset use.
            return _callerAuthorizedCheckCollection;
        }
    }

    /**
     * @dev Internal function to check if a caller is an authorized operator for the token being transferred.
     * 
     * @param caller     The caller of the token transfer.
     * @param collection The collection address of the token being transferred.
     * @param tokenId    The id of the token being transferred.
     * 
     * @return isAuthorized  True if the caller is authorized to transfer the token, false otherwise.
     */
    function _callerAuthorizedCheckToken(
        address collection,
        address caller,
        uint256 tokenId,
        uint256 /*amount*/
    ) internal view returns (bool isAuthorized) {
        uint256 slotValue;
        (isAuthorized, ) = _callerAuthorized(caller, _getTransientOperatorSlot(collection, tokenId));
        if (isAuthorized) return true;
        (isAuthorized, slotValue) = _callerAuthorized(caller, _getTransientOperatorSlot(collection));
        isAuthorized = isAuthorized && slotValue >> 255 == 1;
    }

    /**
     * @dev Internal function to check if a caller is an authorized operator for the collection being transferred.
     * 
     * @param caller     The caller of the token transfer.
     * @param collection The collection address of the token being transferred.
     * 
     * @return isAuthorized  True if the caller is authorized to transfer the collection, false otherwise.
     */
    function _callerAuthorizedCheckCollection(
        address collection,
        address caller,
        uint256 /*tokenId*/,
        uint256 /*amount*/
    ) internal view returns (bool isAuthorized) {
        (isAuthorized, ) = _callerAuthorized(caller, _getTransientOperatorSlot(collection));
    }

    /**
     * @dev Internal function to check if a caller is an authorized operator. 
     * @dev This overload of `_callerAuthorized` checks a specific storage slot for the caller address.
     * 
     * @param caller     The caller of the token transfer.
     * @param slot       The storage slot to check for the caller address.
     * 
     * @return isAuthorized  True if the caller is authorized to transfer the token, false otherwise.
     * @return slotValue     The transient storage value in `slot`, used to check for allow any token id flag if necessary.
     */
    function _callerAuthorized(address caller, uint256 slot) internal view returns (bool isAuthorized, uint256 slotValue) {
        slotValue = _getTstorish(slot);
        address authorizedOperator = address(uint160(slotValue));
        isAuthorized = authorizedOperator == WILDCARD_OPERATOR_ADDRESS || authorizedOperator == caller;
    }

    /**
     * @dev Internal function to check if an address is an EOA in EIP-7702 delegation mode, and what address
     *      it is delegated to.
     * 
     * @param _address   The account to check for EIP-7702 delegation.
     * 
     * @return isDelegate True if the account is an EOA with an EIP-7702 delegate attached, false otherwise.
     * @return delegate   The address of the EIP-7702 delegate code, if one is attached.
     */
    function _check7702(address _address) internal view returns (bool isDelegate, address delegate) {
        assembly ("memory-safe") {
            mstore(0x00, 0x00)
            extcodecopy(_address, 0x1D, 0x00, 0x17)
            if eq(mload(0x00), 0xEF0100) {
                isDelegate := 1
                delegate := shr(0x60, mload(0x20))
            }
        }
    }
}
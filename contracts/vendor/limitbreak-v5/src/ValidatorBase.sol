// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./DataTypes.sol";
import "./Errors.sol";

/**
 * @title ValidatorBase
 * @author Limit Break, Inc.
 * @notice Base contract for all Creator Token Validator, Module, and Ruleset contracts. 
 *         Includes some helper functions and modifiers and easy access to validator diamond storage
 *         to allow modules and rulesets to access the storage of the validator contract.
 */
contract ValidatorBase {

    /*************************************************************************/
    /*                               MODIFIERS                               */
    /*************************************************************************/

    /**
     * @dev This modifier restricts a function call to the owner of the list `id`.
     * @dev Throws when the caller is not the list owner.
     */
    modifier onlyListOwner(uint48 id) {
        _requireCallerOwnsList(id);
        _;
    }

    /*************************************************************************/
    /*                                HELPERS                                */
    /*************************************************************************/

    /**
     * @notice Requires the caller to be the owner of list `id`.
     * 
     * @dev    Throws when the caller is not the owner of the list.
     * 
     * @param id  The id of the list to check ownership of.
     */
    function _requireCallerOwnsList(uint48 id) private view {
        if (msg.sender != validatorStorage().listOwners[id]) {
            revert CreatorTokenTransferValidator__CallerDoesNotOwnList();
        }
    }

    /**
     * @dev Internal function used to compute the transient storage slot for the authorized 
     *      operator of a token in a collection.
     * 
     * @param collection The collection address of the token being transferred.
     * @param tokenId    The id of the token being transferred.
     * 
     * @return operatorSlot The storage slot location for the authorized operator value.
     */
    function _getTransientOperatorSlot(
        address collection, 
        uint256 tokenId
    ) internal pure returns (uint256 operatorSlot) {
        assembly {
            mstore(0x00, collection)
            mstore(0x20, tokenId)
            operatorSlot := shr(4, keccak256(0x00, 0x40))
       }
    }

    /**
     * @dev Internal function used to compute the transient storage slot for the authorized operator of a collection.
     * 
     * @param collection The collection address of the token being transferred.
     * 
     * @return operatorSlot The storage slot location for the authorized operator value.
     */
    function _getTransientOperatorSlot(address collection) internal view returns (uint256 operatorSlot) {
        mapping (address => address) storage _transientOperator = validatorStorage().transientOperator;
        assembly {
            mstore(0x00, collection)
            mstore(0x20, _transientOperator.slot)
            operatorSlot := keccak256(0x00, 0x40)
        }
    }

    /**
     * @dev Internal function used to efficiently retrieve the code length of `account`.
     * 
     * @param account The address to get the deployed code length for.
     * 
     * @return length The length of deployed code at the address.
     */
    function _getCodeLengthAsm(address account) internal view returns (uint256 length) {
        assembly { length := extcodesize(account) }
    }

    /**
     * @dev Internal function used to efficiently retrieve the codehash of `account`.
     * 
     * @param account The address to get the deployed codehash for.
     * 
     * @return codehash The codehash of the deployed code at the address.
     */
    function _getCodeHashAsm(address account) internal view returns (bytes32 codehash) {
        assembly { codehash := extcodehash(account) }
    }

    /**
     * @notice Returns true if the `flagValue` has the `flag` set, false otherwise.
     *
     * @dev    This function uses the bitwise AND operator to check if the `flag` is set in `flagValue`.
     *
     * @param flagValue  The value to check for the presence of the `flag`.
     * @param flag       The flag to check for in the `flagValue`.
     */
    function _isFlagSet(uint256 flagValue, uint256 flag) internal pure returns (bool flagSet) {
        flagSet = (flagValue & flag) != 0;
    }

    /*************************************************************************/
    /*                                STORAGE                                */
    /*************************************************************************/

    /// @dev The base storage slot for Validator V5 contract storage items.
    bytes32 constant DIAMOND_STORAGE_VALIDATOR = 
        0x0000000000000000000000000000000000000000000000000000000000721C05;

    /**
     * @dev Returns a storage object that follows the Diamond standard storage pattern for
     * @dev contract storage across multiple module contracts.
     */
    function validatorStorage() internal pure returns (ValidatorStorage storage diamondStorage) {
        bytes32 slot = DIAMOND_STORAGE_VALIDATOR;
        assembly {
            diamondStorage.slot := slot
        }
    }
}
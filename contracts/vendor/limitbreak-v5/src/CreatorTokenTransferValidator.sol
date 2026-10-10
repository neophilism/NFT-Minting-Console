// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./Constants.sol";
import "./DataTypes.sol";
import "./Errors.sol";
import "./ValidatorBase.sol";
import "./interfaces/IRuleset.sol";
import "./interfaces/IRulesetDelegateCall.sol";
import "@limitbreak/permit-c/PermitC.sol";
import "../tm-core-lib/src/utils/introspection/ERC165.sol";
import "../tm-core-lib/src/utils/structs/EnumerableSet.sol";
import "../tm-core-lib/src/utils/token/IEOARegistry.sol";
import "../tm-core-lib/src/utils/token/ITransferValidator.sol";
import "../tm-core-lib/src/utils/misc/Tstorish.sol";

/**
 * @title  CreatorTokenTransferValidator
 * @author Limit Break, Inc.
 * @notice The CreatorTokenTransferValidator contract is designed to provide a customizable and secure transfer 
 *         validation mechanism for NFT collections. This contract allows the owner of an NFT collection to choose a 
 *         validation ruleset to apply to their collection, global and ruleset-specific options to fine-tune validation
 *         behavior, and manage blacklists/whitelists/authorizer/expansion lists and expansion settings for rulesets.
 */
contract CreatorTokenTransferValidator is 
IEOARegistry, 
ITransferValidator, 
ValidatorBase, 
ERC165, 
Tstorish, 
PermitC {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    /*************************************************************************/
    /*                                EVENTS                                 */
    /*************************************************************************/

    /// @dev Emitted when a new list is created.
    event CreatedList(uint256 indexed id, string name);

    /// @dev Emitted when the ownership of a list is transferred to a new owner.
    event ReassignedListOwnership(uint256 indexed id, address indexed newOwner);

    /*************************************************************************/
    /*                               CONSTANTS                               */
    /*************************************************************************/

    /// @dev The address of the EOA Registry to use to validate an account is a verified EOA.
    address private immutable _eoaRegistry;

    /// @dev The address of the management module that implements list and collection settings management.
    address private immutable _managementModule;

    /// @dev The address of the safe delegate module that implements the safe delegate code checker.
    address private immutable _safeDelegateModule;

    constructor(
        address defaultOwner,
        address eoaRegistry_,
        address managementModule_,
        address safeDelegateModule_,
        string memory name,
        string memory version
    ) 
    Tstorish()
    PermitC(
        name,
        version,
        defaultOwner,
        block.chainid == 1 ? 0.33 ether : 0.01 ether
    ) {
        if (defaultOwner == address(0) || 
            eoaRegistry_ == address(0) || eoaRegistry_.code.length == 0 ||
            managementModule_ == address(0) || managementModule_.code.length == 0 ||
            safeDelegateModule_ == address(0) || safeDelegateModule_.code.length == 0) {
            revert CreatorTokenTransferValidator__InvalidConstructorArgs();
        }

        _createDefaultList(defaultOwner);

        _eoaRegistry = eoaRegistry_;
        _managementModule = managementModule_;
        _safeDelegateModule = safeDelegateModule_;
    }

    /**
     * @dev This function is only called during contract construction to create the default list.
     */
    function _createDefaultList(address defaultOwner) internal {
        uint48 id = 0;

        validatorStorage().listOwners[id] = defaultOwner;

        emit CreatedList(id, "DEFAULT LIST");
        emit ReassignedListOwnership(id, defaultOwner);
    }

    /*************************************************************************/
    /*                               MODIFIERS                               */
    /*************************************************************************/

    /**
     * @dev This modifier delegatecalls the specified module with the exact same calldata
     *      that came into the function, properly handling returndata when necessary.
     *      Assumes that the complete implementation of a function call is done in an external
     *      module.
     */
    modifier delegateCall(address module) {
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), module, 0, calldatasize(), 0, 0)
            let size := returndatasize()
            returndatacopy(0, 0, size)
            if iszero(result) {
                revert(0, size)
            }
            return(0, size)
        }
        _;
    }

    /*************************************************************************/
    /*                               RULESET ADMIN                           */
    /*************************************************************************/

    /**
     * @notice Registers a ruleset to be used for transfer validation.
     * 
     * @notice The ruleset must be a contract and goes through a sanitization / purity check process.
     *         The ruleset may not contain any banned opcodes (either undefined as of Prague or any known opcode that
     *         carries any risk of making state changes on the EVM). 
     *
     * @dev    Throws if the `msg.sender` does not own the default list (validator admin).
     * @dev    Throws if codehash of the ruleset denotes that it is either an uninitialized account or is an EOA.
     * @dev    Throws if the ruleset is not pure (meaning that it contains an invalid or banned opcode).
     *
     * @dev <h4>Postconditions:</h4>
     *      1. The ruleset is marked as registered in the validator storage.
     *      2. A `RulesetRegistered` event is emitted, the first time the ruleset is registered.
     *         (Subsequent registrations of the same ruleset do not emit this event).
     *
     * @param ruleset The address of the ruleset to register.
     */
    function registerRuleset(address ruleset) external delegateCall(_safeDelegateModule) {}

    /**
     * @notice Binds a ruleset to a ruleset ID.
     * 
     * @dev    Throws if the `msg.sender` does not own the default list (validator admin).
     * @dev    Throws if the ruleset is not registered.
     * @dev    Throws if the ruleset ID is RULESET_ID_FIXED_OR_CUSTOM, as this is reserved for fixed rulesets that do not follow the
     *         automatic update process.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. The ruleset is bound to the ruleset ID.
     *      2. A `RulesetBindingUpdated` event is emitted to indicate the ruleset binding has been updated.
     *         (If the ruleset is already bound to the ruleset ID, no event is emitted).
     *
     * @param rulesetId The ID of the ruleset to bind.
     * @param ruleset The address of the ruleset to bind.
     */
    function bindRuleset(uint8 rulesetId, address ruleset) external delegateCall(_safeDelegateModule) {}

    /*************************************************************************/
    /*                          APPLY TRANSFER POLICIES                      */
    /*************************************************************************/

    /**
     * @notice Apply the collection ruleset and options to a transfer operation of a creator token.
     *
     * @dev If the caller is self (Permit-C Processor) it means we have already applied operator validation in the 
     *      _beforeTransferFrom callback.  In this case, the security policy was already applied and the operator
     *      that used the Permit-C processor passed the security policy check and transfer can be safely allowed.
     *
     * @dev Modular rulesets with options determine the logic governing transfers.
     *
     * @dev Throws when the ruleset returns a non-zero error selector.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. Transfer is allowed or denied based on the ruleset.
     *
     * @param caller      The address initiating the transfer.
     * @param from        The address of the token owner.
     * @param to          The address of the token receiver.
     */
    function validateTransfer(address caller, address from, address to) public view {
        (bytes4 errorSelector,) = _validateTransfer(AUTHORIZER_CHECK_TYPE_COLLECTION, msg.sender, caller, from, to, 0, 0);
        if (errorSelector != SELECTOR_NO_ERROR) {
            _revertCustomErrorSelectorAsm(errorSelector);
        }
    }

    /**
     * @notice Apply the collection ruleset and options to a transfer operation of a creator token.
     *
     * @dev If the caller is self (Permit-C Processor) it means we have already applied operator validation in the 
     *      _beforeTransferFrom callback.  In this case, the security policy was already applied and the operator
     *      that used the Permit-C processor passed the security policy check and transfer can be safely allowed.
     *
     * @dev Modular rulesets with options determine the logic governing transfers.
     *
     * @dev Throws when the ruleset returns a non-zero error selector.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. Transfer is allowed or denied based on the ruleset.
     *
     * @param caller      The address initiating the transfer.
     * @param from        The address of the token owner.
     * @param to          The address of the token receiver.
     * @param tokenId     The token id being transferred.
     */
    function validateTransfer(address caller, address from, address to, uint256 tokenId) public view {
        (bytes4 errorSelector,) = _validateTransfer(AUTHORIZER_CHECK_TYPE_TOKEN, msg.sender, caller, from, to, tokenId, 0);
        if (errorSelector != SELECTOR_NO_ERROR) {
            _revertCustomErrorSelectorAsm(errorSelector);
        }
    }

    /**
     * @notice Apply the collection ruleset and options to a transfer operation of a creator token.
     *
     * @dev If the caller is self (Permit-C Processor) it means we have already applied operator validation in the 
     *      _beforeTransferFrom callback.  In this case, the security policy was already applied and the operator
     *      that used the Permit-C processor passed the security policy check and transfer can be safely allowed.
     *
     * @dev Modular rulesets with options determine the logic governing transfers.
     *
     * @dev Throws when the ruleset returns a non-zero error selector.
     * @dev Throws when authorization mode with amounts are active and the amount exceeds the authorization amount.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. Transfer is allowed or denied based on the ruleset.
     *
     * @param caller      The address initiating the transfer.
     * @param from        The address of the token owner.
     * @param to          The address of the token receiver.
     * @param tokenId     The token id being transferred.
     * @param amount      The amount of the token being transferred.
     */
    function validateTransfer(address caller, address from, address to, uint256 tokenId, uint256 amount) external {
        (bytes4 errorSelector,) = _validateTransfer(AUTHORIZER_CHECK_TYPE_TOKEN_AND_AMOUNT, msg.sender, caller, from, to, tokenId, amount);
        if (errorSelector != SELECTOR_NO_ERROR) {
            _revertCustomErrorSelectorAsm(errorSelector);
        }

        uint256 collectionAndTokenIdSlot = _getTransientOperatorSlot(msg.sender, tokenId);
        if (_getTstorish(collectionAndTokenIdSlot) != 0) {
            uint256 amountSlot = collectionAndTokenIdSlot + 1;
            uint256 authorizedAmount = _getTstorish(amountSlot);

            if (amount > authorizedAmount) {
                revert CreatorTokenTransferValidator__AmountExceedsAuthorization();
            }

            unchecked {
                _setTstorish(amountSlot, authorizedAmount - amount);
            }
        }
    }

    /**
     * @notice Apply the collection ruleset and options to a transfer operation of a creator token.
     *
     * @dev If the caller is self (Permit-C Processor) it means we have already applied operator validation in the 
     *      _beforeTransferFrom callback.  In this case, the security policy was already applied and the operator
     *      that used the Permit-C processor passed the security policy check and transfer can be safely allowed.
     *
     * @dev Modular rulesets with options determine the logic governing transfers.
     *
     * @dev Throws when the ruleset returns a non-zero error selector.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. Transfer is allowed or denied based on the ruleset.
     *
     * @param caller      The address initiating the transfer.
     * @param from        The address of the token owner.
     * @param to          The address of the token receiver.
     */
    function applyCollectionTransferPolicy(address caller, address from, address to) external view {
        validateTransfer(caller, from, to);
    }

    /**
     * @notice Sets an operator for an authorized transfer that skips transfer security level
     *         validation for caller and receiver constraints.
     * 
     * @dev    An authorizer *MUST* clear the authorization with a call to `afterAuthorizedTransfer`
     *         to prevent unauthorized transfers of the token.
     * 
     * @dev    Throws when authorization mode is disabled for the collection.
     * @dev    Throws when using the wildcard operator address and the collection does not allow
     *         for wildcard authorized operators.
     * @dev    Throws when the caller is not an allowed authorizer for the collection.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. The `operator` is stored as an authorized operator for transfers.
     * 
     * @param operator  The address of the operator to set as authorized for transfers.
     * @param token     The address of the token to authorize.
     * @param tokenId   The token id to set the authorized operator for.
     */
    function beforeAuthorizedTransfer(address operator, address token, uint256 tokenId) external {
        _setOperatorInTransientStorage(operator, token, tokenId, false);
    }

    /**
     * @notice Clears the authorized operator for a token to prevent additional transfers that
     *         do not conform to the transfer security level for the token.
     * 
     * @dev    Throws when authorization mode is disabled for the collection.
     * @dev    Throws when using the wildcard operator address and the collection does not allow
     *         for wildcard authorized operators.
     * @dev    Throws when the caller is not an allowed authorizer for the collection.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. The authorized operator for the token is cleared from storage.
     * 
     * @param token     The address of the token to authorize.
     * @param tokenId   The token id to set the authorized operator for.
     */
    function afterAuthorizedTransfer(address token, uint256 tokenId) public {
        _setOperatorInTransientStorage(address(uint160(uint256(BYTES32_ZERO))), token, tokenId, false);
    }

    /**
     * @notice Sets an operator for an authorized transfer that skips transfer security level
     *         validation for caller and receiver constraints.
     * @notice This overload of `beforeAuthorizedTransfer` defaults to a tokenId of 0.
     * 
     * @dev    An authorizer *MUST* clear the authorization with a call to `afterAuthorizedTransfer`
     *         to prevent unauthorized transfers of the token.
     * 
     * @dev    Throws when authorization mode is disabled for the collection.
     * @dev    Throws when using the wildcard operator address and the collection does not allow
     *         for wildcard authorized operators.
     * @dev    Throws when the caller is not an allowed authorizer for the collection.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. The `operator` is stored as an authorized operator for transfers.
     * 
     * @param operator  The address of the operator to set as authorized for transfers.
     * @param token     The address of the token to authorize.
     */
    function beforeAuthorizedTransfer(address operator, address token) external {
        _setOperatorInTransientStorage(operator, token, 0, true);
    }

    /**
     * @notice Clears the authorized operator for a token to prevent additional transfers that
     *         do not conform to the transfer security level for the token.
     * @notice This overload of `afterAuthorizedTransfer` defaults to a tokenId of 0.
     * 
     * @dev    Throws when authorization mode is disabled for the collection.
     * @dev    Throws when using the wildcard operator address and the collection does not allow
     *         for wildcard authorized operators.
     * @dev    Throws when the caller is not an allowed authorizer for the collection.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. The authorized operator for the token is cleared from storage.
     * 
     * @param token     The address of the token to authorize.
     */
    function afterAuthorizedTransfer(address token) external {
        afterAuthorizedTransfer(token, 0);
    }

    /**
     * @notice Sets the wildcard operator to authorize any operator to transfer a token while
     *         skipping transfer security level validation for caller and receiver constraints.
     * 
     * @dev    An authorizer *MUST* clear the authorization with a call to `afterAuthorizedTransfer`
     *         to prevent unauthorized transfers of the token.
     * 
     * @dev    Throws when authorization mode is disabled for the collection.
     * @dev    Throws when the collection does not allow for wildcard authorized operators.
     * @dev    Throws when the caller is not an allowed authorizer for the collection.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. The wildcard operator is stored as an authorized operator for transfers.
     * 
     * @param token     The address of the token to authorize.
     * @param tokenId   The token id to set the authorized operator for.
     */
    function beforeAuthorizedTransfer(address token, uint256 tokenId) external {
        _setOperatorInTransientStorage(WILDCARD_OPERATOR_ADDRESS, token, tokenId, false);
    }

    /**
     * @notice Sets the wildcard operator to authorize any operator to transfer a token while
     *         skipping transfer security level validation for caller and receiver constraints.
     * 
     * @dev    An authorizer *MUST* clear the authorization with a call to `afterAuthorizedTransfer`
     *         to prevent unauthorized transfers of the token.
     * 
     * @dev    Throws when authorization mode is disabled for the collection.
     * @dev    Throws when the collection does not allow for wildcard authorized operators.
     * @dev    Throws when the caller is not an allowed authorizer for the collection.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. The wildcard operator is stored as an authorized operator for transfers.
     *      2. The specified amount is stored as the authorized amount.
     * 
     * @param token     The address of the token to authorize.
     * @param tokenId   The token id to set the authorized operator for.
     * @param amount    The amount of the token to authorize.
     */
    function beforeAuthorizedTransferWithAmount(address token, uint256 tokenId, uint256 amount) external {
        _setOperatorInTransientStorage(WILDCARD_OPERATOR_ADDRESS, token, tokenId, amount);
    }

    /**
     * @notice Sets the specified operator to authorize any operator to transfer a token while
     *         skipping transfer security level validation for caller and receiver constraints.
     * 
     * @dev    An authorizer *MUST* clear the authorization with a call to `afterAuthorizedTransfer`
     *         to prevent unauthorized transfers of the token.
     * 
     * @dev    Throws when authorization mode is disabled for the collection.
     * @dev    Throws when the collection does not allow for wildcard authorized operators.
     * @dev    Throws when the caller is not an allowed authorizer for the collection.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. The specified operator is stored as an authorized operator for transfers.
     *      2. The specified amount is stored as the authorized amount for the operator.
     * 
     * @param operator  The address of the operator to set as authorized for transfers.
     * @param token     The address of the token to authorize.
     * @param tokenId   The token id to set the authorized operator for.
     * @param amount    The amount of the token to authorize.
     */
    function beforeAuthorizedTransferWithAmount(address operator, address token, uint256 tokenId, uint256 amount) external {
        _setOperatorInTransientStorage(operator, token, tokenId, amount);
    }

    /**
     * @notice Clears the authorized operator for a token to prevent additional transfers that
     *         do not conform to the transfer security level for the token.
     * 
     * @dev    Throws when authorization mode is disabled for the collection.
     * @dev    Throws when using the wildcard operator address and the collection does not allow
     *         for wildcard authorized operators.
     * @dev    Throws when the caller is not an allowed authorizer for the collection.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. The authorized operator for the token is cleared from storage.
     * 
     * @param token     The address of the token to authorize.
     * @param tokenId   The token id to set the authorized operator for.
     */
    function afterAuthorizedTransferWithAmount(address token, uint256 tokenId) external {
        _setOperatorInTransientStorage(address(uint160(uint256(BYTES32_ZERO))), token, tokenId, 0);
    }

    /*************************************************************************/
    /*                               SIMULATION                              */
    /*************************************************************************/

    /**
     * @notice Simulates transfer validation of a collection with its current ruleset and options.
     * 
     * @dev    Authorization mode overrides are not taken into account.
     *
     * @param collection The address of the collection.
     * @param caller     The address initiating the transfer.
     * @param from       The address of the token owner.
     * @param to         The address of the token receiver.
     * @return isTransferAllowed True if the transfer is allowed, false otherwise.
     * @return errorCode         The error code if the transfer is not allowed.
     */
    function validateTransferSim(
        address collection, 
        address caller, 
        address from, 
        address to
    ) external view returns (bool isTransferAllowed, bytes4 errorCode) {
        (errorCode,) = _validateTransfer(AUTHORIZER_CHECK_TYPE_COLLECTION, collection, caller, from, to, 0, 0);
        isTransferAllowed = errorCode == SELECTOR_NO_ERROR;
    }

    /**
     * @notice Simulates transfer validation of a collection with its current ruleset and options.
     *
     * @dev    Authorization mode overrides are not taken into account.
     *
     * @param collection The address of the collection.
     * @param caller     The address initiating the transfer.
     * @param from       The address of the token owner.
     * @param to         The address of the token receiver.
     * @param tokenId    The token id being transferred.
     * @return isTransferAllowed True if the transfer is allowed, false otherwise.
     * @return errorCode         The error code if the transfer is not allowed.
     */
    function validateTransferSim(
        address collection,
        address caller, 
        address from, 
        address to, 
        uint256 tokenId
    ) external view returns (bool isTransferAllowed, bytes4 errorCode) {
        (errorCode,) = _validateTransfer(AUTHORIZER_CHECK_TYPE_TOKEN, collection, caller, from, to, tokenId, 0);
        isTransferAllowed = errorCode == SELECTOR_NO_ERROR;
    }

    /**
     * @notice Simulates transfer validation of a collection with its current ruleset and options.
     *
     * @dev    Authorization mode overrides are not taken into account.
     *
     * @param collection The address of the collection.
     * @param caller     The address initiating the transfer.
     * @param from       The address of the token owner.
     * @param to         The address of the token receiver.
     * @param tokenId    The token id being transferred.
     * @param amount     The amount of the token being transferred.
     * @return isTransferAllowed True if the transfer is allowed, false otherwise.
     * @return errorCode         The error code if the transfer is not allowed.     
     */
    function validateTransferSim(
        address collection,
        address caller, 
        address from, 
        address to, 
        uint256 tokenId, 
        uint256 amount
    ) external view returns (bool isTransferAllowed, bytes4 errorCode) {
        (errorCode,) = _validateTransfer(AUTHORIZER_CHECK_TYPE_TOKEN_AND_AMOUNT, collection, caller, from, to, tokenId, amount);
        isTransferAllowed = errorCode == SELECTOR_NO_ERROR;
    }

    /*************************************************************************/
    /*                    COLLECTION AND LIST MANAGEMENT                     */
    /*************************************************************************/

    /**
     * @notice Creates a new list id.  The list id is a handle to allow editing of blacklisted and whitelisted accounts
     *         and codehashes.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. A new list with the specified name is created.
     *      2. The caller is set as the owner of the new list.
     *      3. A `CreatedList` event is emitted.
     *      4. A `ReassignedListOwnership` event is emitted.
     *
     * @param  name The name of the new list.
     * @return id   The id of the new list.
     */
    function createList(string calldata name) public delegateCall(_managementModule) returns (uint48 id) {}

    /**
     * @notice Creates a new list id, and copies all blacklisted, whitelisted, and authorizer accounts and codehashes 
     *         from the specified source list.
     *
     * @dev    <h4>Postconditions:</h4>
     *         1. A new list with the specified name is created.
     *         2. The caller is set as the owner of the new list.
     *         3. A `CreatedList` event is emitted.
     *         4. A `ReassignedListOwnership` event is emitted.
     *         5. All blacklisted and whitelisted accounts and codehashes from the specified source list are copied
     *            to the new list.
     *         6. An `AddedAccountToList` event is emitted for each blacklisted and whitelisted account copied.
     *         7. An `AddedCodeHashToList` event is emitted for each blacklisted and whitelisted codehash copied.
     *
     * @param  name         The name of the new list.
     * @param  sourceListId The id of the source list to copy from.
     * @return id           The id of the new list.
     */
    function createListCopy(string calldata name, uint48 sourceListId) external delegateCall(_managementModule) returns (uint48 id) {}

    /**
     * @notice Creates a new list id, and copies all accounts and codehashes from the
     *         specified source list for each specified list type.
     *
     * @dev    <h4>Postconditions:</h4>
     *         1. A new list with the specified name is created.
     *         2. The caller is set as the owner of the new list.
     *         3. A `CreatedList` event is emitted.
     *         4. A `ReassignedListOwnership` event is emitted.
     *         5. All accounts and codehashes from the specified source list / list types are copied
     *            to the new list.
     *         6. An `AddedAccountToList` event is emitted for each account copied.
     *         7. An `AddedCodeHashToList` event is emitted for each codehash copied.
     *
     * @param  name         The name of the new list.
     * @param  sourceListId The id of the source list to copy from.
     * @param  listTypes    The list types to copy from the source list.
     * @return id           The id of the new list.
     */
    function createListCopy(string calldata name, uint48 sourceListId, uint8[] calldata listTypes) external delegateCall(_managementModule) returns (uint48 id) {}

    /**
     * @notice Transfer ownership of a list to a new owner.
     *
     * @dev Throws when the new owner is the zero address.
     * @dev Throws when the caller does not own the specified list.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. The list ownership is transferred to the new owner.
     *      2. A `ReassignedListOwnership` event is emitted.
     *
     * @param id       The id of the list.
     * @param newOwner The address of the new owner.
     */
    function reassignOwnershipOfList(uint48 id, address newOwner) public delegateCall(_managementModule) {}

    /**
     * @notice Renounce the ownership of a list, rendering the list immutable.
     *
     * @dev Throws when the caller does not own the specified list.
     * @dev Throws when list id is zero (default list).
     *
     * @dev <h4>Postconditions:</h4>
     *      1. The ownership of the specified list is renounced.
     *      2. A `ReassignedListOwnership` event is emitted.
     *
     * @param id The id of the list.
     */
    function renounceOwnershipOfList(uint48 id) public delegateCall(_managementModule) {}

    /**
     * @notice Set the ruleset id, global / ruleset options, fixed / custom ruleset for a collection.
     *
     * @dev Throws when the caller is neither collection contract, nor the owner or admin of the specified collection.
     * @dev Throws when setting a custom ruleset to an unregistered ruleset address.
     * @dev Throws when setting a ruleset id that is not bound to a ruleset address.
     * @dev Throws when setting a custom ruleset with a managed ruleset id.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. The ruleset of the specified collection is set to the new value.
     *      2. Global options and ruleset-specific options of the specified collection are set to the new value.
     *      3. A `SetCollectionRuleset` event is emitted.
     *      4. A `SetCollectionSecurityPolicyOptions` event is emitted.
     *
     * @param collection                 The address of the collection.
     * @param rulesetId                  The new ruleset id to apply.
     * @param customRuleset              The address of the custom ruleset to apply. Must be address(0) unless ruleset
     *                                   id is RULESET_ID_FIXED_OR_CUSTOM (255).
     * @param globalOptions              The global options to apply.
     * @param rulesetOptions             The ruleset-specific options to apply.
     */
    function setRulesetOfCollection(
        address collection, 
        uint8 rulesetId,
        address customRuleset,
        uint8 globalOptions,
        uint16 rulesetOptions
    ) external delegateCall(_managementModule) {}

    /**
     * @notice Set expansion words and datums for a collection.
     *
     * @dev Throws when the caller is neither collection contract, nor the owner or admin of the specified collection.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. Included expansion words and datums are set for the specified collection.
     *      2. A `SetCollectionExpansionWords` event is emitted for each expansion word included in the request.
     *      3. A `SetCollectionExpansionDatums` event is emitted for each expansion datum included in the request.
     *
     * @param collection                 The address of the collection.
     * @param expansionWords             The expansion words to set.
     * @param expansionDatums            The expansion datums to set.
     */
    function setExpansionSettingsOfCollection(
        address collection, 
        ExpansionWord[] calldata expansionWords,
        ExpansionDatum[] calldata expansionDatums
    ) external delegateCall(_managementModule) {}

    /**
     * @notice Set the token type setting of a collection.
     *
     * @dev Throws when the caller is neither collection contract, nor the owner or admin of the specified collection.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. The token type of the specified collection is set to the new value.
     *      2. A `SetTokenType` event is emitted.
     *
     * @param collection  The address of the collection.
     * @param tokenType   The new transfer security level to apply.
     */
    function setTokenTypeOfCollection(
        address collection, 
        uint16 tokenType
    ) external delegateCall(_managementModule) {}

    /**
     * @notice Applies the specified list to a collection.
     * 
     * @dev Throws when the caller is neither collection contract, nor the owner or admin of the specified collection.
     * @dev Throws when the specified list id does not exist.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. The list of the specified collection is set to the new value.
     *      2. An `AppliedListToCollection` event is emitted.
     *
     * @param collection The address of the collection.
     * @param id         The id of the operator whitelist.
     */
    function applyListToCollection(address collection, uint48 id) public delegateCall(_managementModule) {}

    /**
     * @notice Adds accounts to the frozen accounts list of a collection.
     * 
     * @dev Throws when the caller is neither collection contract, nor the owner or admin of the specified collection.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. The accounts are added to the list of frozen accounts for a collection.
     *      2. A `AccountFrozenForCollection` event is emitted for each account added to the list.
     *
     * @param collection        The address of the collection.
     * @param accountsToFreeze  The list of accounts to added to frozen accounts.
     */
    function freezeAccountsForCollection(address collection, address[] calldata accountsToFreeze) external delegateCall(_managementModule) {}

    /**
     * @notice Removes accounts to the frozen accounts list of a collection.
     * 
     * @dev Throws when the caller is neither collection contract, nor the owner or admin of the specified collection.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. The accounts are removed from the list of frozen accounts for a collection.
     *      2. A `AccountUnfrozenForCollection` event is emitted for each account removed from the list.
     *
     * @param collection          The address of the collection.
     * @param accountsToUnfreeze  The list of accounts to remove from frozen accounts.
     */
    function unfreezeAccountsForCollection(address collection, address[] calldata accountsToUnfreeze) external delegateCall(_managementModule) {}

    /**
     * @notice Adds one or more accounts to a list of specified list type.
     *
     * @dev Throws when the caller does not own the specified list.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. Accounts not previously in the list are added.
     *      2. An `AddedAccountToList` event is emitted for each account that is newly added to the list.
     *
     * @param id       The id of the list.
     * @param listType The type of the list.
     * @param accounts The addresses of the accounts to add.
     */
    function addAccountsToList(
        uint48 id,
        uint8 listType,
        address[] calldata accounts
    ) external delegateCall(_managementModule) {}

    /**
     * @notice Removes one or more accounts from a list of the specified list type.
     *
     * @dev Throws when the caller does not own the specified list.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. Accounts previously in the list are removed.
     *      2. A `RemovedAccountFromList` event is emitted for each account that is removed from the list.
     *
     * @param id       The id of the list.
     * @param listType The type of the list.
     * @param accounts The addresses of the accounts to remove.
     */
    function removeAccountsFromList(
        uint48 id,
        uint8 listType,
        address[] calldata accounts
    ) external delegateCall(_managementModule) {}

    /**
     * @notice Adds one or more codehashes to a list of specified list type.
     *
     * @dev Throws when the caller does not own the specified list.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. Codehashes not previously in the list are added.
     *      2. An `AddedCodeHashToList` event is emitted for each codehash that is newly added to the list.
     *
     * @param id         The id of the list.
     * @param listType   The type of the list.
     * @param codehashes The codehashes to add.
     */
    function addCodeHashesToList(
        uint48 id,
        uint8 listType,
        bytes32[] calldata codehashes
    ) external delegateCall(_managementModule) {}

    /**
     * @notice Removes one or more codehashes from a list of the specified list type.
     *
     * @dev Throws when the caller does not own the specified list.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. Codehashes previously in the list are removed.
     *      2. A `RemovedCodeHashFromList` event is emitted for each codehash that is removed from the list.
     *
     * @param id         The id of the list.
     * @param listType   The type of the list.
     * @param codehashes The codehashes to remove.
     */
    function removeCodeHashesFromList(
        uint48 id,
        uint8 listType,
        bytes32[] calldata codehashes
    ) external delegateCall(_managementModule) {}

    /*************************************************************************/
    /*                      RULESET VIEW ACCESSORS                           */
    /*************************************************************************/

    /**
     * @notice Returns true if the specified ruleset is registered, false otherwise.
     */
    function isRulesetRegistered(address ruleset) external view returns (bool) {
        return validatorStorage().registeredRulesets[ruleset];
    }

    /**
     * @notice Returns the address of the ruleset currently bound to the specified ruleset id.
     */
    function boundRuleset(uint8 rulesetId) external view returns (address) {
        if (rulesetId == RULESET_ID_FIXED_OR_CUSTOM) {
            return address(0);
        }

        return validatorStorage().rulesetBindings[rulesetId];
    }

    /*************************************************************************/
    /*           COLLECTION AND LIST SETTINGS VIEW ACCESSORS                 */
    /*************************************************************************/

    /**
     * @notice Returns the id of the list that was created.
     */
    function lastListId() external view returns (uint48) {
        return validatorStorage().lastListId;
    }

    /**
     * @notice Returns the owner of the specified list id.
     */
    function listOwners(uint48 id) external view returns (address) {
        return validatorStorage().listOwners[id];
    }

    /**
     * @notice Get the security policy of the specified collection.
     * @param collection The address of the collection.
     * @return           The security policy of the specified collection, which includes:
     *                   Ruleset id, list id, global options, ruleset-specific options, optional custom ruleset address,
     *                   and token type (if registered).
     */
    function getCollectionSecurityPolicy(
        address collection
    ) external view returns (CollectionSecurityPolicy memory) {
        return validatorStorage().collectionSecurityPolicies[collection];
    }

    /**
     * @notice Returns expansion word settings for a collection.
     *
     * @param  tokenAddress     The smart contract address of the token.
     * @param  keys             The expansion word keys to retrieve.
     */
    function getCollectionExpansionWords(
        address tokenAddress, 
        bytes32[] calldata keys
    ) public view returns (bytes32[] memory values) {
        if(keys.length > 0) {
            mapping (bytes32 => bytes32) storage ptrExpansionWordsForCollection = 
                validatorStorage().collectionExpansionWords[tokenAddress];

            values = new bytes32[](keys.length);
            for (uint256 i = 0; i < keys.length; ++i) {
                values[i] = ptrExpansionWordsForCollection[keys[i]];
            }
        }
    }

    /**
     * @notice Returns expansion datum settings for a collection.
     *
     * @param  tokenAddress     The smart contract address of the token.
     * @param  keys             The expansion datum keys to retrieve.
     */
    function getCollectionExpansionDatums(
        address tokenAddress, 
        bytes32[] calldata keys
    ) public view returns (bytes[] memory values) {
        if(keys.length > 0) {
            mapping (bytes32 => bytes) storage ptrExpansionDatumsForCollection = 
                validatorStorage().collectionExpansionDatums[tokenAddress];

            values = new bytes[](keys.length);
            for (uint256 i = 0; i < keys.length; ++i) {
                values[i] = ptrExpansionDatumsForCollection[keys[i]];
            }
        }
    }

    /**
     * @notice Get accounts by list id and list type.
     * @param  id The id of the list.
     * @param  listType The type of the list.
     * @return An array of accounts in the list of the specified type.
     */
    function getListAccounts(uint48 id, uint8 listType) public view returns (address[] memory) {
        return validatorStorage().lists[listType][id].enumerableAccounts.values();
    }

    /**
     * @notice Get codehashes by list id and list type.
     * @param  id The id of the list.
     * @param  listType The type of the list.
     * @return An array of codehashes in the list of the specified type.
     */
    function getListCodeHashes(uint48 id, uint8 listType) public view returns (bytes32[] memory) {
        return validatorStorage().lists[listType][id].enumerableCodehashes.values();
    }

    /**
     * @notice Check if an account is found in a specified list id / list type.
     * @param id       The id of the list.
     * @param listType The type of the list.
     * @param account  The address of the account to check.
     * @return         True if the account is in the specified list / type, false otherwise.
     */
    function isAccountInList(uint48 id, uint8 listType, address account) public view returns (bool) {
        return validatorStorage().lists[listType][id].nonEnumerableAccounts[account];
    }

    /**
     * @notice Check if a codehash is in a specified list / type.
     * @param id       The id of the list.
     * @param listType The type of the list.
     * @param codehash  The codehash to check.
     * @return         True if the codehash is in the specified list / type, false otherwise.
     */
    function isCodeHashInList(uint48 id, uint8 listType, bytes32 codehash) public view returns (bool) {
        return validatorStorage().lists[listType][id].nonEnumerableCodehashes[codehash];
    }

    /**
     * @notice Get accounts in list by collection and list type.
     * @param collection The address of the collection.
     * @param listType   The type of the list.
     * @return           An array of accounts.
     */
    function getListAccountsByCollection(address collection, uint8 listType) external view returns (address[] memory) {
        return getListAccounts(validatorStorage().collectionSecurityPolicies[collection].listId, listType);
    }

    /**
     * @notice Get codehashes in list by collection and list type.
     * @param collection The address of the collection.
     * @param listType   The type of the list.
     * @return           An array of codehashes.
     */
    function getListCodeHashesByCollection(address collection, uint8 listType) external view returns (bytes32[] memory) {
        return getListCodeHashes(validatorStorage().collectionSecurityPolicies[collection].listId, listType);
    }

    /**
     * @notice Get frozen accounts by collection.
     * @param collection The address of the collection.
     * @return           An array of frozen accounts.
     */
    function getFrozenAccountsByCollection(address collection) external view returns (address[] memory) {
        return validatorStorage().frozenAccounts[collection].enumerableAccounts.values();
    }

    /**
     * @notice Check if an account is in the list by a specified collection and list type.
     * @param collection The address of the collection.
     * @param listType   The type of the list.
     * @param account    The address of the account to check.
     * @return           True if the account is in the list / list type of the specified collection, false otherwise.
     */
    function isAccountInListByCollection(address collection, uint8 listType, address account) external view returns (bool) {
        return isAccountInList(validatorStorage().collectionSecurityPolicies[collection].listId, listType, account);
    }

    /**
     * @notice Check if a codehash is in the list by a specified collection / list type.
     * @param collection The address of the collection.
     * @param listType   The type of the list.
     * @param codehash   The codehash to check.
     * @return           True if the codehash is in the list / list type of the specified collection, false otherwise.
     */
    function isCodeHashInListByCollection(address collection, uint8 listType, bytes32 codehash) external view returns (bool) {
        return isCodeHashInList(validatorStorage().collectionSecurityPolicies[collection].listId, listType, codehash);
    }

    /**
     * @notice Check if an account is frozen for a specified collection.
     * @param collection The address of the collection.
     * @param account    The address of the account to check.
     * @return           True if the account is frozen by the specified collection, false otherwise.
     */
    function isAccountFrozenForCollection(address collection, address account) external view returns (bool) {
        return validatorStorage().frozenAccounts[collection].nonEnumerableAccounts[account];
    }

    /**
     * @notice Returns true if the specified account has verified a signature on the registry, false otherwise.
     */
    function isVerifiedEOA(address account) public view returns (bool) {
        return IEOARegistry(_eoaRegistry).isVerifiedEOA(account);
    }

    /**
     * @notice Makes a delegatecall to the validator ruleset module that perform the transfer validation logic.
     *
     * @dev Throws when the `msg.sender` is not equal to address(this).  This guarantees that staticcall context
     *      is properly preserved.
     */
    function validateTransferDelegateCall(
        uint256 authorizerCheckType,
        address collection,
        address caller, 
        address from, 
        address to,
        uint256 tokenId,
        uint256 amount) external /*view*/ returns (bytes4 errorSelector, uint16 tokenType) { 
        if (msg.sender != address(this)) {
            revert CreatorTokenTransferValidator__OnlyValidatorCanAccessThisFunction();
        }

        address validatorModuleAddress;
        (
            validatorModuleAddress,
            tokenType
        ) = _getCollectionTokenTypeAndValidatorModule(collection);

        errorSelector = _delegateCallRuleset(
            validatorModuleAddress,
            authorizerCheckType,
            collection,
            caller,
            from,
            to,
            tokenId,
            amount
        );
    }

    /**
     * @notice ERC-165 Interface Support
     * @dev    Do not remove LEGACY from this contract or future contracts.  
     *         Doing so will break backwards compatibility with V1 and V2 creator tokens.
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC165, IERC165) returns (bool) {
        return
            interfaceId == LEGACY_TRANSFER_VALIDATOR_INTERFACE_ID ||
            interfaceId == type(ITransferValidator).interfaceId ||
            interfaceId == type(IPermitC).interfaceId ||
            interfaceId == type(IEOARegistry).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    /*************************************************************************/
    /*                                HELPERS                                */
    /*************************************************************************/

    /**
     * @dev Hook that is called before any permitted token transfer that goes through Permit-C.
     *      Applies the collection transfer policy, using the operator that called Permit-C as the caller.
     *      This allows creator token standard protections to extend to permitted transfers.
     * 
     * @param token  The collection address of the token being transferred.
     * @param from   The address of the token owner.
     * @param to     The address of the token receiver.
     * @param id     The token id being transferred.
     */
    function _beforeTransferFrom(
        uint256 tokenType,
        address token, 
        address from, 
        address to, 
        uint256 id, 
        uint256 amount
    ) internal override returns (bool isError) {
        (bytes4 selector, uint16 collectionTokenType) = 
            _validateTransfer(
                tokenType == TOKEN_TYPE_ERC721 ? AUTHORIZER_CHECK_TYPE_TOKEN : AUTHORIZER_CHECK_TYPE_TOKEN_AND_AMOUNT, 
                token, 
                msg.sender, 
                from, 
                to, 
                id, 
                amount
            );

        if (collectionTokenType == DEFAULT_TOKEN_TYPE || collectionTokenType == tokenType) {
            isError = SELECTOR_NO_ERROR != selector;
        } else {
            revert CreatorTokenTransferValidator__TokenTypesDoNotMatch();
        }
    }

    /**
     * @notice Apply the collection ruleset and options to a transfer operation of a creator token.
     *
     * @dev If the caller is self (Permit-C Processor) it means we have already applied operator validation in the 
     *      _beforeTransferFrom callback.  In this case, the security policy was already applied and the operator
     *      that used the Permit-C processor passed the security policy check and transfer can be safely allowed.
     *
     * @dev Modular rulesets with options determine the logic governing transfers.
     *
     * @dev Throws when the ruleset returns a non-zero error selector.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. Transfer is allowed or denied based on the ruleset.
     *
     * @param collection  The collection address of the token being transferred.
     * @param caller      The address initiating the transfer.
     * @param from        The address of the token owner.
     * @param to          The address of the token receiver.
     * @param tokenId     The token id being transferred.
     * 
     * @return The selector value for an error if the transfer is not allowed, `SELECTOR_NO_ERROR` if the transfer is allowed.
     */
    function _validateTransfer(
        uint256 authorizerCheckType,
        address collection, 
        address caller, 
        address from, 
        address to,
        uint256 tokenId,
        uint256 amount
    ) internal view returns (bytes4,uint16) {
        if (caller == address(this)) { 
            // If the caller is self (Permit-C Processor) it means we have already applied operator validation in the 
            // _beforeTransferFrom callback.  In this case, the security policy was already applied and the operator
            // that used the Permit-C processor passed the security policy check and transfer can be safely allowed.
            return (SELECTOR_NO_ERROR, DEFAULT_TOKEN_TYPE);
        }

        return IRulesetDelegateCall(address(this)).validateTransferDelegateCall(
            authorizerCheckType,
            collection,
            caller,
            from,
            to,
            tokenId,
            amount
        );
    }

    /**
     * @dev Internal function used to get the collection token type and validator module address.
     *
     * @param collection The collection address to get the token type and validator module address for.
     * @return validatorModuleAddress  The validator module address afor the collection.
     * @return tokenType               The token type for the collection.
     */
    function _getCollectionTokenTypeAndValidatorModule(
        address collection
    ) internal view returns (address validatorModuleAddress, uint16 tokenType) {
        CollectionSecurityPolicy storage ptrSecurityPolicy = validatorStorage().collectionSecurityPolicies[collection];

        validatorModuleAddress = 
            ptrSecurityPolicy.rulesetId < RULESET_ID_FIXED_OR_CUSTOM ? 
            validatorStorage().rulesetBindings[ptrSecurityPolicy.rulesetId] : 
            ptrSecurityPolicy.customRuleset;

        tokenType = ptrSecurityPolicy.tokenType;
    }

    /**
     * @dev Internal function used to efficiently revert with a custom error selector.
     *
     * @param errorSelector The error selector to revert with.
     */
    function _revertCustomErrorSelectorAsm(bytes4 errorSelector) internal pure {
        assembly {
            mstore(0x00, errorSelector)
            revert(0x00, 0x04)
        }
    }

    /**
     * @dev Internal function used to check if authorization mode can be activated for a transfer.
     * 
     * @dev Throws when the collection has not enabled authorization mode.
     * @dev Throws when the wildcard operator is being set for a collection that does not
     *      allow wildcard operators.
     * @dev Throws when the authorizer is not in the list of approved authorizers for
     *      the collection.
     * 
     * @param collection  The collection address to activate authorization mode for a transfer.
     * @param operator    The operator specified by the authorizer to allow transfers.
     * @param authorizer  The address of the authorizer making the call.
     */
    function _checkCollectionAllowsAuthorizerAndOperator(
        address collection, 
        address operator, 
        address authorizer
    ) internal view {
        CollectionSecurityPolicy storage collectionSecurityPolicy = validatorStorage().collectionSecurityPolicies[collection];

        if (_isFlagSet(collectionSecurityPolicy.globalOptions, FLAG_GLOBAL_DISABLE_AUTHORIZATION_MODE)) {
            revert CreatorTokenTransferValidator__AuthorizationDisabledForCollection();
        }

        if (_isFlagSet(collectionSecurityPolicy.globalOptions, FLAG_GLOBAL_AUTHORIZERS_CANNOT_SET_WILDCARD_OPERATORS)) {
            if (operator == WILDCARD_OPERATOR_ADDRESS) {
                revert CreatorTokenTransferValidator__WildcardOperatorsCannotBeAuthorizedForCollection();
            }
        }

        if (!validatorStorage().lists[LIST_TYPE_AUTHORIZERS][collectionSecurityPolicy.listId].nonEnumerableAccounts[authorizer]) {
            if (!_isFlagSet(collectionSecurityPolicy.globalOptions, FLAG_GLOBAL_CUSTOM_LIST_SUPPLEMENTS_DEFAULT_LIST) || 
                !validatorStorage().lists[LIST_TYPE_AUTHORIZERS][DEFAULT_LIST_ID].nonEnumerableAccounts[authorizer]) {
                revert CreatorTokenTransferValidator__CallerMustBeAnAuthorizer();
            }
        }
    }

    /**
     * @dev Modifier to apply the allowed authorizer and operator for collection checks.
     * 
     * @dev Throws when the collection has not enabled authorization mode.
     * @dev Throws when the wildcard operator is being set for a collection that does not
     *      allow wildcard operators.
     * @dev Throws when the authorizer is not in the list of approved authorizers for
     *      the collection.
     * 
     * @param collection  The collection address to activate authorization mode for a transfer.
     * @param operator    The operator specified by the authorizer to allow transfers.
     * @param authorizer  The address of the authorizer making the call.
     */
    modifier whenAuthorizerAndOperatorEnabledForCollection(
        address collection, 
        address operator, 
        address authorizer
    ) {
        _checkCollectionAllowsAuthorizerAndOperator(collection, operator, authorizer);
        _;
    }

    /**
     * @dev Internal function for setting the authorized operator in storage for a token and collection.
     * 
     * @param operator         The allowed operator for an authorized transfer.
     * @param collection       The address of the collection that the operator is authorized for.
     * @param tokenId          The id of the token that is authorized.
     * @param allowAnyTokenId  Flag if the authorizer is enabling transfers for any token id
     */
    function _setOperatorInTransientStorage(
        address operator,
        address collection, 
        uint256 tokenId,
        bool allowAnyTokenId
    ) internal whenAuthorizerAndOperatorEnabledForCollection(collection, operator, msg.sender) {
        _setTstorish(_getTransientOperatorSlot(collection), (allowAnyTokenId ? 1 << 255 : 0) | uint256(uint160(operator)));
        _setTstorish(_getTransientOperatorSlot(collection, tokenId), uint256(uint160(operator)));
    }

    /**
     * @dev Internal function for setting the authorized operator and amount in storage for a token and collection.
     * 
     * @param operator    The allowed operator for an authorized transfer.
     * @param collection  The address of the collection that the operator is authorized for.
     * @param tokenId     The id of the token that is authorized.
     * @param amount      The amount of the token that is authorized.
     */
    function _setOperatorInTransientStorage(
        address operator,
        address collection, 
        uint256 tokenId,
        uint256 amount
    ) internal whenAuthorizerAndOperatorEnabledForCollection(collection, operator, msg.sender) {
        _setTstorish(_getTransientOperatorSlot(collection), uint256(uint160(operator)));
        uint256 collectionAndTokenIdSlot = _getTransientOperatorSlot(collection, tokenId);
        _setTstorish(collectionAndTokenIdSlot, uint256(uint160(operator)));
        _setTstorish(collectionAndTokenIdSlot + 1, amount);
    }
    
    /**
     * @dev Internal function triggered when the Tstore support is activated.
     */
    function _onTstoreSupportActivated() internal virtual override {
        // Nothing to do here
    }

    /**
     * @dev Internal function used to delegate call the ruleset module for transfer validation and return results.
     */
    function _delegateCallRuleset(
        address _ruleSet,
        uint256 _authorizerCheckType,
        address _collection,
        address _caller, 
        address _from, 
        address _to,
        uint256 _tokenId,
        uint256 _amount
    ) internal returns (bytes4 errorSelector) {
        bytes4 selector = IRuleset.validateTransfer.selector;
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, selector)
            mstore(add(ptr,0x04), _authorizerCheckType)
            mstore(add(ptr,0x24), _collection)
            mstore(add(ptr,0x44), _caller)
            mstore(add(ptr,0x64), _from)
            mstore(add(ptr,0x84), _to)
            mstore(add(ptr,0xA4), _tokenId)
            mstore(add(ptr,0xC4), _amount)
            mstore(0x40, add(ptr,0xE4))

            let result := delegatecall(gas(), _ruleSet, ptr, 0xE4, 0x00, 0x20)
            if iszero(result) {
                // Call has failed, retrieve the error message and revert
                let size := returndatasize()
                returndatacopy(0, 0, size)
                revert(0, size)
            }
            errorSelector := mload(0x00)
        }
    }
}
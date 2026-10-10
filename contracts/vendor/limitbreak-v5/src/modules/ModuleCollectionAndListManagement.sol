// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../Constants.sol";
import "../DataTypes.sol";
import "../Errors.sol";
import "../ValidatorBase.sol";
import "../interfaces/IRuleset.sol";
import "../../tm-core-lib/src/utils/introspection/ERC165.sol";
import "../../tm-core-lib/src/utils/structs/EnumerableSet.sol";
import "../../tm-core-lib/src/utils/token/IEOARegistry.sol";
import "../../tm-core-lib/src/utils/token/ITransferValidator.sol";
import "../../tm-core-lib/src/utils/misc/Tstorish.sol";

/**
 * @title ModuleCollectionAndListManagement
 * @author Limit Break, Inc.
 * @notice Module for managing collection security polices, ruleset options, 
 *         lists of accounts and codehashes, and ruleset/validator expansion settings.
 */
contract ModuleCollectionAndListManagement is ValidatorBase {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    /*************************************************************************/
    /*                                EVENTS                                 */
    /*************************************************************************/

    /// @dev Emitted when a new list is created.
    event CreatedList(uint256 indexed id, string name);

    /// @dev Emitted when a list is applied to a collection.
    event AppliedListToCollection(address indexed collection, uint48 indexed id);

    /// @dev Emitted when the ownership of a list is transferred to a new owner.
    event ReassignedListOwnership(uint256 indexed id, address indexed newOwner);

    /// @dev Emitted when an account is added to the list of frozen accounts for a collection.
    event AccountFrozenForCollection(address indexed collection, address indexed account);

    /// @dev Emitted when an account is removed from the list of frozen accounts for a collection.
    event AccountUnfrozenForCollection(address indexed collection, address indexed account);

    /// @dev Emitted when an address is added to a list.
    event AddedAccountToList(uint8 indexed kind, uint48 indexed id, address indexed account);

    /// @dev Emitted when a codehash is added to a list.
    event AddedCodeHashToList(uint8 indexed kind, uint48 indexed id, bytes32 indexed codehash);

    /// @dev Emitted when an address is removed from a list.
    event RemovedAccountFromList(uint8 indexed kind, uint48 indexed id, address indexed account);

    /// @dev Emitted when a codehash is removed from a list.
    event RemovedCodeHashFromList(uint8 indexed kind, uint48 indexed id, bytes32 indexed codehash);

    /// @dev Emitted when the validation ruleset id and/or custom ruleset for a collection is updated.
    event SetCollectionRuleset(address indexed collection, uint8 indexed rulesetId, address indexed customRuleset);

    /// @dev Emitted when a collection's token type is updated.
    event SetTokenType(address indexed collection, uint16 tokenType);

    /// @dev Emitted when a collection's security policy bit options is updated.
    event SetCollectionSecurityPolicyOptions(address indexed collection, uint8 globalOptions, uint16 rulesetOptions);

    /// @dev Emitted when a collection's security policy expansion words are updated.
    event SetCollectionExpansionWords(address indexed collection, bytes32 indexed key, bytes32 value);

    /// @dev Emitted when a collection's security policy expansion datums are updated.
    event SetCollectionExpansionDatums(address indexed collection, bytes32 indexed key, bytes value);

    /*************************************************************************/
    /*                              LIST MANAGEMENT                          */
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
    function createList(string calldata name) public returns (uint48 id) {
        unchecked {
            id = ++validatorStorage().lastListId;
        }

        validatorStorage().listOwners[id] = msg.sender;

        emit CreatedList(id, name);
        emit ReassignedListOwnership(id, msg.sender);
    }

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
    function createListCopy(string calldata name, uint48 sourceListId) external returns (uint48 id) {
        unchecked {
            id = ++validatorStorage().lastListId;

            if (sourceListId > id - 1) {
                revert CreatorTokenTransferValidator__ListDoesNotExist();
            }
        }

        validatorStorage().listOwners[id] = msg.sender;

        emit CreatedList(id, name);
        emit ReassignedListOwnership(id, msg.sender);

        List storage sourceBlacklist = validatorStorage().lists[LIST_TYPE_BLACKLIST][sourceListId];
        List storage sourceWhitelist = validatorStorage().lists[LIST_TYPE_WHITELIST][sourceListId];
        List storage sourceAuthorizers = validatorStorage().lists[LIST_TYPE_AUTHORIZERS][sourceListId];
        List storage targetBlacklist = validatorStorage().lists[LIST_TYPE_BLACKLIST][id];
        List storage targetWhitelist = validatorStorage().lists[LIST_TYPE_WHITELIST][id];
        List storage targetAuthorizers = validatorStorage().lists[LIST_TYPE_AUTHORIZERS][id];

        _copyAddressSet(LIST_TYPE_BLACKLIST, id, sourceBlacklist, targetBlacklist);
        _copyBytes32Set(LIST_TYPE_BLACKLIST, id, sourceBlacklist, targetBlacklist);
        _copyAddressSet(LIST_TYPE_WHITELIST, id, sourceWhitelist, targetWhitelist);
        _copyBytes32Set(LIST_TYPE_WHITELIST, id, sourceWhitelist, targetWhitelist);
        _copyAddressSet(LIST_TYPE_AUTHORIZERS, id, sourceAuthorizers, targetAuthorizers);
        _copyBytes32Set(LIST_TYPE_AUTHORIZERS, id, sourceAuthorizers, targetAuthorizers);
    }

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
    function createListCopy(
        string calldata name, 
        uint48 sourceListId, 
        uint8[] calldata listTypes
    ) external returns (uint48 id) {
        unchecked {
            id = ++validatorStorage().lastListId;

            if (sourceListId > id - 1) {
                revert CreatorTokenTransferValidator__ListDoesNotExist();
            }
        }

        validatorStorage().listOwners[id] = msg.sender;

        emit CreatedList(id, name);
        emit ReassignedListOwnership(id, msg.sender);

        uint8 listType;
        for (uint256 i = 0; i < listTypes.length; ++i) {
            listType = listTypes[i];
            List storage sourceList = validatorStorage().lists[listType][sourceListId];
            List storage targetList = validatorStorage().lists[listType][id];
            _copyAddressSet(listType, id, sourceList, targetList);
            _copyBytes32Set(listType, id, sourceList, targetList);
        }
    }

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
    function reassignOwnershipOfList(uint48 id, address newOwner) public {
        if(newOwner == address(0)) {
            revert CreatorTokenTransferValidator__ListOwnershipCannotBeTransferredToZeroAddress();
        }

        _reassignOwnershipOfList(id, newOwner);
    }

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
    function renounceOwnershipOfList(uint48 id) public {
        if (id == DEFAULT_LIST_ID) {
            revert CreatorTokenTransferValidator__CannotRenounceOwnershipOfDefaultList();
        }

        _reassignOwnershipOfList(id, address(0));
    }

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
    ) external {
        _requireCallerIsNFTOrContractOwnerOrAdmin(collection);

        CollectionSecurityPolicy storage ptrCollectionStoragePolicy = 
            validatorStorage().collectionSecurityPolicies[collection];
            
        if (rulesetId == RULESET_ID_FIXED_OR_CUSTOM) {
            if (!validatorStorage().registeredRulesets[customRuleset]) {
                revert CreatorTokenTransferValidator__RulesetIsNotRegistered();
            }

            ptrCollectionStoragePolicy.customRuleset = customRuleset;
        } else {
            if (validatorStorage().rulesetBindings[rulesetId] == address(0)) {
                revert CreatorTokenTransferValidator__InvalidTransferSecurityLevel();
            }

            if (customRuleset != address(0)) {
                revert CreatorTokenTransferValidator__CannotSetCustomRulesetOnManagedRulesetId();
            }

            ptrCollectionStoragePolicy.customRuleset = address(0);
        }

        ptrCollectionStoragePolicy.rulesetId = rulesetId;
        ptrCollectionStoragePolicy.globalOptions = globalOptions;
        ptrCollectionStoragePolicy.rulesetOptions = rulesetOptions;
        emit SetCollectionRuleset(collection, rulesetId, customRuleset);
        emit SetCollectionSecurityPolicyOptions(collection, globalOptions, rulesetOptions);
    }

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
    ) external {
        _requireCallerIsNFTOrContractOwnerOrAdmin(collection);

        if (expansionWords.length > 0) {
            mapping (bytes32 => bytes32) storage ptrExpansionWordsForCollection = 
                validatorStorage().collectionExpansionWords[collection];

            ExpansionWord calldata expansionWord;
            for (uint256 i = 0; i < expansionWords.length; ++i) {
                expansionWord = expansionWords[i];
                ptrExpansionWordsForCollection[expansionWord.key] = expansionWord.value;
                emit SetCollectionExpansionWords(collection, expansionWord.key, expansionWord.value);
            }
        }

        if (expansionDatums.length > 0) {
            mapping (bytes32 => bytes) storage ptrExpansionDatumsForCollection = 
                validatorStorage().collectionExpansionDatums[collection];

            ExpansionDatum calldata expansionDatum;
            for (uint256 i = 0; i < expansionDatums.length; ++i) {
                expansionDatum = expansionDatums[i];
                ptrExpansionDatumsForCollection[expansionDatum.key] = expansionDatum.value;
                emit SetCollectionExpansionDatums(collection, expansionDatum.key, expansionDatum.value);
            }
        }
    }

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
    ) external {
        _requireCallerIsNFTOrContractOwnerOrAdmin(collection);
        validatorStorage().collectionSecurityPolicies[collection].tokenType = tokenType;
        emit SetTokenType(collection, tokenType);
    }

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
    function applyListToCollection(address collection, uint48 id) public {
        _requireCallerIsNFTOrContractOwnerOrAdmin(collection);

        if (id > validatorStorage().lastListId) {
            revert CreatorTokenTransferValidator__ListDoesNotExist();
        }

        validatorStorage().collectionSecurityPolicies[collection].listId = id;
        emit AppliedListToCollection(collection, id);
    }

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
    function freezeAccountsForCollection(address collection, address[] calldata accountsToFreeze) external {
        _requireCallerIsNFTOrContractOwnerOrAdmin(collection);

        AccountList storage accounts = validatorStorage().frozenAccounts[collection];

        for (uint256 i = 0; i < accountsToFreeze.length; ++i) {
            address accountToFreeze = accountsToFreeze[i];

            if (accounts.enumerableAccounts.add(accountToFreeze)) {
                emit AccountFrozenForCollection(collection, accountToFreeze);
                accounts.nonEnumerableAccounts[accountToFreeze] = true;
            }
        }
    }

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
    function unfreezeAccountsForCollection(address collection, address[] calldata accountsToUnfreeze) external {
        _requireCallerIsNFTOrContractOwnerOrAdmin(collection);

        AccountList storage accounts = validatorStorage().frozenAccounts[collection];

        for (uint256 i = 0; i < accountsToUnfreeze.length; ++i) {
            address accountToUnfreeze = accountsToUnfreeze[i];

            if (accounts.enumerableAccounts.remove(accountToUnfreeze)) {
                emit AccountUnfrozenForCollection(collection, accountToUnfreeze);
                accounts.nonEnumerableAccounts[accountToUnfreeze] = false;
            }
        }
    }

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
    ) external {
        _addAccountsToList(validatorStorage().lists[listType][id], listType, id, accounts);
    }

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
    ) external {
        _removeAccountsFromList(validatorStorage().lists[listType][id], listType, id, accounts);
    }

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
    ) external {
        _addCodeHashesToList(validatorStorage().lists[listType][id], listType, id, codehashes);
    }

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
    ) external {
        _removeCodeHashesFromList(validatorStorage().lists[listType][id], listType, id, codehashes);
    }

    /*************************************************************************/
    /*                                HELPERS                                */
    /*************************************************************************/

    /**
     * @notice Reverts the transaction if the caller is not the owner or assigned the default
     * @notice admin role of the contract at `tokenAddress`.
     *
     * @dev    Throws when the caller is neither owner nor assigned the default admin role.
     * 
     * @param tokenAddress The contract address of the token to check permissions for.
     */
    function _requireCallerIsNFTOrContractOwnerOrAdmin(address tokenAddress) internal view {
        address caller = msg.sender;
        
        if(caller == tokenAddress) {
            return;
        }

        (address contractOwner,) = _safeOwner(tokenAddress);
        if(caller == contractOwner) {
            return;
        }

        (bool callerIsContractAdmin,) = _safeHasRole(tokenAddress, DEFAULT_ACCESS_CONTROL_ADMIN_ROLE, caller);
        if(callerIsContractAdmin) {
            return;
        }

        revert CreatorTokenTransferValidator__CallerMustHaveElevatedPermissionsForSpecifiedNFT();
    }

    /**
     * @notice Copies all addresses in `ptrFromList` to `ptrToList`.
     * 
     * @dev    This function will copy all addresses from one list to another list.
     * @dev    Note: If used to copy adddresses to an existing list the current list contents will not be
     * @dev    deleted before copying. New addresses will be appeneded to the end of the list and the
     * @dev    non-enumerable mapping key value will be set to true.
     * 
     * @dev <h4>Postconditions:</h4>
     *      1. Addresses in from list that are not already present in to list are added to the to list.
     *      2. Emits an `AddedAccountToList` event for each address copied to the list.
     * 
     * @param  listType          The type of list addresses are being copied from and to.
     * @param  destinationListId The id of the list being copied to.
     * @param  ptrFromList       The storage pointer for the list being copied from.
     * @param  ptrToList         The storage pointer for the list being copied to.
     */
    function _copyAddressSet(
        uint8 listType,
        uint48 destinationListId,
        List storage ptrFromList,
        List storage ptrToList
    ) private {
        EnumerableSet.AddressSet storage ptrFromSet = ptrFromList.enumerableAccounts;
        EnumerableSet.AddressSet storage ptrToSet = ptrToList.enumerableAccounts;
        mapping (address => bool) storage ptrToNonEnumerableSet = ptrToList.nonEnumerableAccounts;
        uint256 sourceLength = ptrFromSet.length();
        address account;
        for (uint256 i = 0; i < sourceLength; ++i) {
            account = ptrFromSet.at(i); 
            if (ptrToSet.add(account)) {
                emit AddedAccountToList(listType, destinationListId, account);
                ptrToNonEnumerableSet[account] = true;
            }
        }
    }

    /**
     * @notice Copies all codehashes in `ptrFromList` to `ptrToList`.
     * 
     * @dev    This function will copy all codehashes from one list to another list.
     * @dev    Note: If used to copy codehashes to an existing list the current list contents will not be
     * @dev    deleted before copying. New codehashes will be appeneded to the end of the list and the
     * @dev    non-enumerable mapping key value will be set to true.
     * 
     * @dev <h4>Postconditions:</h4>
     *      1. Codehashes in from list that are not already present in to list are added to the to list.
     *      2. Emits an `AddedCodeHashToList` event for each codehash copied to the list.
     * 
     * @param  listType          The type of list codehashes are being copied from and to.
     * @param  destinationListId The id of the list being copied to.
     * @param  ptrFromList       The storage pointer for the list being copied from.
     * @param  ptrToList         The storage pointer for the list being copied to.
     */
    function _copyBytes32Set(
        uint8 listType,
        uint48 destinationListId,
        List storage ptrFromList,
        List storage ptrToList
    ) private {
        EnumerableSet.Bytes32Set storage ptrFromSet = ptrFromList.enumerableCodehashes;
        EnumerableSet.Bytes32Set storage ptrToSet = ptrToList.enumerableCodehashes;
        mapping (bytes32 => bool) storage ptrToNonEnumerableSet = ptrToList.nonEnumerableCodehashes;
        uint256 sourceLength = ptrFromSet.length();
        bytes32 codehash;
        for (uint256 i = 0; i < sourceLength; ++i) {
            codehash = ptrFromSet.at(i);
            if (ptrToSet.add(codehash)) {
                emit AddedCodeHashToList(listType, destinationListId, codehash);
                ptrToNonEnumerableSet[codehash] = true;
            }
        }
    }

    /**
     * @notice Adds one or more accounts to a list.
     * 
     * @dev <h4>Postconditions:</h4>
     *      1. Accounts that were not previously in the list are added to the list.
     *      2. An `AddedAccountToList` event is emitted for each account that was not
     *         previously on the list.
     * 
     * @param list     The storage pointer for the list to add accounts to.
     * @param listType The type of list the accounts are being added to.
     * @param id       The id of the list the accounts are being added to.
     * @param accounts An array of accounts to add to the list.
     */
    function _addAccountsToList(
        List storage list,
        uint8 listType,
        uint48 id,
        address[] calldata accounts
    ) internal onlyListOwner(id) {
        address account;
        for (uint256 i = 0; i < accounts.length; ++i) {
            account = accounts[i];

            if (list.enumerableAccounts.add(account)) {
                emit AddedAccountToList(listType, id, account);
                list.nonEnumerableAccounts[account] = true;
            }
        }
    }

    /**
     * @notice Adds one or more codehashes to a list.
     * 
     * @dev <h4>Postconditions:</h4>
     *      1. Codehashes that were not previously in the list are added to the list.
     *      2. An `AddedCodeHashToList` event is emitted for each codehash that was not
     *         previously on the list.
     * 
     * @param list        The storage pointer for the list to add codehashes to.
     * @param listType    The type of list the codehashes are being added to.
     * @param id          The id of the list the codehashes are being added to.
     * @param codehashes  An array of codehashes to add to the list.
     */
    function _addCodeHashesToList(
        List storage list,
        uint8 listType,
        uint48 id,
        bytes32[] calldata codehashes
    ) internal onlyListOwner(id) {
        bytes32 codehash;
        for (uint256 i = 0; i < codehashes.length; ++i) {
            codehash = codehashes[i];

            if (list.enumerableCodehashes.add(codehash)) {
                emit AddedCodeHashToList(listType, id, codehash);
                list.nonEnumerableCodehashes[codehash] = true;
            }
        }
    }

    /**
     * @notice Removes one or more accounts from a list.
     * 
     * @dev <h4>Postconditions:</h4>
     *      1. Accounts that were previously in the list are removed from the list.
     *      2. An `RemovedAccountFromList` event is emitted for each account that was
     *         previously on the list.
     * 
     * @param list        The storage pointer for the list to remove accounts from.
     * @param listType    The type of list the accounts are being removed from.
     * @param id          The id of the list the accounts are being removed from.
     * @param accounts    An array of accounts to remove from the list.
     */
    function _removeAccountsFromList(
        List storage list, 
        uint8 listType,
        uint48 id, 
        address[] memory accounts
    ) internal onlyListOwner(id) {
        address account;
        for (uint256 i = 0; i < accounts.length; ++i) {
            account = accounts[i];
            if (list.enumerableAccounts.remove(account)) {
                emit RemovedAccountFromList(listType, id, account);
                delete list.nonEnumerableAccounts[account];
            }
        }
    }

    /**
     * @notice Removes one or more codehashes from a list.
     * 
     * @dev <h4>Postconditions:</h4>
     *      1. Codehashes that were previously in the list are removed from the list.
     *      2. An `RemovedCodeHashFromList` event is emitted for each codehash that was
     *         previously on the list.
     * 
     * @param list        The storage pointer for the list to remove codehashes from.
     * @param listType    The type of list the codehashes are being removed from.
     * @param id          The id of the list the codehashes are being removed from.
     * @param codehashes  An array of codehashes to remove from the list.
     */
    function _removeCodeHashesFromList(
        List storage list, 
        uint8 listType, 
        uint48 id, 
        bytes32[] calldata codehashes
    ) internal onlyListOwner(id) {
        bytes32 codehash;
        for (uint256 i = 0; i < codehashes.length; ++i) {
            codehash = codehashes[i];
            if (list.enumerableCodehashes.remove(codehash)) {
                emit RemovedCodeHashFromList(listType, id, codehash);
                delete list.nonEnumerableCodehashes[codehash];
            }
        }
    }

    /**
     * @notice Sets the owner of list `id` to `newOwner`.
     * 
     * @dev    Throws when the caller is not the owner of the list.
     * 
     * @dev    <h4>Postconditions:</h4>
     *         1. The owner of list `id` is set to `newOwner`.
     *         2. Emits a `ReassignedListOwnership` event.
     * 
     * @param id       The id of the list to reassign ownership of.
     * @param newOwner The account to assign ownership of the list to.
     */
    function _reassignOwnershipOfList(uint48 id, address newOwner) private onlyListOwner(id) {
        validatorStorage().listOwners[id] = newOwner;
        emit ReassignedListOwnership(id, newOwner);
    }

    /**
     * @dev A gas efficient, and fallback-safe way to call the owner function on a token contract.
     *      This will get the owner if it exists - and when the function is unimplemented, the
     *      presence of a fallback function will not result in halted execution.
     * 
     * @param tokenAddress  The address of the token collection to get the owner of.
     * 
     * @return owner   The owner of the token collection contract.
     * @return isError True if there was an error in retrieving the owner, false if the call was successful.
     */
    function _safeOwner(
        address tokenAddress
    ) internal view returns(address owner, bool isError) {
        assembly {
            function _callOwner(_tokenAddress) -> _owner, _isError {
                mstore(0x00, 0x8da5cb5b)
                if and(iszero(lt(returndatasize(), 0x20)), staticcall(gas(), _tokenAddress, 0x1C, 0x04, 0x00, 0x20)) {
                    _owner := mload(0x00)
                    leave
                }
                _isError := true
            }
            owner, isError := _callOwner(tokenAddress)
        }
    }
    
    /**
     * @dev A gas efficient, and fallback-safe way to call the hasRole function on a token contract.
     *      This will check if the account `hasRole` if `hasRole` exists - and when the function is unimplemented, the
     *      presence of a fallback function will not result in halted execution.
     * 
     * @param tokenAddress  The address of the token collection to call hasRole on.
     * @param role          The role to check if the account has on the collection.
     * @param account       The address of the account to check if they have a specified role.
     * 
     * @return hasRole The owner of the token collection contract.
     * @return isError True if there was an error in retrieving the owner, false if the call was successful.
     */
    function _safeHasRole(
        address tokenAddress,
        bytes32 role,
        address account
    ) internal view returns(bool hasRole, bool isError) {
        assembly {
            function _callHasRole(_tokenAddress, _role, _account) -> _hasRole, _isError {
                let ptr := mload(0x40)
                mstore(0x40, add(ptr, 0x60))
                mstore(ptr, 0x91d14854)
                mstore(add(0x20, ptr), _role)
                mstore(add(0x40, ptr), _account)
                if and(iszero(lt(returndatasize(), 0x20)), staticcall(gas(), _tokenAddress, add(ptr, 0x1C), 0x44, 0x00, 0x20)) {
                    _hasRole := mload(0x00)
                    leave
                }
                _isError := true
            }
            hasRole, isError := _callHasRole(tokenAddress, role, account)
        }
    }
}
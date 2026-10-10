// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../tm-core-lib/src/utils/structs/EnumerableSet.sol";

/**
 * @dev This struct contains the security policy settings for a collection.
 */
struct CollectionSecurityPolicy {
    uint8 rulesetId;
    uint48 listId;
    address customRuleset;
    uint8 globalOptions;
    uint16 rulesetOptions;
    uint16 tokenType;
}


/**
 * @dev This struct is internally for the storage of account and codehash lists.
 */
struct List {
    EnumerableSet.AddressSet enumerableAccounts;
    EnumerableSet.Bytes32Set enumerableCodehashes;
    mapping (address => bool) nonEnumerableAccounts;
    mapping (bytes32 => bool) nonEnumerableCodehashes;
}

/**
 * @dev This struct is internally for the storage of account lists.
 */
struct AccountList {
    EnumerableSet.AddressSet enumerableAccounts;
    mapping (address => bool) nonEnumerableAccounts;
}

/**
 * @dev This struct contains a key and value pair for future expansion data words that are 32 bytes long.
 */
struct ExpansionWord {
    bytes32 key;
    bytes32 value;
}

/**
 * @dev This struct contains a key and value pair for future expansion data bytes that are variable length.
 */
struct ExpansionDatum {
    bytes32 key;
    bytes value;
}

/**
 * @dev This struct contains the storage layout for the validator contract, excluding Permit-C and Tstorish data.
 */
struct ValidatorStorage {
    /// @notice Keeps track of the most recently created list id.
    uint48 lastListId;

    /// @dev Used as a collision guard.
    mapping (address => address) transientOperator;

    /// @notice Mapping of list ids to list owners
    mapping (uint48 => address) listOwners;

    /// @dev Mapping of collection addresses to their security policy settings
    mapping (address => CollectionSecurityPolicy) collectionSecurityPolicies;

    /// @dev Mapping of collections to accounts that are frozen for those collections
    mapping (address => AccountList) frozenAccounts;

    /// @dev Mapping of list ids to list data
    mapping (uint8 => mapping (uint48 => List)) lists;

    /// @dev Mapping of collection addressses to any future expansion data words settings that may be used in the future
    mapping (address collection => mapping (bytes32 extension => bytes32 word)) collectionExpansionWords;

    /// @dev Mapping of collection addressses to any future expansion data bytes settings that may be used in the future
    mapping (address collection => mapping (bytes32 extension => bytes data)) collectionExpansionDatums;

    /// @dev Mapping of addresses to a boolean indicating if they are registered trusted validator modules
    mapping (address => bool) registeredRulesets;

    /// @dev Mapping of security levels to their current implementation modules
    mapping (uint8 => address) rulesetBindings;
}
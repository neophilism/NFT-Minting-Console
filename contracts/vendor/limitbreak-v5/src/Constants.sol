// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**************************************************************/
/*                        LIST TYPES                          */
/**************************************************************/

uint8 constant LIST_TYPE_BLACKLIST = 0;
uint8 constant LIST_TYPE_WHITELIST = 1;
uint8 constant LIST_TYPE_AUTHORIZERS = 2;
uint8 constant EXPANSION_LIST_TYPE_WHITELIST_EXTENSION_CONTRACTS = 3;
uint8 constant EXPANSION_LIST_TYPE_7702_DELEGATE_WHITELIST = 4;
uint8 constant EXPANSION_LIST_TYPE_7702_DELEGATE_WHITELIST_EXTENSION_CONTRACTS = 5;

/**************************************************************/
/*                        RULESET IDS                         */
/**************************************************************/

uint8 constant RULESET_ID_DEFAULT = 0;
uint8 constant RULESET_ID_VANILLA = 1;
uint8 constant RULESET_ID_SOULBOUND = 2;
uint8 constant RULESET_ID_BLACKLIST = 3;
uint8 constant RULESET_ID_WHITELIST = 4;
uint8 constant RULESET_ID_FIXED_OR_CUSTOM = 255;

/**************************************************************/
/*                    AUTHORIZER CHECK TYPES                  */
/**************************************************************/

uint256 constant AUTHORIZER_CHECK_TYPE_TOKEN = 1;
uint256 constant AUTHORIZER_CHECK_TYPE_COLLECTION = 2;
uint256 constant AUTHORIZER_CHECK_TYPE_TOKEN_AND_AMOUNT = 3;

/**************************************************************/
/*                       MISCELLANEOUS                        */
/**************************************************************/

bytes4 constant LEGACY_TRANSFER_VALIDATOR_INTERFACE_ID = bytes4(0x00000000);
bytes4 constant SELECTOR_NO_ERROR = bytes4(0x00000000);
bytes32 constant BYTES32_ZERO = 0x0000000000000000000000000000000000000000000000000000000000000000;
bytes32 constant DEFAULT_ACCESS_CONTROL_ADMIN_ROLE = 0x0000000000000000000000000000000000000000000000000000000000000000;
address constant WILDCARD_OPERATOR_ADDRESS = address(0x01);
uint48 constant DEFAULT_LIST_ID = 0;
uint16 constant DEFAULT_TOKEN_TYPE = 0;

/**************************************************************/
/*                       FLAGS - GLOBAL                       */
/**************************************************************/

// Flags are used to efficiently store and retrieve boolean values in a single uint8.
// Each flag is a power of 2, so they can be combined using bitwise OR (|) and checked using bitwise AND (&).
// For example, to set the first and third flags, you would use: flags = FLAG1 | FLAG3;
// To check if the first flag is set, you would use: if (flags & FLAG1 != 0) { ... }
uint8 constant FLAG_GLOBAL_DISABLE_AUTHORIZATION_MODE = 1 << 0;
uint8 constant FLAG_GLOBAL_AUTHORIZERS_CANNOT_SET_WILDCARD_OPERATORS = 1 << 1;
uint8 constant FLAG_GLOBAL_ENABLE_ACCOUNT_FREEZING_MODE = 1 << 2;
uint8 constant FLAG_GLOBAL_CUSTOM_LIST_SUPPLEMENTS_DEFAULT_LIST = 1 << 3;

/**************************************************************/
/*                  FLAGS - RULESET WHITELIST                 */
/**************************************************************/

uint16 constant FLAG_RULESET_WHITELIST_BLOCK_ALL_OTC = 1 << 0;
uint16 constant FLAG_RULESET_WHITELIST_ALLOW_OTC_FOR_7702_DELEGATES = 1 << 1;
uint16 constant FLAG_RULESET_WHITELIST_ALLOW_OTC_FOR_SMART_WALLETS = 1 << 2;
uint16 constant FLAG_RULESET_WHITELIST_BLOCK_SMART_WALLET_RECEIVERS = 1 << 3;
uint16 constant FLAG_RULESET_WHITELIST_BLOCK_UNVERIFIED_EOA_RECEIVERS = 1 << 4;

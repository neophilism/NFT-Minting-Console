// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./RulesetBase.sol";
import "../interfaces/IWhitelistExtension.sol";
import "../../tm-core-lib/src/utils/token/IEOARegistry.sol";

/**
 * @title RulesetWhitelist
 * @author Limit Break, Inc.
 * @notice A ruleset contract that blocks transfers by default, unless exceptions are made through various options and 
 *         whitelisting rules.  
 */
contract RulesetWhitelist is IRuleset, RulesetBase {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    struct Options {
        bool enableAccountFreezingMode;
        bool disableAuthorizationMode;
        bool customListSupplementsDefaultList;
        bool blockSmartWalletReceivers;
        bool blockUnverifiedEOAReceivers;
        bool blockAllOTC;
        bool allowOTCFor7702Delegates;
        bool allowOTCForSmartWallets;
    }

    /// @dev The address of the EOA Registry to use to validate an account is a verified EOA.
    address private immutable _eoaRegistry;

    constructor(address eoaRegistry_) RulesetBase() {
        if (eoaRegistry_ == address(0)) {
            revert CreatorTokenTransferValidator__InvalidConstructorArgs();
        }

        _eoaRegistry = eoaRegistry_;
    }

    /**
     * @notice Validates a transfer of a Creator Token.
     *
     * @notice Global Options Used: 
     *         - Disable Authorization Mode: Toggles authorization mode logic on/off (default: enabled)
     *         - Enable Account Freezing Mode: Toggles account freezing logic on/off (default: disabled)     
     *         - Custom List Supplements Default List Mode: When toggled on, whitelist includes both custom list 
     *                                                      values and default managed list values (default: off)
     *
     * @notice Ruleset-Specific Options Used: 
     *         - Block Smart Wallet Receivers: When enabled, blocks transfers to receivers with 
     *                                         code length > 0, unless `to` is whitelisted (default: disabled)
     *         - Block Unverified EOA Receivers: When enabled, blocks transfers to receivers that have not verified
     *                                           an ECDSA signature on the EOA registry, unless `to` is whitelisted 
     *                                           (default: disabled)
     *         - Block All OTC: When enabled, blocks all OTC transfers, unless `caller` or `from` are whitelisted 
     *                          (default: disabled) 
     *                          [OTC transfer is defined as any owner-initiated transfer where caller == from]
     *         - Allow OTC For 7702 Delegates: Unused when Block All OTC is enabled. When enabled, allows OTC transfers 
     *                                         from EOAs that currently have EIP-7702 delegates attached. When disabled,
     *                                         blocks OTC transfers from EOAs that currently have EIP-7702 delegates 
     *                                         attached, unless the attached delegate is whitelisted. 
     *                                         (default: disabled)
     *         - Allow OTC For Smart Wallets: Unused when Block All OTC is enabled. When enabled, allows OTC transfers
     *                                        from smart wallets. When disabled, blocks OTC transfers from smart wallets,
     *                                        unless the smart wallet is whitelisted. (default: disabled)
     *
     * @notice Validation Flow: 
     *         1. If account freezing mode is enabled, check if the sender or recipient is frozen.
     *            If frozen, block transfer and return.
     *         2. If authorization mode is enabled, check if an authorizer has pre-authorized transfer of 
     *            collection/token id/amount by operator (msg.sender). If authorized, allow transfer and return.
     *         3. If block smart wallet receivers is enabled, check if the receiver has code length > 0. If so,
     *            check if the receiver is whitelisted. If not whitelisted, block transfer and return. 
     *            If whitelisted, continue.
     *         4. If block unverified EOA receivers is enabled, check if the receiver has verified an ECDSA signature
     *            on the EOA registry. If not verified, check if the receiver is whitelisted. If not whitelisted, 
     *            block transfer and return. If whitelisted, continue.
     *         5. If transfer is OTC (caller == from):
     *            5a. If block all OTC is enabled, check if `caller` or `from` are whitelisted.  
     *                If not whitelisted, block transfer and return.  If whitelisted, allow transfer and return.
     *            5b. If block all OTC is disabled, and code length of `from` address equals 0, allow transfer and return.
     *            5c. If block all OTC is disabled, and code length of `from` address is greater than 0:
     *                5ci. If `from` is an EOA with delegation attached: when allow OTC for 7702 delegates is enabled, 
     *                     allow transfer an return.  Otherwise, when allow OTC for 7702 delegates is disabled, check
     *                     if delegate is whitelisted. If not whitelisted, block transfer and return. If whitelisted,
     *                     allow transfer and return.
     *                5cii. Otherwise, `from` is a smart wallet. If allow OTC for smart wallets is enabled, allow 
     *                      transfer and return. Otherwise, check if `from` is whitelisted. If not whitelisted, block
     *                      transfer and return. If whitelisted, allow transfer and return.
     *          6. If transfer is not OTC (caller != from), check if `caller` is whitelisted. If not whitelisted, 
     *             block transfer and return. If whitelisted, allow transfer and return.
     *
     * @notice Whitelisting Notes:
     *         - When performing a whitelist check, when custom list supplements default list mode is enabled, the
     *           default whitelist is checked first.  If the operator is not whitelisted in the default list, the
     *           custom list specified in the collection security policy is checked.
     *         - When performing whitelist checks, accounts are first checked by address, then by codehash, and finally
     *           evaluated against a set of 0 or more whitelist extensions.
     */
    function validateTransfer(
        uint256 authorizerCheckType,
        address collection,
        address caller, 
        address from,
        address to,
        uint256 tokenId,
        uint256 amount) external view returns (bytes4) {
        CollectionSecurityPolicy storage collectionSecurityPolicy = 
            validatorStorage().collectionSecurityPolicies[collection];

        Options memory opts = 
            _getOptions(collectionSecurityPolicy.globalOptions, collectionSecurityPolicy.rulesetOptions);

        if (opts.enableAccountFreezingMode) {
            AccountList storage frozenAccountList = validatorStorage().frozenAccounts[collection];
            
            if (frozenAccountList.nonEnumerableAccounts[from]) {
                return CreatorTokenTransferValidator__SenderAccountIsFrozen.selector;
            }

            if (frozenAccountList.nonEnumerableAccounts[to]) {
                return CreatorTokenTransferValidator__ReceiverAccountIsFrozen.selector;
            }
        }

        if (!opts.disableAuthorizationMode) {
            if (_isAuthorized(authorizerCheckType, collection, caller, tokenId, amount)) {
                return SELECTOR_NO_ERROR;
            }
        }

        return _doWhitelistChecks(
            opts, 
            collectionSecurityPolicy.listId,
            collection, 
            to, 
            caller, 
            from);
    }

    function _doWhitelistChecks(
        Options memory opts,
        uint48 listId,
        address collection,
        address to,
        address caller, 
        address from
    ) internal view returns (bytes4) {
        (
            mapping (address => bool) storage accountWhitelist,
            mapping (bytes32 => bool) storage codehashWhitelist,
            EnumerableSet.AddressSet storage whitelistExtensions
        ) = _getWhitelistStoragePointers(listId);

        if (opts.blockSmartWalletReceivers) {
            if (_getCodeLengthAsm(to) > 0) {
                if (!_isWhitelisted(opts.customListSupplementsDefaultList, accountWhitelist, codehashWhitelist, whitelistExtensions, collection, to)) {
                    return CreatorTokenTransferValidator__ReceiverMustNotHaveDeployedCode.selector;
                }
            }
        }

        if (opts.blockUnverifiedEOAReceivers) {
            if (!_isVerifiedEOA(to)) {
                if (!_isWhitelisted(opts.customListSupplementsDefaultList, accountWhitelist, codehashWhitelist, whitelistExtensions, collection, to)) {
                    return CreatorTokenTransferValidator__ReceiverProofOfEOASignatureUnverified.selector;
                }
            }
        }

        if (caller == from) {
            if (!opts.blockAllOTC) {
                if (_getCodeLengthAsm(from) > 0) {
                    (bool isDelegate, address delegate) = _check7702(from);

                    if (opts.allowOTCFor7702Delegates) {
                        // If allowing OTC for 7702 delegates, check if the owner is delegated or not
                        if (!isDelegate) {
                            // This is a non-delegated smart wallet account, if OTC is not allowed for smart wallets check against whitelist
                            if (!opts.allowOTCForSmartWallets) {
                                if (!_isWhitelisted(opts.customListSupplementsDefaultList, accountWhitelist, codehashWhitelist, whitelistExtensions, collection, from)) {
                                    return CreatorTokenTransferValidator__OTCNotAllowedForSmartWallets.selector;
                                }
                            }
                        }
                    } else {
                        // If not allowing OTC for 7702 delegates, check if the owner is delegated or not
                        if (isDelegate) { 
                            // This is a delegated EOA account, block unless delegate is whitelisted
                            if (!_is7702DelegateWhitelisted(opts.customListSupplementsDefaultList, listId, collection, delegate)) {
                                return CreatorTokenTransferValidator__OTCNotAllowedFor7702Delegates.selector;
                            }
                        } else {
                            // This is a non-delegated smart wallet account, if OTC is not allowed for smart wallets check against whitelist
                            if (!opts.allowOTCForSmartWallets) {
                                if (!_isWhitelisted(opts.customListSupplementsDefaultList, accountWhitelist, codehashWhitelist, whitelistExtensions, collection, from)) {
                                    return CreatorTokenTransferValidator__OTCNotAllowedForSmartWallets.selector;
                                }
                            }
                        }
                    }
                }

                return SELECTOR_NO_ERROR;
            }
        }

        if (!_isWhitelisted(opts.customListSupplementsDefaultList, accountWhitelist, codehashWhitelist, whitelistExtensions, collection, caller, from)) {
            return CreatorTokenTransferValidator__CallerOrFromMustBeWhitelisted.selector;
        }

        return SELECTOR_NO_ERROR;
    }

    function _isWhitelisted(
        bool customListSupplementsDefaultList,
        mapping (address => bool) storage accountWhitelist,
        mapping (bytes32 => bool) storage codehashWhitelist,
        EnumerableSet.AddressSet storage whitelistExtensions,
        address collection,
        address account
    ) internal view returns (bool isWhitelisted) {
        if (customListSupplementsDefaultList) {
            (
                mapping (address => bool) storage defaultAccountWhitelist,
                mapping (bytes32 => bool) storage defaultCodehashWhitelist,
                EnumerableSet.AddressSet storage defaultWhitelistExtensions
            ) = _getWhitelistStoragePointers(DEFAULT_LIST_ID);

            if (_checkWhitelist(
                    defaultAccountWhitelist, 
                    defaultCodehashWhitelist, 
                    defaultWhitelistExtensions, 
                    collection, 
                    account)) {
                return true;
            }
        }

        return _checkWhitelist(accountWhitelist, codehashWhitelist, whitelistExtensions, collection, account);
    }

    function _isWhitelisted(
        bool customListSupplementsDefaultList,
        mapping (address => bool) storage accountWhitelist,
        mapping (bytes32 => bool) storage codehashWhitelist,
        EnumerableSet.AddressSet storage whitelistExtensions,
        address collection,
        address account1,
        address account2
    ) internal view returns (bool isWhitelisted) {
        if (customListSupplementsDefaultList) {
            (
                mapping (address => bool) storage defaultAccountWhitelist,
                mapping (bytes32 => bool) storage defaultCodehashWhitelist,
                EnumerableSet.AddressSet storage defaultWhitelistExtensions
            ) = _getWhitelistStoragePointers(DEFAULT_LIST_ID);

            if (_checkWhitelist(
                    defaultAccountWhitelist, 
                    defaultCodehashWhitelist, 
                    defaultWhitelistExtensions, 
                    collection, 
                    account1,
                    account2)) {
                return true;
            }
        }

        return _checkWhitelist(accountWhitelist, codehashWhitelist, whitelistExtensions, collection, account1, account2);
    }

    function _is7702DelegateWhitelisted(
        bool customListSupplementsDefaultList,
        uint48 listId,
        address collection,
        address account
    ) internal view returns (bool isWhitelisted) {
        if (customListSupplementsDefaultList) {
            (
                mapping (address => bool) storage defaultAccountWhitelist,
                mapping (bytes32 => bool) storage defaultCodehashWhitelist,
                EnumerableSet.AddressSet storage defaultWhitelistExtensions
            ) = _get7702DelegateWhitelistStoragePointers(DEFAULT_LIST_ID);

            if (_checkWhitelist(
                    defaultAccountWhitelist, 
                    defaultCodehashWhitelist, 
                    defaultWhitelistExtensions, 
                    collection, 
                    account)) {
                return true;
            }
        }

        (
            mapping (address => bool) storage accountWhitelist,
            mapping (bytes32 => bool) storage codehashWhitelist,
            EnumerableSet.AddressSet storage whitelistExtensions
        ) = _get7702DelegateWhitelistStoragePointers(listId);

        return _checkWhitelist(accountWhitelist, codehashWhitelist, whitelistExtensions, collection, account);
    }

    function _checkWhitelist(
        mapping (address => bool) storage accountWhitelist,
        mapping (bytes32 => bool) storage codehashWhitelist,
        EnumerableSet.AddressSet storage whitelistExtensions,
        address collection,
        address account
    ) internal view returns (bool isWhitelisted) {
        isWhitelisted = 
                accountWhitelist[account] || 
                codehashWhitelist[_getCodeHashAsm(account)];

        if (!isWhitelisted) {
            uint256 lengthOfExtensionsList = whitelistExtensions.length();
            for (uint256 i = 0; i < lengthOfExtensionsList; ++i) {
                IWhitelistExtension whitelistExtension = IWhitelistExtension(whitelistExtensions.at(i));
                if (whitelistExtension.isWhitelisted(collection, account)) {
                    isWhitelisted = true;
                    break;
                }
            }
        }
    }

    function _checkWhitelist(
        mapping (address => bool) storage accountWhitelist,
        mapping (bytes32 => bool) storage codehashWhitelist,
        EnumerableSet.AddressSet storage whitelistExtensions,
        address collection,
        address account1,
        address account2
    ) internal view returns (bool isWhitelisted) {
        isWhitelisted = 
            accountWhitelist[account1] || 
            accountWhitelist[account2] || 
            codehashWhitelist[_getCodeHashAsm(account1)] ||
            codehashWhitelist[_getCodeHashAsm(account2)];

        if (!isWhitelisted) {
            uint256 lengthOfExtensionsList = whitelistExtensions.length();
            for (uint256 i = 0; i < lengthOfExtensionsList; ++i) {
                IWhitelistExtension whitelistExtension = IWhitelistExtension(whitelistExtensions.at(i));
                if (whitelistExtension.isWhitelisted(collection, account1) || 
                    whitelistExtension.isWhitelisted(collection, account2)) {
                    isWhitelisted = true;
                    break;
                }
            }
        }
    }

    /// @notice Returns true if the specified account has verified a signature on the registry, false otherwise.
    function _isVerifiedEOA(address account) internal view returns (bool) {
        return IEOARegistry(_eoaRegistry).isVerifiedEOA(account);
    }

    function _getOptions(uint8 globalOptions, uint16 whitelistOptions) internal pure returns (Options memory options) {
        options.enableAccountFreezingMode = 
            _isFlagSet(globalOptions, FLAG_GLOBAL_ENABLE_ACCOUNT_FREEZING_MODE);

        options.disableAuthorizationMode = 
            _isFlagSet(globalOptions, FLAG_GLOBAL_DISABLE_AUTHORIZATION_MODE);

        options.customListSupplementsDefaultList = 
            _isFlagSet(globalOptions, FLAG_GLOBAL_CUSTOM_LIST_SUPPLEMENTS_DEFAULT_LIST);

        options.blockSmartWalletReceivers = 
            _isFlagSet(whitelistOptions, FLAG_RULESET_WHITELIST_BLOCK_SMART_WALLET_RECEIVERS);

        options.blockUnverifiedEOAReceivers = 
            _isFlagSet(whitelistOptions, FLAG_RULESET_WHITELIST_BLOCK_UNVERIFIED_EOA_RECEIVERS);

        options.blockAllOTC = 
            _isFlagSet(whitelistOptions, FLAG_RULESET_WHITELIST_BLOCK_ALL_OTC);

        options.allowOTCFor7702Delegates = 
            _isFlagSet(whitelistOptions, FLAG_RULESET_WHITELIST_ALLOW_OTC_FOR_7702_DELEGATES);
            
        options.allowOTCForSmartWallets = 
            _isFlagSet(whitelistOptions, FLAG_RULESET_WHITELIST_ALLOW_OTC_FOR_SMART_WALLETS);
    }

    function _getWhitelistStoragePointers(uint48 listId) 
    internal 
    view 
    returns (
        mapping (address => bool) storage accountWhitelist,
        mapping (bytes32 => bool) storage codehashWhitelist,
        EnumerableSet.AddressSet storage whitelistExtensions
    ) {
        List storage whitelist = validatorStorage().lists[LIST_TYPE_WHITELIST][listId];
        accountWhitelist = whitelist.nonEnumerableAccounts;
        codehashWhitelist = whitelist.nonEnumerableCodehashes;
        whitelistExtensions = 
            validatorStorage().lists[EXPANSION_LIST_TYPE_WHITELIST_EXTENSION_CONTRACTS][listId].enumerableAccounts;
    }

    function _get7702DelegateWhitelistStoragePointers(uint48 listId) 
    internal 
    view 
    returns (
        mapping (address => bool) storage accountWhitelist,
        mapping (bytes32 => bool) storage codehashWhitelist,
        EnumerableSet.AddressSet storage whitelistExtensions
    ) {
        List storage whitelist = 
            validatorStorage().lists[EXPANSION_LIST_TYPE_7702_DELEGATE_WHITELIST][listId];
        accountWhitelist = whitelist.nonEnumerableAccounts;
        codehashWhitelist = whitelist.nonEnumerableCodehashes;
        whitelistExtensions = 
            validatorStorage().lists[EXPANSION_LIST_TYPE_7702_DELEGATE_WHITELIST_EXTENSION_CONTRACTS][listId].enumerableAccounts;
    }
}
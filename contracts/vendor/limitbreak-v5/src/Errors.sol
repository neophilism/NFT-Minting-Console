// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Thrown when admin attempts to bind a ruleset to the fixed/custom ruleset ID.
error CreatorTokenTransferValidator__AdminCannotAssignRulesetToRulesetIdCustom();

/// @dev Thrown when validating transfers with amount if authorization by amount mode is active and the amount
///      exceeds the pre-authorized amount.
error CreatorTokenTransferValidator__AmountExceedsAuthorization();

/// @dev Thrown when attempting to set a authorized operator when authorization mode is disabled.
error CreatorTokenTransferValidator__AuthorizationDisabledForCollection();

/// @dev Thrown when attempting to call a function that requires the caller to be the list owner.
error CreatorTokenTransferValidator__CallerDoesNotOwnList();

/// @dev Thrown when authorizing a transfer for a collection using authorizers and the msg.sender is not in the 
///      authorizer list.
error CreatorTokenTransferValidator__CallerMustBeAnAuthorizer();

/// @dev Thrown when validating a transfer for a collection using whitelists and the operator is not on the whitelist.
error CreatorTokenTransferValidator__CallerMustBeWhitelisted();

/// @dev Thrown when attempting to call a function that requires owner or default admin role for a collection that the 
///      caller does not have.
error CreatorTokenTransferValidator__CallerMustHaveElevatedPermissionsForSpecifiedNFT();

/// @dev Thrown when validating a transfer for a collection using whitelists and the operator or from account is not on the whitelist.
error CreatorTokenTransferValidator__CallerOrFromMustBeWhitelisted();

/// @dev Thrown when attempting to renounce ownership of the default list id.
error CreatorTokenTransferValidator__CannotRenounceOwnershipOfDefaultList();

/// @dev Thrown when setting the ruleset for a collection when a reserved ruleset id is used, but a custom ruleset
///      is specified.
error CreatorTokenTransferValidator__CannotSetCustomRulesetOnManagedRulesetId();

/// @dev Thrown when constructor args are not valid
error CreatorTokenTransferValidator__InvalidConstructorArgs();

/// @dev Thrown when setting the transfer security level to an invalid value.
error CreatorTokenTransferValidator__InvalidTransferSecurityLevel();

/// @dev Thrown when attempting to set a list id that does not exist.
error CreatorTokenTransferValidator__ListDoesNotExist();

/// @dev Thrown when attempting to transfer the ownership of a list to the zero address.
error CreatorTokenTransferValidator__ListOwnershipCannotBeTransferredToZeroAddress();

/// @dev Thrown when attempting to call the transfer validation logic externally, as staticcall guarantees are needed.
error CreatorTokenTransferValidator__OnlyValidatorCanAccessThisFunction();

/// @dev Thrown when validating a transfer for a collection using blacklists and the operator is on the blacklist.
error CreatorTokenTransferValidator__OperatorIsBlacklisted();

/// @dev Thrown when validating an OTC transfer with EIP-7702 Delegation when disabled by security settings.
error CreatorTokenTransferValidator__OTCNotAllowedFor7702Delegates();

/// @dev Thrown when validating an OTC transfer from Smart Wallets when disabled by security settings.
error CreatorTokenTransferValidator__OTCNotAllowedForSmartWallets();

/// @dev Thrown when a frozen account is the receiver of a transfer
error CreatorTokenTransferValidator__ReceiverAccountIsFrozen();

/// @dev Thrown when validating a transfer for a collection that does not allow receiver to have code and the receiver 
///      has code.
error CreatorTokenTransferValidator__ReceiverMustNotHaveDeployedCode();

/// @dev Thrown when validating a transfer for a collection that requires receivers be verified EOAs and the receiver 
///      is not verified.
error CreatorTokenTransferValidator__ReceiverProofOfEOASignatureUnverified();

/// @dev Thrown when attempting to register a ruleset that is not a contract.
error CreatorTokenTransferValidator__RulesetIsNotContract();

/// @dev Thrown when attempting to register a ruleset that is not pure.
error CreatorTokenTransferValidator__RulesetIsNotPure();

/// @dev Thrown when admin attempts to bind a ruleset that is not registered, or a collection admin tries to 
///      set their fixed/custom ruleset to an unregistered ruleset.
error CreatorTokenTransferValidator__RulesetIsNotRegistered();

/// @dev Thrown when a frozen account is the sender of a transfer
error CreatorTokenTransferValidator__SenderAccountIsFrozen();

/// @dev Thrown when validating a transfer for a collection that is in soulbound token mode.
error CreatorTokenTransferValidator__TokenIsSoulbound();

/// @dev Thrown when attempting to validate a permitted transfer where the permit type does not match the 
///      collection-defined token type.
error CreatorTokenTransferValidator__TokenTypesDoNotMatch();

/// @dev Thrown when an authorizer attempts to set a wildcard authorized operator on collections that don't 
///      allow wildcards
error CreatorTokenTransferValidator__WildcardOperatorsCannotBeAuthorizedForCollection();
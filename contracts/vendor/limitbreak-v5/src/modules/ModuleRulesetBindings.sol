// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../Constants.sol";
import "../DataTypes.sol";
import "../Errors.sol";
import "../ValidatorBase.sol";

/**
 * @title ModuleRulesetBindings
 * @author Limit Break, Inc.
 * @notice Module for registering and binding rulesets for the Creator Token Validator.
 */
contract ModuleRulesetBindings is ValidatorBase {
    
    /*************************************************************************/
    /*                                EVENTS                                 */
    /*************************************************************************/

    /// @dev Emitted when a delegated ruleset is registered.
    event RulesetRegistered(address indexed delegatedRuleset);

    /// @dev Emitted when a ruleset binding is set.
    event RulesetBindingUpdated(uint8 indexed rulesetId, address indexed oldRuleset, address indexed newRuleset);

    /*************************************************************************/
    /*                               CONSTANTS                               */
    /*************************************************************************/

    /**
     * @dev The allowed opcodes for a delegated ruleset.  The following opcodes are banned, as they carry risk
     *      of undesired state changes.
     *
     *      All unmapped/unused OPCODES as of Cancun hardfork.
     *      (55) SSTORE
     *      (5D) TSTORE
     *      (A0) LOG0
     *      (A1) LOG1
     *      (A2) LOG2
     *      (A3) LOG3
     *      (A4) LOG4
     *      (F0) CREATE
     *      (F1) CALL
     *      (F2) CALLCODE
     *      (F4) DELEGATECALL
     *      (F5) CREATE2
     *      (FF) SELFDESTRUCT
     */
    uint256 public constant ALLOWED_OPCODES = 0x640800000000000000000000FFFFFFFFFFFFFFFFDFDF07FFFFFF00013FFF0FFF;

    bytes32 private constant EOA_WITHOUT_DELEGATE = 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470;
    bytes32 private constant UNINITIALIZED_ACCOUNT_CODEHASH = 0x0000000000000000000000000000000000000000000000000000000000000000;

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
     * @notice Ruleset developers must compile and deploy rulesets without compiler metadata, as this is likely to 
     *         produce an invalid opcode in nonexecutable code that will fail the code purity check.
     *
     * @dev    Throws if the `msg.sender` does not own the default list (validator admin).
     * @dev    Throws if codehash of the ruleset denotes that it is either an uninitialized account or is an EOA.
     * @dev    Throws if the ruleset is not pure (meaning that it contains an invalid or banned opcode).
     * @dev    Likely to throw if ruleset contract was compiled with compiler metadata, as this is likely to produce an 
     *         invalid opcode in nonexecutable code.
     *
     * @dev <h4>Postconditions:</h4>
     *      1. The ruleset is marked as registered in the validator storage.
     *      2. A `RulesetRegistered` event is emitted, the first time the ruleset is registered.
     *         (Subsequent registrations of the same ruleset do not emit this event).
     *
     * @param ruleset The address of the ruleset to register.
     */
    function registerRuleset(address ruleset) external onlyListOwner(DEFAULT_LIST_ID) {
        bytes32 _contractCodehash = _getCodeHashAsm(ruleset);

        if (_contractCodehash == UNINITIALIZED_ACCOUNT_CODEHASH ||
            _contractCodehash == EOA_WITHOUT_DELEGATE) {
            revert CreatorTokenTransferValidator__RulesetIsNotContract();
        }
    
        if (!validatorStorage().registeredRulesets[ruleset]) {
            if (!_check(ruleset.code, ALLOWED_OPCODES)) {
                revert CreatorTokenTransferValidator__RulesetIsNotPure();
            }

            validatorStorage().registeredRulesets[ruleset] = true;
            emit RulesetRegistered(ruleset);
        }
    }

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
    function bindRuleset(
        uint8 rulesetId, 
        address ruleset
    ) external onlyListOwner(DEFAULT_LIST_ID) {
        if (rulesetId == RULESET_ID_FIXED_OR_CUSTOM) {
            revert CreatorTokenTransferValidator__AdminCannotAssignRulesetToRulesetIdCustom();
        }

        if (!validatorStorage().registeredRulesets[ruleset]) {
            revert CreatorTokenTransferValidator__RulesetIsNotRegistered();
        }

        address oldRuleset = validatorStorage().rulesetBindings[rulesetId];
        if (oldRuleset != ruleset) {
            validatorStorage().rulesetBindings[rulesetId] = ruleset;
            emit RulesetBindingUpdated(rulesetId, oldRuleset, ruleset);
        }
    }

    /**
     * @dev Internal function used to check if a ruleset is pure, according to a set of allowed opcodes.
     */
    function _check(bytes memory _code, uint256 _allowedOpcodes) internal pure returns (bool isPure) {
        assembly ("memory-safe") {
            // Code is pure by default unless disallowed byte is found.
            isPure := 1

            // `offset` is the memory position where the bytecode starts; we
            // add `0x20` to skip the portion that stores the length of the
            // bytecode.
            let offset := add(_code, 0x20)
            // `end` is the memory position where the bytecode ends.
            let end := add(offset, mload(_code))

            for { } lt(offset, end) { } {
                let opcode := byte(0, mload(offset))

                // Set `isPure` to 0 if any indexed bit in the loop was ever 0.
                isPure := and(isPure, shr(opcode, _allowedOpcodes))

                // Always increments the offset by at least 1.
                // If an opcode is a PUSH1-PUSH32 opcode (byte ∈ [0x60, 0x80)) the resulting value
                // after subtracting 0x60 will be a valid index ∈ [0, 32). This is then indexed into
                // a byte array representing the push bytes of the opcodes (1-32). Bytes outside of
                // that range will result in an index larger than 31, which for `BYTE(n, x)` always
                // returns 0.
                offset :=
                    add(
                        add(offset, 1),
                        byte(
                            sub(opcode, 0x60),
                            0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20
                        )
                    )
            }
        }
    }
}
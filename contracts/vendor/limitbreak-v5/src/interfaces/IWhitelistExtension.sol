// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/** 
 * @title IRuleset
 * @author Limit Break, Inc.
 * @notice Interface for whitelist extension contracts for the Whitelist Ruleset.
 *
 * @dev The Whitelist Ruleset supports whitelisting of specific accounts and codehashes.  
 *      A Whitelist Extension contract offers an additional mechanism to perform more sophisticated
 *      checks to see if an account can be allowed to perform a transfer.  For example, imagine a collection
 *      that blocks OTC transfers from smart wallet accounts because a smart wallet could be used to faciliate
 *      a trade that violates the creator's rules on trading.  A Whitelist Extension contract could be used to
 *      query a trusted smart wallet factory that is known to adhere to the creator's rules, and allow any wallet
 *      originating from that factory to perform OTC trades or to receive tokens when in a mode that blocks contracts
 *      from receiving tokens.
 */
 
interface IWhitelistExtension {
    
    /**
     * @notice Perform an advanced check on an account to see if it should be whitelisted.
     *
     * @param collection The address of the Creator Token contract.
     * @param account    The address of the account to check.
     * @return true if the account is whitelisted, false otherwise.
     */
    function isWhitelisted(
        address collection,
        address account) external view returns (bool);
}
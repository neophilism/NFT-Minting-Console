# Real Validator Security Assertions

## Versioned test subject

The integration suite checks out Limit Break's `creator-token-transfer-validator` at commit
`59adb8b36ab0256c7430b017b1c9f8b4841d6e1e`, including that commit's pinned PermitC and
forge-std submodules. Tests deploy the real validator, management modules, and whitelist ruleset;
they do not substitute the unit-test validator.

The collection uses fixed/custom ruleset ID `255`, the deployed whitelist ruleset, and
`rulesetOptions = 6`. In this version, `6` is a bitmask enabling OTC transfers for EIP-7702
delegates and smart wallets. The `BLOCK_ALL_OTC` bit is not set, so ordinary direct owner
transfers are also allowed. This is tested as source behavior, not described as royalty enforcement.

## Assertions covered

| Assertion | Evidence |
| --- | --- |
| Marketplace list ownership and policy read-back | Exact list owner, ID, custom ruleset, and options are asserted. |
| EOA, Safe-like, and EIP-7702 direct transfers | Each holder form completes a direct transfer under options `6`. |
| Unauthorized marketplace blocked | Token approval alone does not bypass the validator. |
| Signed-zone authorizer pattern | A listed authorizer temporarily authorizes the marketplace operator in one transaction. |
| Policy evolution | OWNER can add an authorizer, tighten to soulbound, and restore the pinned whitelist policy. |
| Administrative separation | A non-owner cannot edit the list or collection policy. |
| Freeze and restore | OWNER can freeze a holder when freeze mode is enabled and later restore transferability. |
| No validator seizure path | Neither validator nor operator can transfer a holder token without ERC-721 approval. |
| Immutable royalty configuration | Recipient and basis points survive policy changes. |

## Claim limits

ERC-2981 reports royalty information; it does not collect payment. The suite deliberately proves
that a wallet-to-wallet transfer can complete without a royalty payment. The signed-zone fixture
tests the validator authorization handshake, not a live OpenSea oracle signature, Seaport order,
or royalty settlement. Live deployed addresses, bytecode read-back, and marketplace transactions
remain later PR-21, PR-22, PR-27, and PR-33 gates. OWNER remains trusted and can loosen, tighten,
freeze, or accidentally block transfers through validator policy changes.


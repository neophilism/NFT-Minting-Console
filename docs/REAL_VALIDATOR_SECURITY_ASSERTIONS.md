> **Current owner review policy:** [AGENTS.md](../AGENTS.md) and [security/review-policy.json](../security/review-policy.json) authorize AI source/security review and applicable passing tests for implementation, merge and deployment. Independent human review is deferred follow-up, with no claim that AI review is independent certification. Concrete defects, missing functionality/credentials and actual wallet approvals still apply.

# Real Validator Security Assertions

## Versioned test subject

The integration suite checks out Limit Break's `creator-token-transfer-validator` at commit
`59adb8b36ab0256c7430b017b1c9f8b4841d6e1e`, including that commit's pinned PermitC and
forge-std submodules. Tests deploy the real validator, management modules, and whitelist ruleset;
they do not substitute the unit-test validator.

Foundry is pinned to v1.3.6 and Solidity to 0.8.24. Validator/ruleset fixtures use
the upstream million-run optimizer and omit CBOR/compiler metadata, as the real
module's opcode purity check requires. The collection is deployed from the
application's Hardhat artifact (200 optimizer runs, Paris compilation target),
not from the differently optimized Foundry artifact. The suite executes under
Prague to inspect EIP-7702 delegation-designation behavior. The integration
command rejects dirty/unpinned validator checkouts, mismatched submodules,
unsupported Foundry versions, or changed parity-critical dependencies.

The collection uses fixed/custom ruleset ID `255`, the deployed whitelist ruleset, and
`rulesetOptions = 6`. In this version, `6` is a bitmask enabling OTC transfers for EIP-7702
delegates and smart wallets. The `BLOCK_ALL_OTC` bit is not set, so ordinary direct owner
transfers are also allowed. This is tested as source behavior, not described as royalty enforcement.

## Assertions covered

| Assertion | Evidence |
| --- | --- |
| Marketplace list ownership and policy read-back | Exact list owner, ID, custom ruleset, and options are asserted. |
| EOA, Safe-like, and EIP-7702 direct transfers | A code-free EOA, a call-forwarding wallet, and an account with an EIP-7702 designation each transfer under options `6`. |
| Unauthorized marketplace blocked | Token approval alone does not bypass the validator. |
| Signed-zone authorizer pattern | A listed authorizer temporarily authorizes the marketplace operator in one transaction; authorization does not survive cleanup or replace holder approval. |
| Policy evolution | OWNER can add an authorizer, tighten to soulbound, and restore the pinned whitelist policy. |
| Administrative separation | A non-owner cannot edit the list or collection policy. |
| Freeze and restore | OWNER can freeze a holder when freeze mode is enabled and later restore transferability. |
| No validator seizure path | Neither the actual validator, an owner-selected blocking validator, the operator nor the authorized-zone handshake can replace ERC-721 holder approval. |
| Mint/transfer separation | Mint succeeds under the real soulbound policy while holder transfer fails. |
| Immutable royalty configuration | Recipient and basis points survive policy changes. |

## Claim limits

ERC-2981 reports royalty information; it does not collect payment. The suite deliberately proves
that a wallet-to-wallet transfer can complete without a royalty payment. The signed-zone fixture
tests the validator authorization handshake, not a live OpenSea oracle signature, Seaport order,
or royalty settlement. Live deployed addresses, bytecode read-back, and marketplace transactions
remain later PR-21, PR-22, PR-27, and PR-33 gates. OWNER remains trusted and can loosen, tighten,
freeze, or accidentally block transfers through validator policy changes.

The Safe-like fixture is not a deployed Safe implementation. EIP-7702 uses a
designation installed with `vm.etch` and a simulated caller; it does not prove
authorization-list signing or a particular delegation wallet implementation.
The EOA transfer asserts no value arrives at the royalty recipient. No sale,
compensated transfer, royalty collection or actual OpenSea signature is asserted.

## Acceptance evidence and review state

The repaired suite passes 17 tests locally: 14 collection/validator cases and
three inherited registry cases, including two 256-run fuzz cases. Baseline CI
passes all 18 collection unit tests, compile, lint, typecheck, production audit
(zero vulnerabilities), and build. Remote CI must verify the final pushed head.

Review of the incoming draft found a Solidity inherited-member encoding error,
ruleset metadata rejected by the real purity check, an EOA test whose initial
holder was a contract, and a differently compiled collection test subject.
These are corrected without modifying the production collection contract.
Independent human review of these changes has not occurred and remains deferred under
the owner policy above. The source review and applicable exact-head CI are the operational
review process; they do not establish an independent audit. Test counts in this section
record the original validator follow-up, not the current full application suite.

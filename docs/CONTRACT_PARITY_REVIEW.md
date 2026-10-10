# Contract Parity Review

**Plan item:** PR-03, audit parity: original custom contract versus current generic fork  
**Reviewed generic source:** `contracts/NFTCollection.sol` at merge base `55bc25ff1d100e4bfd913e535cfc65e73ed80743`  
**Frozen reference:** `reference/androids-of-the-vine/AndroidsOfTheVineCollection.sol`  
**Reference SHA-256:** `75b83275c7f18901c290d4aaccba49ebb409f25fdffb7fa5860833788b2f32fb`  
**Reference provenance:** the approved 178-line Solidity 0.8.24 no-autoapproval variant described in `HANDOFF_CONTEXT.md`  
**Review status:** parity analysis, not an audit or production approval

## Decision summary

The generic contract preserves the reference's critical architecture: it inherits `CreatorTokenBase` directly, does not inherit `ERC721C` or `AutomaticValidatorTransferApproval`, keeps owner and minter powers separate, fixes the minter and royalty recipient at deployment, writes token content and rights fields only once, disables ownership renunciation, and uses the same transfer-validation hooks and interface reporting.

Two deliberate product changes create new code and audit surface:

1. Collection identity, maximum supply, and royalty basis points moved from constants to validated immutable constructor inputs.
2. `mintWorksBatch(WorkInput[])` and the shared `_mintWork` path were added with a maximum batch of ten.

These changes are approved requirements for the generic product and may proceed in PR-04. They are not covered by the historical AOTV review. PR-04 must complete the corrective tests in `contract-parity-test-matrix.json`; PR-05 must test the actual pinned validator and adversarial operator paths. No mainnet deployment, inherited-audit claim, or production-ready claim is justified before those gates and independent review.

## Exact source comparison

The comparison used the frozen file itself, not reconstructed conversational text:

```bash
diff -u reference/androids-of-the-vine/AndroidsOfTheVineCollection.sol contracts/NFTCollection.sol
```

Formatting and NatSpec compression are non-executable differences. Executable differences are catalogued below.

| Area | Frozen reference | Generic contract | Decision and security implication |
|---|---|---|---|
| Contract identity | `AndroidsOfTheVineCollection` | `NFTCollection` | Approved product rename; changes artifact name and deployment bytecode. |
| Name and symbol | Fixed `Androids Of The Vine` / `AOTV` | Constructor strings, non-empty | Approved genericization. Empty values fail closed. Test arbitrary and boundary-length values; the contract does not impose a maximum string length. |
| Maximum supply | Constant 40 | Non-zero immutable `SERIES_SIZE` | Approved genericization. Immutability and ID range semantics are preserved. Test independent deployments, boundary IDs, automatic closure, and impractically large values at the application layer. |
| Royalty rate | Constant 600 bps | Immutable constructor `royaltyBps_`, at most 10,000 | Approved genericization. Recipient remains immutable. Verify zero/maximum/out-of-range construction and ERC-2981 arithmetic; do not describe royalties as universally enforced. |
| Constructor ABI | Three addresses | Two strings, supply, bps, three addresses | Intentional breaking ABI change. Deployment tooling must select a versioned artifact and verify constructor arguments/codehash. |
| Constructor errors | Zero-address check | Adds empty identity, zero supply, and royalty-range errors | Fail-closed additions. Confirm whether the base royalty constructor or local check determines the exact out-of-range revert; callers must not depend on an unverified selector. |
| Mint ABI | `mintWork(uint256,string,string,bytes32,string,bytes32)` | Same canonical parameter types; parameter names clarified | Selector-compatible. Semantics remain mint-to-immutable-MINTER and write-once fields. |
| Batch mint | None | Tuple-array ABI, `MAX_BATCH = 10`, shared internal mint path | Approved new feature and primary new attack/gas surface. Whole-transaction atomicity follows EVM reverts but requires duplicate, late-failure, event-order, close-boundary, gas, and validator-hook tests. |
| New public ABI | None | `MAX_BATCH()` and `mintWorksBatch(...)` | Intentional ABI expansion. Indexers and clients must use the versioned generic ABI. |
| Errors | Reference set | Adds `InvalidSeriesSize`, `InvalidRoyalty`, `InvalidBatchSize` | Intentional ABI expansion; no storage or authority change. |
| Events | `WorkMinted` and `MintingClosed` | Same names, indexed fields, and parameter types | Event signatures are preserved. Verify one ordered event per successful work and a single close event at capacity. |
| Storage | Constants plus immutable roles and mappings | Constants become immutables; adds no mutable admin setting; adds struct type only | Deployment bytecode/storage layout differ. This is not an upgradeable contract, so storage migration is not supported or implied. |

## Preserved security invariants

| Invariant | Evidence in both sources | Required proof before production |
|---|---|---|
| No validator-wide holder approval | Direct `CreatorTokenBase` inheritance; no `ERC721C`, `AutomaticValidatorTransferApproval`, or automatic-approval setter | ABI scan plus malicious-validator/operator test showing `isApprovedForAll` remains false and unauthorized transfer fails. |
| Owner cannot mint or rewrite creative/economic data | `onlyMinter`; no setters for URI, title, hashes, supply, royalty, recipient, or minter | Role-separation and ABI/no-setter tests. |
| Minter cannot administer policy | Validator setter remains on the inherited owner path | Owner/minter/deployer separation tests with EOA and Safe-like callers. |
| No owner seizure path | Plain ERC-721 approvals; validator is consulted but is not approved to transfer | Malicious validator, approval, PermitC, and operator-path adversarial tests. A holder can still voluntarily approve an operator. |
| Token fields are write-once | Duplicate IDs revert; mappings are written only inside first successful mint | Single and batch duplicate/replay tests plus ABI scan. |
| Supply is bounded and permanent | Immutable supply and range check; automatic close at capacity | Arbitrary-supply, last-slot, sparse-ID, and close tests. |
| Minting closure is permanent | Boolean only moves false to true; no reopen function | Manual/automatic closure and post-close rejection tests. |
| Ownership cannot be renounced | Overridden `renounceOwnership()` always reverts | Owner and non-owner tests; ownership transfer to a non-zero Safe-like address. |
| Transfer validation covers transfers | Same `_beforeTokenTransfer` and `_afterTokenTransfer` loops call inherited validation | Real-validator allow/block tests, including batch-size behavior inherited from ERC-721. |
| Metadata and interface compatibility | Same `tokenURI`, `getTransferValidationFunction`, `_tokenType`, and `supportsInterface(ERC721, ERC2981)` logic | Exact ERC-165 IDs for ERC-721, metadata, ERC-2981, `ICreatorToken`, and legacy creator token; false for invalid ID. |

## Authority and validator paths

- `OWNER` is a trusted policy administrator through inherited `setTransferValidator`. It can replace a validator with another deployed contract and thereby loosen, tighten, or block transfers. This authority must remain visible to collectors.
- The contract never calls `setApprovalForAll` for a holder and exposes no automatic-validator-approval switch. A validator can allow or reject a transfer hook, but hook authority alone does not grant ERC-721 operator authority.
- A malicious or compromised owner-selected validator can deny transfers. It must not be described as unable to freeze trading.
- A holder can independently grant an ERC-721 approval to any address. The application must never ask a holder to approve the transfer validator itself or the compromised Limit Break Payment Processor.
- Direct wallet transfers can bypass priced marketplace royalty collection. ERC-2981 reports a royalty; it does not observe or compel consideration for every transfer.
- Real behavior for whitelist ruleset 255/options 6, OpenSea SignedZone authorization, Safe accounts, and EIP-7702 accounts remains a PR-05 gate. Live addresses and bytecode must be reverified before use.

## ABI and dependency compatibility

The dependency pins match the reference: Solidity 0.8.24, `@limitbreak/creator-token-standards` 5.0.0, and OpenZeppelin 4.8.3. The import list, inheritance order, transfer hook overrides, token type value 721, validator function signature, token URI override, and ERC-165 override bases are unchanged.

The generic constructor is intentionally ABI-incompatible with the reference. `mintWork` retains its canonical function signature because Solidity selectors use parameter types, not parameter names. The batch function, struct tuple, getters, and new custom errors extend the ABI. Build artifacts and runtime bytecode must be versioned; a deployment client must never infer parity from a matching contract name or partial ABI.

ERC-2981 compatibility is inherited from `BasicRoyalties`. ERC-721 and metadata support are inherited from `ERC721OpenZeppelin`; creator-token interfaces are added explicitly. PR-04 must assert exact interface IDs and royalty results instead of relying only on inheritance inspection.

## Historical audit findings

The September 2026 v5 real-validator re-audit is evidence about a superseded policy-management design, not this generic contract. Its lessons remain mandatory:

- smart-wallet/Safe direct transfers failed under ruleset options 0; the selected path is ruleset 255/options 6 and must be retested;
- a policy administrator could weaken enforcement or freeze holders despite narrower documentation; the present trusted-owner model discloses that power rather than claiming it away;
- OpenSea SignedZone compatibility was not proven on mainnet; a disposable real-sale rehearsal remains required;
- validator/PermitC operator approval is unnecessary and must never be requested;
- live validator bytecode, registered rulesets, authorizer, and marketplace behavior were outside the historical audit and remain external evidence gates.

## Gate disposition

PR-03 approves the two generic requirements for implementation hardening, not for production deployment. PR-04 owns constructor/batch/interface/role corrective tests and any resulting contract corrections. PR-05 owns pinned real-validator and adversarial coverage. Independent contract review, reproducible artifacts, disposable mainnet rehearsal, and exact live bytecode verification remain blocking release gates.

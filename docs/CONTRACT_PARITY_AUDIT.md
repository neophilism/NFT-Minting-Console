# Contract Parity Audit

**Status:** PR-03 blocking review record. This document compares the generic
`NFTCollection` prototype with the frozen 178-line no-autoapproval reference.
It is not an external audit, deployment approval, or production-readiness claim.

## Reviewed inputs

The comparison is pinned to repository commit
`55bc25ff1d100e4bfd913e535cfc65e73ed80743`:

- frozen reference: `reference/androids-of-the-vine/AndroidsOfTheVineCollection.sol`,
  Git blob `35e7f17a07ca795e64eb91829a6737e39c1ad56c`, with the independently recorded
  SHA-256 `75b83275c7f18901c290d4aaccba49ebb409f25fdffb7fa5860833788b2f32fb`;
- generic fork: `contracts/NFTCollection.sol`, Git blob
  `ab3d0887bfa6c37b02e9e813a40092dc4b87b3bf`;
- compiler `0.8.24`, optimizer enabled with 200 runs;
- `@limitbreak/creator-token-standards` `5.0.0`;
- `@openzeppelin/contracts` `4.8.3`; and
- the frozen package overview and September 2026 real-validator re-audit.

The review used an exact unified diff, then separately classified executable
changes, formatting/comment-only changes, inherited behavior, and test gaps.

## Result

The fork retains the reference's inheritance order, transfer hooks, interface
reporting, immutable roles/economics after construction, write-once token data,
mint destination, ownership-renunciation prohibition, and deliberate exclusion
of `AutomaticValidatorTransferApproval`.

There are three executable design changes:

1. collection name, symbol, maximum supply, and royalty bps move from constants
   to validated constructor inputs;
2. a bounded, atomic `mintWorksBatch` entry point is added; and
3. the original mint body is factored into one internal function shared by
   single and batch minting.

These changes are required by the generic product charter and ordered plan.
They are approved product-direction changes, but they do **not** inherit the
historical package's audit status. PR-04 must implement the corrective matrix
below and PR-05 must restore real-validator evidence before deployment.

## Executable parity diff

| Area | Frozen reference | Generic fork | Security effect / disposition |
| --- | --- | --- | --- |
| Contract identity | Fixed `AndroidsOfTheVineCollection`, name `Androids Of The Vine`, symbol `AOTV` | `NFTCollection`; non-empty name and symbol supplied once | Required for unrelated releases. Inputs affect display/ABI construction only and have no setter. Test empty values and independent deployments in PR-04. |
| Supply | `SERIES_SIZE = 40` constant | Nonzero `SERIES_SIZE` immutable | Cap remains permanent and token IDs remain 1 through the cap. Extremely large caps do not create a loop by themselves, but deployment/readback and UI bounds need tests. |
| Royalty | `CREATOR_ROYALTY_BPS = 600` constant | Constructor input limited to 0–10,000 and stored immutable | Recipient and rate remain permanent. Zero and 100% are technically permitted and must be treated as explicit release choices. Test boundaries, ERC-2981 arithmetic, and independent collections. |
| Constructor ABI | Three role addresses | Four release fields plus three role addresses | All role addresses remain nonzero. Deployment callers and artifact/version records must use the new ABI and read every immutable back before advancing state. |
| Batch ABI | Single `mintWork` only | Adds `WorkInput[]`, `MAX_BATCH = 10`, and `mintWorksBatch` | Required by the charter. One revert unwinds all prior loop iterations, but duplicate IDs, invalid elements, close-at-cap behavior, gas bounds, and callback/reentrancy assumptions require explicit tests. |
| Mint implementation | Validation and writes live in `mintWork` | Same sequence moved to `_mintWork`; single mint delegates to it | Field order, checks, writes, destination, events, and automatic close are semantically preserved. Parameter names change only; event and function types remain compatible. |
| New errors | None for generic inputs/batch | `InvalidSeriesSize`, `InvalidRoyalty`, `InvalidBatchSize` | Narrows failure reasons and does not add authority. Tests must assert each exact error. |
| Formatting/comments | Expanded NatSpec and multiline bodies | Condensed formatting and shorter contract comment | No bytecode authority change, but the shorter comment omits important trust disclosures. PR-04 documentation must retain the complete owner/minter/validator threat model. |

No executable difference was found in the following sections:

- inheritance list and order;
- immutable `MINTER` and `ROYALTY_RECIPIENT`;
- `totalMinted`, `mintingClosed`, and all token-data mappings;
- `onlyMinter`, `closeMinting`, and disabled `renounceOwnership`;
- pre- and post-transfer validation hooks and ERC-721 token type;
- `getTransferValidationFunction`;
- minted-token `tokenURI` behavior; and
- ERC-165 reporting for `ICreatorToken`, `ICreatorTokenLegacy`, ERC-721,
  metadata, and ERC-2981 through the same override chain.

## Preserved security invariants

1. Only the immutable MINTER can mint or permanently close minting, and every
   mint goes to that same address.
2. Token IDs are nonzero, capped, and unique. Title, metadata URI, media hash,
   rights URI, and rights hash are nonempty/nonzero before they are written.
3. There are no setters for collection supply, royalty rate/recipient, minter,
   or minted token data.
4. Reaching the exact cap permanently closes minting. Manual close cannot be
   reversed.
5. OWNER can transfer ownership to a nonzero address and cannot renounce it.
6. OWNER retains the inherited ability to replace the transfer validator. That
   power can loosen policy or block transfers and must remain behind a trusted
   administrative Safe.
7. The contract inherits `CreatorTokenBase` directly, not the `ERC721C`
   convenience wrapper. It exposes no automatic validator-approval function.
8. Changing a validator does not itself approve that validator or any operator
   over a holder's token. A transfer still needs holder ownership or ordinary
   ERC-721 approval.
9. ERC-2981 reports a royalty; neither version collects sale proceeds or proves
   that a marketplace paid the royalty.

## Threat and compatibility findings

### P0 production gate: generic fork is not audit-approved

The frozen review applies to different bytecode and fixed economics. Constructor
parameterization and batch minting expand the state space. The fork must not be
described as audited until PR-04/05 tests, independent PR-30 audit, and release
gates pass.

### P1 trusted owner can change transfer policy

`setTransferValidator` is inherited and owner-controlled in both contracts.
The owner can install a permissive, broken, or blocking validator immediately.
The no-autoapproval design prevents that act alone from seizing a token, but it
does not prevent censorship or weakened marketplace policy. Documentation and
UI must disclose this role; PR-05 must test malicious validators and operators.

### P1 batch minting expands failure and gas surface

The ten-item bound limits loop growth. Solidity transaction atomicity means a
bad later item reverts earlier writes and mints. Required tests must cover every
invalid element position, duplicates, cap crossing, manual/automatic close,
events, and malicious callback assumptions. No production conclusion is drawn
from the current duplicate-only atomicity test.

### P1 royalty and supply inputs require explicit confirmation

Allowing any nonzero supply and 0–10,000 bps is consistent with a generic
release, including zero royalty. These are irreversible economics. Deployment
must validate exact user intent and read the values back; application defaults
must never substitute historical 40/600 values silently.

### P1 validator and marketplace behavior remains unproved

The current six-test suite uses a minimal local validator. It does not establish
the real Limit Break v5 ruleset, Safe/EIP-7702 direct transfer behavior,
SignedZone authorization, list ownership, or royalty-policy behavior. Those are
PR-05 gates. The superseded September audit's findings are retained as threat
inputs, not asserted as findings against this minimal fork without new tests.

### Compatibility conclusion

The exact pinned toolchain compiles the unchanged override shapes:
`_beforeTokenTransfer(address,address,uint256,uint256)`,
`_afterTokenTransfer(address,address,uint256,uint256)`,
`tokenURI(uint256)`, and
`supportsInterface(bytes4) override(ERC721, ERC2981)`.
The fork reports both creator-token interface IDs and delegates remaining
interfaces through the same OpenZeppelin/BasicRoyalties chain. Any dependency
upgrade requires this analysis and interface tests to be repeated.

## Corrective test matrix

Status values describe evidence at the reviewed commit, not intent.

| Required evidence | Current status | Delivery gate |
| --- | --- | --- |
| Runtime bytecode below the EIP-170 24 KB limit | Missing | PR-04 |
| Constructor name/symbol, arbitrary supply/bps, roles, and royalty readback across two independent deployments | Partial: one deployment plus values | PR-04 |
| Empty name/symbol, zero addresses, zero supply, 0/10,000/10,001 bps boundaries | Partial: zero supply and >10,000 only | PR-04 |
| No ABI setters for supply, economics, minter, or token fields | Missing | PR-04 |
| MINTER-only single mint; exact field/event persistence; destination is MINTER | Partial | PR-04 |
| Reject ID 0/out of range, duplicate ID, empty strings, and zero hashes with exact errors | Partial: duplicate only | PR-04 |
| Manual close, repeat-close rejection, automatic close at cap, and no reopen path | Partial: automatic close only | PR-04 |
| Batch sizes 0/1/10/11, duplicates/invalid items in every position, atomic rollback, cap crossing, and ordered events | Partial: 0/11 and duplicate rollback | PR-04 |
| Ownership transfer only by owner, zero-address rejection, and renounce disabled | Partial: renounce only | PR-04 |
| ERC-165 IDs for ERC-721, metadata, ERC-2981, `ICreatorToken`, and legacy creator token | Missing | PR-04 |
| ERC-2981 arithmetic and immutable recipient/rate across policy changes | Partial: one calculation | PR-04/05 |
| Owner-only validator update; validator must contain code; null/default behavior documented | Partial | PR-04/05 |
| Allowed/blocked transfers use the real validator; mint is not blocked as a transfer | Missing against real validator | PR-05 |
| Malicious owner-selected validator cannot transfer without holder approval; no validator-wide autoapproval ABI/path | Partial: local negative operator test | PR-05 |
| List ownership, options-6 EOA/Safe/EIP-7702 direct transfers, unauthorized marketplace block, SignedZone sale, owner policy administration | Missing | PR-05 |
| Dependency/interface parity repeated on every Limit Break, OpenZeppelin, or compiler upgrade | Missing automated guard | PR-04/05 |

## PR-04 completion evidence

PR-04 corrected the constructor validation order so zero royalty recipients and
royalty rates above 10,000 bps now produce the generic contract's documented
errors before the inherited ERC-2981 initializer. It added test-only blocking
validator, interface-ID, and smart-wallet call helpers without adding production
authority.

GitHub Actions run 38062625412 compiled 26 Solidity files and passed all 18
contract tests. The suite now covers the PR-04 rows above: runtime size,
independent parameterized deployments, constructor boundaries, absence of
mutation/automatic-approval functions, exact work persistence/events, all
single-mint validation branches, manual/automatic close, batch bounds and
rollback, ownership, validator ownership/code/null behavior, blocking policy,
Safe-like owner/minter calls, interface IDs, and royalty persistence. Lint,
TypeScript validation, the zero-vulnerability production audit, and build also
passed.

Real Limit Break validator, ruleset 255/options 6, SignedZone, malicious
operator, Safe/EIP-7702 policy, and marketplace royalty-bypass evidence remain
PR-05 work. The historical audit status is still not inherited.

## Required follow-up

PR-04 may change the generic contract only where a matrix test demonstrates a
defect or an acceptance requirement demands it. It must preserve the invariants
above and update this record for any ABI or authority change. PR-05 must use the
pinned real validator implementation and record the exact source revision.
No deployment, marketplace-compatibility, royalty-enforcement, audit, or
production claim is permitted from this parity review alone.

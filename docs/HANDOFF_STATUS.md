# NFT Console — Handoff Completeness and Current-State Audit

**As of 2026-10-10.** Read with [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) and [HANDOFF_CONTEXT.md](HANDOFF_CONTEXT.md). This is a factual snapshot, **not** a certification that the unfinished prototype is safe to deploy.

## Verdict

**Ready for an independent developer/ChatGPT account to resume development from the repository and the 36-PR plan, without knowing our conversations. NOT ready for mainnet or production use.** Some source fixtures and operational credentials are not in GitHub, as documented below. A new developer must not assert that the freshly parameterized contract inherits any prior audit approval.

## Handoff source-of-truth order

1. [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) — full 36 PR work packages, prerequisites, acceptance criteria and release gates.
2. [HANDOFF_CONTEXT.md](HANDOFF_CONTEXT.md) — user-approved decisions, reasons rejected architectures failed, AOTV example rights/economics and E2EESA boundaries.
3. [Original frozen reference files](../reference/androids-of-the-vine/) — authoritative last-finalized example contract, legal rights, metadata and package rationale. **Read-only for comparison**, not the current generic deployable source.
4. Current [NFTCollection.sol](../contracts/NFTCollection.sol), [tests](../test/), [console](../console/) and CI — an **unverified prototype** that must be brought into alignment.
5. The independent E2EESA source repo (version pin/applicability matrix required in PR-08), and real Limit Break/Seaport sources verified against deployed bytecode.

If instructions conflict, do **not** silently prefer a newer draft over the original security invariants or override user-approved rights. Record the conflict in a PR and justify the resolution.

## Captured historical source artifacts — exact checks

| Artifact | Archived path | Exact SHA-256 | Status |
| --- | --- | --- | --- |
| Final 178-line no-autoapproval Solidity reference | `reference/androids-of-the-vine/AndroidsOfTheVineCollection.sol` | `75b83275c7f18901c290d4aaccba49ebb409f25fdffb7fa5860833788b2f32fb` | Verified byte-for-byte against original |
| Final Token 1 rights agreement | `reference/androids-of-the-vine/ANDROID_OF_THE_VINE_TOKEN_001_RIGHTS_FINAL.md` | `0ddcfae9f5fc2d2e059ed12e7a33ea5815e00a64e70930485602bc73f3f374c9` | Verified; **immutable legal payload**, do not normalize whitespace |
| Token 1 metadata template | `reference/androids-of-the-vine/token-001.metadata.template.json` | `96f2cac4483679c2e1df2d0124126f41f605471eb7a1b9d1b961c00ede8b4219` | Verified; IPFS placeholders not published |
| Final example package overview | `reference/androids-of-the-vine/ORIGINAL_PACKAGE_README.md` | Git blob SHA `86a395ac9e8b0570bfa2996292ff1767d06e1edc` | Verified byte-for-byte against original overview |

**Historical audit preserved:** [September 2026 v5 real-validator re-audit](../reference/audits/2026-09-v5-real-validator-reaudit.txt) (superseded design; explains earlier high-risk findings, **not** a security audit of the current generic contract or final minimal reference).

The prior complete **`androids-of-the-vine-current-simple-instructions.zip`** had SHA-256 `dc613479d4fc385f49a2bd8b2c32244ed9b5fe31e4231d4c4ae9990f6529b950`; the full ZIP (including the historical tests and compiled validator fixtures) is **not yet in this GitHub repository**. The frozen Solidity/right/metadata/README sources above are, so the core architectural reference is now available from another account. Original video artwork and private user wallet/API credentials are not intended to be published in GitHub.

## Original test matrix that must be ported/rebuilt

The last example package included **13 unit tests and 8 real validator integration tests**, using Limit Break v5 source commit `59adb8b36ab0256c7430b017b1c9f8b4841d6e1e`. The generic fork must cover the equivalent behaviors:

**13 unit test cases:**
1. Contract under Ethereum 24 KB size limit.
2. Supply, roles, owner-vs-deployer and fixed royalty.
3. No setters changing royalty/supply/MINTER/token fields.
4. Only MINTER can mint; mint goes to MINTER; write-once inputs/events.
5. Reject token ID out of range, empty strings, zero hashes.
6. Permanent MINTER-only close; no reopening.
7. Automatic close at exactly maximum supply.
8. Ownership transfer to nonzero, renounce disabled.
9. Owner-only validator updates and validator must be a deployed contract.
10. Allowed/blocked transfers use actual validator.
11. Mint is not blocked as a transfer.
12. Malicious owner-controlled validator cannot seize holder NFT; no validator-wide operator approval.
13. ERC-165 interfaces: ERC-721, metadata, ERC-2981, `ICreatorToken`.

**8 real validator integration cases:**
1. Owner-created marketplace list/policy correctly owned and readable.
2. EOA wallet-to-wallet direct transfer.
3. Safe-like contract wallet direct transfer (ruleset options `6`).
4. Unlisted/unauthorized marketplace blocked even with token approval.
5. SignedZone-pattern authorized sale succeeds.
6. OWNER can add a marketplace after deployment.
7. Only OWNER can administer list/policy.
8. Royalty rate/recipient remain immutable through policy changes.

**Additional required generic tests**: arbitrary max supply and bps across independent contracts, `mintWorksBatch` atomicity/limits/reentrancy, Safe/EIP-7702 behavior, rights hash/correct byte serialization, chain bytecode checks, null/default validator handling, marketplace/royalty/security adversarial scenarios, and E2EE/publish-boundary attacks. CI must also run the **real-validator integration suite**, not merely six simple unit tests.

## Current prototype defects and incomplete work

- **P0 — NOT PRODUCTION READY:** `console/server.mjs` currently receives raw media and rights plaintext at `/api/prepare`, writes plaintext temp files and uploads them directly to **public IPFS**. The user required a private E2E-encrypted draft workspace and an explicit public-publication step. Do not test with unreleased confidential user media until PRs 08–13 fix this. Local browser draft fields are currently written unencrypted to `localStorage`.
- **P0 — Validator integration not finished:** the console deploys contracts but does not automatically establish/read back the validated marketplace/authorizer policy. The generic contract is an unaudited adaptation; no authority exists to call it secure simply because the prior fixed-series variant was reviewed.
- **P0 — OpenSea listing not implemented:** UI only generates an OpenSea NFT URL; it does not obtain seller approvals, sign/post a valid Seaport order, verify active price/status, or prove secondary royalty payment. Do not report “listed.”
- **P0 — Mainnet release gates absent:** no verified disposable mainnet sale + payout, no actual production deployment, no external code audit, no evidence-backed E2EESA conformance. A green build alone cannot satisfy these.
- **P1 — Current CI red:** at the time of this audit the latest reviewed workflow run compiled successfully and passed **5 of 6 unit tests**; test #6 failed because a Hardhat-local transfer called the library's default transfer validator at an address with **no deployed code** (`CreatorTokenBase._preValidateTransfer`). Fix the local validator fixture/test harness in PR-02/05; do not paper over it or weaken contract validation. Source: GitHub Actions run [38059078683](https://github.com/neophilism/NFT-Minting-Console/actions/runs/38059078683); later runs continued to fail in `npm test`.
- **P1 — Integration command broken/missing:** `package.json` includes `npm run test:integration` pointing at `test-integration/real-validator.test.cjs`, but that file and the original validator artifact fixture were **not committed to this generic repo**.
- **P1 — Reproducibility:** no committed `package-lock.json` yet for generic repo; CI temporarily runs `npm install` rather than `npm ci`. Pin dependencies, add lockfile and restore deterministic CI; add comprehensive UI/server tests and security checks.
- **P1 — Backend maturity:** no persistent encrypted multi-release model, durable job queue, encrypted object storage, device recovery/key management, production-grade administrative authorization/CSRF/replay and upload quotas, real price/listing status reconciler or working Render/Neon deployment.
- **P1 — Rights byte handling:** generic server turns user-entered rights into sanitized/trimmed text before hashing/pinning. The console must review and hash **exact final legal bytes**, verify them after IPFS retrieval, and distinguish release-wide vs per-token language. Changes after mint must not silently alter hashed rights.
- **P1 — Generality:** first-pass UI defaults (40, 6%, 1 ETH) mirror AOTV; defaults may be edited and saved but must not silently make those values the only usable launch configuration or leak personal Collector Circle language into new releases.
- **P1 — E2EESA version pin and evidence:** security standard is still in pre-1.0 development; PR-08 must select exact upstream source commit, applicable profiles and evidence scope, then the app implements those controls. Do not state certification.

## Unknowns that do not block ordinary coding

- Actual real user wallet/Safe addresses, approved deployment chain instance, live validator/list bytecode, future IPFS pinning account and API secrets, OpenSea API key, Render/Neon service identities, domain, billing limits and mainnet gas budget. These are external operational prerequisites for later deployment, **not evidence that a product-design decision was left unspecified**.
- The finished generic console should allow legally reviewed rights to be supplied per release. The exact rights/price/media of a **new** NFT release are user content at creation, not something a developer can infer in advance.

## First task for the successor

Start at **PR-01** in the [36-PR development plan](DEVELOPMENT_PLAN.md), audit the already committed prototype, then **PR-02/03** to restore deterministic CI and ensure contract parity with the frozen reference. Do **not** deploy or mint real mainnet NFTs from the existing app. Continue dependent PRs after passing gates, using GitHub itself as the handoff source; do not rely on earlier ChatGPT conversational memory.

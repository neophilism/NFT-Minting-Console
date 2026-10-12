# PR-09 implementation status and launch blockers

**2026-10-12. Status: partial implementation; not milestone acceptance or production approval.**
The 36-work-package [development plan](DEVELOPMENT_PLAN.md), frozen contract/rights invariants,
and pinned E2EESA requirements remain authoritative. This change is a scoped PR-09a increment,
not a claim that all of PR-09 or the console is finished.

## Implemented in this change

- Wallet authentication messages bind the configured scheme/domain, checksum address, chain,
  random nonce, issue time and expiration. The server accepts only the exact issued message.
- Independent browser-binding cookies and atomically consumed challenges prevent concurrent
  nonce replay and cross-browser challenge reuse. Challenge acceptance lasts five minutes;
  authenticated sessions have eight-hour absolute and thirty-minute idle limits.
- The read-only wallet adapter checks the configured RPC chain and deployed code. EOAs use
  EIP-191 recovery. Deployed contracts must return ERC-1271's magic value; failures never fall
  back to a Safe owner's individual EOA signature. Contract proofs are revalidated on use.
- HttpOnly/SameSite cookies, server-side session invalidation, CSRF checks, fixed-origin
  checks, bounded authentication state, request quotas and redacted errors are implemented.
- Console owner/editor/viewer permissions and an isolated release-grant policy helper are
  tested. Environment allowlists are reloaded on process restart, which also invalidates
  development sessions. Database grant enforcement is NOT yet integrated.
- Browser account/network changes invalidate authority; sign-out revokes the server session.
  Existing v2 deployment identifiers are retained when upgrading the local storage key.
- The unsafe plaintext `/api/prepare` implementation is removed, not relabeled E2EE. It now
  rejects requests before multipart artwork parsing or any public pinning operation.
  Incomplete mint preflight and mainnet artifact delivery are blocked as well.
- New private fields are not written to plaintext localStorage. Existing old draft data is
  not automatically destroyed; users must back it up before clearing browser site data.
  Public deployment receipts and opaque release identifiers still persist locally.
- Authenticated launch-readiness output distinguishes unverified evidence from actual wallet
  inventory. An OpenSea URL explicitly remains `link-only`, never an active listing.

## Verification ledger

| Check | Actual status when this change was prepared |
| --- | --- |
| Native Node protocol, middleware-mock and browser-VM control tests | **90 passed, 0 failed, 0 skipped** |
| Syntax checking all changed JS/MJS/CJS code | Passed |
| Twelve real Express/HTTP integration tests | Added to `npm run test:auth`; not executed in the local dependency-free environment |
| Eleven actual ethers/EVM identity-adapter tests | Added to the existing Hardhat suite; not executed locally |
| Existing Solidity, real-validator, migration, lint, typecheck, dependency audit and E2EESA gates | No new passing result established locally; still mandatory in GitHub CI |
| Real Safe product/browser flow and EIP-7702 acceptance | Not established by the ERC-1271 fixture |
| Independent expert review, E2EESA conformance or live marketplace sale | Not performed; no claim |

Executed local command:

```sh
node --test test-auth/core.test.mjs test-auth/http.test.mjs test-auth/browser.test.mjs
```

The isolated run used Node **22.16.0**, not the project's pinned **22.20.0**. Its fake
signature adapters are deliberately not evidence of cryptographic or on-chain integration.
Local dependency installation and a full checkout were unavailable because the execution
environment could not resolve external package/repository hosts. Do not turn that limitation
into skipped CI checks. On a clean, network-enabled checkout, use the unchanged lockfile:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run ci
npm run test:integration
```

At the inspected main commit `82a62a97f451010454753d1ba09e06ffe4602754`, GitHub's
`NFT Console CI` run **38262081799** failed. A rerun also failed. The rerun's `verify` job
**114869534075** returned an empty step list. The earlier job-log request returned no log
blob. The precise scheduling/account/infrastructure cause has **not** been established;
billing is not asserted as the diagnosis. A fresh PR must establish its own exact-head checks.
Never merge this change while required checks are failed, missing or pending.

## Remaining PR-09 acceptance

Implement and verify a shared durable challenge/session/rate store, database-account binding,
transactional release RBAC and auditable permission changes. Test multi-instance replay,
restart/revocation, actual PostgreSQL row-level isolation, and the approved real Safe wallet
signing experience. The release-grant helper alone does not satisfy those requirements.

`NODE_ENV=production` deliberately refuses startup; in-memory sessions are development-only.
No setting enables public publishing, minting or listing in this increment. Do not work
around the block by treating development mode as a production deployment.

## What remains before NFTs can be sold through this console

1. **NFT-09 through NFT-13:** finish authorization; reviewed client encryption, device/recovery,
   ciphertext storage and an explicit irreversible public-publication boundary.
2. **NFT-14 through NFT-20:** complete multi-release UI, media/edition assignment, exact-byte
   rights review, compliance choices and publication confirmation.
3. **NFT-21 through NFT-25:** complete validator provisioning, wallet/Safe transaction queue,
   testnet rehearsal, canonical deployment and verified batch minting.
4. **NFT-26 through NFT-29:** create/sign/post actual OpenSea orders, verify active listings
   independently, verify royalty behavior, and support subsequent mints and re-listing.
5. **NFT-30 through NFT-36:** complete security/release evidence, provider setup, disposable
   mainnet real-sale rehearsal, staged launch, status integration and final acceptance.

No mainnet deployment, mint, order signature, NFT sale or public artwork upload was performed
while preparing this change. Existing collections in a user's wallet are not surveyed by the
software-readiness endpoint. Real artwork, exact rights, chain settings and wallet signatures
must be reviewed in the finished workflow, not inferred from the historical AOTV preset.

## Source standards and claim limits

The protocol references are [ERC-4361](https://eips.ethereum.org/EIPS/eip-4361),
[ERC-1271](https://eips.ethereum.org/EIPS/eip-1271) and the pinned ethers dependency. The
adapter is implementation work, not a formal SIWE certification. The current candidate
[E2EESA applicability](E2EESA_APPLICABILITY.md) and expert-review gates are unchanged.
See [separate self-review](PR09_SECURITY_SELF_REVIEW.md) for the actual review scope.

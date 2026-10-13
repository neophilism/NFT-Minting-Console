# NFT Console development progress

Source of truth: docs/DEVELOPMENT_PLAN.md and registry/prs.json.

## Starting point for this session

Main `00e92164ad7a745d81a345ba9bbfea56975ffd25` includes merged PRs #22,
#24 and #25: browser/Safe/PostgreSQL identity acceptance, exact-byte local rights
preparation, and direct-EOA mint receipt verification with a 24-token local
rehearsal. This does not establish production mint/list readiness.

## Current implementation

The next increment adds durable, wallet-and-chain-scoped transaction operations:
atomic wallet reservations, uncertain-outcome handling without automatic resend,
transaction-hash persistence, public calldata recovery, receipt reconciliation,
RLS isolation, runtime-immutable audit events and restart/cross-node tests.
See docs/MINT_JOURNAL.md. It introduces no signing key custody, server broadcast,
unpublished draft storage, production mode or encryption-profile change.

Local verification: 62 real contract/EVM tests and 222 authentication/database
records passed, plus lint/types. Exact-head native PostgreSQL, browser, Safe,
validator and security CI must pass before merge. Published PR review records
are authoritative for final run IDs and merge status.

## Continue from here

Integrate the journal with the user-facing wallet/recovery screen and test a
complete browser -> HTTP -> restricted database -> local-chain mint -> reload ->
verified receipt path. Then continue publication/media integration, Safe
transaction envelopes, real order construction/posting/verification, and the
remaining private-workspace and production gates. Do not call a URL a listing,
a mint an active order, an assistant review an independent audit, or a partial
work package completed. Never modify frozen rights or weaken production guards.

## Merged journal and current wallet UI

PR #26 merged as `33a7616c38f9d3c82b3375c20d53f18e1ecc3358` after core
38324907382, native runtime 38324907391, browser 38324907386 and record-integrity
38324907387 passed. Separate assistant review: 5497222114. It is not an
independent expert audit.

PR #27 now integrates the journal into Mint transactions: fee/disclosure review,
selected-wallet account/chain/nonce checks, one request, local real-chain receipt
recovery, reload, lost wallet/claim/storage response handling and mainnet-off
controls. Local 86 model, 62 contract, 223 auth and 8 data cases passed. Final
remote browser acceptance and exact-head security review must pass before merge.
See docs/MINT_WALLET_UI.md. The complete encrypted publish/mint/list product and
external production gates remain incomplete; never equate this rehearsal with
live user NFTs for sale.

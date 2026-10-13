# NFT Console

A general-purpose workspace for independent NFT collections, using this
project's custom ERC-721C-compatible collection family. Not an AOTV-only product.

> **DEVELOPMENT / REHEARSAL ONLY.** Wallet authentication, durable release
> authorization and the responsive React interface are implemented and tested.
> Private client encryption, public publication, complete minting and real
> OpenSea orders are unfinished. Production startup and those actions remain
> disabled. No NFT URL is presented as a verified listing.

## Current user interface

The default page is a bundled TypeScript/React application with collection
navigation, wallet connection, release-record inventory, an in-memory collection
setup preview, release readiness and settings. Desktop/mobile keyboard and
accessibility checks are in CI. See [UI acceptance evidence](docs/PR15_UI_ACCEPTANCE.md).

The setup preview does **not** save or upload fields. Do not enter confidential
artwork or terms. Existing record IDs and workflow stages can be listed when the
database is configured; private content is not unlocked by this build. Legacy
local/Sepolia deployment rehearsal remains at `/legacy/`, separately gated.

## Local rights and metadata preparation

The collection setup screen includes an owner-only, local preparation panel.
Review a UTF-8 text/Markdown or PDF rights file (up to 8 MiB), preserve its exact
SHA-256, explicitly select collection-wide or token-specific scope, and prepare
an allowlisted public metadata JSON file. A separate button downloads that exact
JSON. Replacing the rights file or editing any field invalidates the preview and
review acknowledgment. Sign-out, navigation and reload clear page state.

Use test or already-public documents while private-workspace acceptance is
pending. This panel does not encrypt, save drafts, upload, retrieve IPFS content,
validate legal terms, sign transactions or create orders. Media digests and IPFS
locations are user-supplied claims, not verified asset retrieval. PDF bytes are
hashed but never rendered. See [scope and reproduction](docs/PUBLICATION_PREPARATION.md).

## Disposable mint rehearsal and receipt verification

`npm run mint:rehearse` deploys two independent fixture collections through the
actual local factory, mints 24 synthetic tokens and verifies their exact events
and immutable fields. It refuses public/forked networks and non-fixture accounts.
The reusable public-data module prepares deterministic unsigned batches,
simulates them and reconciles receipts without a signer or transaction broadcast.
This is not the user-facing mint workflow, a public upload or an OpenSea listing.
See [mint component and rehearsal boundaries](docs/MINT_RECONCILIATION.md).

## Durable transaction recovery

Authenticated wallet accounts have a persistent mint-operation journal with
one-winner wallet reservations, idempotent transaction recording, immutable
runtime audit events and receipt reconciliation after restart. It stores only
routing commitments and public transaction references, never unpublished
calldata or private drafts. Apply the new forward-only authorization migration
before starting a configured database-backed server. See [API, safety and
recovery rules](docs/MINT_JOURNAL.md). This does not enable production signing.

## Wallet transaction screen

Open **Mint transactions** for saved operations, receipt checks and interrupted
wallet-response recovery. A separately enabled loopback/chain-31337 rehearsal
supports public test-manifest import, explicit simulation disclosure, fee review,
a single wallet request and durable receipt recovery. It does not enable mainnet
or Sepolia signing. See [wallet UI boundaries and reproduction](docs/MINT_WALLET_UI.md).

## Token #1 rights revision (not finalized)

For **Androids Of The Vine Token #1**, the Creator's current instruction replaces
historical investor-priority language with a one-time, defined **Creator's Companion
Portfolio** (music, software snapshots and video). The original rights/metadata
remain byte-exact historical references; the [new full working rights agreement,
provisional Schedule A and unusable pending metadata](releases/androids-of-the-vine/token-001/README.md)
are **not yet ready to publish or mint**. Do not reuse the historical rights
hash or assert the new bundle is finalized. The future collector-NFT allocation
in Section 5 has not been changed and remains a distinct legal-review issue.

## Start here for development or handoff

1. [Product Charter](docs/PRODUCT_CHARTER.md), [36-work-package Development Plan](docs/DEVELOPMENT_PLAN.md)
   and [canonical registry](registry/roadmap.json).
2. [Recovered Decisions](docs/HANDOFF_CONTEXT.md) and the dated [historical handoff audit](docs/HANDOFF_STATUS.md).
3. [Durable authorization](docs/PR09_DURABLE_STORAGE.md), [native PostgreSQL and actual Safe acceptance](docs/PR09_RUNTIME_ACCEPTANCE.md)
   and [React/browser acceptance](docs/PR15_UI_ACCEPTANCE.md) and [combined browser/Safe/PostgreSQL acceptance](docs/PR09_BROWSER_ACCEPTANCE.md). These supersede earlier execution blockers, not the full product plan.
4. [Frozen original source/rights](reference/androids-of-the-vine/), [Contract Parity Audit](docs/CONTRACT_PARITY_AUDIT.md),
   [real-validator assertions](docs/REAL_VALIDATOR_SECURITY_ASSERTIONS.md) and [Release Data Model](docs/RELEASE_DATA_MODEL.md).
5. [E2EESA applicability and closed crypto gate](docs/E2EESA_APPLICABILITY.md),
   [Threat Model](docs/THREAT_MODEL.md), [Privacy Inventory](docs/PRIVACY_INVENTORY.md)
   and [scoped security progress](security/e2eesa-status.json).

## Product invariants

Every collection selects its own name, symbol, supply, owner/minter, royalty
recipient/rate, artwork and exact rights bytes. Deploy once per collection; mint
later works at that same address. Never restore validator-wide automatic approval
or a seizure path. Public IPFS content is not private encrypted storage.

The intended workflow is encrypted drafting, explicit public publication,
wallet-signed deployment and validator setup, verified minting, then a separately
signed and independently verified marketplace order. A URL is not an order; a
unit-test pass is not an audit or mainnet rehearsal. No wallet signing keys or
seed phrases are collected. Authentication does not authorize asset transfers.

## Build and run locally

Use **Node 22.20.0 / npm 10.9.3** and the committed lockfile:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm start
```

Use [console/.env.example](console/.env.example) to configure a repository-root
`.env` or injected backend environment. Default origin is `http://localhost:3000`,
network Sepolia `11155111`, and bind address loopback. Set an exact `PUBLIC_ORIGIN`,
a matching `RPC_URL`, and public `ADMIN_WALLETS` addresses; optional editor/viewer
allowlists cannot overlap with conflicting roles. Never put private keys in this
configuration. Missing UI builds return 503 rather than falling back to a prototype.

For durable storage, follow [restricted-role provisioning and migrations](docs/PR09_DURABLE_STORAGE.md).
Runtime database credentials must not be migration-owner credentials. A configured
database failure cannot fall back to memory. Without a configured database,
authentication is development-memory only and inventory is unavailable.

`NODE_ENV=production` intentionally refuses startup until the production gates
are accepted. Do not use development mode as a substitute production deployment.
The Vite dev server uses port 5173; when developing through its proxy, set the
backend's exact `PUBLIC_ORIGIN=http://localhost:5173` for that development session.

## Verification

```sh
npm run ci
npm run test:ui:model
npx --no-install playwright install --with-deps chromium
npm run test:ui:browser
```

CI additionally runs the pinned real transfer validator, actual Safe 1.4.1 and
native PostgreSQL/multi-instance HTTP suites. See the linked acceptance documents
for exact pins, commands, executed results and limits. Test wallets use public
local-only fixtures, never user wallets or funds. Browser evidence is synthetic;
manual wallet-product and production rehearsals remain distinct checks.

The source-owned E2EESA status separates implementation, complete testing and
independent expert review. Read [adoption instructions](docs/E2EESA_ADOPTION.md)
and run `python3 scripts/validate_e2eesa_status.py`. Record integrity does not
certify security. The pre-crypto independent review gate has not been waived.

# NFT Console

General-purpose NFT release, minting and listing console using this project's custom
ERC-721C-compatible collection family. This is **not** an AOTV-only product.

> **DEVELOPMENT ONLY - NOT READY TO MINT OR SELL REAL NFTS.**
> The current PR-09a increment hardens wallet authentication and closes the unsafe prototype
> public-upload path. Private encrypted drafts, complete mint preflight and actual OpenSea
> listing are unfinished. Production startup, public publication and minting are blocked.
> See [current implementation and launch status](docs/PR09_AUTH_STATUS.md).

## Start here for independent handoff

1. [Product Charter](docs/PRODUCT_CHARTER.md), [36-work-package Development Plan](docs/DEVELOPMENT_PLAN.md),
   and canonical [roadmap registry](registry/roadmap.json).
2. [Recovered Product Decisions](docs/HANDOFF_CONTEXT.md), [historical handoff audit](docs/HANDOFF_STATUS.md),
   and [current PR-09 status](docs/PR09_AUTH_STATUS.md). The October 10 audit is a historical snapshot,
   not the current next-step instruction.
3. [Frozen original source and rights](reference/androids-of-the-vine/),
   [Contract Parity Audit](docs/CONTRACT_PARITY_AUDIT.md), and
   [Real-validator security assertions](docs/REAL_VALIDATOR_SECURITY_ASSERTIONS.md).
4. [Release Data Model](docs/RELEASE_DATA_MODEL.md) - ownership, migrations, immutable evidence
   and PostgreSQL isolation requirements.
5. [E2EESA applicability](docs/E2EESA_APPLICABILITY.md), [Threat Model](docs/THREAT_MODEL.md),
   [Privacy Inventory](docs/PRIVACY_INVENTORY.md), and
   [separate PR-09a self-review](docs/PR09_SECURITY_SELF_REVIEW.md).

## Product invariants and intended workflow

Every release selects its own name, symbol, supply, owner/minter, royalty recipient/rate,
artwork, display images, metadata and exact rights bytes. Deploy once per collection, then
mint additional works under the existing address. Media/rights hashes and minted token
fields are immutable. Never add validator-wide automatic operator approval or a seizure path.

The intended workflow is an encrypted private workspace, explicit publication of selected
plaintext to public IPFS, wallet-signed collection deployment and validator provisioning,
verified minting, then separately signed and independently verified OpenSea listings.
**An NFT URL is not a listing. A passed unit test is not a mainnet rehearsal or an audit.**
Wallet signatures authenticate separately from draft encryption keys. This console never
custodies wallet seeds or signing keys; it cannot sign transactions for a user.

The current development UI only permits authorized-owner rehearsal deployment on a configured
non-mainnet factory. Its fields are memory-only, not encrypted saved drafts. Do not enter
confidential artwork. Existing historical plaintext browser drafts are not automatically
deleted; back them up before clearing site data. Public deployment receipts and stable
release identifiers are retained, including migration from earlier v2 identifiers.

## Deterministic development

Use **Node.js 22.20.0 and npm 10.9.3**, with the committed lockfile:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run ci
```

CI keeps compilation, lint, typecheck, contract tests, migration/isolation tests, dependency
audit, build, real-validator integration and E2EESA checks. It now also runs `npm run test:auth`
for protocol, middleware, browser-control and real HTTP tests. Hardhat includes actual
ethers/EOA and ERC-1271 adapter tests. Those fixtures do not establish real Safe acceptance.
For exact executed versus unexecuted evidence, read the current status document above.

With Foundry **v1.3.6**, the real-validator suite requires its exact source checkout:

```sh
git clone https://github.com/limitbreakinc/creator-token-transfer-validator.git vendor/creator-token-transfer-validator
git -C vendor/creator-token-transfer-validator checkout 59adb8b36ab0256c7430b017b1c9f8b4841d6e1e
git -C vendor/creator-token-transfer-validator submodule update --init --recursive
npm run test:integration
```

## Local authentication setup

Use [console/.env.example](console/.env.example) as a reference. Put local development
configuration in the repository-root `.env` (dotenv's default location), never commit it.
Choose exact `PUBLIC_ORIGIN` (default `http://localhost:3000`), `CHAIN_ID` (default Sepolia
11155111), and a chain-matching `RPC_URL`. Configure `ADMIN_WALLETS`, optionally
`EDITOR_WALLETS` and `VIEWER_WALLETS`; a wallet cannot have conflicting console roles.
Start with `npm start` after compiling. Default binding is loopback only.

RPC credentials and future Pinata/OpenSea/database secrets belong only in backend secret
managers. Never provide private keys to the console. `NODE_ENV=production` refuses startup
until the durable authorization and launch requirements are implemented and accepted;
development mode is not an alternative production deployment.

## End-to-End Everywhere progress

The source-owned [security/e2eesa-status.json](security/e2eesa-status.json) records implementation,
complete testing and independent expert review separately. Engine Room reads it from GitHub.
These new authentication tests do not mark those stages complete. Read
[adoption and independent-account instructions](docs/E2EESA_ADOPTION.md), and run
`python3 scripts/validate_e2eesa_status.py`. Record integrity does not certify product security.

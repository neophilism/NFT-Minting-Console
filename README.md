# NFT Console

General-purpose collection setup, release preparation, minting and listing console
using this project's custom ERC-721C-compatible collection family. It is not an
AOTV-only product.

> **DEVELOPMENT ONLY. NOT READY TO MINT OR SELL REAL NFTS.**
> PR #18 now includes durable authentication, database release permissions and
> an opaque-envelope release API. Client encryption/recovery, complete public
> publication, mint verification and real OpenSea listings remain unfinished.
> See [current implementation and evidence](docs/PR09_DURABLE_STORAGE.md).

## Handoff and source of truth

Start with the [Product Charter](docs/PRODUCT_CHARTER.md),
[36-work-package Development Plan](docs/DEVELOPMENT_PLAN.md),
[canonical registry](registry/roadmap.json), and
[Recovered Product Decisions](docs/HANDOFF_CONTEXT.md).
[Handoff Status](docs/HANDOFF_STATUS.md) is the original historical audit;
[PR09_AUTH_STATUS](docs/PR09_AUTH_STATUS.md) records the earlier memory-only
increment. The [durable-storage update](docs/PR09_DURABLE_STORAGE.md) is current.

Preserve the [frozen contract/rights reference](reference/androids-of-the-vine/),
[Contract Parity Audit](docs/CONTRACT_PARITY_AUDIT.md),
[real-validator assertions](docs/REAL_VALIDATOR_SECURITY_ASSERTIONS.md),
[release data model](docs/RELEASE_DATA_MODEL.md),
[E2EESA applicability](docs/E2EESA_APPLICABILITY.md),
[Threat Model](docs/THREAT_MODEL.md), and [Privacy Inventory](docs/PRIVACY_INVENTORY.md).
The [separate implementation review](docs/PR09_DURABLE_REVIEW.md) is an assistant
self-review, not independent certification.

## Invariants and intended workflow

Each release chooses its own name, supply, owner/minter, royalty settings,
artwork, metadata and exact rights bytes. Deploy once per collection, then mint
additional works under that address. Preserve immutable token/media/rights fields
and the absence of validator-wide automatic approvals or seizure paths.

The target workflow is encrypted private drafting, explicit publication of
selected plaintext, wallet-signed deployment and policy setup, verified minting,
then separately signed and independently verified marketplace orders. **A token
URL is not a listing; a passing unit test is not an audit or real-sale rehearsal.**
Wallet signatures authenticate separately from draft encryption. No seed or
private signing key is collected or held by this console.

The development UI remains memory-only and does not post its plaintext form to
the new opaque API. Existing historical plaintext browser drafts are not deleted
automatically; back them up before clearing site data. Public deployment receipts
and stable release identifiers are retained. Only authorized non-mainnet rehearsal
deployment is available; production publishing, minting and listing stay blocked.

## Development and verification

Use Node **22.20.0**, npm **10.9.3**, and the unchanged lockfile:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run ci
```

Existing compile, lint, typecheck, contract, data, dependency-audit, build and
security gates remain. `npm run test:auth` now includes PostgreSQL store and
release integration tests. `npm run test:auth:controls` runs the isolated control
suite; passing it alone does not accept the product.

With Foundry **v1.3.6**, run the real-validator suite against the exact source:

```sh
git clone https://github.com/limitbreakinc/creator-token-transfer-validator.git vendor/creator-token-transfer-validator
git -C vendor/creator-token-transfer-validator checkout 59adb8b36ab0256c7430b017b1c9f8b4841d6e1e
git -C vendor/creator-token-transfer-validator submodule update --init --recursive
npm run test:integration
```

## Configuration

Use [console/.env.example](console/.env.example) as a reference for a root `.env`
or backend secret-manager configuration. Set the exact `PUBLIC_ORIGIN`, chain,
matching RPC and authorized wallet roles. Default startup binds loopback only.

Optional `DATABASE_URL` enables durable storage with a dedicated restricted
runtime login. [Provisioning, migrations and policy rotation](docs/PR09_DURABLE_STORAGE.md)
use a separate operations environment. The application refuses migration-owner
credentials and never falls back to memory when configured storage fails.
`NODE_ENV=production` still refuses launch until release acceptance.

## Security status

[security/e2eesa-status.json](security/e2eesa-status.json) records implementation,
complete testing and independent review separately. New auth tests do not mark
those stages accepted. Follow [adoption guidance](docs/E2EESA_ADOPTION.md) and
run `python3 scripts/validate_e2eesa_status.py`; status-record integrity is not
security certification. Public IPFS assets are never described as E2EE.

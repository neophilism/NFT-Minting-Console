# NFT Console

**Start here for independent handoff:**

1. [Product Charter](docs/PRODUCT_CHARTER.md) - generic product identity, release/token model, supported networks, lifecycle, and source-of-truth rules.
2. [36-PR Development Plan](docs/DEVELOPMENT_PLAN.md) - authoritative roadmap, dependencies and acceptance gates.
3. [Recovered Product Decisions & Requirements](docs/HANDOFF_CONTEXT.md) - original custom contract rationale, royalties, NFT licensing and Galinsky Collectors Circle decisions, and E2EESA requirements.
4. [Handoff Completeness & Current Blockers](docs/HANDOFF_STATUS.md) - source provenance, original test matrix, known CI defects and missing implementation work.
5. [Frozen original contract/rights/metadata reference](reference/androids-of-the-vine/) - byte-identical example source, **not** the generic production contract.
6. [Contract Parity Audit](docs/CONTRACT_PARITY_AUDIT.md) - PR-03 executable diff, preserved invariants, threat findings, and corrective test matrix.

> **PROTOTYPE ONLY - NOT SAFE FOR PRIVATE ARTWORK OR MAINNET DEPLOYMENT.** The present upload route sends plaintext directly to public IPFS, lacks the required E2EE draft boundary, and has no completed OpenSea listing integration. The generic contract has not passed parity review/audit or the full real-validator integration suite. See [Handoff Status](docs/HANDOFF_STATUS.md) before running it.

General-purpose NFT release, minting and listing console using the custom ERC-721C-compatible contract pattern developed for this project.

**Not specific to Androids Of The Vine.** Every release must choose its own collection name, token symbol, maximum supply, creator royalty rate/recipient, owner/minter wallets, media files, metadata, optional preview images and rights terms. The smart contract records per-token media and rights SHA-256 hashes immutably and intentionally omits `AutomaticValidatorTransferApproval`.

## Desired workflow

1. **Create release**: enter collection details and roles, choose network and configure marketplace compatibility.
2. **Add works**: drop one or more image/video/audio/other files, review titles, descriptions and per-work display images. Define the rights text for this release; do not use any project-specific rights unless explicitly chosen.
3. **Prepare**: validate file counts, hash and pin media/rights/metadata to IPFS, check exact supply and unused token IDs.
4. **Deploy once per collection** with wallet signing, then configure validator policy.
5. **Mint batch** of works with a wallet signature, verify chain receipts and show precise NFT links.
6. **List on OpenSea** with required wallet approvals/signatures, verify listing state. Never assume minting automatically creates a listing.

## Safety and delivery gates

- GitHub CI must compile and run contract unit and real-validator integration tests before deployment.
- The backend must require an authorized admin wallet before it spends IPFS pinning resources; never expose Pinata/OpenSea keys or wallet private keys to browsers.
- Contract deployment and minting always require signed on-chain transactions by an authorized wallet; this console never holds signing keys.
- Do not advertise automatic marketplace listing until it is tested end to end on a disposable mainnet collection with real OpenSea orders and royalty settlement.
- Prefer one collection deployment per release, many NFTs minted under that collection. Initial pricing is an off-chain OpenSea listing decision, not a contract sale price.

## Deterministic development

Use Node.js 22.20.0 and npm 10.9.3. Install exactly the committed dependency
graph and run every local CI gate with:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run ci
```

`npm run ci` compiles Solidity, lints and type-checks the JavaScript sources,
runs the contract unit tests, audits production dependencies at high severity,
and performs the application build check. GitHub Actions runs the same gates as
separate fail-closed steps so a failed compile or incomplete job cannot appear
green.

PR-05 adds a separate real-validator suite. With Foundry v1.3.6 installed:

```sh
git clone https://github.com/limitbreakinc/creator-token-transfer-validator.git vendor/creator-token-transfer-validator
git -C vendor/creator-token-transfer-validator checkout 59adb8b36ab0256c7430b017b1c9f8b4841d6e1e
git -C vendor/creator-token-transfer-validator submodule update --init --recursive
npm run test:integration
```

The command checks the exact source and submodule revisions and exercises the
application's Hardhat collection artifact against the real validator. GitHub
Actions runs both suites. See [security assertions](docs/REAL_VALIDATOR_SECURITY_ASSERTIONS.md)
for evidence and limits. Passing these tests does not establish live OpenSea
compatibility, royalty settlement, external audit approval, or production readiness.

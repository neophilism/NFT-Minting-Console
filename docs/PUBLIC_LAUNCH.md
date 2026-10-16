# Public-only first mint

This path uses finalized, deliberately public assets. It does not enable private drafting, encrypted device recovery, or claim completion of the full 36-package roadmap.

## Contract deployment

The collection can be deployed directly with its existing reviewed constructor. Deploying a separate factory first is optional and unnecessary for the first release. One collection supports subsequent mint batches without redeployment.

`console/launch/contracts.mjs` derives the exact creation calldata, address and runtime hash from the pinned compiler artifact and reviewed constructor values. Solidity immutable byte offsets come from compiler build metadata; unknown immutable fields fail closed. No deployed-RPC bytecode is accepted as its own expected hash. A read-only constructor call must return precisely the predicted runtime. Receipt checks bind the transaction sender, chain, nonce, zero value, exact calldata, creation address, canonical inclusion and confirmation count. Deployed name, symbol, supply, owner, minter, royalty recipient, rate and ERC-2981 response are checked against the intended configuration.

Wallet keys stay in the wallet. No application API holds a signer or broadcasts a raw signed transaction. Transactions remain separate explicit decisions. A deployed collection is not evidence of a token mint or marketplace listing.

## Verification

The Hardhat `First-mint direct collection deployment` suite deploys two independent configurations, verifies predicted runtime against actual EVM output, rejects changed royalty settings/calldata, duplicate deployment, malformed configuration and incomplete compiler metadata. No public-chain transaction or gas was spent.

## Public mint workflow

The **Deploy & mint** screen is separate from private drafting. `NFT_PUBLIC_LAUNCH=1` enables it only with an authorized owner, HTTPS origin/RPC and restricted durable database. `NODE_ENV=production` additionally requires the real durable authentication path; injected authentication and memory fallback are rejected. Chain 1 requires `NFT_MAINNET_ACK=ethereum-mainnet-real-fees`. These are operator configuration controls; every on-chain transaction still requires explicit wallet review.

The browser simulates each exact operation through its selected wallet independently of the server's RPC, checks the network/account/nonce, estimates gas with a 20% limit margin, verifies the wallet balance, and displays the maximum network fee. The wallet receives one zero-value transaction with exact destination/calldata, nonce, gas and price. No approvals, listing orders, automatic chain switches, private keys or automatic rebroadcasts are included.

Public launch records use their own RLS-protected journal and append-only events, leaving the ciphertext workspace and older routing-only mint journal unchanged. Plans are account- and chain-scoped, immutable and revision-checked. A durable reservation precedes a wallet request. An unknown wallet response cannot become a fresh send; another tab cannot reserve a different transaction while an unresolved launch is pending. Reload restores public settings and transaction hashes. Explicit wallet rejection allows a fresh reviewed request. A confirmed, exact reverted transaction retains its failure evidence and permits preparing a new operation with a new nonce.

Direct EOA wallets are the first-mint signing path. Safe authentication remains available elsewhere, but signing a deployment/mint as a Safe or delegated EOA is not implemented in this public launch flow. Mints are batched up to ten works; subsequent batches use the same collection.

## Prepare finalized assets

Create a local release JSON with exactly these fields (all paths are relative to that JSON):

```json
{
  "version": 1,
  "tokenId": "1",
  "title": "Your finalized title",
  "description": "Your approved public description",
  "image": "poster.png",
  "media": "video.mp4",
  "rights": "FINAL_RIGHTS.md",
  "rightsScope": "token"
}
```

For an image-only NFT, set `media` to `null`. `rightsScope` is `token` or `collection`. The tool never chooses token count, legal terms or artwork for the owner.

```sh
npm run release:inspect -- release.json
npm run release:publish -- release.json REVIEW_SHA256 public-mint-bundle.json --public-disclosure-confirmed
```

Inspect prints the exact local file hashes and a review digest before any upload. Publishing requires that digest and `PINATA_JWT` in the operations environment. Files are streamed, uploaded sequentially, read back and SHA-256 verified; metadata is generated with exact media/poster/rights references and hashed after final serialization. A restricted local checkpoint records completed uploads before moving on. An uncertain upload leaves a blocking checkpoint; do not delete it or blindly repeat the POST. Use `npm run release:reconcile -- public-mint-bundle.json KNOWN_CID` to verify the pending exact bytes with read-only IPFS retrieval before resuming. This command does not upload again. A returned CID is saved into the checkpoint when available; a different CID is rejected.

Import the resulting bundle on **Deploy & mint**, choose a verified collection and explicitly approve public-file checks. The server requires matching metadata bytes, title, artwork/poster/media references, rights URI and hashes; it independently reads the public IPFS bytes before simulating the batch. Collection deployment is reverified against the compiler-derived expected bytecode/configuration. The browser performs its own chain simulation and fee review before the mint signature. Receipt verification checks transaction inclusion, ordered mint events and every immutable token field after at least two confirmations.

## Operational limits

This scope enables minting finalized public works; it does not assert completion of encrypted draft editing, cross-device recovery, private object storage, marketplace policy provisioning, automated listing, a real-sale rehearsal or security certification. Validator presence is checked; a transfer-validator policy or active OpenSea listing is not inferred from that presence. The console records `validatorPolicyVerified: false` and `listingVerified: false` accordingly. The owner must finish marketplace policy configuration before relying on a sale workflow.

No real user artwork, private wallet key, public-chain transaction or paid service was used in the automated acceptance fixtures. Local acceptance includes real EVM deployment/mint receipts and PostgreSQL role/RLS behavior. Native PostgreSQL and desktop/mobile browser acceptance are required CI checks before merging.

## Current deployment evidence — 2026-10-16

- PR #43: all six applicable GitHub Actions jobs passed; exact direct deployment primitives merged.
- PR #44: all six jobs passed, including native PostgreSQL, actual Safe/validator integration and **94 desktop/mobile browser tests**. Browser tests deploy and mint with synthetic disposable EOAs and independently read exact immutable fields.
- PR #47: all six required jobs passed, including native PostgreSQL and desktop/mobile browser acceptance. The read-only launch doctor and shared wallet fee policy are merged.
- [Render preview](https://nft-minting-console-preview.onrender.com/#/launch): application code from PR #47, commit `dfa147a5100032b9eed8346d3e4a2c76045bc799`, deploy `dep-db94hpjrjlhs73c8t40g`, verified live. It remains configured for Sepolia with live signing disabled until user credentials and addresses are supplied.
- Existing Neon project `dark-math-52213387`: baseline and all four authorization migrations applied atomically to isolated branch `br-misty-band-b4052asu`; exact migration checksums recorded. A restricted SQL-created login has only the three NOINHERIT application grants, with no role creation, database creation, replication or RLS bypass. SQL checks confirm no unauthenticated launch rows and no application permission to delete history or forge audit events.
- Direct native TCP from the development container to Neon is unavailable (DNS); native driver integration is verified in CI. This is not reported as a successful production connection.
- The default Neon branch `br-late-forest-b4z0hjsa` remains unchanged: automatic approval review rejected migrating that specific production target. The isolated branch remains the verified migration/rehearsal environment. Final production-target setup is pending.

Inputs still needed for the owner's real mint: public owner/minter/royalty addresses and supply; finalized artwork/poster and final rights; Pinata access and RPC endpoints; funded signing wallet and explicit wallet signatures. OpenSea API access is only required for automated marketplace listing. Keep service secrets in the hosting/operations environment. Never supply a seed phrase or wallet private key.

## Read-only operator check and deployment budget

Create a public `launch-request.json` with the intended deployment wallet and exact collection configuration. These are constructor choices, not defaults for the owner's release:

```json
{
  "version": 1,
  "wallet": "0xYOUR_DEPLOYMENT_WALLET",
  "collection": {
    "name": "Your approved collection",
    "symbol": "YOUR_SYMBOL",
    "seriesSize": "YOUR_APPROVED_SUPPLY",
    "royaltyBps": "YOUR_APPROVED_BASIS_POINTS",
    "owner": "0xYOUR_COLLECTION_OWNER",
    "minter": "0xYOUR_MINTING_WALLET",
    "royaltyRecipient": "0xYOUR_ROYALTY_RECIPIENT"
  }
}
```

```sh
npm run build
npm run launch:doctor -- launch-request.json
npm run launch:doctor -- launch-request.json --network
```

Use the application environment with `NODE_ENV=production`, the explicit chain, HTTPS origin/RPC, `ADMIN_WALLETS`, restricted `DATABASE_URL`, and public-launch flag/real-mainnet-fee acknowledgement described above. Both deployment and minting wallets must have the console owner role. Migration credentials belong in a separate operations environment; the check rejects them in the app environment. Pinata credential presence is reported separately and is not evidence of successful authentication or publication.

The default command checks configuration locally and never reports live readiness. `--network` additionally uses a fresh runtime database connection in a **read-only transaction**, verifies its restricted role and forced-RLS launch tables, confirms immutable-plan/event permission limits and zero unbound row visibility, then rolls back. It does not apply migrations, inspect private rows, create auth sessions, upload files, reserve journal entries, request a signature or broadcast anything. Schema presence/permissions are verified; migration checksum history is deliberately not claimed accessible to the restricted login.

The RPC check simulates exact compiler-derived creation output, checks direct EOA deployment/minter wallets, and obtains pending nonce/balance and current gas price. Its fee calculation shares the wallet's 20% gas-limit margin, upper limits and rounding. The report includes the deployment cap and **additional wei/ETH needed above the wallet's existing balance**. This estimate covers one collection deployment only: minting needs additional gas after its exact public batch exists. It is time-sensitive, contains no swap/bridge/exchange purchase instruction, and does not authorize a transaction. Wallet review repeats live checks before any signature.

The report redacts service credentials and URLs. Failed checks exit nonzero. `readyForDeploymentReview` can become true only when every configuration/database/simulation/fee/balance check passes; `mintingVerified`, `listingVerified` and `transactionSent` remain false. An empty wallet can be inspected without buying ETH first when the RPC supports zero-price estimation; unsupported simulations fail without inventing a funding amount.

Canonical PR records treat public-launch work as contributing evidence for unfinished roadmap packages. Validator provisioning, encrypted release editing, full mint-job orchestration and production rollout are not marked complete by the public-flow merges.


## Combined deployment and supplied-batch funding estimate

After publishing and independently reading back the approved final files, use the same public collection request and one or more generated public mint bundles:

```sh
npm run build
npm run launch:budget -- launch-request.json public-mint-bundle.json additional-public-bundle.json
```

Only HTTPS `RPC_URL` and explicit Ethereum-mainnet/Sepolia `CHAIN_ID` are needed for this read-only command. Each bundle must contain one to ten works with matching canonical metadata bytes, public IPFS files and exact media/rights commitments. Supply up to 500 works across at most 500 bundle files, with an 8 MiB total public JSON input limit. Duplicate token IDs across files are rejected. The command performs GET readback; it does not upload or change the publication checkpoint.

The RPC must support [`eth_simulateV1`](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-eth#eth-simulate-v1), including the optional [`maxUsedGas` field](https://ethereum.github.io/execution-apis/api/methods/eth_simulateV1/) for each funded operation. This field records peak gas before refunds. A missing peak measurement stops the combined quote; net receipt gas alone is not used as its funding basis.

A virtual deployment block followed by one virtual block per batch executes exact compiler-derived deployment bytes and every supplied mint batch. A separate random virtual reader calls the public getters so those simulated reads cannot consume the signing wallets' mint nonces. The reader never requires a real key or funding. Only virtual balances are overridden; real nonce, code, storage, policy state and balances are not changed. Direct EOA signers and a stable wallet nonce/balance snapshot are required. The result checks constructor runtime, ordered mint events, all intended token fields/initial owners, collection configuration and royalty readback. It also observes the pinned v5 default validator address and actual source-chain code presence. Policy provisioning and listing verification remain separate.

The report groups gas caps by deployment/minter wallet. If they are the same wallet, its existing balance is subtracted **once from the combined cap**. Different wallets receive separate shortfalls. Every cap uses peak gas plus the same upward-rounded 20% limit margin and fee ceilings as browser review. The quote covers one new collection and all supplied works, grouped into batches of ten. The report explicitly gives `suppliedWorkCount`, `seriesSize` and `entireSeriesIncluded`; it does not assume unsupplied NFTs are covered. Policy changes, token approvals, listings, unsupplied works and exchange/bridge costs are excluded. It is time-sensitive and is not a guarantee that prices or wallet state will remain unchanged.

RPC providers can cap total simulated gas, blocks or response size. If any batch, peak-gas measurement or readback is unavailable, the command fails instead of publishing a partial total. It does not change RPC gas limits or substitute a linear guess for later batches.

`publicFilesVerified` requires actual readback. `readyForFundingReview` also requires valid fee caps and observed validator contract presence. This is a funding-scope observation, not application/DB readiness, ownership proof or transaction authorization: run `launch:doctor` separately. Virtual block/transaction hashes are not recorded as public-chain receipt evidence, and `transactionSent`, `mintingVerified`, `listingVerified` and `validatorPolicyVerified` remain false. Wallet review repeats independent live checks before each real signature.

CI builds [Geth v1.17.8](https://github.com/ethereum/go-ethereum/releases/tag/v1.17.8) from exact commit `a579077007b98217c3e253a66e4b452ca0c32b96` and starts a no-peer, loopback-only developer chain. Synthetic EOA cases exercise actual unsigned simulation for shared and distinct deployment/minter wallets, compare immutable fields, and confirm that source nonce, balance, predicted-address code and head are unchanged. That fixture has no deployed default validator and must not be promoted to public-chain readiness. Operator RPC availability and a real mint still await user inputs.

## Recover an existing wallet cancellation

A lost wallet response remains unresolved until there is chain evidence. The launch page accepts the hash of an **existing** wallet cancellation and performs independent read-only receipt checks through the connected wallet RPC and the server RPC. It never asks the wallet to sign, cancel or replace a transaction.

The narrow accepted form is a successful zero-value self-transfer by the same direct EOA, on the same chain and nonce, with empty calldata, empty access/authorization lists, exactly 21,000 gas limit and gas used, no logs and no created contract. The signer must have no code at the preceding block or receipt block. The receipt must be included in its canonical block, with a canonical RPC `finalized` block at least one block later. Providers without finalized-tag support and other replacement formats remain unresolved.

A verified cancellation stores append-only public evidence separately from the original hash and marks the operation `NONCE_CANCELLED`. The original action is **not** marked verified. The original plan cannot be re-sent; a new plan uses the wallet's fresh nonce. A stale revision, mismatched nonce, unfinalized receipt or uncertain RPC result cannot unlock a new operation. A reload recovers the evidence if the response was lost.

Apply authorization migration `005_launch_nonce_resolution.sql` through the separate migration environment before enabling the updated application. It creates a forced-RLS, account/chain-bound proof table with no runtime update/delete grant. The readiness doctor checks the new table's forced RLS, immutable-proof privileges and unbound visibility. Existing migration bytes are unchanged. No migration to the production Neon default branch has been applied by this change.

Regression coverage includes actual disposable EVM cancellation receipts, malformed/adversarial RPC evidence, embedded and native PostgreSQL history/permission checks, and desktop/mobile browser recovery after an unknown wallet outcome. These tests use synthetic wallets only; passing them does not prove a public-chain launch occurred.

## Multi-batch funding evidence

The private pinned-Geth acceptance fixture exercises shared and distinct deployment/minter wallets for two-work and eleven-work releases. The eleven-work release crosses the ten-work boundary, checks final supply closure and immutable per-token readback, and requires sequential real-operation nonces despite the intervening virtual getter calls. The aggregate quote contains only deployment and mint costs; no synthetic reader cost is charged to a signing wallet. Source balances/nonces/code remain unchanged. Larger releases remain bounded by the selected provider's simulation capacity and are not claimed to have been publicly minted.

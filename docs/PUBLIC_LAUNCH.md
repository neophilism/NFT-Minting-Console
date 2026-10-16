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

Inspect prints the exact local file hashes and a review digest before any upload. Publishing requires that digest and `PINATA_JWT` in the operations environment. Files are streamed, uploaded sequentially, read back and SHA-256 verified; metadata is generated with exact media/poster/rights references and hashed after final serialization. A restricted local checkpoint records completed uploads before moving on. An uncertain upload leaves a blocking checkpoint; do not delete it or blindly repeat the POST. Reconcile its CID through the existing public-file verification command before resolving it.

Import the resulting bundle on **Deploy & mint**, choose a verified collection and explicitly approve public-file checks. The server requires matching metadata bytes, title, artwork/poster/media references, rights URI and hashes; it independently reads the public IPFS bytes before simulating the batch. Collection deployment is reverified against the compiler-derived expected bytecode/configuration. The browser performs its own chain simulation and fee review before the mint signature. Receipt verification checks transaction inclusion, ordered mint events and every immutable token field after at least two confirmations.

## Operational limits

This scope enables minting finalized public works; it does not assert completion of encrypted draft editing, cross-device recovery, private object storage, marketplace policy provisioning, automated listing, a real-sale rehearsal or security certification. Validator presence is checked; a transfer-validator policy or active OpenSea listing is not inferred from that presence. The console records `validatorPolicyVerified: false` and `listingVerified: false` accordingly. The owner must finish marketplace policy configuration before relying on a sale workflow.

No real user artwork, private wallet key, public-chain transaction or paid service was used in the automated acceptance fixtures. Local acceptance includes real EVM deployment/mint receipts and PostgreSQL role/RLS behavior. Native PostgreSQL and desktop/mobile browser acceptance are required CI checks before merging.

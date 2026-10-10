# NFT Console

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

Implementation status and test commands will be updated as code is added.

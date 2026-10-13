Seaport v1.6 order intents — developer-only

Scope: strict offline one-token ERC721, fixed ETH price and exact native Seaport typed-data intent. This component is NOT a live listing, transaction, user wallet wizard or production feature. No API credential or private key is used.

The module console/marketplace/seaport-intent.mjs validates reviewed mainnet protocol/conduit/zone profiles, fixed contract code-hash claims, expiry, integer prices and exact royalty/marketplace bps, and constructs a signable EIP712 digest, token-specific approval, cancellation and OpenSea post-body data. It also verifies signed maker identity. The caller must still check every reviewed code hash, ownership, Safe/EOA signing, live Seaport counter, approvals, zone authorization and exact marketplace fees against real independent chain and OpenSea data before any signing or order submission. A syntactically correct order is not a listing.

The existing npm run test:marketplace:transport executes all test-marketplace/*.test.mjs, including the additional signed-order cases. No mainnet transaction, UI, server POST, new dependency or production gate was changed.

References: https://docs.opensea.io/reference/post_listing and https://docs.opensea.io/reference/get_order

# Server-only OpenSea signed-listing submission (NFT-26 increment)

This transport POSTs an already signed and explicitly reviewed Ethereum Seaport ERC-721 fixed-price order to the fixed OpenSea API v2 listings endpoint. It does not construct, approve, sign, retry, or verify an active listing. A response is API acceptance only, never chain or royalty verification. It is deliberately not connected to an HTTP endpoint or production feature flag.

A future authenticated wallet flow must independently prove the signed EIP-712 domain and seller, NFT ownership, token approvals, validator policy, total price/fee/royalty split, and actual review consent, and must persist idempotency/recovery before enabling submissions. Unknown POST results must be reconciled through read-only API plus chain inspection rather than blindly resubmitted. The key remains server-only; no mainnet wallet is touched by these synthetic tests.

OpenSea API reference: https://docs.opensea.io/reference/post_listing

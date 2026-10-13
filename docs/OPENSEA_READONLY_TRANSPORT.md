# OpenSea read-only transport foundation

**Scope: server-side public-data observation only; NOT listing acceptance.**

`console/marketplace/read-only.mjs` restricts requests to the fixed OpenSea v2 HTTPS origin and three whitelisted GET paths: NFT, collection and a Seaport order observation. It never accepts caller-supplied URLs, arbitrary methods or redirects, never sends a private wallet key or token draft, rejects oversized/non-JSON/unsafe responses, preserves unsafe JSON integer tokens exactly, and reports `listingVerified: false` and `chainVerified: false` even if the upstream API claims `ACTIVE`.

The constructor's OpenSea API key belongs **only on the service** (secret manager/environment), never the React bundle, downloadable assets, public metadata or GitHub. This module has no signing, posting, on-chain transaction, API retry, or privilege escalation; caller must separately verify exact Seaport parameters and signature, token ownership, approval, current counter/zone state, validator compliance, price/currency/fees, on-chain codehash and marketplace order availability before UI can say **Listed**.

The API paths are grounded in the recorded official [OpenSea order API](https://docs.opensea.io/reference/get_order) and collection/NFT endpoints. This is a reusable narrow component, not an assumption that a browser token link is a live order.

**Still blocked:** private artwork staging and declassification, IPFS publication and retrieval, full EIP-712 order construction, user wallet approval/signing, official posting workflow, on-chain and OpenSea verification, mainnet Safe compatibility, disposable mainnet sale, independent security review and user-controlled releases. Production startup gates remain closed. Tests are fully synthetic and do not call OpenSea or use live credentials.

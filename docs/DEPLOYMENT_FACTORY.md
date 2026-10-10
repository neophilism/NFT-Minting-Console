# Deployment Factory

PR-06 introduces `NFTCollectionFactory` as the only application deployment path.
It uses CREATE2 with a salt derived from the factory version, chain ID and stable
release ID. Reusing a release ID is rejected before another collection can be
created.

Each `CollectionDeployed` event records the release ID, requester, chain ID,
factory version, collection creation-code ID, exact configuration hash and
init-code hash. The browser verifies the predicted address, event and deployed
bytecode before storing a local receipt. `GET /api/deployment/:releaseId`
reconciles that record against the configured RPC endpoint.

The factory is deliberately not an owner, minter or signing service. OWNER and
MINTER may be EOAs or contract wallets such as Safes. Every application
deployment transaction is signed by the connected browser wallet; the server
does not accept or store a private key.

Supported chain metadata is versioned in `config/chains.json`. A factory must
be deployed and its address set as `DEPLOYMENT_FACTORY_ADDRESS` for the target
chain before the browser can deploy releases. Mainnet deployment remains gated
by the later rehearsal, verification and audit plan items.

Run `npm run deploy:rehearse` on the local Hardhat network to create two
unrelated collections and print their deterministic receipts. Automated tests
cover independent configuration, constructor boundaries, duplicate protection,
contract-wallet roles and version/bytecode identifiers.

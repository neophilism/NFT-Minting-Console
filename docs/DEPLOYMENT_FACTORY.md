# Deployment Factory

PR-06 introduces `NFTCollectionFactory` as the only application deployment path.
Version 2 uses CREATE2 with a salt derived from the factory version, chain ID,
transaction requester and stable release ID. Reusing a release ID within the
same requester's namespace is rejected even if constructor inputs change.
Another caller can copy a pending transaction's ID/configuration only into its
own namespace; it cannot reserve or replace the intended requester's deployment.
The previous global v1 mapping allowed this front-running denial of service.

Each `CollectionDeployed` event records the release ID, requester, chain ID,
factory version, collection creation-code ID, exact configuration hash and
init-code hash. The browser verifies the predicted address, event and deployed
bytecode before storing a local receipt. `GET /api/deployment/:releaseId?requester=ADDRESS`
reconciles that record against the configured RPC endpoint.

The factory is deliberately not an owner, minter or signing service. OWNER and
MINTER may be EOAs or contract wallets such as Safes. Every application
deployment transaction is signed by the connected browser wallet; the server
does not accept or store a private key.

Address prediction requires an explicit requester. It is the actual transaction
sender (the Safe itself for a Safe transaction), independently of OWNER/MINTER.
The browser verifies v2 and the collection creation-code ID before signing,
binds all event commitments to its request, and rejects resuming with changed
immutable inputs. Wallet-scoped local release IDs and receipts include requester.
These checks do not authenticate an arbitrary RPC or a deployed factory; exact
chain bytecode and canonical receipt verification remain later acceptance gates.

The v2 salt/ABI/version changes require a newly reviewed factory. A v1 instance
cannot be upgraded and v1 receipts are not silently reinterpreted as v2. No live
factory is deployed or migrated by this change. Independent security review is
still required before acceptance.

Supported chain metadata is versioned in `config/chains.json`. A factory must
be deployed and its address set as `DEPLOYMENT_FACTORY_ADDRESS` for the target
chain before the browser can deploy releases. Mainnet deployment remains gated
by the later rehearsal, verification and audit plan items.

Run `npm run deploy:rehearse` on the local Hardhat network to create two
unrelated collections and print their deterministic receipts. Automated tests
cover independent configuration, constructor boundaries, duplicate protection,
contract-wallet roles and version/bytecode identifiers. Regression cases first
failed on v1 for copied and modified attacker configurations; v2 must pass both
and actual contract-wallet requester isolation.

Security crosswalk for PR-08's target architecture: `chain-write` and
`public-chain-and-orders` deliberately disclose deployment inputs and receipts.
Their authenticity/claim boundary is tracked by `NFT-CLAIM-001` and `NFT-T09` in
the pending security crosswalk. Requester scoping prevents cross-wallet reservation
without making wallet login a content-key authority or giving the factory token
approvals. The shared server reconciliation helper is exercised against real
local deployments and fails closed without requester, on wrong chain, or without
factory code. Exact-source independent review and live bytecode remain pending.

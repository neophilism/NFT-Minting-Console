# Batch intent, chain simulation and mint receipt reconciliation

This is a public-data implementation component for NFT-25 and the local portion
of NFT-22. It builds on the existing accepted collection/factory contracts; it
does not enable a later workflow before its publication, validator, wallet,
marketplace or production dependencies. Both work packages remain partial.

## Public component API

`console/chain/mint.mjs` exports:

- `prepareMintPlan({ chainId, collection, minter, runtimeCodeHash, works })`:
  validates a snapshot and produces deterministic unsigned batches, at most
  ten works per batch and 500 works per plan. IDs are canonical decimal strings;
  media/rights digests are nonzero, lowercase, 0x-prefixed bytes32. URI/title
  bytes are not trimmed or normalized. Unknown/private fields, prototypes,
  accessors, sparse arrays, duplicate IDs and excessive input are rejected.
- `simulateMintBatch(provider, batch, { signal })`: verifies the chain, pinned
  runtime code, immutable minter, direct-EOA scope, batch limit, supply and
  closure at a particular canonical block, then performs a read-only eth_call.
  The canonical block and network are rechecked before returning.
- `verifyMintReceipt(provider, batch, transactionHash, options)`: binds the
  exact transaction, receipt, block membership, expected value/calldata and
  sender/collection to the prepared intent. It requires a successful receipt,
  the requested confirmations, exact ordered Transfer/WorkMinted events and
  every immutable token field read back at the receipt block. A final block
  and network recheck rejects a reorganization observed during verification.

No helper obtains a signer, submits/retries/replaces a transaction, stores a
key, uploads an asset or places an order. Errors use bounded fixed codes rather
than returning provider messages. Abort signals suppress stale results; they
do not promise cancellation of every in-flight provider request.

## Explicit trust and scope limits

The runtimeCodeHash and expected collection/minter/chain must come from a
reviewed deployment record. Deriving them from an untrusted RPC and immediately
checking that same RPC is not a production trust anchor. Provider results still
trust that provider: block-hash checks are not independent consensus proofs.
The returned evidence is block/time-scoped and must be reconciled again before
later actions; even successful confirmation checks do not guarantee finality.
The confirmation count is explicit, defaults to two, and can be set to 1-256 by
the calling policy. This is not a recommended production finality policy.

Only direct EOA transactions of type 0, 1 or 2 are accepted. Safe, EIP-7702
and blob/authorization envelopes fail closed and require separate adapters and
acceptance. A receipt log's optional removed flag may be absent; an explicitly
removed/invalid flag is rejected and canonical block checks remain mandatory.
The initial mint recipient is proven, not current ownership after transfers.

URI prefixes and exact strings are checked here, but CID validity, published
bytes, rights approval and public-content retrieval belong to the preceding
publication preflight. All results keep publicContentVerified,
validatorPolicyVerified, productionReady and listingVerified false. A successful
mint is not an active listing. Simulation does not approve gas budgets, policy
compatibility, a later changed chain state or a wallet signature.

This addresses the public-chain integrity part of the existing threat model:
wrong chain/contract, altered immutable fields, transaction substitution,
forged events, reorgs and false completion. It adds no server route, private
storage, encryption provider, standard/profile change or conformance claim.
The existing independent pre-crypto review gate remains unchanged.

## Disposable end-to-end rehearsal

After the pinned dependency install and compile, run:

```sh
npm run mint:rehearse
```

`scripts/rehearse-mints.cjs` refuses non-Hardhat networks and any fork before
provider calls, then requires chain 31337 and the seven known public local-test
accounts. It never accepts a user key or a public-chain provider configuration.
It deploys the actual v2 factory and two parameter-independent collections,
mints 21 Alpha works in batches 10/10/1 and three Beta works in one batch, and
reconciles all 24 receipts/token records through the public component. It also
checks owner/minter/supply/closure, ERC-2981 recipient/amount and duplicate-mint
rejection. ERC-2981 read-back is not a verified royalty payment.

Media, rights and IPFS locations are synthetic, unuploaded fixtures. No real
artwork, user wallet funds or marketplace orders are used. The local codehash
anchor is the just-deployed source-compiled fixture, not a mainnet attestation.
The report is written to `artifacts/rehearsal/mint-report.json`; CI retains that
specific synthetic report, never environment files, signing keys or .git.

## Verification and next integration

The component adds 16 contract/provider cases in `test/MintReconciliation.cjs`.
Local pinned Node 22.20.0: all 56 contract cases and 69 UI/model cases passed,
plus lint/type checks and the 24-mint rehearsal. Contract execution locally
uses checksum-verified compiled artifacts with --no-compile; remote CI compiles
from source and audits dependencies. All original native PostgreSQL, Safe,
real-validator, browser and security-profile gates remain mandatory. Final
head-specific CI and separate assistant security review are recorded on the PR.

Still needed for complete NFT-22/25 acceptance: persistent job/receipt storage,
wallet-confirmed transaction queue, Safe/7702 envelope support, gas/fee policy,
resumable production orchestration, complete public-content and validator
preflight, Sepolia/product-wallet rehearsals and the broader launch gates.
No independent expert audit or mainnet/OpenSea acceptance is claimed.

Primary interfaces checked during implementation:
- https://docs.ethers.org/v6/api/providers/
- https://docs.ethers.org/v6/api/contract/
- The exact checked-in NFTCollection.sol and NFTCollectionFactory.sol.

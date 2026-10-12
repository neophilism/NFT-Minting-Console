# Durable mint transaction journal

The authenticated API now keeps a wallet-and-chain-scoped journal for mint
intents, wallet reservations, returned transaction hashes and block-scoped
verification observations. It builds on the accepted NFT-09 identity boundary
and NFT-25 read-only verifier. This implements the persistence/resume portion
of NFT-23/25, not their entire user-wallet/validator/publication acceptance.

## API and workflow

All endpoints are under `/api/mint-operations`. Reads require a valid session;
writes additionally require owner authorization, same origin and CSRF.

1. POST `{intentId, collection, runtimeCodeHash}` to create an idempotent routing
   record. The actor's wallet/chain are server-authenticated, never body fields.
   No works, titles, rights, calldata, encryption keys or draft payload is saved.
2. POST `/:id/claim` with `{expectedRevision}` immediately before a wallet send.
   Exactly one competing caller can reserve it. A replay or lost claim response
   is a conflict, not a second permission to sign. Reservations never expire
   into an automatic resend.
3. POST `/:id/wallet-outcome` with the reservation's revision/attemptId and
   `outcome: rejected` only for a definitive wallet rejection. Unknown errors
   use `outcome: unknown`, leaving an attention state that cannot be retried.
   These are client reports, not cryptographic proof of wallet behavior.
4. POST `/:id/transaction` with `{transactionHash}` to record the observed hash.
   Exact retries are idempotent; a different hash cannot silently replace it.
   An unverified hash does not establish a mint. Unknown outcomes can be
   recovered by recording the transaction found in the wallet history.
5. POST `/:id/reconcile` with `{}`. The server recovers exact public calldata
   from the RPC's transaction, rebuilds the intent and uses the real receipt
   verifier. No unpublished draft is needed to resume. Missing transactions,
   insufficient confirmations, RPC failure and detected reorgs remove current
   verified status. The API never accepts a caller-supplied status or receipt.
6. GET the collection, `/:id`, or `/:id/events` to resume after restart. The
   `after` cursor and `limit` (1-100) provide stable pagination. Unsent prepared
   records alone may be cancelled with `/:id/cancel` and expectedRevision.

A network request runs outside database locks; a revision compare-and-set keeps
stale verification from replacing a newer observation. The server never gets a
signer, broadcasts, replaces or automatically retries a transaction. A lost
wallet response must be investigated in the wallet, not treated as rejection.
The current version does not support transaction replacement or Safe envelopes.

## Storage and operational changes

Apply `npm run db:migrate:auth` from the existing separate migration-credential
environment. The forward-only `003_mint_journal.sql` follows the unchanged
baseline/auth migrations. Application startup checks for its tables and fails
closed if the schema is missing; migrations are never run by the runtime role.
No live production database was modified by this implementation.

The journal and its trigger-generated events have forced row security using
existing account/chain binding. Runtime credentials retain exactly the existing
three non-inherited roles. The application role cannot delete journal records,
change intent identity, rewrite a stored transaction hash, or insert/update/
delete audit events. The event trigger has a narrowly privileged definer and
fixed search path. No new runtime role membership is required.

There is a 1,000-operation per-account capacity bound, existing HTTP quotas,
bounded identifiers/errors, and no content in the schema or logs. Account,
contract, digest, transaction and timing metadata are visible to the service.
This journal is not private draft storage or proof of E2EE. Retention/archival
policy and capacity changes remain part of production operational acceptance.

## Security mapping and limits

- NFT-T04 / NFT-IDENTITY-001: authenticated identity, role/chain binding,
  CSRF/origin checks, stale revision rejection and no automatic signing retries.
- NFT-T08 / NFT-PUBLISH-001 / NFT-SERVER-002: opaque intent commitment only;
  unpublished media, rights text and calldata are not submitted to this API.
- NFT-T09 / NFT-CLAIM-001: public transaction intent reconstruction plus exact
  receipt/event/immutable read-back; no client completion assertions. Status is
  an RPC-derived observation at a recorded block, never independent consensus,
  current token ownership, an active listing, or a royalty payment.
- NFT-T01: least-privilege RLS and immutable runtime audit operations. A database
  administrator can still change the database; this is not external tamper-proof
  logging. A hostile authorized client can misreport wallet rejection; the
  concurrency protections govern correct clients, not a malicious wallet.

A record with `state: verified` is historical block-scoped evidence, not a
permanent guarantee. Later actions must refresh it. Two confirmations are the
existing development default, not a selected mainnet finality policy. The
runtime codehash must originate in a reviewed deployment record. The API/RPC
trust boundary and unsupported Safe/7702 limitations remain explicit.

## Tests and handoff

Local Node 22.20.0: 62 contract/EVM tests, 222 auth/database records, lint and
TypeScript checks passed before publication. New coverage includes 11 shared
embedded/native PostgreSQL cases, six actual chain-plus-journal cases, and
three native multi-instance HTTP cases. The native cases must pass remote CI
with the existing restricted PostgreSQL role; local PGlite is not that evidence.
Original browser, actual Safe, real-validator and security-profile gates remain.
Final commit-specific CI and separate assistant security review are on the PR.

Primary interfaces: PostgreSQL 18 row security and transactions; ethers 6.17
provider/receipt interfaces; EIP-1193 rejection versus connectivity errors.
https://www.postgresql.org/docs/18/ddl-rowsecurity.html
https://docs.ethers.org/v6/api/providers/
https://eips.ethereum.org/EIPS/eip-1193

Next integration: connect this journal to the reviewed wallet/fee/simulation
screen, add explicit interrupted-wallet recovery UI, and exercise it through
actual browser/HTTP/database/local-contract tests. Production mint/list and the
independent pre-crypto review gate stay closed; no private keys or user funds
were used in testing.

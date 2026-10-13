# Wallet review and interrupted-mint recovery UI

PR #27 connects the durable journal from merged PR #26 to the responsive
`#/transactions` screen. This is direct-EOA local workflow acceptance, not a
mainnet release, live extension/hardware-wallet acceptance or an active listing.

## Delivered user flow

An authenticated account can list its wallet/network-specific journal, open an
operation, inspect saved transaction references and recorded block observations,
and refresh receipt verification. An owner can attach a matching transaction
hash recovered from wallet history. The server reconstructs the exact public
intent and verifies the receipt; a user-supplied hash never directly marks a
mint successful. Only unsent prepared operations can be cancelled.

New wallet requests are opt-in rehearsal only. `NFT_LOCAL_MINT_REHEARSAL=1`
requires a durable database, chain 31337, a loopback HTTP origin and loopback
HTTP server RPC, and refuses production mode. The browser independently requires
that local origin/network and an owner session. Other environments expose
recovery only, with no new signing controls. No mainnet/Sepolia send is enabled.

In rehearsal, import a public test JSON manifest (at most 2 MiB), select an exact
batch and inspect all immutable fields. A separate disclosure acknowledgment
precedes sending calldata to the selected wallet provider for simulation. The
client checks the reviewed collection runtime hash/minter, supply and closure,
then obtains gas, nonce and test-wallet balance. Gas has a 20% margin and a
12-million ceiling; price is capped at 1,000 gwei and total at 0.1 test ETH.
These are local test safeguards, not a production fee or finality policy.

The fee/nonce snapshot is validated, copied and frozen; it expires after two
minutes. A second acknowledgment authorizes one exact wallet request. Both
before and after atomic journal reservation, the client checks wallet/network
and pending nonce. It does not switch chains, approve an operator, send value
to the contract or retry a transaction automatically. Fee review is separate
from wallet sign-in, and a wallet may still reject or alter a request; receipt
verification detects mismatched executed calldata/value/sender afterward.

A definitive EIP-1193 4001 rejection returns the journal to prepared. Other
errors leave a non-resendable attention/reserved state. A returned hash that
could not be saved is displayed for manual recovery. A lost claim response
never triggers a wallet request. Reload/sign-out/network changes clear local
review state, not durable history. Inspect wallet activity after any ambiguous
outcome; cancelling a page request cannot cancel an already submitted chain
transaction. Transaction replacements and Safe/7702 sends remain unsupported.

## Security and privacy boundaries

The selected authenticated wallet provider is reused, not an arbitrary new
injected provider. Server APIs still require the existing session/origin/CSRF
and account/chain authorization. Before broadcast only intent commitments and
routing references reach the API; no draft/media/rights payload or key is saved.
No new encryption primitive, profile pin, production startup path or dependency
is introduced. The existing independent pre-crypto review remains pending.

The runtime code hash is supplied through the reviewed manifest and must have
an independently established deployment basis. RPC observations and the hosted
origin remain trusted; this flow is not a light client, independent consensus
proof, publishing/read-back verification or validator-policy approval. A
verified receipt is historical evidence at the recorded block, not current
ownership, irreversible finality, a royalty payment or an OpenSea order.

## Reproduction and evidence

The existing browser workflow compiles the actual collection before starting
its disposable local EVM, pinned Safe and restricted native PostgreSQL. A
separate test-only loopback bridge accepts only externally signed exact issued
fixture mints from known disposable accounts. It rejects browser-Origin
requests, unsigned/arbitrary transfers, signing/debug methods and nonlocal or
forked startup. The original authentication RPC remains read-only. Deterministic
wallet adapters sign real local transactions; they are not live extensions.
No user artwork, public-chain funds, private account keys or real orders are used.

Local pinned Node 22.20.0 results: 62 contract/EVM, 223 authentication/database,
86 UI/model and 8 data cases passed, plus lint/types/UI build. A separate local
controller/journal/contract round trip also passed. Remote acceptance must run
all original 72 browser cases plus 18 new viewport cases, covering mint/reload,
rejection, actual-broadcast/lost-response recovery, claim/save failure, network
changes, private-field rejection, feature gating and bridge denial. Screenshots
and axe checks cover the saved-receipt screen. Exact final run IDs, artifact
inspection and separate assistant security review are recorded on the PR.

Remaining full product gates include private drafting/recovery/storage,
publication/retrieval, validator configuration, Safe transactions, production
fee/finality policy, deployment UI, marketplace orders and production rehearsals.

## Implementation-head evidence

Head `3ffaef2c9a4a776c7dbc4c3ab3f71aceb955120f` passed core CI
38326874506, native PostgreSQL/Safe 38326874302 and browser 38326874317.
Artifact 11781173378 was downloaded and SHA-256 checked as
`a428b05a8dc3b1595bac90ac664cca167a74b82c3df6160e38b12fada4cef302`.
Its report records 90 expected, zero failed, skipped or flaky cases. Desktop
and mobile recovery screenshots were visually inspected. Final documentation
and screenshot-position changes rerun all checks; final head/run IDs and the
separate assistant review are on PR #27. None of this is an independent expert
security audit or a public-chain mint/listing.

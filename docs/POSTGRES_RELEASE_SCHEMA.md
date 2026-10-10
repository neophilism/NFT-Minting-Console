# PostgreSQL release schema — PR-07

This is the PostgreSQL/Neon data foundation required by development-plan section
3. It does not enable the prototype's plaintext upload route or implement draft
encryption, authentication, provider provisioning, or listing verification.
Independent review is pending. The schema's controls must not be represented as
proof that current application traffic is encrypted.

## Records and private/public boundaries

| Record | Stored values and invariant |
| --- | --- |
| Accounts | Wallet/chain identity needed for authentication; provisioned by a privileged identity path in PR-09. |
| Releases | Owner and lifecycle routing, opaque client ciphertext and nonce; titles, role defaults, rights text and draft settings stay inside that ciphertext. |
| Release permissions | Owner-maintained viewer/editor assignments; shared access remains denied until PR-09 supplies its authenticated RBAC implementation. |
| Assets | Opaque object ID, ciphertext manifest, nonce, ciphertext size and upload status; no filename, media type, plaintext hash or file key. |
| Editions | Release-bound asset assignment and encrypted attributes; published assignments cannot be rewritten. |
| Rights versions | Write-once encrypted document versions; exact public SHA-256 and IPFS URI can be bound once after explicit publication. |
| Publications | Intentionally public token title, exact hash/URI references and consent digest; immutable, isolated through composite foreign keys. |
| Deployment profiles | Public immutable constructor/economic/version/code commitments after confirmation; independent configuration for every release. |
| Transaction jobs | Release-local idempotency, opaque payloads and operational state; confirmation requires a transaction hash. |
| Deployments and tokens | Append-only public receipt/block/transaction references; one deployment per release and unique, supply-bounded token IDs. |
| Listings and observations | Immutable order/price terms and append-only observations; an active/sold observation requires API and chain verification declarations. |
| Activity | Routing event type plus encrypted detail; actor is the current account and history is append-only. |

Solidity uint256 values use exact decimal strings in TypeScript and an integral,
bounded PostgreSQL numeric domain. JavaScript `Number` conversion is prohibited
for supply, token IDs, prices and chain amounts. Hashes are exact 32-byte values;
the schema never sanitizes or normalizes legal text. PR-19 must calculate hashes
from the final legal bytes and PR-20 must retrieve and verify public content.

The database validates record structure and immutability. It cannot establish
that an opaque byte string was encrypted, that a claimed consent happened, that
a receipt is canonical, or that a listing is live. The authenticated publishing,
chain and marketplace services must independently establish those facts before
inserting evidence. RLS is not protection from a compromised database owner or
API process; client E2EE remains the confidentiality boundary.

## Migration and runtime access

Configure `DATABASE_URL` through the environment secret manager, then run
`npm run db:migrate` as the separate migration identity. Migrations apply under
one transaction and advisory lock, with exact SHA-256 history checks. Missing,
changed or inserted historical migrations fail closed. Failed DDL and migration
records roll back together. There is no destructive down-migration command;
rollbacks preserve evidence and use tested restores or a forward corrective
migration. Provider setup and a hosted restore drill belong to PR-32.

`nft_console_api` is a non-login role without administrator or RLS-bypass
privileges. A separate restricted runtime login may assume it; that login must
not own the schema or carry migration privileges. All 14 domain tables enable
and force RLS. Only the release owner has access in this foundation. Authentication
in PR-09 must validate the session and, on a checked-out connection, start a
transaction, `SET LOCAL ROLE nft_console_api`, and bind the validated account with
`set_config('nft_console.account_id', $1, true)`. Always commit/rollback and return
the connection. Never take that ID from an untrusted request field or retain it
across pooled requests. Missing identity yields no private rows. This setting is
a trusted server boundary, not an independently authenticated database token.

## Acceptance evidence and follow-up

`npm run test:data` runs actual PostgreSQL semantics through pinned PGlite 0.5.8,
with nonprivileged role/RLS exercises rather than mocked queries. Seven suites
cover atomic/checksum-bound migration, unauthenticated/cross-owner isolation,
cross-release foreign keys, write-once evidence and exact hashes, full uint256
precision, duplicate jobs/deployments, supply checks, actor spoofing and listing
state constraints. CI also retains the contract and real-validator gates.
PGlite establishes SQL behavior, not hosted Neon permissions, concurrent network
connections, TLS, backups or production availability; those require staging tests.

The previously merged SQLite PR-07 implementation conflicted with the approved
PostgreSQL architecture, exposed private draft names/media types/plaintext hashes
as schema columns, and used JavaScript numeric conversions that cannot preserve
uint256 values. This change replaces that unused SQLite repository and its
migrations/tests rather than maintaining two competing canonical models. No
application route consumed it and no hosted data migration is asserted. Existing
local experimental SQLite files are left untouched; importing any real records
requires separately validated, privacy-preserving migration work after review.
PostgreSQL is the canonical planned model. Its independent security review must
pass before PR-09 or PR-15 consumes this foundation.

# Release Data Model

PR-07 introduces a versioned SQLite schema and repository boundary for release
state. It uses Node's built-in SQLite driver, foreign keys and ordered,
checksum-verified migrations. No plaintext draft is written by the current
prototype; later E2EE work must persist ciphertext through this boundary.

Ownership starts at `releases.owner_wallet`. Every asset, edition, token,
rights version, transaction job, listing, deployment profile and activity event
is scoped by `release_id`. Composite foreign keys prevent a token from
referencing another release's edition or rights version. Identical token IDs and
edition keys remain valid in different releases.

SHA-256 values are stored as exact 64-character lowercase hexadecimal strings.
Rights versions, token publication records, deployment profiles and activity
events are append-only. Published asset hashes and URIs cannot be rewritten.
Corrections therefore require a new version or event instead of destroying
evidence.

The normalized tables are:

- `releases`: lifecycle, immutable collection inputs and owning wallet;
- `assets`: encrypted/private and explicitly published object references;
- `editions` and `token_records`: release-local editions and on-chain token evidence;
- `rights_versions`: exact legal byte hashes and optional immutable public URI;
- `transaction_jobs`: resumable deploy/policy/mint/list operations;
- `listings`: independently reconciled marketplace orders;
- `deployment_profiles`: factory, bytecode/config IDs and transaction receipts;
- `activity_log`: append-only actor/action evidence.

Set `DATA_DB_PATH` to choose the database file. The default is
`data/nft-console.sqlite`, which is excluded from source control. PR-09 will
add authenticated API access; PR-10 onward will add encrypted draft payloads.

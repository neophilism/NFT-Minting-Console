# Separate PR-09b assistant security review

2026-10-12. Reviewer: implementing assistant, in a separate review pass.
This is not an independent auditor, certification, or mainnet release approval.

Reviewed SQL access policies, definer-function privileges, runtime login checks,
transaction context, connection cleanup, realm policy changes, immutable audit,
strict envelopes, pagination, update idempotency and revocation behavior.
Production contracts, historical rights bytes and pinned dependencies remain
unchanged. No full-codebase review or real Safe-product test is claimed.

Findings addressed: role-map changes fail closed rather than silently weakening
running sessions; runtime credentials cannot inherit the migration role; URL
SSL switches cannot disable configured certificate verification; pooled account
context is transaction-local; logout cannot be undone by a racing touch; stale
draft writes cannot overwrite later revisions; and removed allowlisted wallets
remain revocable without recreating their account. The last issue has a dedicated
regression test and is covered by the added PostgreSQL integration suite.

Reviewed evidence: 86 current local control tests passed; 20 live SQL role/RLS
assertions passed on the isolated Neon branch. Real driver, HTTP, complete pinned
CI and Safe integration are not established by those counts. Added integration
tests must run without skipped checks before merge. Opaque envelope storage does
not establish E2EE, and normal hosted JavaScript retains origin trust.

Disposition: implementation submitted for complete verification; do not mark
NFT-09 accepted, merge failed/pending checks, enable mainnet, upload confidential
artwork, or skip independent cryptographic and marketplace rehearsal gates.

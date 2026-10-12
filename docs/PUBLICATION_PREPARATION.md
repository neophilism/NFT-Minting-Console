# Exact-byte rights and public-metadata preparation

2026-10-12. A dependency-safe client-only increment of NFT-14's public/private
boundary, with reusable preparation primitives for the later NFT-19/20 flow.
NFT-14 and NFT-19 remain partial. This does not complete dependent publishing,
private storage, compliance, collector registry, rights templates or minting.

## Delivered behavior

An authorized owner opens **New collection** and the **Rights & public metadata**
panel. Choose a nonempty UTF-8 `.txt`/`.md` or PDF, up to 8 MiB. The client hashes
the original bytes with SHA-256, including BOM, CR/LF, whitespace and final LF.
Text preview is inert React text and capped at 8,192 characters. A PDF header
check is not a PDF parser, malware scan or legal review; PDFs are never embedded.
The public frozen rights file has a regression assertion for its exact digest.

Enter intentionally public name, description, image URI, rights URI and media
digest; choose **collection** or **token** rights scope explicitly. Video/audio
requires a separate poster URI (the image field) and poster digest. Review the
full rights file and public-data acknowledgment, then prepare an immutable JSON
snapshot. Downloading is a separate, explicit local action. Every field edit or
rights replacement invalidates both snapshot and acknowledgment. File reads
are generation-bound and aborted/discarded on replacement, clear and unmount.
All planner state remounts when wallet, chain or session identity changes.

The pure metadata API supports bounded public traits. The current panel does
not expose a trait editor. Allowlisted fields reject unknown keys at the root,
properties and trait levels, prototypes/accessors, sparse arrays, unsupported
numbers, bad digests, malformed Unicode and oversized metadata. Free text can
still contain personal information: there is no claim of semantic PII detection.
The user must review it. No collector contacts, eligibility registry or default
membership/investment terms are inserted into metadata.

## Deliberately limited URI support

Only `ipfs://` with CIDv0 SHA-256/dag-pb or canonical lowercase base32 CIDv1
SHA-256/raw or dag-pb is accepted. Paths reject traversal, invalid UTF-8,
encoded separators, query/fragment and double decoding. Mutable HTTP/IPNS,
credential-bearing links and active-content schemes are rejected. This is a
bounded syntax validator, not a general CID implementation or network verifier.

Media digests and content locations are supplied by the user. The panel never
fetches a gateway, authenticates remote bytes or proves the rights URI refers
to the reviewed file. A CID may identify a DAG and is not generally the original
file's SHA-256. These distinct checks must be added to the eventual NFT-13/20
publication/read-back path before production use.

Primary references used for this public-data schema (checked 2026-10-12):
- https://specs.ipfs.tech/cid/
- https://docs.ipfs.tech/concepts/content-addressing/
- https://docs.opensea.io/docs/metadata-standards

## Security and privacy scope

This addresses the existing threat model's accidental publication and active
rights-content cases by making the public projection explicit, rendering text
without HTML, not contacting supplied URLs and not serializing private fields.
The privacy inventory's rights, NFT metadata and collector-personal-data rows
apply. There is no new server route, persisted plaintext, log payload, telemetry,
key store, identity flow, dependency or encryption primitive. The existing
E2EESA source/profile pins and independent pre-crypto review gate are unchanged.
SHA-256 here is public content integrity, not private draft encryption.

Use only test or already-public documents until private-workspace acceptance.
The hosted page's origin and endpoint remain trusted; page-memory clearing is
not forensic zeroization. Previously downloaded files remain on the user's
device. This increment does not grant legal rights or certify compliance.
Authentication does not authorize asset transfers. No public publish, mint,
listing, production mode or deployment gate is enabled.

## Verification and handoff

Local pinned Node 22.20.0 results before browser CI: 69 UI/model tests, 40
contract tests using the verified compiled baseline, 8 data tests and 211
authentication tests passed; lint, application/test types, syntax checks and
UI build passed. Compiler/dependency audit, real-validator, actual Safe, native
PostgreSQL and the full desktop/mobile browser suite must pass remote CI on the
published PR head before merge. Final run IDs and separate assistant security
review are recorded on the PR, not inferred from this local result.

`test-ui/publication.test.ts` covers exact bytes, the original rights hash,
invalid inputs, copy/abort behavior, strict schema, CID/path cases and stable
serialization. Seven additional browser cases on each viewport cover exact
export without upload/signing, acknowledgment invalidation, PDF non-rendering,
active text escaping, clear/navigation/reload, sign-out and slow-file races.
Prepared-state accessibility is checked without suppressing axe rules; CI saves
both viewport screenshots. Runtime readiness now excludes already accepted
NFT-09/15 from outstanding groups while retaining six actual release groups.

Next: the approved private-workspace, recovery and encrypted-storage work;
complete public-media manifests, rights templates and legal checkpoints; actual
publication/retrieval verification; and gated deployment/mint/order workflows.
No independent expert or marketplace/mainnet acceptance is claimed here.

# Client release envelope (NFT-10)

`console/crypto/workspace.mjs` seals a small private release JSON document before
it reaches the existing opaque `/api/releases` storage API. The returned object
contains only `id`, base64 `ciphertext`, and base64 `nonce`, matching the API's
create shape. The server does not receive the plaintext or wrapping key.

Each seal generates a fresh 256-bit content key, a random 96-bit AES-GCM content
nonce and a separate random 96-bit AES-GCM key-wrap nonce. The 256-bit wrapping
key is supplied by an authorized client, is non-extractable, and never appears
in the envelope. Both authenticated operations bind the release ID and distinct
domain strings as additional authenticated data. The versioned binary envelope
holds only a wrapped content key and encrypted draft bytes. Opening rejects
wrong keys, release substitutions, modified ciphertext and nonces.
Draft JSON validation rejects accessors, functions, non-finite numbers,
prototype-sensitive names, sparse arrays and over-deep trees before sealing,
so a save cannot silently drop fields or produce an unusable record.

This is a **client primitive, not an enabled private workspace**. A generated
wrapping key is ephemeral unless explicitly stored by
`local-key-store.mjs` in this browser's IndexedDB. The store refuses to
silently replace a missing key when opening a record and separates keys by
wallet and chain. It is a single-browser building block, not proof of device
authorization or recoverability. The product must not turn on Save private release
until NFT-11 provides authenticated device enrollment, authorized key
transfer and recovery, and NFT-12 provides the full private object lifecycle.
Wallet login authenticates an account but does not establish an encryption key
or authorize a device. A compromised code-serving origin or client can still
read the draft. Server-side revision/CAS controls must be checked separately;
the envelope does not prevent a compromised server replaying an older record.

The record is limited to 24 KiB of plaintext and the API's 32 KiB ciphertext
cap. Files use `console/crypto/attachments.mjs`, whose private manifest must
remain within an authenticated encrypted draft; it must not be placed in API
metadata. Larger drafts and resumable ciphertext objects belong to NFT-12.

`console/crypto/draft-api.mjs` connects the client envelope to the existing
authenticated release API. It sends only the three opaque fields, checks that
the create response echoes the exact encrypted record, and decrypts a GET
response only for the expected release ID. The request callback must be the
same-origin authenticated API transport. UI exposure remains disabled until
the device key lifecycle is implemented and reviewed. Edits reseal with a
fresh content key and nonces, send the server's compare-and-swap revision,
and accept only an echoed encrypted record at exactly the next revision.

Verification: `node --test test-crypto/workspace.test.mjs
test-crypto/draft-api.test.mjs` covers round-trip,
freshness, server-visible field minimization, wrong-key and substitution
failure, tampering, invalid base64 and extractable-key rejection. The existing
browser CI command picks up `workspace.browser.mjs` for actual Chromium
WebCrypto verification. `draft-attachment.integration.test.mjs` exercises a
synthetic untrusted server that receives only encrypted release metadata and
attachment chunks, then verifies authorized recovery and wrong-key/missing-
chunk failure. A deployed API/object-store server-compromise exercise and
cross-device acceptance remain pending. `local-key-store.browser.mjs` checks
Chromium IndexedDB persistence across a page reload and account separation.

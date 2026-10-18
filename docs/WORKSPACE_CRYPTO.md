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

This is a **client primitive, not an enabled private workspace**. A generated
wrapping key is ephemeral. The product must not turn on Save private release
until NFT-11 provides authenticated device enrollment, key persistence,
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
the device key lifecycle is implemented and reviewed.

Verification: `node --test test-crypto/workspace.test.mjs
test-crypto/draft-api.test.mjs` covers round-trip,
freshness, server-visible field minimization, wrong-key and substitution
failure, tampering, invalid base64 and extractable-key rejection. The existing
browser CI command picks up `workspace.browser.mjs` for actual Chromium
WebCrypto verification. End-to-end server-compromise and cross-device
acceptance remain pending.

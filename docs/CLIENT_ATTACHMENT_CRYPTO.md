# Client attachment cryptography — NFT-10 implementation increment

The browser-compatible module `console/crypto/attachments.mjs` now encrypts and
verifies immutable Blob/File inputs using WebCrypto AES-256-GCM and streaming
SHA-256. It has no HTTP client, database, wallet, storage or logging integration.
This is the file-encryption primitive, **not a complete private workspace**.
No production or private-draft feature flag is enabled by this change.

## Exact-source basis and AI security review

Source: `spec/attachments-file-encryption.md` at E2EESA commit
`2883c792a766ae6ca860abb6fbe8b1654ba9d7de`, pinned in `security/e2eesa.lock.json`.
The source SHA-256 is
`ecfe6fc9c193660a8ff1e218688b8fd024b5600134032e7d20a029e5974e44d8`.
Review followed the owner-authorized process in AGENTS.md. Independent external
review remains pending; this is neither certification nor full profile conformance.

| Requirement | Implementation / evidence | Remaining integration |
| --- | --- | --- |
| Fresh per-attachment 256-bit key | CSPRNG; identical-file/derivative independence test | Fresh invocation for every new share/derivative |
| Bound private manifest | Strict fields; sorted UTF-8 JSON; normative digest domain; independent OpenSSL digest check | Authenticated E2EE parent delivery |
| Chunks and empty file | 64 KiB–8 MiB; exact count/last length; empty file has one GCM tag | Resumable ciphertext store |
| Nonces and AAD | Random four-byte prefix plus uint64 big-endian index; attachment/digest/index/count/length bound; 128-bit tags | None for format primitive |
| No nonce reuse | Single-use encrypt capability; simultaneous, retry, sink failure and cancellation tests | Retransmit stored ciphertext; never re-encrypt a failed job with the old key |
| Integrity and truncation | AEAD before callback; exact lengths/positions; completed SHA-256; corruption/substitution/reordering/missing-data tests | Transactional temporary sink commits only after wholeFileVerified |
| Bounded memory | Two sequential passes; incremental hash; one chunk at a time; 64 MiB fixture with 8 MiB chunks | Gigabyte-class browser/storage acceptance remains pending |
| Key/metadata confidentiality | Ciphertext sink receives only index and encrypted bytes; private manifest separate; no network API | Account roots, current device authorization, MLS/key wrapping, vault and recovery |
| No automatic history/recall promise | No recipient or sharing operation exists in this module | Device removal and sharing controls in NFT-11 |

Review checked manifest substitution, nonce reuse, malicious chunk sources,
async caller mutation, chunk-authentication ordering, whole-file completeness,
and bounded processing. Native Blob access ignores subclass substitutions between
hash and encryption passes. Public APIs copy the input manifest and ciphertext
before asynchronous work. Imported WebCrypto keys are non-extractable; temporary
raw key/plaintext buffers are wiped on success/failure where possible.

JavaScript cannot guarantee erasure of all engine copies. The private manifest
intentionally holds the key and must remain on authorized endpoints. A malicious
served application, extension or compromised endpoint can read plaintext/keys;
this component does not solve malicious-origin or endpoint trust.

## Correct integration

1. Prepare an immutable Blob with the authorized parent-message ID and private
   filename/media type. Keep `privateManifest` client-side.
2. Call `encryptTo` once. The callback receives `(index, ciphertext)` and applies
   backpressure. The separate storage routing ID may be used; never put the
   manifest, filename, media type, plaintext hash or key in storage metadata.
3. Deliver the private manifest **only within the approved authenticated E2EE
   parent message** to currently authorized devices. A manifest digest is not
   sender authentication. Wallet login is not device/key authorization.
4. Open only an authenticated manifest with the expected parent-message ID.
   `decryptChunk` authenticates a range but does not verify the whole file.
5. `decryptTo` authenticates each chunk before the callback and verifies the
   complete hash before returning `wholeFileVerified: true`. Use a quarantined,
   temporary output; discard it on any error, including final hash mismatch.
   The plaintext callback buffer is wiped after it resolves: copy data if it
   must survive, and do not render/commit the complete file before final success.
6. Cancellation/failure consumes the encrypt capability. Resume by retransmitting
   already-stored ciphertext. Restart encryption with a new prepared attachment.

The 1 TiB input ceiling is a validation bound, not a tested product upload limit.
Loss of ciphertext or keys can prevent recovery. Deletion cannot recall copies
already received by another authorized endpoint.

## Verification

Pinned runtime: Node 22.20.0 / npm 10.9.3. `npm run test:crypto` executes 19 cases
including independent OpenSSL interoperability and a 64 MiB bounded fixture.
The new `test:crypto:browser` runs the bundled module in actual Chromium with
WebCrypto and rejects remote network requests. Both CI providers enforce it in
their browser jobs after installing the pinned browser.

Local unit tests passed. Local pinned Chromium installation was unavailable
(download returned a truncated archive), so browser acceptance must come from
CI; it is not claimed from Node WebCrypto. See the PR checks for final-head CI.

`@noble/hashes@1.3.2` is now an explicit production dependency for incremental
SHA-256. This exact version/integrity was already in the locked production graph;
no new package tarball, runtime version or unpinned dependency is introduced.

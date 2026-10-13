# Exact public-file verification

`npm run public:verify -- public-manifest.json [pinata|ipfs|dweb]` reads files that
have already been intentionally made public and compares each complete byte
stream to its independently reviewed SHA-256 and exact size. It never publishes,
signs, pins, mints, stores a draft or creates a listing.

The input is version 1, has `publicDisclosureConfirmed: true`, and contains a
`files` array of one to four entries. Each entry contains only `kind` (`metadata`,
`rights`, `image` or `media`), immutable `ipfs://` `uri`, lowercase 64-character
`sha256` and integer `byteLength`. Kinds cannot repeat. Obtain digests from the
reviewed original files, not from the same gateway being checked. Never put
unpublished identifiers or private content in this manifest: requesting a CID
reveals it to the gateway and may cause the gateway to retrieve that content.

Limits are 128 KiB metadata, 8 MiB rights, 32 MiB image and 2 GiB media. The
verifier hashes streaming chunks and keeps only the current chunk and hash state,
with a 60-second total default deadline. The reusable API supports a bounded
longer deadline. It returns a successful immutable report only after every file
matches. A failed final file cannot create a partially successful release report.

Only three fixed HTTPS gateways are selectable. Redirects, partial responses,
compressed responses, malformed paths, URL queries, IPNS, length/digest mismatch,
rate limits and cancellation fail closed. No credentials, arbitrary endpoints,
headers, POSTs or automatic retries are accepted. Error messages omit remote
response bodies. Frontend preparation and server verification share the same URI
parser, avoiding different interpretations of an immutable content path.

## Verification and limits

`npm run test:publication` covers exact BOM/CRLF bytes, pre-network validation,
manifest mutation, same-size corruptions, partial/oversized/stalled downloads,
credential-bearing/unsafe URLs, all-file completion, 64 MiB streamed media and a
real disposable local HTTP transport. `npm run test:ui:model` retains the existing
public preparation regression coverage. Both CI providers run the new suite.

This verifies bytes against reviewed commitments. It does not verify UnixFS/DAG
membership using CAR proofs, independent gateway operators, durable pin retention,
legal approval, malware safety, encryption, on-chain values or an active listing.
Those claims remain false in the report. A gateway can withhold data and a future
retrieval can fail; an observation is not an availability promise.

AI source review checked URL construction/redirect refusal, caller-mutation
isolation, stream bounds, timeout/cancellation, exact legal bytes and absence of
upload/signing authority. External audit is deferred under the owner's October 13
instruction; it does not block this implementation. This does not mark external
review complete or change the application's currently unfinished production path.

Relevant upstream specifications:
- https://docs.ipfs.tech/quickstart/retrieve/
- https://specs.ipfs.tech/http-gateways/path-gateway/

The browser review/publish wizard still needs to integrate this component with
its reviewed snapshot and durable operation state. The CLI is a reproducible
component tool, not a claim of completion of NFT-13/19/20/25.

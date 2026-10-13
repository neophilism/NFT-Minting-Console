# NFT-13: Explicit public IPFS upload operator tool

The command public:pin uploads one **already-approved, intentionally public** file through Pinata V3 and verifies every byte retrieved from an independent public gateway against the **reviewed original SHA-256**. It is usable independently of the unfinished web wizard. It **does not** enable production server startup, save encrypted drafts, deploy contracts, mint NFTs, or list on OpenSea.

## Using the command

1. Obtain a Pinata JWT for public-file upload, with quota/permissions appropriate to the artwork. Keep PINATA_JWT in a private environment, never in Git, a chat, log or PR.
2. Finalize the exact bytes of the file. Compute SHA-256 using a separate tool: on macOS run shasum -a 256 FILE, or on Linux run sha256sum FILE.
3. Privately review that this **exact file** may be irrevocably public on IPFS. Then invoke:

    npm run public:pin -- rights ./FINAL_RIGHTS.md REVIEWED_64_CHAR_SHA256 --public-disclosure-confirmed

Use metadata, rights, image or media for the first argument. Upload rights and images/media before composing metadata; metadata must refer to their returned immutable IPFS URIs and exact reviewed SHA-256 digests. Publish metadata last, and copy verified exact URI/digests into the mint manifest.

A successful command prints a structured public manifest with exactBytesVerified:true and mintAuthorized:false. Keep this alongside your approved releases. If Pinata accepted a file but gateway retrieval fails, the command reports a public CID and nonzero exit status. It **never resends automatically**. Use the existing public:verify command to try readback of that CID using your saved independently reviewed byte count and digest.

File limits: metadata <=128 KiB; rights <=8 MiB; image <=32 MiB; media <=2 GiB. Pinata account upload/gateway plan limits may be lower. Video files are streamed via Node file-backed Blob; the entire video is not buffered. Pinata creates UnixFS CID values that must not be confused with original file SHA-256; the independent gateway readback provides the actual check.

## Boundaries and security

No upload happens before a matching local file SHA-256 and an explicit --public-disclosure-confirmed acknowledgement. Public network=public and CID version=v1 are fixed; upload URL is pinned to HTTPS uploads.pinata.cloud. Remote response is bounded to 16 KiB. Redirects, malformed CIDs, mismatched sizes and unexpected network values fail closed. No automatic retry, and API errors never contain a JWT. A gateway error after a successful upload does not roll back public disclosure.

This is an operator-side first step, not a replacement for client-encrypted private drafts, saved release workflows, or the full publication + mint approval checks. Production readiness remains false.

Reference: https://docs.pinata.cloud/api-reference/endpoint/upload-a-file
See also: docs/PUBLIC_FILE_VERIFICATION.md

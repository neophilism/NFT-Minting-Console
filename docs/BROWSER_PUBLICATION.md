# Public browser publication, cost review and mint handoff

This increment implements the public-only file publication path in Deploy & mint. It is not private encrypted draft storage, legal approval, a marketplace listing, or full 36-work-package completion. Development labeling stays until its actual release criteria are met.

## User workflow

Enter the token ID, title, description and token/collection rights scope. Select the final artwork image or poster, final rights document and optional video/audio. The browser hashes the exact original files locally. Review the originals and public disclosure, then save immutable public commitments in the account-scoped database. No files upload merely because they were selected or the plan was saved.

Use each Publish and verify button to explicitly publish that file. The backend saves an upload attempt before requesting a short-lived Pinata capability; the browser uploads directly to Pinata without ever receiving PINATA_JWT. The server records the returned CID and independently retrieves exact bytes from an allowlisted HTTPS gateway, checking SHA-256 and length. A returned CID alone is never a verified result.

After artwork and rights verify, generate canonical metadata, review its JSON, and explicitly publish/verify that metadata too. Use verified NFT for cost review and minting hands the exact validated mint bundle into the existing total-cost and wallet flow, with no CLI/download/import step required. Repeat for additional works; cost review includes the whole selection, and mint batches are selected in groups of at most ten. Existing CLI bundles still work.

## Recovery and persistence

Saved public work commitments survive browser reload and server restart. File bytes remain on the user's device or on public IPFS, not in browser localStorage or a private server draft cache. On reload, select saved work and reselect matching local originals only for files not yet published. Changed bytes/names/MIME/length do not replace the saved commitments; create another reviewed public work instead.

An interrupted upload is not silently retried. Record/recover its CID from Pinata and verify existing bytes without uploading again. A new upload after uncertainty requires an explicit duplicate-allowance acknowledgment and expiration of the earlier five-minute capability. Capability validity is tied to the saved attempt time, so a slow authorization response cannot extend beyond the retry window. At most twenty authorizations are permitted per file. Signed URLs are not claimed to be hash-bound or single-use by Pinata; server readback enforces the independent exact-byte commitment before minting.

## Boundaries

Public metadata and file commitments are explicitly approved plaintext public data. Pinata subscriptions/allowances can be consumed before the chain quote; unknown provider fees are excluded, never silently called zero. New-collection network estimates require supported sequential RPC simulation; unavailable quotes do not authorize a transaction. Every paid transaction still has independent wallet review and a user signature.

Limits: image32MiB, rights8MiB, optional video/audio2GiB, metadata128KiB; provider limits may be lower. Large resumable transfer and encrypted private workflows remain separate unfinished milestones. Secrets and signed upload capabilities are not saved to the workbench, emitted in errors or logged. Only fixed Pinata upload/gateway origins are used, with redirects refused. Strict owner authorization/origin/CSRF remains in place. Database RLS is forced, plans and verified file records are immutable, repeat plan submission is idempotent, and one account holds at most1000 saved public works.

## Operations and evidence

Apply only forward migration007_publication_workbench.sql in a separate operator environment. When enabled, runtime startup checks the workbench tables using the restricted application role. Existing installations without a public launch or Pinata credential leave this feature disabled. The account JWT needs Files Write (org:files:write); groups/gateway administration is not needed. Provider reference: PinataCloud/pinata commit66767703e54c5d5261e9d33235a2c92f95cf87d9, src/core/functions/uploads/createSignedUploadURL.ts, and the official create-signed-upload-url endpoint documentation. No third-party upload SDK is added.

Tests: strict plan/capability/schema checks, actual PostgreSQL-engine storage/HTTP readback, altered-byte rejection, account isolation, immutable records and no blind resend. The browser acceptance fixture sends real multipart browser bytes to a local synthetic provider, loses the first upload reply deliberately, reloads, recovers without another upload, publishes rights/metadata, hands off to cost review, and signs/verifies a real local-EVM deployment/mint. Provider simulation is explicitly synthetic; this does not prove live Pinata credentials or use real artwork/funds. Exact-head CI results are recorded in the PR after execution, not presumed here.

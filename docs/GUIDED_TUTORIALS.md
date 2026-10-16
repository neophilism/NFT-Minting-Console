# Guided tutorials and reusable configurations

PR #52 implements an always-available **Help & tutorials** layer and explicit non-confidential configuration presets. No third-party tutorial service, tracking SDK, additional dependency, API key or separate documentation host is needed for the tutorial UI. Provider account creation, secret entry, the current public publisher and user wallet approval remain external operations; this is not a claim that all platform workflows are complete.

## Tutorial catalog

1. Administrator Setup: public roles, RPC, restricted database, publication credentials, Render environment and read-only readiness checks.
2. Connect Wallet: network, sign-in message, troubleshooting and sign-out.
3. Create a Collection: identity, supply, royalties, roles and review.
4. Save, Load and Edit Configurations: named copies, backups, imports and deployment reuse.
5. Artwork, Rights and Metadata: final bytes, scope and public metadata review.
6. Androids Of The Vine Companion Materials: optional two-project portfolios and final rights requirements.
7. Publish Files and Prepare a Mint Bundle: the current operations CLI, explicit public review and uncertain-upload recovery.
8. Deploy a Collection: generated constructor, fee review, explicit wallet signature and receipt verification.
9. Mint NFTs and Add Later Batches: verified collection, exact bundles and continued use of the same address.
10. Verify and Recover Transactions: durable history, missing hashes, finalized cancellation evidence and no blind re-send.
11. Marketplace Handoff: minted versus listed and the remaining validator/listing flow.
12. Workspace Status and Troubleshooting: configuration versus live evidence and safe problem reports.

Each guide has Back/Next, an explicit screen-opening button, relevant-control highlighting, missing-prerequisite guidance, Escape/Close and local progress/resume. Reading completion never changes operational readiness. Screen navigation asks before discarding current unsaved page data. The guide itself never clicks application action buttons, calls a wallet, changes a network, uploads a file, prepares a transaction or spends funds. The catalog is accessible before sign-in. Its configuration snapshot contains only public flags and explicitly is not a network/credential test.

## Presets

The same Saved configurations component appears in Collection setup and Deploy & mint. Saving is explicit, requires a name and an unencrypted-storage acknowledgment, and creates a new version-1 UUID copy. The library is scoped by browser origin, public signed-in wallet and network. A loaded preset is an editable copy; it does not alter the original preset or any deployed contract. The existing pinned deployment generator receives the chosen constructor values only when the owner separately approves public disclosure and prepares a new deployment.

Allowed data: name, symbol, maximum supply, public owner/minter/royalty addresses, royalty basis points and optional exact ETH listing preference. No artwork, rights, credentials, signatures, approvals, calldata or transaction hashes are accepted. Files are bounded to 128 KiB; at most 50 presets are retained per scoped library. Unknown fields, invalid numbers/addresses, wrong versions/networks, duplicate stored identities and corrupt storage fail closed. Storage failure is not reported as success.

Presets are **not encrypted private drafts, cloud backup or cross-device sync**. Browser data survives sign-out and is readable to someone with access to that browser profile. Use only non-confidential settings, export JSON for backup or another device, and delete unwanted local presets explicitly. Imported JSON is validated before a replacement confirmation; it is not persisted until the user saves a new copy. Clearing browser data can remove presets and tutorial progress but cannot alter on-chain contracts. Concurrent browser windows are not an atomic cross-device storage system.

For later NFTs in the same collection, select its already-verified deployment. For a new independent collection, load the old preset, change the desired parameters, save a new copy, and prepare a new deployment. A listing-price preference creates no marketplace order. Deployed immutable parameters cannot be rewritten by loading a preset.

## Scope and roadmap mapping

This contributes to NFT-15 (guidance UI), NFT-16 (public reusable settings), NFT-17 (constructor configuration reuse), and operational documentation. It does not complete encrypted-release acceptance for NFT-16, the complete GUI publication flow or full production rollout. External human review remains deferred under AGENTS.md; real defects and failed checks still block merge.

## Verification

`test-ui/guidance.test.ts` checks exact conversion, schema/privacy exclusions, bounds, wallet/network separation, corrupt storage, copy independence, tutorial routing and bounded progress. `test-ui/guidance.spec.ts` runs desktop/mobile catalog and guide accessibility, resume, navigation cancellation, save/reload/copy/export, invalid imports, and preset-to-real-local-EVM deployment preparation without wallet transaction broadcast. Existing actual deployment/mint/cancellation browser tests remain in force. CI conclusions must be checked for the exact PR head; this document is not evidence of a live mint.

Run `npm run lint`, `npm run typecheck:ui`, `npm run test:ui:model`, `npm run build`, then `npm run test:ui:browser`. Full repository CI, real-validator and native-runtime suites remain required. Fixtures use synthetic disposable local wallets, never owner funds.

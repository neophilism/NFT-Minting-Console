# NFT Console development progress

Source of truth: docs/DEVELOPMENT_PLAN.md, registry/prs.json, exact-head PR checks and deployment evidence. A merged contribution is not automatic completion of its entire roadmap work package.

## Current browser completion work - 2026-10-16

PR #52 implemented guided tutorials and explicit browser-local public presets. PR #53 implemented pre-mint total-cost review, with genuine sequential simulation tested on a pinned private Geth chain. Both are merged. Production baseline and authorization migrations001-005 were applied and verified; this does not prove the app uses that database.

PR #54 implemented secure browser administrator enrollment using a hosting setup code plus a domain/chain/purpose-bound EOA wallet proof. Claims are durable and single-winner; rotation or network changes do not reopen setup. It merged as `0df2da39642eab5c88517ed70cb309aa33e65cbc`, with112 browser checks passing, and was deployed to the existing NFT Console service. Production migration006 was checksum-verified and applied. No user administrator was invented or registered by a developer fixture.

PR #55 integrates public browser artwork/rights/media publication, exact original hashes, durable work/attempt history, short-lived public upload permissions without exposing the Pinata JWT, independent public readback, metadata generation and direct total-cost/mint handoff. Additive migration007 is required before enabling the feature. Required exact-head checks and deployment are recorded in the PR; do not assume a draft implementation has passed.

Review found and corrected an incomplete IPFS type declaration, configuration-model expectations, a recovery-refresh selection race, missing selected-history options and a regression in the synthetic mint fixture. Existing strict signed-fixture checks and manifest issuance were restored instead of deleting their tests. Saved public responses are now independently schema/identity/descriptor/hash checked by the client. Mobile pointer/layout acceptance remains required, including continued user pinch zoom.

## Next execution order

Finish and verify PR55, reconcile the current guides/runbooks, apply only the new checksum-bound migration007, then deploy the exact accepted commit. Do not rerun first-time production initialization or edit historical migration bytes. Complete actual runtime/secret wiring only through authorized tools or the owner's provider interface; do not bypass a denied environment action. Verify the live setup/configuration status and provider capabilities without exposing credentials.

The broad plan still includes unfinished private E2EE drafting and key recovery/sharing, large resumable encrypted storage, Safe/delegated transaction flows, automated validator-policy provisioning, and complete marketplace signing/submission/listing verification. The public browser increment does not complete those packages. Do not remove development labeling merely because a public subset deploys, an environment flag changes, or a tutorial is marked read.

## Evidence and limits

Use docs/BROWSER_COMPLETION_PLAN.md, docs/BROWSER_INSTALLATION.md, docs/BROWSER_PUBLICATION.md, docs/PRE_MINT_COST_REVIEW.md and docs/PRODUCTION_DATABASE_20261016.md for the current implementation boundaries. Historical journal, rights and UI acceptance documents remain useful only for their dated scopes. No user funds, real private artwork or wallet signing keys are test inputs. A mint is not a listing, a URL is not an active order, and implementing-agent review is not an independent audit or certification. The owner's external-review deferral in AGENTS.md remains in force.

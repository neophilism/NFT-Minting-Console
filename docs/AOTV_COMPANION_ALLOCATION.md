# Androids Of The Vine — optional token-specific Companion Portfolio (40 × 2)

**2026-10-13 implementation scope: DRAFT/PREVIEW ONLY. No funds, mint, listing, publication or legally approved companion rights are produced.**

## The creator's decision

- The forty Androids Of The Vine NFTs may each **optionally** include two specific, finite packages of information about other work by the creator. An NFT with the feature disabled carries no such extra rights.
- The intended full-series arrangement uses **40 distinct projects**, **two projects per selected NFT**, **80 assignments**, each project **exactly twice**, and 40 unique project pairs. The deterministic circular order assigns Token #001 Projects 01+02, #002 Projects 02+03, ... #040 Projects 40+01.
- The user controls the 40 project titles and ordering; names 03–40 in the example catalog are merely placeholders. The provisional Token #001 projects are Unsealed Records Music Playlist and Live Debate Engine. Music Analyzer was withdrawn and is not included.
- Projects may include nonprofits, idea-stage creative concepts, music, art, software and businesses. **Nothing is identified as an investment opportunity, offered for investment or assigned investment rights.** These are informational/creative bonus packages; project selection has no financing significance.
- One fixed, full **Schedule A per opted-in token**, included inside that token's final rights artifact, with exact material names, immutable versions and SHA-256, one-time delivery methods and controlling IP/master/composition/software permissions. No ongoing support, business launch, evolving codebase, future media, streaming service, investment access or return is promised.
- The bonus is personal to the **Original Purchaser**, not newly granted on resale; the commercial artwork license and Section 5 future-collector NFT reservation remain separate and unchanged.

## Actual implementation and deliberate limits

The generic UI's **New collection → Companion project materials** panel is opt-in **off by default**, memory-only and generates downloadable JSON/Markdown **drafts**. It can target all 40 token IDs or a comma-separated subset. If some tokens opt out, the strict twice-per-project balance necessarily fails: the display reports this accurately rather than misrepresenting equality. No additional terms are silently inserted in the NFT metadata, rights bytes, on-chain contract, or other collections.

For a local draft using the stored example catalog:

\`\`\`sh
# Work on a local copy, never commit secret or unreleased source/materials to GitHub.
# Edit the catalog: replace placeholders and fill in exact fixed files, hashes and license/delivery descriptions.
# Change "enabled": false to true and optionally set "enabledTokenIds".
npm run companion:aotv:generate -- releases/androids-of-the-vine/companion/PROJECT_CATALOG_TEMPLATE.json ./aotv-companion-drafts
\`\`\`

The generator uses exclusive-create semantics for output so it will not silently overwrite drafts or replace signed-off packages. Generate into a new empty output directory after each change; the output contains **DRAFT ONLY** markings. If disabled, it emits a no-benefit manifest and no schedules. **Never publish this provisional catalog or generated schedule as finalized token rights.**

## What must happen before any real sale or mint

1. Creator supplies, curates and approves all 40 project titles and which NFT tokens opt in; choose the materials for each project. A project may recur on two tokens, but each token's content may be a different fixed version only when expressly identified.
2. Review exact bytes and public-disclosure sensitivity of all selected files. Never publish unreviewed private source code, credentials, third-party music masters, subscriber records or confidential business documentation; obtain needed permissions.
3. Complete each opted-in token's exact Schedule A; for opted-out tokens create an unambiguous **no-companion** rights version. Incorporate each Schedule A into that token's **own** final rights agreement and compute its new SHA-256 **after** all text and files are approved. Token media, title, artwork and digests are distinct token-specific data.
4. Qualified securities/IP counsel reviews the full offering, including the separate Section 5 collector benefits, rather than assuming optional information makes classification automatic. Promotional descriptions must not promise company access, project financing or financial returns.
5. Pin finalized rights, metadata, approved media and other public artifacts with explicit declassification and independently retrieve/verify their exact bytes. The current console cannot yet perform these production flows.
6. Complete gated client encryption, private storage/recovery, publish/read-back, validator/SignedZone configuration, actual wallet & Safe rehearsal, contract security assessment, signed minting, verified Seaport order creation, and disposable mainnet OpenSea sale/royalty rehearsal. Use the [approved work-package plan](DEVELOPMENT_PLAN.md) and [current readiness UI](../console/ui/src/ReleaseReadiness.tsx); do not disable production failsafes.
7. Track Original Purchaser delivery separately from transferrable NFT ownership. Never expose private collector personal data in public token metadata.

**Security invariant:** Optional content assignment never authorizes wallet transactions and is NOT evidence that content exists, was licensed, reviewed, encrypted, pinned, delivered, minted, listed, or bought.

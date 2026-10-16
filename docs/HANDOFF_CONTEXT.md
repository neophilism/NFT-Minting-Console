> **Current owner review policy:** [AGENTS.md](../AGENTS.md) and [security/review-policy.json](../security/review-policy.json) authorize AI source/security review and applicable passing tests for implementation, merge and deployment. Independent human review is deferred follow-up, with no claim that AI review is independent certification. Concrete defects, missing functionality/credentials and actual wallet approvals still apply.

# NFT Console — Recovered Product Decisions and Handoff Context

**Read this after [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md), before editing the code.**  
**Status:** Source-grounded context recovered from the original NFT project and later NFT Console discussions through 2026-10-10. This file documents **decisions and intent**, not completed implementations or a legal/security certification.  
**Product repository:** https://github.com/neophilism/NFT-Minting-Console  
**Normative security reference:** https://github.com/neophilism/End-To-End-Everywhere-Security-Architecture-Standard


> **LATER USER DIRECTIVE (2026-10-12) — CURRENT TOKEN #1 RIGHTS INTENT.** This file retains earlier decisions for provenance. The former Section 4 investor-consideration benefit is **superseded** for future Token #1 offerings by a one-time fixed Creator's Companion Portfolio. The new full rights draft, incomplete Schedule A and not-for-mint metadata are in [the Token #1 revision workspace](../releases/androids-of-the-vine/token-001/README.md). The old frozen rights hash is **historical, not the approved current package**. Do not publish/mint from either the old example or the incomplete draft. Section 5 future collector NFT allocations remain unchanged and require counsel review. This direction is specific to AOTV Token #1; the generic console still requires per-release approval.

> **NEWER USER DIRECTIVE (2026-10-13) — OPTIONAL TWO-PROJECT BENEFIT.** For Androids Of The Vine, the Companion Portfolio is optional on each NFT; opted-in tokens have exactly two token-specific project-information packages and separate Schedule A. The provisional 40-token / 40-project circular allocation gives each project two placements only when all 40 tokens opt in. Opted-out tokens promise no package. The materials are creative, technical, philanthropic, nonprofit, early-idea or business-related informational works, not investor opportunities, financing priority or access to securities. No project is marketed for investment. Preserve every token's exact final rights/Schedule A hash; do not invent the 38 unselected projects or claim the incomplete drafts are mintable. See [companion allocation](AOTV_COMPANION_ALLOCATION.md).

## A. The fundamental product decision

The product is called **NFT Console**. It must be **general-purpose**, not an “Androids Of The Vine minting console.” The user creates separate releases for unrelated works by entering the collection name, symbol, desired supply, artwork/media files, per-item titles/descriptions/images, rights agreements, royalty details, owner/minter addresses, listing prices and related information. Supported inputs include **image, video, audio and other digital files**, subject to format and marketplace limitations.

- **Deploy one custom collection contract per independently created release.** Within that release, mint one token or a batch of tokens; return to the collection later to mint remaining token IDs **without redeploying**.
- Different releases must have independent supplies, names, copyrights/licenses, royalties, accounts, media, prices, token IDs and deployment records. **Never hard-code AOTV, 40 tokens, 6%, or 1 ETH into the generic defaults as requirements**; those values belong only to that example.
- User-facing target: **drag and drop → enter/review information → automatic data/hash/rights/chain checks → explicitly approve required wallet transactions → NFT minted → create/verify a real OpenSea listing → working links**. The user does not want a terminal-first process or manual multi-document reconciliation.
- Present a polished, professional and pleasurable-to-use **web app** with a premium visual treatment, accessible forms, previews, progress, resumability, and intelligible errors. Do not mistake the existing static HTML prototype for the finished UI.
- **Two operating modes:** rare **Collection Setup** (deploy/validator/roles) and repeated **Mint & List** (work-specific upload, metadata/rights, verification, mint and listing). The contract test suite belongs in CI and release/deployment gates; each individual new work additionally needs its own immutable-data and on-chain preflight.
- OpenSea listing **requires wallet approvals and signatures**. No claim that an NFT is “listed” until the live marketplace listing has actually been submitted, indexed and verified. “Automate” means manage all other steps transparently and request signatures only when unavoidable; never custody wallet keys.

## B. Preferred custom contract — exact historical baseline, not the current generic fork

The **last approved minimal source variant** was a 178-line **AndroidsOfTheVineCollection.sol** using:

- Solidity 0.8.24, Limit Break `@limitbreak/creator-token-standards` 5.0.0, and OpenZeppelin 4.8.3.
- Inheritance: `OwnableBasic`, `ERC721OpenZeppelin`, `CreatorTokenBase`, `BasicRoyalties`, **not** the full `ERC721C` wrapper. The wrapper included `AutomaticValidatorTransferApproval`, so its owner could enable approvals for a validator across every holder. Eliminating that was a **critical, explicitly approved security correction**. No function named `setAutomaticApprovalOfTransfersFromValidator` and no owner/operator seizure backdoor should reappear.
- ERC-721, ERC-721 Metadata, ERC-2981 and Limit Break `ICreatorToken` interface support; `getTransferValidationFunction()` returns the expected validator signature.
- The collection's maximum series size, royalty bps, royalty recipient and MINTER are fixed at contract creation. Per token the title, metadata URI, **SHA-256 media hash**, rights URI and **SHA-256 rights hash** are written once on mint; no setters. Token IDs must be in range, unique and not reused. Minting can be closed permanently and closes automatically when full.
- `MINTER` (hardware wallet or Safe) mints to itself; `OWNER` administers validator/marketplace compatibility but does **not** mint or take a holder's tokens; royalty recipient can be a different wallet/Safe. `renounceOwnership()` is deliberately disabled. A hardware-backed **2-of-3 Safe** is strongly recommended for OWNER.
- The OWNER is **trusted** to change validator/marketplace restrictions and may be capable of blocking trading or making some sales royalty-free by policy choices. Do **not** change this into a frozen/timelocked multi-role governance scheme without a new explicit product decision. Previous v5/v6 complex governance designs were superseded by this minimal trusted-admin architecture.
- The actual final AOTV contract has **40 IDs (1–40), symbol AOTV, collection and work title “Androids Of The Vine,” 6% royalty (600 bps)**. This is an **example implementation** only.
- The generic `contracts/NFTCollection.sol` now in the repo **was drafted separately**, changes constructors and storage, and adds `mintWorksBatch` (up to 10 works). Its parity with the original is **NOT established**. PR-03/04/05 must review the differences, recompile, rerun tests and seek independent review; the original's reputation must never be transferred to new code without evidence.

Frozen, byte-exact reference files:
- [Original 178-line contract](../reference/androids-of-the-vine/AndroidsOfTheVineCollection.sol) (source SHA-256 `75b83275c7f18901c290d4aaccba49ebb409f25fdffb7fa5860833788b2f32fb`).
- [Final Token #1 rights agreement](../reference/androids-of-the-vine/ANDROID_OF_THE_VINE_TOKEN_001_RIGHTS_FINAL.md) (source SHA-256 `0ddcfae9f5fc2d2e059ed12e7a33ea5815e00a64e70930485602bc73f3f374c9`; **do not edit these bytes**, since the hash is embedded in Token #1 metadata and its preflight check).
- [Token #1 metadata template](../reference/androids-of-the-vine/token-001.metadata.template.json) (source SHA-256 `96f2cac4483679c2e1df2d0124126f41f605471eb7a1b9d1b961c00ede8b4219`).
- [Original latest package overview](../reference/androids-of-the-vine/ORIGINAL_PACKAGE_README.md) (historical note, not the console operating manual).

**Historical progression, to prevent mistaken reversion:** An early immutable NFT version preceded ERC-721C; v4 was audited and had owner freeze/external-list/mint/test findings; v5 fixed those but introduced other policy-admin controls and Safe-transfer issues; a heavily timelocked v6 was judged excessive. The user's simpler ~133-line contract was then corrected to the **178-line no-autoapproval** architecture. Later edits changed AOTV 100→40 tokens and 1 ETH initial price, finalized the collector-right language, and supplied simpler test/mainnet PDFs. Earlier architectures are **superseded**, not alternate official code paths.

## C. Transfer validation, marketplaces and royalty realities

- The preferred real Limit Break Transfer Validator v5 test source was commit `59adb8b36ab0256c7430b017b1c9f8b4841d6e1e` (March 2026). Reconfirm actual **live chain addresses/bytecode** before configuring a production contract; do not conflate the base library's default validator address with a verified live v5 deployment.
- The **Whitelist custom ruleset = 255**, configured with **ruleset options `6`**. Option bits permit direct transfers from smart-wallet/Safe and EIP-7702 delegated accounts while allowing ordinary EOA direct transfers. This explicitly favors wallet compatibility over universal royalty enforcement. Options `0` blocked certain smart-wallet/Safe/7702 OTC transfers, an unacceptable surprise to minters/holders.
- The collection-owned marketplace/authorizer list must support adding new marketplaces later, without promising to add them to increase token value. OpenSea Seaport 1.6 SignedZone v2 was historically discussed as `0x000056f7000000ece9003ca63978907a00ffd100`; verify that address and the exact authorization path against current production configuration before signing. Never assume OpenSea Studio's “enforce earnings” toggle preserves the chosen validator.
- **6% ERC-2981 is an advertised royalty rate, not a magic guarantee on every transaction.** Authorized marketplace sales may enforce it; direct wallet-to-wallet transfers can avoid on-chain price observation. Original AOTV rights impose a contractual 6% royalty on compensated direct secondary sales, recognizing practical enforcement limits.
- The Limit Break **Payment Processor** was reported exploited beginning 2026-09-24; the incident is distinct from the transfer validator and from ERC-2981. **Do not integrate the Payment Processor or direct holders to approve the validator as an operator.** Use audited/current Seaport-based flows only after verification.
- OWNER retains technical ability to replace/configure validators and update marketplace compatibility, not an undertaking to create liquidity or drive token prices. Any disclosure must distinguish the OWNER's capability from a promised future service.
- **Mandatory disposable mainnet rehearsal** before canonical collection deployment: same intended Safe/EOA roles, policy, SignedZone, real low-value NFT, actual OpenSea order and real purchase, inspect royalty payout, verify direct wallet transfer; fail/stop on mismatch. Sepolia/unit tests alone cannot establish marketplace interoperability.

## D. AOTV's selected legal rights — historical example, not universal boilerplate

The original NFT package grants the current lawful Owner a **worldwide, nonexclusive commercial license** for:
1. public display;
2. private display;
3. reproduction;
4. authorized-copy distribution;
5. merchandising;
6. promotional/advertising use;
7. film, TV, music video and other audiovisual incorporation;
8. publishing/books/editorial products;
9. game/interactive media use;
10. derivatives/adaptations/remixes.

**Copyright remains with the creator.** The creator can concurrently exploit/license the original work. Generally these licensed rights **follow the NFT**, while valid third-party licenses granted earlier survive later NFT transfers according to their terms. No general sublicensing right should be silently inferred. Authentication and integrity rely on the exact byte hash. The ability to resell/transfer the token remains, subject to the disclosed validator policy. No contractual promise to manage NFT price, promote appreciation or produce financial returns should be invented.

**AOTV's Collector Circle benefits are personal and emphatically do NOT follow the token.** These were negotiated as follows:
- The **Original Purchaser** must buy a token in an initial bona fide sale directly from the creator or designated MINTER. This buyer receives **one personal, nontransferable Galinsky Collectors Circle membership**, regardless of whether they initially buy multiple AOTV NFTs; selling the NFT does not remove membership. A secondary owner does **not** gain membership by buying the NFT.
- The original Circle is limited to original purchasers of the **40** AOTV NFTs; user anticipates this may be the only Circle cohort.
- **SUPERSEDED historical Section 4:** The archived rights agreement once promised Priority Investment Consideration. **Do not use that benefit for a new Token #1 offer or new metadata.** The Creator's later instruction of 2026-10-12 instead calls for a completed, one-time **Creator's Companion Portfolio**, consisting of fixed creative/technical/musical materials without any investor priority, venture participation, financing notifications, or future updates. See [working successor draft and Schedule A](../releases/androids-of-the-vine/token-001/README.md); Schedule A is not yet completed and the new agreement is not mint-ready. The old rights bytes/hash remain archival for provenance only.
- **Future NFT allocation**: if the creator independently launches other NFT collections, **10% (rounded down) of NFTs in each of the next 10 qualifying releases** reserved for Circle members; reserved inventory stays exclusive for **one year** from first offering. After one year, unpurchased reserved NFTs can remain with creator or be donated free to museums subject to no-transfer except free return. Returned units cannot be sold to general public. Museum purpose is preservation/display/public access; no guarantee of future collections, donations, exhibition, trading liquidity or investment return.
- Implement private, access-controlled recording of **Original Purchaser identity, purchase provenance, wallet/contact, and membership persistence** separately from NFT metadata and on-chain ownership. No KYC or centralized registry feature should be implied as already implemented; appropriate privacy/legal workflow remains a development task.
- In the user's AOTV intent, **Token #1 is the only NFT for the specific video titled Androids Of The Vine**; additional AOTV slots were intended for other distinct works. The generic console must separately support editions or multiple distinct works as a release-specific choice, and should flag accidental duplicate media hashes rather than quietly create multiple editions when not requested. The historical Solidity contract enforces ID uniqueness and cap, **not** uniqueness of media hashes.

**Rejected as ongoing benefits/promises:** perpetual free annual NFTs, mandatory annual digital catalogue/continued catalog production, guaranteed future collector-only physical venue or hospitality projects, promised museum placement/exhibitions, ongoing marketing/liquidity services, guaranteed financial return or entitlement to invest in future companies. Reintroducing any of these into a template would contradict the final AOTV choice.

The above rights are **opt-in per release**, NOT imposed on unrelated new collections or purchasers. Console must allow all relevant rights and buyer-benefit clauses to be entered and signed off per release.

For AOTV Token #1:
- Video file SHA-256 `950a845421f19c0e9bb2c6483dfb9ff95067fcad36cdb555159230670511627d`.
- Poster image SHA-256 `e271a41a7a911b4beff3aaf2bf947638dd4981a9331c3d72bf5c0985237339e1`.
- Final rights agreement SHA-256 `0ddcfae9f5fc2d2e059ed12e7a33ea5815e00a64e70930485602bc73f3f374c9`.
- Initial listing intent: **1 ETH per initially offered NFT**, a marketplace listing setting, not a hard-coded sale mechanism.
- Token #1 metadata URI includes poster `image`, video `animation_url`, signed-off rights URI and hashes; IPFS CIDs remain placeholders until files are pinned and read back. Do not invent live addresses/CIDs or assume AOTV has deployed.

## E. End-To-End-Everywhere Security Architecture Standard

The user explicitly requires the **same End-To-End-Everywhere Security Architecture Standard (E2EESA)** for NFT Console. The standard is maintained in its own repository. The relevant architecture is **component/data-flow scoped**, not a claim that an entire GitHub repo is “encrypted.”

- Private drafts, media, rights documents, assets and sensitive membership records should be encrypted at their trusted endpoints **before server/object-store upload**; servers hold ciphertext without decryption keys. Use exact version-pinned, applicable E2EESA profiles and supporting conformance/evidence fixtures.
- The chosen E2EESA attachment-file profile calls for per-file fresh 256-bit keys, authenticated per-chunk encryption with nonce uniqueness, an authenticated manifest/context binding, bounded-memory streaming/resume, and precise retention/recovery limitations. Standard server-side disk/KMS encryption alone **is not E2EE**.
- Wallet authentication is separate from decryption-key ownership. Plan cross-device key authorization, safe recovery, secure origin/bootstrap for web clients, anti-rollback, and client-verifiable release integrity.
- **Publication changes the trust boundary.** Public NFT media, thumbnails, rights documents, metadata and IPFS URIs must be viewable by marketplaces/collectors. The user must explicitly choose exactly what becomes plaintext/public; never call public IPFS storage “end-to-end encrypted.”
- The upstream E2EESA standard was in pre-1.0 development as of 2026-10-10; do not claim “E2EESA certified” from a design or passing local tests. PR-08 pins the exact profile/version and generates a documented architecture/evidence crosswalk, PR-10 onward implements it.
- Use correct security practices for public site, object storage, IPFS pinning provider, Neon/Render secrets, authentication, CI supply chain, browser script integrity, key handling and disaster recovery.

## F. Operating style and deployment constraints

- The user wants the most tedious steps automated, no repeated command-line ritual, and **clear beginner-friendly instructions** in PDFs for users (test first, then deployment). Developer-facing Markdown technical plans are fine in GitHub.
- User prefers **continuous chained PR development**: when an implementation PR is green and unblocked, merge and proceed to next dependency, without waiting for approval of routine engineering choices. Consult the user only for material product/legal decisions, external accounts, authentication/keys, real monetary transaction authorizations and genuine external blockers. No autonomous signing of on-chain transfers.
- Every release needs contract CI and chain-level preflight. External accounts/funding/API keys and deployment wallets will still require authenticated setup at launch; no credentials should ever be requested in source code/chat.
- If the user's choice is a nontechnical shortcut but it would misrepresent listing status, royalty enforcement, public declassification, future economic rights or E2EE, **do not fake a completed step**. Distinguish prepared, pinned, deployed, minted, listed and paid/settled.
- Render and Neon are preferred available infrastructure options where economical; storage/IPFS service selection should consider practical costs and the user's stated budget constraints. Show actual costs before signatures or service activation.
- Engine Room should ingest factual PR/CI/deploy status and show the deployed NFT Console link only when genuinely live.

## G. What is recorded versus what still requires verification

**Captured here:** the user's original purpose, the reason for the simplified no-autoapproval contract, frozen source/legal example files, AOTV's detailed rights and membership selections, marketplace/royalty trust model, security intent, full user-facing workflow, and previous architectural rejection rationale.

**Not proven by this context:** independent production security audit; live validator/SignedZone on-chain bytecode; OpenSea Safe/Seaport order compatibility; deployment, minting, sale or payments; completeness/correctness of the new generic contract; legal opinion that any particular NFT sale is not a security; final encrypted client implementation; API secrets or user wallet access.

**See:** [HANDOFF_STATUS.md](HANDOFF_STATUS.md) for precise repository file/test gap findings, and [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for all 36 PR work packages and dependencies. Always use the final-rights file itself for enforceable words; this document is a summary of it.

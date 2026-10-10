# E2EESA Applicability and Profile Lock

## Status and claim boundary

This repository pins the End-To-End Everywhere Security Architecture Standard
(E2EESA) source at commit `6ec85d51f9207da31f0e90fd8a7c82ffff8448f6`.
That source identifies itself as `0.9.0-rc.2-dev`; its profile catalog is
`0.1.0-dev`. The selection in
`security/e2eesa-configuration.json` is therefore a candidate design input,
not a conformance, certification, independent-review, or production-readiness
claim. The machine-readable limits and review gate are recorded in
`security/e2eesa-profile-lock.json`.

Cryptography implementation must not begin until an independent reviewer has
accepted the applicability decision, browser trust boundary, threat model,
privacy inventory, and public-publication boundary. A passing resolver check
only proves that the selected identifiers and dependencies are internally
consistent with the pinned catalog.

## System and data-flow scope

| Component or flow | Scope | Selected profile and rationale |
| --- | --- | --- |
| Browser release workspace | Private drafts, local keys, wallet session | `client-web-hardened`; the browser remains a hostile, updateable endpoint |
| Account and release identity | Admin wallet binding and device authorization | `identity-account-root`; account-rooted authorization without server-held signing keys |
| Draft synchronization | Encrypted release state between authorized devices | `pairwise-pqxdh-triple-ratchet`; candidate forward-secure device channel |
| Draft media and rights | Chunked artwork, previews, rights, and metadata before publication | `attachment-chunked-aead`; integrity and resumable encrypted transfer |
| Secret custody | Device identity and content-encryption keys | `secret-platform-keystore`; platform-backed, non-exportable storage where available |
| Network transport | Browser-to-service transport | `transport-tls13-classical`; defense in depth, not the E2EE boundary |
| Service persistence | Draft ciphertext and routing data only | `server-ciphertext-only`; plaintext and signing keys are forbidden |
| Metadata | Minimal routing, authorization, and operational fields | `metadata-minimized`; do not collect collector or artwork data for convenience |
| Backup | No server escrow of draft keys or plaintext | `backup-none`; recovery requirements need a later reviewed design |
| Telemetry | No draft-content or cryptographic telemetry | `telemetry-none`; operational counters must be non-content and minimized |
| Build and release | Reproducible, attested dependencies and reviewed delivery | `assurance-a2-reviewed`, with its resolved supply-chain and verification dependencies |
| Vulnerability handling | Risk-based disclosure and remediation | `vulnerability-disclosure-risk-adaptive` |

The protection boundary ends only at an explicit, authenticated publication
action. IPFS media, rights, NFT metadata, transaction calldata, contract state,
and marketplace listing fields are intentionally public after that action.
The selected profiles do not make public blockchain data confidential.

## Evidence matrix

| Requirement | Repository evidence | Status |
| --- | --- | --- |
| Exact upstream source and input integrity | Profile lock plus CI commit and blob-hash checks | Automated |
| Machine-readable selection | `security/e2eesa-configuration.json` | Automated resolver validation |
| Dependencies and conflicts | Pinned upstream `profile_engine.py` output | Automated |
| Component and data-flow applicability | This document | Candidate |
| Attacker capabilities and residual risk | `docs/THREAT_MODEL.md` | Candidate |
| Personal and sensitive data handling | `docs/PRIVACY_INVENTORY.md` | Candidate |
| Independent review | Review record linked from a future lock update | Pending |
| Cryptographic implementation | Later plan items after review gate | Blocked |
| Production conformance or certification | None | Not claimed |

## Change control

Any change to the upstream commit, catalog or property-registry blob, selected
profile, client architecture, key custody, synchronization flow, backup
strategy, telemetry, or publication boundary requires a new resolver result
and independent review. The profile lock must not be marked reviewed by the
implementation author.

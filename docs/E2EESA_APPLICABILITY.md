> **Owner instruction, 2026-10-13:** Independent human/external security review is deferred and is not a prerequisite for implementation, merge or deployment. AI source/security review and applicable passing tests are the operational review process. Actual defects and missing functionality still require fixes. External review/certification remain honestly pending. See [AGENTS.md](../AGENTS.md) and [review policy](../security/review-policy.json). This supersedes conflicting older review-gate wording below.

# E2EESA applicability and implementation gate — PR-08

This is a **target architecture and configuration diagnostic**, not evidence that
the prototype implements E2EE, not a frozen upstream Candidate, and not a
certification. AI exact-source architecture/profile review applies to PR-10; external human
review is deferred under the owner instruction. The current plaintext `/api/prepare` and unencrypted
`localStorage` flows remain known failures until replaced by PRs 09–13.

## Exact upstream basis

`security/e2eesa.lock.json` pins upstream commit
`2883c792a766ae6ca860abb6fbe8b1654ba9d7de`, release `0.9.0-rc.2-dev`, catalog
basis `0.1.0-dev`, canonical tree/catalog digests, and exact hashes of normative
documents and evaluator code. These two upstream version labels are distinct.
The source remains in audit remediation and is not production certification
material.

The latest observed commit `6ec85d51f9207da31f0e90fd8a7c82ffff8448f6`
changed README without refreshing its frozen-file manifest. The upstream
`standard_lock` check fails there: README's recorded Git blob is
`56c1fdc7c37d7890768989ed32160d88779e7c42`, while that head contains
`b2ce78b0cf2a22564818a5568afd0a0a4a0c775b`. The preceding pin retains the valid
manifest and identical normative specifications/profiles. This records the
failure rather than repairing upstream bytes or waiving the source check.
Any pin/profile change requires fresh resolution and AI source/security review.

## Component and data-flow scope

`security/target-architecture.json` declares browser, authenticated API, object
storage, backup storage, public publication proxy, chain/marketplace proxy and
build/release process separately. Attachment, authenticated manifest delivery,
local vault, backup, explicit publication, login and chain writes are separate
flows. Inventory completeness has **not** been established by a trusted observer.

| Boundary | Exact selected profile / constraint |
| --- | --- |
| Device authority | `identity-account-root@0.1.0`, with `verify-account-root@0.1.0`; a client-controlled root authorizes devices. Wallet login is separate. |
| Manifest and key delivery | `group-mls-rfc9420@0.1.0`; authenticated membership epochs for explicitly authorized release devices. |
| Private files and derivatives | `attachment-chunked-aead@0.1.0`; fresh 256-bit key per file/derivative, authenticated manifest and chunk context, 4-byte random nonce prefix plus 64-bit big-endian chunk counter. |
| Local secret persistence | `secret-software-vault@0.1.0`; explicit local unlock, authenticated vault, Argon2id v0x13 with an upstream RFC 9106 floor. No hardware or non-exportability claim. |
| Recovery | `backup-user-secret@0.1.0`; fresh backup-generation key and independent device authorization. Recovery material is never a wallet seed/private key. |
| Browser execution | `client-web-hardened@0.1.0`; hosted origin still delivers code. Exact release closure, authenticated update roots, CSP/SRI and independent transparency monitoring are required controls, currently unimplemented. |
| Network transport | `transport-tls13-classical@0.1.0`; authenticated TLS 1.3, separately from application E2EE. No post-quantum claim. |
| Service infrastructure | `server-ciphertext-only@0.1.0`; no content/root/recovery keys, encrypted private derivatives and constrained metadata. Public publication is explicitly disclosed data. |
| Metadata / diagnostics | `metadata-minimized@0.1.0`; client `telemetry-none@0.1.0`, service `telemetry-minimized-diagnostics@0.1.0`. No IP/timing anonymity claim. |
| Delivery process | `development-ssdf-baseline@0.1.0`, `supply-chain-attested-reproducible@0.1.0`, `verification-combined@0.1.0`, `assurance-a2-reviewed@0.1.0`; selecting them is not proof those processes have passed. |
| Vulnerability process | `vulnerability-disclosure-risk-adaptive@0.1.0`, `vulnerability-prioritization-cvss-threat@0.1.0`, `advisory-csaf-2-0-iso20153@0.1.0`; pending operational implementation. |

The parent E2EE channel is mandatory **in the consuming attachment flow**, not
merely selected somewhere else. A raw AES envelope or a wallet-signature-derived
key does not satisfy this design. Browser-capable, maintained protocol/Argon2
libraries and exact cipher-suite bindings must be selected and reviewed before
implementation. This PR adds no custom protocol or cryptographic primitives.

The current server profile imposes a maximum 30-day ciphertext retention bound,
including queues/replicas. Durable private cloud releases/archives require a
separately reviewed retention/profile design; do not silently call indefinite
database/object retention compliant. Account-root recovery after total device
loss, an independent rollback anchor, and actual code-log/witness operators are
also unresolved review inputs. PR-11/12/31/32 must establish these mechanisms and
their availability/cost before launch. No fake witness identity is supplied here.

## Privacy inventory

| Data | Intended recipient / allowed service view | Publication and retention |
| --- | --- | --- |
| Draft artwork, rights, settings, filenames, thumbnails, extracted metadata and plaintext hashes | Authorized browser endpoints; API/object stores receive ciphertext and opaque routing only. | Private until separately identified and confirmed for publication; active-sync retention bound must be implemented. |
| Content keys, account-root secret, MLS state, local vault unlock and recovery secrets | Authorized client key boundary only. | Never in URLs, logs, storage metadata, browser-accessible server config, GitHub or public IPFS. |
| Wallet login address/challenge/session | Authentication service receives the explicitly disclosed identity and verifies fresh, domain/chain/expiry-bound proof. | No signing key custody; bounded challenge/session lifetime and redacted audit routing. |
| Device public state and routing IDs | Minimal authenticated routing metadata; client verifies root-authorized state and membership. | No server-only device enrollment; revocation cannot recall already disclosed keys/plaintext. |
| Collector contacts, eligibility and nontransferable benefits | Authorized release operators through a separately encrypted private registry. | Excluded from NFT metadata; counsel/privacy retention review remains PR-14. |
| Public media, rights, metadata, hashes, chain economics, receipts and marketplace orders | Public NFT/chain audience after explicit client declassification. | Public content-addressed records cannot be promised private or recalled. |
| Operational diagnostics and provider secrets | Narrow service credential/diagnostic boundary; no content or E2EE secrets. | Explicit allowlist, quotas, deletion/backup rules and secure provider secret manager. |

## Threat model and evidence crosswalk

The requirement crosswalk is `security/requirements.json`. Its NFT-prefixed IDs
are local tracking identifiers; upstream references are exact profile/spec
sections, not invented upstream requirement IDs. Every control has an evidence
state and a later delivery gate. The threat inventory is
`security/threat-model.json`.

Attacker coverage includes compromised API/storage/admin credentials; hostile
origin/build signer and browser extensions; replayed auth and wallet phishing;
malicious ciphertext/range/manifest delivery; revoked/new devices; compromised
recovery providers; collector-record leaks; publication cancellation; hostile
validator/owner/operator policy; false receipts/listing observations; and supply
chain compromise. A compromised live authorized endpoint remains able to expose
its plaintext, and hosted-origin controls cannot prevent that origin from serving
malicious code. OWNER retains the approved trusted transfer-policy model.

## Reproducible diagnostic

Check out the exact upstream commit and set `E2EESA_SOURCE_DIR` to that checkout,
then run `npm run security:profiles` and `npm run test:security-profiles`. CI
checks out that exact source independently. The checker rejects dirty/changed
source, version/digest mismatch, unknown/floating profiles, missing scoped parent
channels, absent endpoint secret storage, duplicate JSON keys, implementation
claim injection and self-approved review flags.

`security/configuration-report.json` contains the upstream active scoped
configuration evaluator's result and exact resolutions. Source/artifact digests
there bind the **configuration definition and resolved configuration**, not an
application build. The report intentionally declares `inventory_supported=false`,
no implementation claims, no certification eligibility, review pending and a
owner-authorized AI review process. Ten adversarial configuration tests pass; implementation
and external evidence remain absent. A configuration pass cannot authorize
deployment or change any of these evidence states.

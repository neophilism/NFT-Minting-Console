> **Owner instruction, 2026-10-13:** Independent human/external security review is deferred and is not a prerequisite for implementation, merge or deployment. AI source/security review and applicable passing tests are the operational review process. Actual defects and missing functionality still require fixes. External review/certification remain honestly pending. See [AGENTS.md](../AGENTS.md) and [review policy](../security/review-policy.json). This supersedes conflicting older review-gate wording below.

# Threat Model

## Security objectives and trust boundaries

Private draft media, rights text, metadata, release configuration, device
identity keys, and content-encryption keys must remain confidential and
tamper-evident until the release owner explicitly publishes them. Wallet
signing keys remain exclusively in the connected wallet. The service may
authorize requests and store ciphertext but is never trusted with draft
plaintext or signing keys.

This is an unimplemented target architecture. The current prototype fails the
private-draft boundary. Exact controls, flows and residual limits are tracked in
`security/threat-model.json` and `security/requirements.json`.

Trust boundaries exist between the browser and wallet, browser and local software
vault, browser and application service, application service and storage,
authorized devices, dependency/build systems, and the irreversible public
IPFS/blockchain/marketplace publication boundary.

## Attacker capabilities

| Capability | Principal threats | Required treatment or residual risk |
| --- | --- | --- |
| Network control | Interception, replay, downgrade, traffic analysis | TLS 1.3 plus end-to-end authenticated encryption; timing and volume leakage remains |
| Service compromise | Ciphertext theft, deletion, rollback, forged routing | Ciphertext-only storage, authenticated versions, monotonic revisions; availability remains |
| Account takeover | Unauthorized device enrollment or publication | Wallet-bound challenges, explicit device authorization and high-risk reauthentication |
| Endpoint compromise | Plaintext/key theft, malicious extensions, UI substitution | Hardened client, CSP, explicit software-vault unlock, minimal lifetime; active endpoint compromise remains |
| Physical device access | Offline extraction and session abuse | Authenticated vault and revocation; no hardware isolation or non-exportability claim |
| Malicious insider | Log inspection, storage access, targeted rollback | Least privilege, no plaintext telemetry, immutable administrative evidence |
| Update compromise | Malicious application bundle or dependency | Pinned dependencies, reviewed builds, provenance and reproducibility requirements |
| Supply-chain compromise | Backdoored package, action, compiler, or profile input | Exact pins and hashes, lockfiles, attestation, independent review |
| Backup compromise | Recovery-secret theft or stale-state restoration | User-held recovery secret, fresh backup keys and independent rollback/device authorization; all-device-loss recovery still requires review |
| Metadata analysis | Relationship, timing, size and release inference | Minimize retained fields; public chain and publication metadata remain observable |
| Replay and rollback | Stale draft or authorization restoration | AEAD-bound identifiers, revisions, transcript/context binding, rejection of stale state |
| Weak randomness or clock | Key/nonce reuse, expiry bypass | OS CSPRNG only; avoid clock as uniqueness source; fail closed on entropy failure |
| Future quantum attacker | Store-now-decrypt-later against draft sync | Classical MLS/TLS target provides no post-quantum confidentiality claim |
| Denial of service | Upload exhaustion, ciphertext deletion, chain congestion | Quotas, idempotency, retries and local durability; no confidentiality tradeoff |
| Blockchain observer | Wallet linkage and permanent public data extraction | Explicit publication warning; confidentiality cannot be restored after publication |

## Composite abuse cases

1. A compromised service plus network observer can correlate users and deny or
   replay ciphertext, but must not recover drafts or create a valid newer
   revision.
2. Account takeover plus a malicious enrolled device can obtain future shared
   draft state. Device enrollment and recovery therefore require independent
   scrutiny before cryptographic work.
3. A hostile application update can exfiltrate plaintext after decryption.
   Cryptography cannot compensate for untrusted code delivery.
4. A user can accidentally publish private data permanently. Publication needs
   an exact manifest, destination preview, wallet confirmation, and an
   irreversible-public warning.
5. A malicious collaborator may supply active media or rights content. Treat
   filenames and metadata as data, isolate previews, and never execute uploads.

## Security decisions deferred to independent review

The review must decide concrete algorithms, parameter sizes, key hierarchy,
device enrollment and revocation, recovery behavior, ciphertext framing,
revision counters, associated data, multi-device conflict handling, and
declassification mechanics. Until then, the selected profiles are requirements
inputs only and no home-grown protocol is permitted.

The service profile's maximum 30-day ciphertext retention conflicts with
indefinite cloud archives. A reviewed archive/profile policy, browser-capable
MLS/Argon2 providers, independent rollback anchor and actual code-transparency
log/witness operators remain explicit design gates.

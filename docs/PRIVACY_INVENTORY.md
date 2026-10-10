# Privacy and Sensitive Data Inventory

This inventory covers pre-publication drafts and the later intentional public
release. Data collection must be necessary for release creation, security, or
legal evidence; convenience analytics are out of scope.

These are target requirements, not observations of the plaintext prototype.
`security/requirements.json` records the actual unimplemented/blocked controls.

| Data | Classification before publication | Location and access | Retention and disposition |
| --- | --- | --- | --- |
| Original media and previews | Highly sensitive draft | Browser plaintext; service ciphertext only | Delete ciphertext on release deletion; published copy is permanent/public |
| Rights text and version history | Sensitive draft/legal record | Browser plaintext; encrypted sync; immutable hash evidence | Retain accepted evidence; published terms are public |
| NFT metadata and attributes | Sensitive draft | Browser plaintext; encrypted sync | Public after explicit publish |
| Content-encryption and device keys | Secret | Client software vault or authorized browser memory; never service-side | Explicit unlock; no hardware isolation or server escrow claim |
| Wallet private keys | Out of scope/secret | External wallet only | Never collected |
| Wallet addresses and signatures | Personal/public identifier | Browser, service authorization record, public chain after signing | Retain minimum audit evidence and chain references |
| Session challenges and tokens | Security-sensitive | Browser and authorization service | Short expiry; invalidate on use/revocation |
| Release status and encrypted revision identifiers | Confidential metadata | Service routing store | Minimize; delete with abandoned release subject to audit requirements |
| Upload sizes and timestamps | Linkable metadata | Service/storage operational records | Short operational retention; never telemetry payload content |
| Transaction hashes and receipts | Public | Service index and blockchain | Retain as release evidence |
| Collector addresses and transfers | Public but linkable | Blockchain/marketplace; local display on demand | Do not build a separate collector dossier |
| IP address and user agent | Personal operational data | Edge/security logs only when required | Short, documented security retention; access controlled |
| Error and audit logs | Potentially sensitive | Service logging system | Structured redaction; no plaintext drafts, keys, tokens, or full signatures |
| Backups | Ciphertext and minimized metadata only | Client-encrypted backup; user-held independent recovery secret | No key escrow; independently assessed rollback/retention design pending |
| Collector contacts, eligibility and optional benefits | Sensitive personal data | Separately encrypted private registry for authorized operators | Never NFT metadata; PR-14 counsel, deletion and retention gate |
| Dependency/build provenance | Non-personal security evidence | CI and release records | Retain with each release |

## Processing rules

- The default is local plaintext processing and ciphertext-only remote storage.
- Active service ciphertext, replicas, queues and backups are subject to the
  selected profile's maximum 30-day bound. Durable private archives require a
  separately reviewed retention/profile policy before implementation.
- Logs, crash reports, support bundles, and analytics must never contain draft
  content, keys, wallet tokens, full signed payloads, or decrypted filenames.
- Access control does not transform public blockchain data into private data;
  users must see the exact public manifest before signing publication.
- Data export and deletion must distinguish deletable service data from
  immutable public IPFS, blockchain, and marketplace records.
- Cross-device synchronization, recovery, and any new telemetry are material
  changes requiring profile re-resolution, privacy review, and threat-model
  updates.

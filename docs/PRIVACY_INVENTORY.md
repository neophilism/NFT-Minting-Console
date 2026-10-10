# Privacy and Sensitive Data Inventory

This inventory covers pre-publication drafts and the later intentional public
release. Data collection must be necessary for release creation, security, or
legal evidence; convenience analytics are out of scope.

| Data | Classification before publication | Location and access | Retention and disposition |
| --- | --- | --- | --- |
| Original media and previews | Highly sensitive draft | Browser plaintext; service ciphertext only | Delete ciphertext on release deletion; published copy is permanent/public |
| Rights text and version history | Sensitive draft/legal record | Browser plaintext; encrypted sync; immutable hash evidence | Retain accepted evidence; published terms are public |
| NFT metadata and attributes | Sensitive draft | Browser plaintext; encrypted sync | Public after explicit publish |
| Content-encryption and device keys | Secret | Platform keystore or browser memory; never service-side | Revoke/delete with device; no server escrow |
| Wallet private keys | Out of scope/secret | External wallet only | Never collected |
| Wallet addresses and signatures | Personal/public identifier | Browser, service authorization record, public chain after signing | Retain minimum audit evidence and chain references |
| Session challenges and tokens | Security-sensitive | Browser and authorization service | Short expiry; invalidate on use/revocation |
| Release status and encrypted revision identifiers | Confidential metadata | Service routing store | Minimize; delete with abandoned release subject to audit requirements |
| Upload sizes and timestamps | Linkable metadata | Service/storage operational records | Short operational retention; never telemetry payload content |
| Transaction hashes and receipts | Public | Service index and blockchain | Retain as release evidence |
| Collector addresses and transfers | Public but linkable | Blockchain/marketplace; local display on demand | Do not build a separate collector dossier |
| IP address and user agent | Personal operational data | Edge/security logs only when required | Short, documented security retention; access controlled |
| Error and audit logs | Potentially sensitive | Service logging system | Structured redaction; no plaintext drafts, keys, tokens, or full signatures |
| Backups | Ciphertext and minimized metadata only | Encrypted infrastructure backup | No key escrow; bounded retention and tested deletion limitations |
| Dependency/build provenance | Non-personal security evidence | CI and release records | Retain with each release |

## Processing rules

- The default is local plaintext processing and ciphertext-only remote storage.
- Logs, crash reports, support bundles, and analytics must never contain draft
  content, keys, wallet tokens, full signed payloads, or decrypted filenames.
- Access control does not transform public blockchain data into private data;
  users must see the exact public manifest before signing publication.
- Data export and deletion must distinguish deletable service data from
  immutable public IPFS, blockchain, and marketplace records.
- Cross-device synchronization, recovery, and any new telemetry are material
  changes requiring profile re-resolution, privacy review, and threat-model
  updates.

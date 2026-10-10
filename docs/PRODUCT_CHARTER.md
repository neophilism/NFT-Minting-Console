# NFT Console Product Charter

**Status:** Implementation baseline for PR-01. The ordered work packages and acceptance gates in [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) remain authoritative.

## Product identity and scope

NFT Console is a generic release-management application for independently configured NFT collections. Androids Of The Vine is preserved only as historical reference material under `reference/androids-of-the-vine/`; it is not the product name, a default release, or a source of implicit economics or rights.

A **release** is the application's private-to-public workspace for one collection. It owns collection configuration, roles, rights versions, media assets, publication records, deployment records, mint jobs, token inventory, marketplace listings, and an activity history.

A **token** is one immutable on-chain item minted within a deployed release collection. A token owns its token ID, title, metadata URI, media hash, rights URI, rights hash, and edition assignment. Minting another token in an existing release must not deploy another collection.

## Supported environments

- Local Hardhat is the development and automated-test environment.
- Ethereum Sepolia is the supported rehearsal network.
- Ethereum mainnet is the only planned production network.
- Other EVM networks are unsupported until their contract, validator, and marketplace compatibility is separately reviewed and added to the development plan.
- Wallet or Safe signatures remain mandatory for deployments, policy changes, minting, approvals, and listings. NFT Console never stores signing keys.

## Release lifecycle

The application uses these product states:

| State | Meaning | Allowed next states |
| --- | --- | --- |
| Draft | Private, editable release configuration and assets. No public publication or chain write is implied. | Validated, Archived |
| Validated | Automated checks passed for the exact current draft. Any relevant edit invalidates this result. | Published, Draft, Archived |
| Published | The user explicitly approved the identified plaintext assets, rights, and metadata for public content-addressed storage. Publication cannot be undone. | Deployed, Archived |
| Deployed | One verified collection contract exists for the release and its immutable configuration has been read back. | Policy configured |
| Policy configured | Transfer-validator configuration has been provisioned and verified. | Minting |
| Minting | One or more tokens are minted, or a resumable mint job is in progress. | Listed, Minting closed |
| Listed | A marketplace order is independently verified as active. Minting alone never produces this state. | Sold, Expired, Cancelled, Relisted |
| Sold | Settlement and ownership change are verified from source data. | Relisted |
| Archived | The release is hidden from active work without deleting its evidence. | Draft |

Operational job states such as queued, awaiting signature, submitted, confirmed, failed, and reconciled are recorded separately. A failed or interrupted job does not advance the product state.

## Core data boundaries

- Private draft bytes are client-encrypted before server or object-storage persistence.
- Public IPFS publication is a separate, explicit declassification action.
- Release defaults are reusable templates only; changing a template never mutates an existing release.
- Collection name, symbol, maximum supply, owner, minter, royalty recipient/rate, network, and applicable rights are release-specific inputs. No historical collection value is silently preselected.
- Published hashes, deployment bytecode/version, transaction receipts, token fields, and listing identifiers are durable evidence, not inferred UI flags.
- Personal collector records and nontransferable benefits remain separate from public NFT metadata.

The detailed schema and migrations are delivered by PR-07. This charter defines ownership and invariants, not a substitute database design.

## Primary use cases

1. An authorized user creates two unrelated releases with different names, roles, supplies, royalties, rights, media, and prices; neither inherits immutable data from the other.
2. The user privately saves and resumes a release, validates exact bytes, and explicitly chooses what becomes public.
3. The user deploys one collection per release, configures and verifies its policy, and mints multiple bounded batches without redeploying.
4. The user creates a marketplace listing through explicit wallet actions and sees "Listed" only after independent verification.
5. The user resumes an existing collection to mint remaining token IDs or relist owned tokens.
6. An unauthorized device or wallet cannot read private drafts, spend provider resources, deploy, mint, or administer another release.

## Source of truth

When implementation material conflicts, resolve it in this order:

1. [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for ordered work, dependencies, and acceptance gates.
2. This charter for generic product identity, lifecycle, and domain ownership.
3. [HANDOFF_CONTEXT.md](HANDOFF_CONTEXT.md) for recovered approved decisions and rejected alternatives.
4. [HANDOFF_STATUS.md](HANDOFF_STATUS.md) for factual current gaps and preserved test requirements.
5. Frozen historical sources under [`../reference/`](../reference/) for comparison and evidence only.

No implementation or documentation may claim deployment, an active listing, royalty settlement, audit approval, or security-standard conformance without the corresponding evidence required by the development plan.

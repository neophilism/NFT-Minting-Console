# Androids Of The Vine — Current Package

One contract, 178 lines including comments, built on Limit Break's `CreatorTokenBase` (creator-token-standards 5.0.0) and OpenZeppelin 4.8.3. It deliberately does not use the `ERC721C` convenience wrapper, because that wrapper includes `AutomaticValidatorTransferApproval`, which would let the owner approve a validator over every holder's tokens. This contract has no such function.

## What is permanent

- 40 tokens, IDs 1–40. Nothing can raise the cap.
- 6% royalty (600 bps) to one fixed recipient, reported through ERC-2981. There is no function to change the rate or the recipient.
- The MINTER address.
- Every minted token's title, metadata URI, media SHA-256, rights URI and rights SHA-256. There are no setters.

## Initial sale plan

Each newly released token is intended to be initially listed from the MINTER wallet at **1 ETH**. The contract does not hard-code or collect the sale price; the 1 ETH price is set in the marketplace listing.

## What the owner controls

- Which transfer validator the collection uses (`setTransferValidator`).
- Which marketplaces are approved. The owner creates and owns a list on Limit Break's Transfer Validator v5 and adds marketplaces to it over time. See `docs/SETUP_GUIDE.md`.
- Ownership can be moved to another non-zero address. `renounceOwnership()` always reverts, so the owner can never be lost by mistake.

**The owner is a trusted administrative role.** It can change the transfer validator and the marketplace policy on it, which means it can loosen or tighten which marketplaces may trade the token and, if misused, could block transfers. It cannot mint, cannot touch any token's data, cannot change the royalty or its recipient, and cannot move or take a collector's token: approvals are plain ERC-721 approvals that only holders grant, and the contract never approves the validator automatically (a test installs an owner-controlled validator and shows it still cannot move a token). Put the owner behind a 2-of-3 Safe. Collectors can read this trust model in a minute, which is the point.

## Galinsky Collectors Circle

The Original Purchaser of an NFT directly from the Creator or MINTER receives a personal, nontransferable Galinsky Collectors Circle membership that survives any later sale of the NFT and does not pass to a secondary purchaser. For selected ventures for which the Creator seeks outside investment, Circle members are included in the initial group of prospective investors considered, receive access to the investment opportunity, and may submit an indication of interest before broader non-strategic investor outreach. If selected and legally eligible, a member may invest on the terms offered to that member. Membership is not an option, warrant, subscription right, right of first refusal, guaranteed allocation, or right to purchase securities.

## What the MINTER controls

- `mintWork(...)`: mints an unused ID to the MINTER address itself. Sales happen afterwards from the MINTER wallet.
- `closeMinting()`: permanently stops minting. Minting also closes by itself when 40 tokens exist.

## Wallet requirements

- MINTER can be a hardware wallet or a Safe. The recommended policy (ruleset options `6`) lets ordinary wallets, Safes and EIP-7702 smart accounts all send tokens directly.
- OWNER should be a 2-of-3 Safe with hardware-wallet signers. It must still be under your control in ten years.
- ROYALTY_RECIPIENT can be a hardware wallet or a Safe.

## Files

- `contracts/AndroidsOfTheVineCollection.sol` — the contract.
- `contracts/MockValidator.sol`, `contracts/IntegrationHelpers.sol` — test-only contracts. Never deploy them.
- `test/` — 13 unit tests.
- `test-integration/` — 8 tests that run the collection against the real Limit Break Transfer Validator v5 source (commit 59adb8b3, March 2026), compiled into `limitbreak-validator-v5-artifacts.json`.
- `scripts/deploy.cjs` — deployment script. `scripts/finalize_hashes.py` — writes the final video/rights/poster hashes into the rights agreement, metadata and preflight script whenever the media changes. `scripts/preflight_token_001.py` — verifies Token #1 files and hashes before minting.
- `docs/SETUP_GUIDE.md` — the only procedure you need. `docs/CHECKLIST.md` — go/no-go list.
- `legal/`, `templates/`, `assets/` — Token #1 rights agreement, metadata template, poster. The hashes inside them are placeholders until you run `scripts/finalize_hashes.py` on the final video.

## Run

```bash
npm install
npm run compile
npm test                 # unit tests
npm run test:integration # real-validator tests
```

If Hardhat cannot download the compiler on your network: `npm install --no-save solc@0.8.24` and add `--config hardhat.offline-solc.config.cjs` to the commands.

## Known limits

- Ruleset options `6` allow any smart-contract wallet that holds a token to send it directly. That is what lets Safes work, but it also means a purpose-built escrow contract could move tokens without paying the royalty. Under options `0` only ordinary wallets can send directly, which closes that gap but blocks Safe and 7702 holders. Both are valid; `6` matches the decision that direct transfers are allowed and the royalty on private sales is a contractual obligation rather than an enforced one. The owner can switch between them at any time on the validator.
- Royalty enforcement covers marketplaces that either appear on your list or are authorized by an authorizer on your list (OpenSea's SignedZone). Blur does not support ERC-721C, so tokens cannot trade there.
- OpenSea keeps its own earnings percentage in Studio, editable by the collection owner. Set it to 6% so it matches the contract.
- The validator is Limit Break's contract. If Limit Break's infrastructure changes, the owner can point the collection at a different validator. That is the reason the owner role exists.

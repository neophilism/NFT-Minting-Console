# Mainnet collection preflight (NFT-24 increment)

`verifyMainnetCollection(provider, reviewedExpectations)` is a **read-only**, Ethereum-chain-1 proof-of-configuration component. It takes independently reviewed values for collection address, expected Solidity runtime code hash, owner/minter/royalty addresses, original series supply and royalty BPS, collection name and symbol. It checks a confirmed chain snapshot for exact runtime bytecode, immutable and owner/minter roles, current minted supply, mint closure, on-chain royaltyInfo and the presence of transfer-validator code. It rechecks the block hash before reporting. It uses no wallet, signing key, broadcast, approval or transfer.

The returned report **always** states `mainnetReady:false`, `transactionAuthorized:false`, `validatorPolicyVerified:false` and `publicFilesVerified:false`. This is deliberate: checking that the transfer validator is deployed is not proof that a particular marketplace's SignedZone/list rules are correct, nor that any public rights/media bytes are approved or pinned.

A future authenticated console flow should integrate this report with complete validator/list policy attestation, exact public manifest readback, price/gas review, anti-replay journal, connected-wallet click authorization, and receipt verification. A missing external human security audit does not block work, but actual incorrect code, missing preflight proofs, or broken tests do. This incremental utility does **not** bypass the existing production startup refusal or mainnet signing blocks.

Run `npm run test:marketplace:transport` to exercise no-chain, fake-provider adverse cases.

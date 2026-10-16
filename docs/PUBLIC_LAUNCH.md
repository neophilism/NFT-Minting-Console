# Public-only first mint

This path uses finalized, deliberately public assets. It does not enable private drafting, encrypted device recovery, or claim completion of the full 36-package roadmap.

## Contract deployment

The collection can be deployed directly with its existing reviewed constructor. Deploying a separate factory first is optional and unnecessary for the first release. One collection supports subsequent mint batches without redeployment.

`console/launch/contracts.mjs` derives the exact creation calldata, address and runtime hash from the pinned compiler artifact and reviewed constructor values. Solidity immutable byte offsets come from compiler build metadata; unknown immutable fields fail closed. No deployed-RPC bytecode is accepted as its own expected hash. A read-only constructor call must return precisely the predicted runtime. Receipt checks bind the transaction sender, chain, nonce, zero value, exact calldata, creation address, canonical inclusion and confirmation count. Deployed name, symbol, supply, owner, minter, royalty recipient, rate and ERC-2981 response are checked against the intended configuration.

Wallet keys stay in the wallet. No application API holds a signer or broadcasts a raw signed transaction. Transactions remain separate explicit decisions. A deployed collection is not evidence of a token mint or marketplace listing.

## Verification

The Hardhat `First-mint direct collection deployment` suite deploys two independent configurations, verifies predicted runtime against actual EVM output, rejects changed royalty settings/calldata, duplicate deployment, malformed configuration and incomplete compiler metadata. No public-chain transaction or gas was spent.

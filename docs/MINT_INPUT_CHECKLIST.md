# Owner inputs for the first real NFT mint

Do not share a seed phrase, wallet private key or exchange password. API credentials belong in the relevant hosting or operations secret environment, never in GitHub, a public preset or public NFT metadata.

## Public details and finalized files

- Register the initial administrator through the [installation interface](BROWSER_INSTALLATION.md), then enter the collection OWNER, MINTER and royalty recipient through the collection form. No wallet address needs to be sent in chat. Roles may use the same address. Both deployment and minting accounts require console owner access. This public signing flow currently requires ordinary direct EOA accounts, not Safe or delegated accounts. Copy the Ethereum/EVM address from your wallet: [MetaMask account-address instructions](https://support.metamask.io/configure/wallet/how-to-copy-your-metamask-account-public-address-/).
- Approved collection identity/economics. Androids Of The Vine / AOTV / 40 / 600 basis points (6%) / 1 ETH initial listing preference are the historical working example, not automatic authorization to mint particular final rights. Keep or edit them deliberately. Listing preference is not a listing.
- Final artwork and display poster for each work, token ID, title and public description. Supply a final image and optional audio/video/media file. Decide exactly which token IDs are in today's mint; an unprovided work is not included in a funding quote.
- Final rights document and explicit token/collection scope. The working Token #1 revised agreement/Schedule A is not yet approved for publication. For an enabled Creator's Companion Portfolio, identify the exact two projects and existing materials in that token's final schedule. Disabled tokens receive no such portfolio. Do not reuse the historical rights hash for revised bytes.

## Service setup

**RPC:** [Alchemy Dashboard](https://dashboard.alchemy.com/) -> Apps -> Create new app -> enable Ethereum -> Endpoints -> copy the HTTPS URL for the chosen network. [Official instructions](https://www.alchemy.com/docs/create-an-api-key). Put the key-bearing URL in Render `RPC_URL`. Mainnet is chain 1, Sepolia is test-only 11155111. The combined funding quote additionally requires `eth_simulateV1` with `maxUsedGas`; verify provider support rather than assuming it.

**Public pinning:** [Pinata dashboard](https://app.pinata.cloud/) -> API Keys -> New Key -> name -> Create Key -> store the displayed JWT. [Official instructions](https://docs.pinata.cloud/account-management/api-keys). Leave Admin off and enable Files Write (`org:files:write`). Store the JWT as `PINATA_JWT` in the Render backend environment for the [public browser workbench](BROWSER_PUBLICATION.md). Never put it in the frontend. The optional CLI also needs the credential in its separate operations environment.

**Hosting:** Use the existing NFT Console service in [Render Dashboard](https://dashboard.render.com/), not another project. The owner confirmed Phillip's workspace for the existing NFT Console service. Environment -> Add Environment Variable stores keys without changing source. [Official instructions](https://render.com/docs/configure-environment-variables).

**Database:** The existing NFT project is `dark-math-52213387`. In [Neon Console](https://console.neon.tech/), open the intended branch -> Connect -> choose database and the provisioned restricted runtime role -> copy the connection string into Render `DATABASE_URL`. [Official instructions](https://neon.com/docs/connect/connect-from-any-app). Do not use the default migration-owner credential in the app. All baseline and authorization migrations, including `006_browser_installation.sql` and `007_publication_workbench.sql`, and restricted-role/RLS checks must pass on the actual selected deployment target. Prior isolated-branch migration evidence is not proof that the default production branch is ready. See [restricted provisioning](PR09_DURABLE_STORAGE.md).

## Activation, not just removal of a label

Configure the exact HTTPS `PUBLIC_ORIGIN`, `HOST=0.0.0.0`, correct `CHAIN_ID`, `RPC_URL`, restricted `DATABASE_URL`, `NFT_PUBLIC_LAUNCH=1`, `NODE_ENV=production`, and, for chain 1, `NFT_MAINNET_ACK=ethereum-mainnet-real-fees`. For browser enrollment set `NFT_SETUP_ENABLED=1` and a random 64-character hexadecimal `NFT_SETUP_CODE`, with environment wallet allowlists empty. The user enters that code and registers their wallet through the interface. Existing installations may use `ADMIN_WALLETS` instead; never combine the two modes. Leave wallet keys in the wallet. Use the read-only `launch:doctor --network` command with approved constructor settings before activating/redeploying. Follow with live sign-in, fresh fee review and an explicitly user-approved transaction. Missing credentials and final files are real blockers, not external-audit requirements.

Fund the correct Ethereum signing account only after the actual current gas quote. Deployment and later minting both need fees; a deployment-only quote is not a full-release budget. No amount is invented here. Wallet approval is needed separately for each paid transaction.

An OpenSea API key is **not required to deploy or mint**. Automated listing and transfer-validator policy provisioning remain distinct unfinished end-to-end workflows; neither is established by a verified mint. Full private encrypted drafting and large resumable transfers remain separate from this public browser launch scope.

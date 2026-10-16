# Browser administrator setup and remaining release work

The owner uses the interface, not a chat message, to register the initial administrator and select collection roles. PR #54 implements the installation control proof, domain/network/purpose-bound wallet message, durable single-winner enrollment and activation of ordinary wallet sign-in. The follow-up closes wallet-event cancellation windows after awaited account reads and adds live deployment checks that never retrieve credentials or register an administrator.

## Owner path

Open the existing NFT Console website. The first-run screen is **Make this your NFT workspace**. In the same existing Render service's **Environment** tab, copy the value of `NFT_SETUP_CODE` into the interface's **Installation setup code** field. This installation-specific value is separate from the Alchemy and Pinata credentials; do not send it to chat or put it in an NFT preset. It proves access to this installation's hosting settings, rather than giving ownership to the first public visitor.

Select Ethereum mainnet in the wallet, click **Connect**, then **Prepare administrator registration**. Review the exact message and registration acknowledgment, then choose **Register administrator with wallet signature**. No gas or asset approval is requested. After success select **Open my workspace** and sign in with the same wallet. Choose collection owner, minter and royalty recipient on-screen; the connected administrator is the initial default and may serve all three roles. Saved public configurations remain available. A different address entered into a collection field is not automatically granted console login or signing authority.

No user wallet address, private key, provider key or secret needs to be supplied to the assistant. No developer should register a fixture wallet on the live site. The setup code can be removed from the hosting environment after successful enrollment; the durable claim must not be overwritten or deleted to re-open setup.

## Executed target inspection

The existing service is `srv-db7gket9fdbs73e6a0d0` in the confirmed workspace. Render reported PR #54 build `0df2da39642eab5c88517ed70cb309aa33e65cbc` live as deployment `dep-db991cc9v7es739gu580`. Read-only Neon inspection of production `dark-math-52213387` / `br-late-forest-b4z0hjsa` confirms all six authorization migration ledger entries, including `006_browser_installation.sql` with SHA256 `82157b62d1a2352946c5bb175c36350f302934dee4251f607e6c8815242e2e7a`, and the original restricted runtime role. At inspection no administrator had claimed the live origin. Never re-run initial schema creation over this database.

The `Installation live readiness` workflow reads only public health, setup and configuration flags. It verifies Ethereum mainnet, PostgreSQL and either a configured unclaimed setup or an activated registered runtime. Its report does not test Pinata authentication, spend funds, generate NFT content or establish full-product completion. Cite the actual report and deploy status for the final checkpoint, not this planning text alone.

## What is still needed for an entirely browser-based mint

1. **Public file publication interface.** The existing publisher still runs as an operations command. Finish final-artwork/rights selection, content hashing, upload consent, server-side Pinata upload authorization, durable uncertain-upload recovery and automatic generated-bundle handoff into cost/deployment/mint review. The user should not have to run a terminal or paste IPFS hashes.
2. **Connected-provider acceptance.** Test the configured Pinata credential and actual hosted RPC quote capabilities with redacted diagnostics. The current total quote requires sequential simulation with peak-gas measurements; lack of provider support is an unavailable quote, not a zero total. Provider presence, startup RPC network matching, and successful uploads are different checks.
3. **Integrated browser rehearsal and launch labels.** Test the complete publication -> full-cost review -> deployment -> mint -> reload/recovery route on disposable fixtures. Preserve the separate exact wallet approval for each real transaction. Do not remove development wording as proof of capabilities that are unfinished.

Once those software steps are complete, the user's actions are to enroll/sign in, choose public collection parameters and final files/rights, review the exact total fees, fund the selected wallet if needed, and personally approve deployment/mint transactions. Those actions happen in the interface or wallet, not in chat. Approval of final rights/materials must not be inferred from a historical draft or template.

## Separate full-platform scope

Private encrypted draft saving, recovery and cross-device sharing; large-file resumable encrypted storage; Safe/delegated transaction support; broader console administrator/role management and recovery; automated validator policy provisioning; and end-to-end marketplace order submission/active-listing verification remain unfinished. They are distinct from the first public EOA mint scope. A verified mint is not a listing, and first-run setup or NODE_ENV=production is not a security certification or a declaration that all 36 work packages are complete.

Roadmap mapping: NFT-09 browser enrollment and cancellation; NFT-32 installation wiring; NFT-36 verification/owner handoff. See BROWSER_COMPLETION_PLAN.md for subsequent dependency order. Existing core/native/PostgreSQL/browser/security checks remain mandatory.

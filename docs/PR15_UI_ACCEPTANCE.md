# NFT-15: React console and browser acceptance

**2026-10-12 / PR #21.** This is the independent responsive-interface work
package, not completion of private drafting, minting, listing or production.
Its approved prerequisites are NFT-01 and NFT-07. Existing contracts, exact
historical rights and the E2EESA profile lock are unchanged.

## Delivered interface

The default route serves the bundled TypeScript/React application. Collections,
local setup preview, release readiness and workspace settings have responsive
navigation, semantic forms and dialogs, keyboard focus management and error
recovery. The old local/Sepolia rehearsal interface remains at `/legacy/`;
there is no fallback to that prototype when the React build is missing.

Wallet discovery supports the EIP-1193 interface and EIP-6963 announcements.
Extension-provided names are rendered as text; their icons, HTML and URLs are
not fetched. The client verifies the exact issued sign-in message, account,
network, purpose and expiration before requesting a signature. Account/network
changes, cancellation and late responses cannot establish stale authority.
Session restoration checks the connected account and network. Failed server
logout is visible, retains only the revocation token in memory, and can be retried.

Release inventory shows only returned record identifiers and recorded workflow
stages. It does not invent names, decrypt private content, infer a deployed NFT
or show an active listing without evidence. The setup form supports arbitrary
collection settings and exact integer/decimal validation without AOTV defaults.
It is a memory-only preview: there is no media upload, private draft write,
publication or transaction, and reload/navigation discards the entered fields.

## Executed evidence

At implementation head `4c6f5c88d99ae88b394a1bf29d04a32a6266c5c3`:

| Suite | Result |
| --- | --- |
| NFT Console CI `38313617772` | All original compile/lint/typecheck/contract/data/auth/audit/build/profile and real-validator gates passed |
| Native runtime acceptance `38313617788` | Native PostgreSQL/multi-instance HTTP and actual Safe cases passed |
| Browser UI acceptance `38313617857` | **50 passed, 0 failed, 0 skipped, 0 flaky**, desktop and mobile |
| UI models | **28 passed**, including strict message, response, decimal and uint256 validation |
| Local pinned Node 22.20.0 | UI build, lint, strict application/test types and model tests passed |

The browser report and four screenshots were downloaded from artifact
`11775955965`; the archive SHA-256 matched
`364fb3787f1e54e7bcc3cda0c5aee5a19c05a081700b83354cbe81e3b22181f2`.
Final-head CI and the merge review are recorded on the PR. UI evidence is
retained for 30 days and can be regenerated with the committed fixture.

The 50 browser cases cover actual EOA signatures through the browser, Express
and a read-only local-EVM RPC bridge; sign-in rejection and wrong-domain/network
messages; pending-signature cancellation; account changes and cookie restoration;
viewer restrictions; exact setup previews without network writes or persistent
storage; inventory failures; logout retry; untrusted extension metadata;
responsive navigation; bidirectional focus cycling; and automated WCAG A/AA
checks across public, setup, readiness and settings screens.

The EIP-1193 provider is a deterministic test adapter, not a live wallet
extension. Inventory responses in these UI cases are explicit fixtures; actual
PostgreSQL permissions and concurrency are separately tested by PR #20.
Real Safe contracts are tested there too, but this UI increment does not claim
an external Safe-app/hardware-wallet/mainnet walkthrough.

## Failures repaired, not suppressed

The first browser pass found native-dialog Tab focus escaping to the document
and insufficient contrast in secondary text. Explicit focus cycling and measured
contrast corrections fixed those findings. Regression cases cover forward and
reverse Tab and a single-target dialog. An ambiguous `:first` test selector
changed identity when the header finished restoring a session; the recorded
trace showed focus correctly restored to the original empty-state button.
The test now identifies the actual opener explicitly, with the focus assertion
intact. Accessibility assertions collect findings on every screen and still fail
CI on any violation. No axe rule is excluded and no browser test is skipped.

Full-page screenshots are captured after scrolling to the top so Chromium's
capture of fixed sidebars/skip links does not misrepresent a scrolled viewport.
This changes capture only, not focus behavior or the production interface.

The local Chromium environment refused loopback navigation with
`ERR_BLOCKED_BY_ADMINISTRATOR` before the page loaded. That policy was not changed
or bypassed. All browser acceptance evidence above comes from GitHub runners.

## Toolchain and source integrity

React 19.3.0, Vite 8.3.4, Playwright 1.64.0 and axe 4.13.0 are pinned with the
committed lockfile. A one-time resolver generated an artifact; a narrowly scoped
feature-branch job checked its reviewed checksums and committed only the two
package files through a non-forced push. It could not target main or merge.
The temporary import workflow is removed. Ordinary CI never resolves `latest`.

The original 30-file implementation matched its locally computed Git blob
hashes and remote tree `086afe91756377dc5f07138ee836940b075606c7`. Subsequent
keyboard/contrast corrections also had their uploaded file hashes checked.
The optional, credential-free reproduction bundle is now manual developer
tooling; all functional, security and native-runtime test gates remain active.

## Separate assistant security review

Reviewed after implementation: wallet message/domain/chain binding; account and
cancellation races; logout failure recovery; same-origin requests and CSRF;
untrusted extension/server content; memory-only preview boundaries; exact values;
production refusal; test-only public mnemonic isolation; dependency provenance;
and CI permissions. CSP remains restrictive, no provider secrets enter client
configuration, and no private artwork or production wallet was used in tests.

This is the implementing assistant's separate engineering review, not an
independent expert audit or E2EESA certification. The crypto implementation gate
in `docs/E2EESA_APPLICABILITY.md` remains closed. NFT-10/11/12, the functional
NFT-16/17/18 builder, rights/publication, marketplace integration and mainnet
rehearsal are not marked done because a responsive shell exists.

## Reproduce

Use Node 22.20.0/npm 10.9.3:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run test:ui:model
npx --no-install playwright install --with-deps chromium
npm run test:ui:browser
```

Browser fixtures run only on loopback, require explicit `NFT_UI_FIXTURE=1`, use
public local-test accounts, and never submit public-network transactions. Run
`npm start` for the actual development console after providing a matching
origin, RPC and authorized public wallet addresses. No seed/private key is needed.

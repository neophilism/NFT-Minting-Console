# NFT-09: combined browser, Safe and PostgreSQL acceptance

2026-10-12. PR #22 merged as `f4e9482dd57ac296d72ca3facc71495c699a94ae`.
Reviewed published head: `0ebeb9df8abac3e38002d9d78cdf5efbf4923482`.
This completes software integration of the authentication scope from PRs #18,
#20 and #21. It is not a live wallet-extension, hardware-wallet or mainnet audit.

## Verified evidence

- Browser UI run `38315306545`, job `115030397014`: 58 browser cases passed,
  including four Safe scenarios on desktop and mobile, plus 28 UI model and
  nine actual Safe integration cases. The fetched job log identifies the
  tested merge of this exact head into `a23138ac451ec777c1010f134bd7627a5769e319`.
- Core NFT Console CI `38315306520`: successful.
- Native runtime acceptance `38315306664`: successful.
- Browser artifact `11775904126` belongs to `38315306545`; its recorded digest is
  `c14ab799cdc6ddbec4bd0a4f4b7688d8ad2e459e241d522668b41b5827d4765b`.
- Separate assistant security review `5496797182` is recorded at the published
  head. It is not independent expert review.

The earlier PR description referenced a different unpublished final head and
runs, and claimed documentation/readiness updates not in its five-file diff.
That description was corrected before merge. This document and the registry
reconciliation are the subsequent source-owned status update, not retroactive
claims that PR #22 changed these files.

## Boundaries

The real React authentication path uses Express wallet verification, pinned
upstream Safe 1.4.1 and restricted-role native PostgreSQL sessions. Browser
providers are deterministic test adapters, but signatures, contracts, HTTP and
database operations are real. Inventory responses remain disclosed fixtures;
SQL isolation is tested separately. Fixture migration rejects non-loopback,
non-fresh or non-disposable databases and closes the administrator connection
before serving runtime requests. The local RPC bridge has read-only methods.

Reproduce using `.github/workflows/ui-browser.yml` and
`.github/workflows/runtime-acceptance.yml`. Missing prerequisites fail; no test
is skipped as a substitute for acceptance. Full production, encryption,
publication, asset-transacting wallet UX and marketplace acceptance stay open.

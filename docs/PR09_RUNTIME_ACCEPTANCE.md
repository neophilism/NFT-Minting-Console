# NFT-09 runtime acceptance: native database and real Safe

**2026-10-12 / PR #20.** Continues merged PR #18. These results supersede the
previous no-recorded-step CI blocker and the unexecuted native-test limitation;
they do not retrospectively change the historical evidence ledgers.

## Verified source and execution

PR #18 merged as `48dce57f792d8f69f2c64356a99c3fdd0f60476f`, after reviewed head
`77448c6628245b860b27277a30e8e1ac7289584a` passed NFT Console CI `38306806501`,
security-record `38306806468` and reproduction `38306806543`. The CI reproduction
bundle enabled local use of the pinned Node 22.20.0 and exact dependencies.
Local tests passed: 40 ethers/EVM records, 8 data records, 211 auth/HTTP/control/
PGlite records, lint and typecheck. Local EVM execution used the CI-compiled
artifacts with `--no-compile`; full compilation and dependency audit passed in CI.

PR #20 head `8ec81641b00d685d6f3f4e56a3d7c48f7529f814` passed:
- Native runtime acceptance `38307842014`: real-safe and native-postgres jobs.
- All original NFT Console CI jobs in `38307841941`.
- Reproduction build `38307842018`.

The first workflow draft placed a dynamic service-port expression in job-level
`env`, where that context is unavailable. Moving it into each consuming step's
`env` restored normal execution. No checks were disabled or weakened.

## Actual PostgreSQL and HTTP boundary

The native migration/store suite runs against an isolated PostgreSQL 18 container
using the real `pg` driver and independent connections. The image is pinned to
Docker's official linux/amd64 digest
`sha256:885953109528ad3dfc90362b1a6f50a78620b5315be19f187753d267e484dc5b`.
The service has disposable test credentials; no provider credentials or real
artwork are present. Missing database configuration fails rather than skipping.

Fourteen additional HTTP assertions exercise real Express servers and a real
restricted login across two app instances: refusal of migration credentials and
unexpected role grants; no table access without the scoped role; one-use login
challenges; shared durable sessions; idempotent creates; plaintext/unauthorized
rejection; viewer/editor restrictions; concurrent revision conflicts; audited
permission changes; cross-instance revocation; restart persistence; final logout;
and unchanged publication/mainnet gates. Only this HTTP suite's signature-proof
adapter is a fixture. SQL, connection permissions, migrations and HTTP are real.

## Actual Safe verification

Nine local-EVM integration cases compile and execute upstream Safe 1.4.1's
singleton, proxy and CompatibilityFallbackHandler. Source is pinned to
`safe-fndn/safe-smart-account@bf943f80fec5ac647159d26161446ac5d716a294` and must be
clean. The test-only import/config never changes the NFT collection artifact.

The cases verify 2-of-3 owner EIP-712 signatures over the Safe message, insufficient
signatures, outsiders, duplicate owners, changed bytes, replay against another
Safe, individual EOA fallback denial, missing handlers, an actual issued login
challenge and revocation after a real Safe threshold-change transaction. Login
and revalidation do not execute a Safe transaction or spend user funds.

This is actual Safe contract interoperability, not a Safe browser-app acceptance
test. A user-facing provider flow and a full browser sign-in walkthrough still
need their own evidence. EIP-7702 behavior, private encryption, independent profile
review, publication, marketplace integration and mainnet rehearsal are not claimed.

## Separate assistant security review

The implementing assistant reviewed the change separately after the test run.
The scope is test infrastructure, pinned upstream provenance, test-only role
credentials, limited runtime roles, multi-instance races and signature-domain
binding. Existing collection source, rights bytes, dependency graph, E2EESA pins,
production refusal and publication/minting gates remain unchanged. The test
service is not a deployed production database. The reproduction artifact contains
tracked source and reproducible build inputs only, without `.git`, environment
dumps, provider credentials or wallet keys.

Disposition: this acceptance increment may merge only after every original and
new check passes on its final head. It does not authorize production or serve as
an independent expert audit. NFT-09 remains partial until the browser-provider
work is complete. NFT-15's independent UI stream can proceed from its existing
01/07 prerequisites while the pinned cryptography review remains open.

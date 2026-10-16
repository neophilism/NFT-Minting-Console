> **Current owner review policy:** [AGENTS.md](../AGENTS.md) and [security/review-policy.json](../security/review-policy.json) authorize AI source/security review and applicable passing tests for implementation, merge and deployment. Independent human review is deferred follow-up, with no claim that AI review is independent certification. Concrete defects, missing functionality/credentials and actual wallet approvals still apply.

# PR-09a separate assistant security self-review

**Date: 2026-10-12. Reviewer: the implementing assistant, in a separate review pass.**
This is NOT an independent third-party audit, expert certification, actual Safe audit,
contract audit, or an authorization to launch. No external-review field is marked complete.

## Reviewed boundaries

The review covered the authentication service, ethers signature adapter, HTTP cookies and
middleware, prototype route containment, browser session invalidation, deployment identity
preservation, changed CI wiring, and test-only contract identity fixture. It did not modify
the production collection/factory contracts, frozen rights bytes or pinned E2EESA profiles.

## Findings addressed before publication

| Risk examined | Treatment and evidence |
| --- | --- |
| Cross-origin/phishing/replay | Fixed configured origin and chain, exact message, independent binding cookie, one-shot challenge consumed before RPC; negative and concurrent tests |
| Cookie tossing/session fixation | Duplicate-cookie rejection, fresh session on reauthentication, legacy-cookie clearing, CSRF and protected logout tests |
| Role prototype-property lookup | Explicit own-property membership, not inherited object lookups; regression test |
| Logout raced by contract RPC | Touch cannot recreate a deleted session; concurrent logout/revalidation test |
| Permissive verifier return | Only literal `valid: true` with an explicit account kind is accepted; regression test |
| Contract signature failure | No EOA fallback; read-only RPC adapter; actual EVM cases committed but not locally executed |
| Browser account/network change | Immediate client invalidation and server logout; signing-race tests |
| Duplicate collection on storage-key upgrade | Existing v2 release identifier reused; corrupt identifiers fail closed; three regression tests |
| Accidental public declassification | Removed multipart/pinning path; endpoints and controls stay blocked pending accepted publication workflow |
| Misleading mint/listing status | Readiness reports `not-verified`; marketplace links cannot report a live order |
| Data loss on upgrade | No automatic deletion of historical browser drafts or receipts; explicit warning and backup requirement |
| Test injection used in production | Production refusal precedes app/provider initialization; no injected-auth escape hatch |

The ERC-1271 Solidity fixture has deliberately unrestricted test setters and is located under
`contracts/test/`. It must never be presented as a Safe implementation or deployed as a user's
wallet. The signature suite tests read-only verification, not ownership of a production Safe.

## Open findings / merge and launch conditions

Durable multi-instance authentication, actual database permission enforcement and real Safe
acceptance remain unfinished PR-09 requirements. The host-delivered browser remains part of
the trust boundary; CSP does not create a verified bootstrap or make public content private.
In-memory contract proofs and identity correlation are not a completed E2EESA privacy design.

Ninety isolated tests and syntax checks passed. Actual Express integration, pinned ethers/EVM
integration, full lint/typecheck/compile, dependencies, real-validator and profile gates still
need successful exact-head CI. Missing/running/failed checks are not accepted as green.

**Disposition:** scoped implementation and containment work is ready to submit for verification;
not approved to merge without passing checks, not accepted as complete PR-09, and not approved
for mainnet/private media. Additional crypto work must retain the applicable source review, cryptographic controls and
passing tests under the current owner policy. Independent human review remains deferred.
This historical self-review does not assert current launch acceptance or approve legal terms.
See [public launch evidence](PUBLIC_LAUNCH.md) for the later implemented scope.

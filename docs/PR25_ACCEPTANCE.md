# PR #25 mint component acceptance

Implementation head `af47dd863c4f2a786c66725981fa463244820bc1` passed core
CI `38322812259`, native PostgreSQL/Safe `38322812213`, browser acceptance
`38322812199` and status-record integrity `38322812188`.

Core CI compiled from source and ran all 56 contract cases, 69 model/UI cases,
8 data cases and 211 authentication cases, plus the original real-validator,
profile, lint/type/build and dependency-audit gates. The existing 72 browser
cases remain mandatory; this component does not change the application UI.

The exact synthetic mint artifact `11779696308` was downloaded and SHA-256
verified as `ef1da97113c00a8719b151f2dc30e860b45ac59a7292f06a0da8068e936b35b1`.
Its report independently records two distinct factory deployments, four batches
(10/10/1 and 3), and 24 successfully reconciled local token mints. The report
explicitly keeps production, public-content and listing verification false.

Final source-owned registry/evidence updates rerun all required checks. The
final head, CI runs and separate assistant security review are recorded on the
PR before merge. This is not an independent expert review or acceptance of all
NFT-22/25 requirements. See MINT_RECONCILIATION.md for the API, test boundaries,
trust anchors, transaction-envelope limits and remaining product integration.

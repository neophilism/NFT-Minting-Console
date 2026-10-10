# Real Validator Security Assertions

## Scope and provenance

PR-05 exercises `NFTCollection` against the actual Limit Break Creator Token
Transfer Validator v5 source pinned at commit
`59adb8b36ab0256c7430b017b1c9f8b4841d6e1e`. The fixture includes the upstream
management and ruleset-binding modules, Vanilla, Soulbound and Whitelist
rulesets, and their required tm-core utilities. The upstream PermitC dependency
continues to come from the locked npm dependency graph.

The vendored Solidity is not a reimplementation. Only local relative import
paths were adapted. Hardhat emits bytecode without Solidity metadata because
the upstream ruleset registration contract checks every byte against an opcode
allowlist.

## Executable assertions

The integration suite deploys the complete modular validator and proves:

- rulesets can be registered and bound by the validator administrator;
- the collection owner can select Whitelist ruleset option value `6`, whose
  bits enable OTC transfers for EIP-7702 delegates and smart wallets;
- direct EOA transfers and contract-wallet initiated transfers work under that policy;
- an EIP-7702 designation (`0xef0100 || delegate`) is recognized separately
  from an ordinary smart wallet and is blocked when its specific option is off;
- an approved marketplace operator is still rejected until it is on the active whitelist;
- whitelist status never replaces ERC-721 holder approval;
- an authorizer modeled on an OpenSea signed-zone flow can authorize, execute
  and clear a transfer atomically, while an unlisted authorizer is rejected;
- enabling account-freezing mode blocks a frozen sender, and unfreezing restores transfers;
- only the collection owner can change policy, while that owner can switch to
  Soulbound or Vanilla, documenting the owner's material policy power; and
- ERC-2981 royalty information survives a direct transfer, but no royalty is paid or enforced.

CI runs this suite separately through `npm run test:integration` after the unit suite.

## Security conclusions and limits

This evidence establishes compatibility with the pinned source and tested rules.
It does not establish that royalties are unavoidable. ERC-2981 expresses
royalty information; direct wallet transfers remain royalty-free, and the
collection owner can select a weaker validator policy. Marketplace royalty
settlement, production validator deployments, Safe versions, EIP-7702 wallet
implementations and signed-zone contracts must be verified against real network
addresses and bytecode before launch.

The test authorizer proves the validator's atomic authorization protocol, not
OpenSea's signatures or production zone implementation. The contract-wallet
fixture proves the Safe-relevant call shape without claiming parity with every
Safe release or module configuration. These residual checks remain deployment
and marketplace gates rather than claims made by this repository.

# Limit Break v5 validator fixture

This directory contains the minimum Solidity source needed to compile the real
Limit Break Creator Token Transfer Validator v5 integration fixture.

- Upstream: https://github.com/limitbreakinc/creator-token-transfer-validator
- Pinned revision: `59adb8b36ab0256c7430b017b1c9f8b4841d6e1e`
- PermitC dependency: npm package `@limitbreak/permit-c`, locked transitively by
  `@limitbreak/creator-token-standards@5.0.0` (the upstream submodule revision is
  `65e3a4a493aa14d1a03c23512233d7546e8f1e96`)

The validator, its modules and rulesets are copied from that exact upstream
revision. The required `tm-core-lib` utility files are copied from the same
revision's `lib/tm-core-lib` tree. The only source edits are import-path changes
that make those utility files resolve within this repository. Solidity compiler
metadata is disabled in Hardhat because the validator deliberately rejects
ruleset bytecode containing banned opcodes, including arbitrary metadata bytes.

The upstream MIT license is reproduced in this directory. This fixture is test
and audit evidence; production deployment must independently verify the chosen
upstream release, addresses, bytecode and deployment procedure.

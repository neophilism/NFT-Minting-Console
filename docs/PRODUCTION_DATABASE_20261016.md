# Production database initialization - 2026-10-16

Owner explicitly authorized Phillip's Render workspace and initialization of the existing NFT Minting Console production branch. Target: Neon project `dark-math-52213387`, branch `br-late-forest-b4z0hjsa`, database `neondb`. No other project was modified.

The baseline and all five authorization migrations were applied. Each exact migration source was SHA-256 checked inside PostgreSQL before execution and its digest written to the normal ledger. Baseline was a single transaction; all five authorization migrations were a second atomic transaction. Existing-schema guards and advisory transaction locks were used. No existing application rows were overwritten; this was the previously empty production target.

| Ledger | Migration | SHA-256 |
| --- | --- | --- |
| Baseline | 001_release_model.sql | 81650115cdbfd4f8efeebfe54c3d4643c80713583eb69df85b6267d4bdbfe728 |
| Authorization | 001_auth_store.sql | 8f9e438924d7a2fa87b2ec741534e52457666e9e533081c0833f5f9d2f1be397 |
| Authorization | 002_release_rbac.sql | 1a3b35de25933a4b4f17375e23385811d066385262342c72b0f0a8f1fe25bb56 |
| Authorization | 003_mint_journal.sql | a96d19edf1767f893a5c4567218782a8f67172522699c18219eaf9adb16b2642 |
| Authorization | 004_public_launch_journal.sql | 27d49f4d05f3a6eb32e30b850d14c4e85ffc007d0743a27fa6de01fe03e5a0c7 |
| Authorization | 005_launch_nonce_resolution.sql | e46355bca3fd6118df3b6e66511c4c2d5688eb784c5e3cace048e64f9ee5708a |

Created `nft_console_runtime` through SQL with LOGIN, NOINHERIT and no superuser, create-database, create-role, replication or RLS-bypass rights. Only `nft_console_api`, `nft_console_auth_service` and `nft_console_identity` were granted, with ADMIN FALSE, INHERIT FALSE, SET TRUE. Its password was generated/provisioned separately and is not recorded in source or these instructions.

A real connection as `nft_console_runtime` through the Neon connector passed a read-only SQL transaction: no direct application/auth schema access, no SET ability to the ACL helper, exactly the three intended grants, forced RLS on launch journal/events/nonce proofs, zero unbound visible rows, no ability to delete launch history, rewrite public plans/proofs or directly insert audit events. Intended auth-service permissions are present. No synthetic private rows or blockchain transactions were created by these checks.

Render reported the owner's tutorial build `d53a1c760416b95f18e3ab846fb8caa4a5ee3035` live at deploy `dep-db97o5brjlhs73asrmm0`. That is not proof that the new database is wired to Render or that RPC/Pinata credentials authenticated successfully. Public HTTP probing from this execution environment was unavailable. The owner's actual public admin/deployment/minter addresses are still needed before configuring the runtime database together with an authorized wallet policy and production launch flags. Do not substitute public test-fixture wallets.

This supersedes prior statements that production is empty. The isolated development branches are unchanged. Full application-to-production database connectivity, approved final NFT materials, owner signatures and a real mint remain separate acceptance steps. No security certification is claimed.

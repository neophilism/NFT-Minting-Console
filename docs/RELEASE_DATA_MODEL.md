# Release data model

PR-07's canonical backend is PostgreSQL, as specified by development-plan section
3. See [PostgreSQL schema and access boundaries](POSTGRES_RELEASE_SCHEMA.md) for
the complete 14-table inventory, exact numeric/hash types, owner-scoped RLS,
append-only publication/chain facts, migration procedure, acceptance evidence and
remaining review/deployment gates.

The earlier, unused SQLite adapter has been replaced. It was never connected to
an application route and does not satisfy the planned backend/privacy boundary.
No local experimental database file is deleted or claimed to have been migrated.

Draft fields are opaque client ciphertext. This schema does not encrypt data,
authenticate requests or activate a public upload path. PR-09 must establish
trusted session/RBAC context; PR-10 onward supplies reviewed client encryption.
Configure `DATABASE_URL` only through the environment secret manager. Run
`npm run db:migrate` with the separate migration identity, and
`npm run test:data` for the actual PostgreSQL isolation/migration regression suite.

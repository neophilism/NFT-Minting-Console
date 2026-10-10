import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

/** Apply forward-only migrations using one checked-out database connection. */
export async function migrate(client, directory = fileURLToPath(new URL("../db/migrations/", import.meta.url))) {
  const names = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (names.length === 0) throw new Error("No schema migrations found");
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(745683219)");
    await client.query("CREATE SCHEMA IF NOT EXISTS nft_console");
    await client.query(`CREATE TABLE IF NOT EXISTS nft_console.schema_migrations (
        name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const previous = await client.query("SELECT name, sha256 FROM nft_console.schema_migrations ORDER BY name");
    const applied = new Map(previous.rows.map(row => [row.name, row.sha256]));
    if ([...applied.keys()].some(name => !names.includes(name))) throw new Error("Applied migration is missing from this checkout");
    const pending = [];
    for (const name of names) {
      const sql = await readFile(path.join(directory, name), "utf8");
      const digest = createHash("sha256").update(sql).digest("hex");
      if (applied.has(name)) {
        if (applied.get(name) !== digest) throw new Error(`Applied migration changed: ${name}`);
        if (pending.length) throw new Error("Cannot insert a migration before an already applied migration");
        continue;
      }
      // PGlite exposes the simple-query protocol as exec; node-postgres
      // uses query without parameters for the same multi-statement script.
      if (typeof client.exec === "function") await client.exec(sql);
      else await client.query(sql);
      await client.query("INSERT INTO nft_console.schema_migrations (name, sha256) VALUES ($1, $2)", [name, digest]);
      pending.push(name);
    }
    await client.query("COMMIT");
    return pending;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) throw new Error("Configure DATABASE_URL in the environment secret manager");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    console.log(JSON.stringify({ applied: await migrate(client) }));
  } finally {
    await client.end();
  }
}

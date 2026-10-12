import {createHash} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

/** A separate ledger preserves the already accepted baseline migration bytes. */
export async function migrateAuth(client,directory=fileURLToPath(new URL('../db/auth-migrations/',import.meta.url))) {
  const names=(await readdir(directory)).filter(name=>/^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  if(!names.length)throw new Error('No authorization migrations found.');
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(745683220)');
    const baseline=await client.query("SELECT to_regclass('nft_console.releases') AS name");
    if(!baseline.rows[0]?.name)throw new Error('Apply baseline release migrations first.');
    await client.query('CREATE SCHEMA IF NOT EXISTS nft_console_auth');
    await client.query('REVOKE ALL ON SCHEMA nft_console_auth FROM PUBLIC');
    await client.query('CREATE TABLE IF NOT EXISTS nft_console_auth.schema_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    await client.query('REVOKE ALL ON nft_console_auth.schema_migrations FROM PUBLIC');
    const history=await client.query('SELECT name,sha256 FROM nft_console_auth.schema_migrations ORDER BY name');
    const applied=new Map(history.rows.map(row=>[row.name,row.sha256]));
    if([...applied.keys()].some(name=>!names.includes(name)))throw new Error('Applied authorization migration is missing.');
    const pending=[];
    for(const name of names) {
      const sql=await readFile(path.join(directory,name),'utf8');
      const sha256=createHash('sha256').update(sql).digest('hex');
      if(applied.has(name)) {
        if(applied.get(name)!==sha256)throw new Error('Applied authorization migration changed: '+name);
        if(pending.length)throw new Error('Cannot insert a migration before applied history.');
        continue;
      }
      if(typeof client.exec==='function')await client.exec(sql);else await client.query(sql);
      await client.query('INSERT INTO nft_console_auth.schema_migrations(name,sha256) VALUES($1,$2)',[name,sha256]);
      pending.push(name);
    }
    await client.query('COMMIT');return pending;
  } catch(error) {await client.query('ROLLBACK');throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  await import('dotenv/config');
  const url=process.env.DATABASE_URL_UNPOOLED;
  if(!url||new URL(url).hostname.includes('-pooler'))throw new Error('Use a direct DATABASE_URL_UNPOOLED in a separate operations environment.');
  const {default:pg}=await import('pg');const {migrate}=await import('./migrate.mjs');
  const {databaseOptions}=await import('../console/data/pool.mjs');
  const client=new pg.Client(databaseOptions(url));await client.connect();
  try {console.log(JSON.stringify({baseline:await migrate(client),authorization:await migrateAuth(client)}));}finally{await client.end();}
}

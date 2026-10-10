import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "../scripts/migrate.mjs";

const cipher = Buffer.alloc(32, 0x91);
const nonce = Buffer.alloc(12, 0x82);
const hash = Buffer.alloc(32, 0x73);
const wallet = "0x" + "11".repeat(20);
const table = name => `nft_console.${name}`;
const db = new PGlite();
await db.waitReady;
const accountA = randomUUID(), accountB = randomUUID();
const releaseA = randomUUID(), releaseB = randomUUID(), releaseC = randomUUID();

async function asAccount(accountId, action) {
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL ROLE nft_console_api");
    if (accountId) await db.query("SELECT set_config('nft_console.account_id', $1, true)", [accountId]);
    const result = await action();
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

async function insertAsset(releaseId, id = randomUUID()) {
  await db.query(`INSERT INTO ${table("assets")}
    (id, release_id, object_id, manifest_ciphertext, manifest_nonce, ciphertext_size)
    VALUES ($1,$2,$3,$4,$5,32)`, [id, releaseId, randomUUID(), cipher, nonce]);
  return id;
}

async function insertRights(releaseId, id = randomUUID()) {
  await db.query(`INSERT INTO ${table("rights_versions")}
    (id, release_id, version_number, document_ciphertext, document_nonce)
    VALUES ($1,$2,1,$3,$4)`, [id, releaseId, cipher, nonce]);
  await db.query(`UPDATE ${table("rights_versions")} SET published_sha256=$2, published_uri='ipfs://RightsFixture' WHERE id=$1`, [id, hash]);
  return id;
}

async function insertPublication(releaseId, assetId, rightsId, tokenId = "1") {
  const id = randomUUID();
  await db.query(`INSERT INTO ${table("publications")}
    (id, release_id, asset_id, rights_version_id, token_id, title,
     media_sha256, rights_sha256, metadata_sha256, media_uri, rights_uri, metadata_uri, consent_digest, confirmed_by_account_id)
    VALUES ($1,$2,$3,$4,$5,'Public fixture title',$6,$6,$6,'ipfs://MediaFixture','ipfs://RightsFixture','ipfs://MetadataFixture',$6,$7)`,
  [id, releaseId, assetId, rightsId, tokenId, hash, accountA]);
  return id;
}

test("clean migration is atomic, repeatable and checksum bound", async () => {
  assert.deepEqual(await migrate(db), ["001_release_model.sql"]);
  assert.deepEqual(await migrate(db), []);
  const flags = await db.query("SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='nft_console_api'");
  assert.deepEqual(flags.rows[0], { rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false });
  const temporary = await mkdtemp(path.join(os.tmpdir(), "nft-schema-"));
  try {
    const source = await readFile(new URL("../db/migrations/001_release_model.sql", import.meta.url), "utf8");
    await writeFile(path.join(temporary, "001_release_model.sql"), source + "\n-- edited history\n");
    await assert.rejects(migrate(db, temporary), /Applied migration changed/);
    await writeFile(path.join(temporary, "001_release_model.sql"), source);
    await writeFile(path.join(temporary, "002_failure.sql"), "CREATE TABLE nft_console.must_rollback(id integer); SELECT missing_function();");
    await assert.rejects(migrate(db, temporary));
    const absent = await db.query("SELECT to_regclass('nft_console.must_rollback') AS name");
    assert.equal(absent.rows[0].name, null);
    assert.equal((await db.query("SELECT count(*)::integer AS count FROM nft_console.schema_migrations")).rows[0].count, 1);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  await db.query(`INSERT INTO ${table("accounts")} (id,wallet,chain_id) VALUES ($1,$2,1),($3,$4,1)`, [accountA,wallet,accountB,"0x"+"22".repeat(20)]);
  for (const [releaseId, accountId] of [[releaseA,accountA],[releaseB,accountB],[releaseC,accountA]]) {
    await asAccount(accountId, () => db.query(`INSERT INTO ${table("releases")}
      (id,owner_account_id,workspace_ciphertext,workspace_nonce) VALUES ($1,$2,$3,$4)`, [releaseId,accountId,cipher,nonce]));
  }
});

test("nonprivileged RLS denies other owners and unbound pooled sessions", async () => {
  const visible = await asAccount(accountA, () => db.query(`SELECT id FROM ${table("releases")} ORDER BY id`));
  assert.deepEqual(visible.rows.map(x=>x.id).sort(), [releaseA,releaseC].sort());
  const hidden = await asAccount(accountA, () => db.query(`UPDATE ${table("releases")} SET state='archived' WHERE id=$1 RETURNING id`, [releaseB]));
  assert.equal(hidden.rows.length, 0);
  await assert.rejects(asAccount(accountA, () => db.query(`INSERT INTO ${table("releases")}
    (id,owner_account_id,workspace_ciphertext,workspace_nonce) VALUES ($1,$2,$3,$4)`, [randomUUID(),accountB,cipher,nonce])), /row-level security/);
  const unauthenticated = await asAccount(null, () => db.query(`SELECT id FROM ${table("releases")}`));
  assert.equal(unauthenticated.rows.length, 0);
  const guarded = await db.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class JOIN pg_namespace n ON n.oid=relnamespace WHERE n.nspname='nft_console' AND relkind='r' AND relname <> 'schema_migrations'");
  assert.equal(guarded.rows.length, 14);
  for (const row of guarded.rows) {
    assert.equal(row.relrowsecurity, true, row.relname);
    assert.equal(row.relforcerowsecurity, true, row.relname);
  }
  await assert.rejects(asAccount(accountA, () => db.query(`UPDATE ${table("releases")} SET owner_account_id=$2 WHERE id=$1`, [releaseA,accountB])), /retargeted/);
  await assert.rejects(asAccount(accountA, () => db.query("ALTER ROLE nft_console_api BYPASSRLS")));
});

test("asset, edition and rights references cannot cross unrelated releases", async () => {
  const assetA = await asAccount(accountA, () => insertAsset(releaseA));
  const assetB = await asAccount(accountB, () => insertAsset(releaseB));
  await assert.rejects(asAccount(accountA, () => db.query(`INSERT INTO ${table("editions")}
    (id,release_id,asset_id,edition_number,edition_count,attributes_ciphertext,attributes_nonce)
    VALUES ($1,$2,$3,1,3,$4,$5)`, [randomUUID(),releaseA,assetB,cipher,nonce])), /foreign key/);
  const rightsC = await asAccount(accountA, () => insertRights(releaseC));
  await assert.rejects(asAccount(accountA, () => insertPublication(releaseA,assetA,rightsC)), /foreign key/);
  await assert.rejects(asAccount(accountA, () => db.query(`UPDATE ${table("assets")} SET release_id=$2 WHERE id=$1`, [assetA,releaseC])), /retargeted/);
  const hidden = await asAccount(accountA, () => db.query(`SELECT id FROM ${table("assets")} WHERE id=$1`, [assetB]));
  assert.equal(hidden.rows.length, 0);
  await assert.rejects(asAccount(accountA, () => insertAsset(releaseB)), /row-level security/);
});

test("exact hash bytes and rights version references are bound once", async () => {
  const rights = await asAccount(accountA, () => insertRights(releaseA));
  const asset = await asAccount(accountA, () => insertAsset(releaseA));
  const publication = await asAccount(accountA, () => insertPublication(releaseA,asset,rights));
  const row = await asAccount(accountA, () => db.query(`SELECT media_sha256,rights_sha256 FROM ${table("publications")} WHERE id=$1`, [publication]));
  assert.deepEqual(Buffer.from(row.rows[0].media_sha256), hash);
  assert.deepEqual(Buffer.from(row.rows[0].rights_sha256), hash);
  await assert.rejects(asAccount(accountA, () => db.query(`UPDATE ${table("rights_versions")} SET document_ciphertext=$2 WHERE id=$1`, [rights,Buffer.alloc(32,4)])), /Rights versions are immutable/);
  await assert.rejects(asAccount(accountA, () => db.query(`UPDATE ${table("rights_versions")} SET published_sha256=$2 WHERE id=$1`, [rights,Buffer.alloc(32,3)])), /Rights versions are immutable/);
  await assert.rejects(asAccount(accountA, () => db.query(`UPDATE ${table("publications")} SET title='Changed' WHERE id=$1`, [publication])), /permission denied/);
  await assert.rejects(db.query(`UPDATE ${table("publications")} SET title='Changed' WHERE id=$1`, [publication]), /append-only/);
  await assert.rejects(db.query(`DELETE FROM ${table("publications")} WHERE id=$1`, [publication]), /append-only/);
  await assert.rejects(asAccount(accountA, () => db.query(`UPDATE ${table("assets")} SET object_id=$2 WHERE id=$1`, [asset,randomUUID()])), /Published asset references/);
  await assert.rejects(asAccount(accountA, () => insertPublication(releaseA,asset,rights)), /unique constraint/);
  await assert.rejects(db.query("SELECT $1::nft_console.sha256", [Buffer.alloc(31,3)]), /check constraint/);
});

test("uint256 values preserve all digits and reject rounding, negatives and overflow", async () => {
  const exact = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
  assert.equal((await db.query("SELECT $1::nft_console.uint256::text AS value", [exact])).rows[0].value, exact);
  await assert.rejects(db.query("SELECT $1::nft_console.uint256", [(BigInt(exact)+1n).toString()]), /check constraint/);
  await assert.rejects(db.query("SELECT $1::nft_console.uint256", ["-1"]), /check constraint/);
  await assert.rejects(db.query("SELECT $1::nft_console.uint256", ["1.5"]), /check constraint/);
});

test("deployment and mint evidence stays isolated, immutable and within supply", async () => {
  const profile = randomUUID(), deployJob = randomUUID(), mintJob = randomUUID(), deployment = randomUUID();
  await asAccount(accountA, async () => {
    await db.query(`INSERT INTO ${table("deployment_profiles")}
      (id,release_id,chain_id,contract_version,creation_code_sha256,runtime_code_sha256,constructor_digest,collection_name,symbol,maximum_supply,royalty_bps,owner_wallet,minter_wallet,royalty_wallet)
      VALUES ($1,$2,31337,'fixture-v1',$3,$3,$3,'Independent Release','INDEP',2,400,$4,$4,$4)`, [profile,releaseA,hash,wallet]);
    for (const [id, kind] of [[deployJob,"deploy"],[mintJob,"mint"]]) {
      await db.query(`INSERT INTO ${table("transaction_jobs")} (id,release_id,kind,idempotency_key,payload_ciphertext,payload_nonce)
        VALUES ($1,$2,$3,$4,$5,$6)`, [id,releaseA,kind,randomUUID(),cipher,nonce]);
    }
    await db.query(`INSERT INTO ${table("deployments")}
      (id,release_id,profile_id,job_id,chain_id,contract_address,transaction_hash,block_hash,block_number)
      VALUES ($1,$2,$3,$4,31337,$5,$6,$6,1)`, [deployment,releaseA,profile,deployJob,wallet,hash]);
    const existing = (await db.query(`SELECT id,token_id FROM ${table("publications")} WHERE release_id=$1`, [releaseA])).rows[0];
    const token = randomUUID();
    await db.query(`INSERT INTO ${table("tokens")}
      (id,release_id,publication_id,deployment_id,mint_job_id,token_id,minted_to,transaction_hash,block_hash,block_number)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,2)`, [token,releaseA,existing.id,deployment,mintJob,existing.token_id,wallet,hash]);
  });
  const hidden = await asAccount(accountB, () => db.query(`SELECT id FROM ${table("tokens")}`));
  assert.equal(hidden.rows.length, 0);
  await assert.rejects(db.query(`UPDATE ${table("deployment_profiles")} SET royalty_bps=600 WHERE id=$1`, [profile]), /append-only/);
  const asset = await asAccount(accountA, () => insertAsset(releaseA));
  const rights = (await asAccount(accountA, () => db.query(`SELECT id FROM ${table("rights_versions")} WHERE release_id=$1`, [releaseA]))).rows[0].id;
  const tooHigh = await asAccount(accountA, () => insertPublication(releaseA,asset,rights,"3"));
  await assert.rejects(asAccount(accountA, () => db.query(`INSERT INTO ${table("tokens")}
    (id,release_id,publication_id,deployment_id,mint_job_id,token_id,minted_to,transaction_hash,block_hash,block_number)
    VALUES ($1,$2,$3,$4,$5,3,$6,$7,$7,3)`, [randomUUID(),releaseA,tooHigh,deployment,mintJob,wallet,hash])), /exceeds.*supply/);
});

test("idempotency, truthful listing observations and encrypted audit boundaries fail closed", async () => {
  const job = randomUUID(), key = randomUUID();
  const input = [job,releaseA,key,cipher,nonce];
  const jobSQL = `INSERT INTO ${table("transaction_jobs")} (id,release_id,kind,idempotency_key,payload_ciphertext,payload_nonce) VALUES ($1,$2,'mint',$3,$4,$5)`;
  await asAccount(accountA, () => db.query(jobSQL, input));
  await assert.rejects(asAccount(accountA, () => db.query(jobSQL, [randomUUID(),...input.slice(1)])), /unique constraint/);
  await assert.rejects(asAccount(accountA, () => db.query(`UPDATE ${table("transaction_jobs")} SET state='confirmed' WHERE id=$1`, [job])), /check constraint/);
  const token = (await asAccount(accountA, () => db.query(`SELECT id FROM ${table("tokens")} WHERE release_id=$1`, [releaseA]))).rows[0].id;
  const listing = randomUUID();
  await asAccount(accountA, () => db.query(`INSERT INTO ${table("listings")} (id,release_id,token_record_id,order_hash,price_base_units,expires_at)
    VALUES ($1,$2,$3,$4,50000000000000000,now()+interval '1 day')`, [listing,releaseA,token,hash]));
  await assert.rejects(asAccount(accountA, () => db.query(`INSERT INTO ${table("listing_observations")}
    (id,release_id,listing_id,state,api_verified,chain_verified,evidence_digest,checked_at)
    VALUES ($1,$2,$3,'active',true,false,$4,now())`, [randomUUID(),releaseA,listing,hash])), /check constraint/);
  const audit = randomUUID();
  await asAccount(accountA, () => db.query(`INSERT INTO ${table("activity_log")}
    (id,release_id,actor_account_id,event_type,details_ciphertext,details_nonce) VALUES ($1,$2,$3,'release.created',$4,$5)`, [audit,releaseA,accountA,cipher,nonce]));
  await assert.rejects(db.query(`DELETE FROM ${table("activity_log")} WHERE id=$1`, [audit]), /append-only/);
  await assert.rejects(asAccount(accountA, () => db.query(`INSERT INTO ${table("activity_log")}
    (id,release_id,actor_account_id,event_type,details_ciphertext,details_nonce) VALUES ($1,$2,$3,'release.created',$4,$5)`, [randomUUID(),releaseA,accountB,cipher,nonce])), /row-level security/);
  const columns = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='nft_console' AND table_name IN ('releases','assets','rights_versions','activity_log')")).rows.map(x=>x.column_name);
  for (const forbidden of ["filename","title","rights_text","content_key","private_key","seed_phrase"]) assert.equal(columns.includes(forbidden),false);
});

test.after(async () => { await db.close(); });

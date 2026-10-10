import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.join(moduleDir, "migrations");
const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

function now() {
  return new Date().toISOString();
}

function checkedId(value, label = "ID") {
  const text = String(value || "");
  if (!ID.test(text)) throw new Error(`${label} is invalid`);
  return text;
}

function checkedHash(value, label = "SHA-256") {
  const text = String(value || "");
  if (!HASH.test(text)) throw new Error(`${label} must be 64 lowercase hexadecimal characters`);
  return text;
}

function checkedAddress(value, label) {
  if (!ethers.isAddress(value)) throw new Error(`${label} must be an Ethereum address`);
  return ethers.getAddress(value).toLowerCase();
}

function migrations() {
  return fs.readdirSync(migrationDir)
    .filter((name) => /^\d{3}-.+\.sql$/.test(name))
    .sort()
    .map((name) => {
      const sql = fs.readFileSync(path.join(migrationDir, name), "utf8");
      return {
        version: Number(name.slice(0, 3)),
        name,
        sql,
        checksum: crypto.createHash("sha256").update(sql).digest("hex"),
      };
    });
}

export function migrate(database, through = Infinity) {
  database.exec(`PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT;`);
  const applied = new Map(
    database.prepare("SELECT version, sha256 FROM schema_migrations").all()
      .map((row) => [Number(row.version), row.sha256]),
  );
  for (const migration of migrations()) {
    if (migration.version > through) continue;
    if (applied.has(migration.version)) {
      if (applied.get(migration.version) !== migration.checksum) {
        throw new Error(`Applied migration ${migration.version} checksum mismatch`);
      }
      continue;
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database.prepare(
        "INSERT INTO schema_migrations(version, name, sha256, applied_at) VALUES (?, ?, ?, ?)",
      ).run(migration.version, migration.name, migration.checksum, now());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  return Number(database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get().version);
}

export function openReleaseStore(filename = process.env.DATA_DB_PATH || "data/nft-console.sqlite") {
  if (filename !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  migrate(database);
  return new ReleaseStore(database);
}

export class ReleaseStore {
  constructor(database) {
    this.database = database;
  }

  close() {
    this.database.close();
  }

  createRelease(input) {
    const createdAt = input.createdAt || now();
    const release = {
      id: checkedId(input.id, "Release ID"),
      ownerWallet: checkedAddress(input.ownerWallet, "Owner wallet"),
      state: input.state || "draft",
      name: String(input.name || ""),
      symbol: String(input.symbol || ""),
      maximumSupply: Number(input.maximumSupply),
      royaltyBps: Number(input.royaltyBps),
      royaltyRecipient: checkedAddress(input.royaltyRecipient, "Royalty recipient"),
    };
    if (!release.name || !release.symbol) throw new Error("Release name and symbol are required");
    this.database.prepare(`INSERT INTO releases
      (id, owner_wallet, state, name, symbol, maximum_supply, royalty_bps, royalty_recipient, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      release.id, release.ownerWallet, release.state, release.name, release.symbol,
      release.maximumSupply, release.royaltyBps, release.royaltyRecipient, createdAt, createdAt,
    );
    return this.getRelease(release.id, release.ownerWallet);
  }

  addRightsVersion(releaseId, input) {
    const id = checkedId(input.id, "Rights version ID");
    this.database.prepare(`INSERT INTO rights_versions
      (id, release_id, version, content_sha256, byte_length, media_type, public_uri, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, checkedId(releaseId, "Release ID"), Number(input.version),
      checkedHash(input.contentSha256, "Rights SHA-256"), Number(input.byteLength),
      String(input.mediaType), input.publicUri || null, input.createdAt || now(),
    );
    return id;
  }

  addEdition(releaseId, input) {
    const id = checkedId(input.id, "Edition ID");
    this.database.prepare(`INSERT INTO editions
      (id, release_id, edition_key, title, quantity, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      id, checkedId(releaseId, "Release ID"), checkedId(input.editionKey, "Edition key"),
      String(input.title), Number(input.quantity), input.createdAt || now(),
    );
    return id;
  }

  addToken(releaseId, input) {
    this.database.prepare(`INSERT INTO token_records
      (release_id, token_id, edition_id, title, metadata_uri, media_sha256,
       rights_version_id, rights_sha256, minted_transaction_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      checkedId(releaseId, "Release ID"), Number(input.tokenId), checkedId(input.editionId, "Edition ID"),
      String(input.title), String(input.metadataUri), checkedHash(input.mediaSha256, "Media SHA-256"),
      checkedId(input.rightsVersionId, "Rights version ID"), checkedHash(input.rightsSha256, "Rights SHA-256"),
      input.mintedTransactionHash || null, input.createdAt || now(),
    );
  }

  addAsset(releaseId, input) {
    const id = checkedId(input.id, "Asset ID");
    this.database.prepare(`INSERT INTO assets
      (id, release_id, kind, ciphertext_sha256, plaintext_sha256, byte_length,
       media_type, storage_locator, published_uri, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, checkedId(releaseId, "Release ID"), input.kind,
      input.ciphertextSha256 ? checkedHash(input.ciphertextSha256, "Ciphertext SHA-256") : null,
      input.plaintextSha256 ? checkedHash(input.plaintextSha256, "Plaintext SHA-256") : null,
      Number(input.byteLength), String(input.mediaType), input.storageLocator || null,
      input.publishedUri || null, input.createdAt || now(),
    );
    return id;
  }

  recordDeployment(releaseId, input) {
    const id = checkedId(input.id, "Deployment ID");
    this.database.prepare(`INSERT INTO deployment_profiles
      (id, release_id, chain_id, factory_address, factory_version,
       collection_creation_code_id, collection_address, config_hash, init_code_hash,
       transaction_hash, block_number, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, checkedId(releaseId, "Release ID"), Number(input.chainId),
      checkedAddress(input.factoryAddress, "Factory address"), checkedHash(input.factoryVersion, "Factory version"),
      checkedHash(input.collectionCreationCodeId, "Creation-code ID"),
      checkedAddress(input.collectionAddress, "Collection address"), checkedHash(input.configHash, "Config hash"),
      checkedHash(input.initCodeHash, "Init-code hash"), String(input.transactionHash),
      Number(input.blockNumber), input.createdAt || now(),
    );
    return id;
  }

  appendActivity(releaseId, actorWallet, action, payload = {}) {
    const result = this.database.prepare(`INSERT INTO activity_log
      (release_id, actor_wallet, action, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      checkedId(releaseId, "Release ID"), checkedAddress(actorWallet, "Actor wallet"),
      String(action), JSON.stringify(payload), now(),
    );
    return Number(result.lastInsertRowid);
  }

  listReleases(ownerWallet) {
    return this.database.prepare(
      "SELECT * FROM releases WHERE owner_wallet = ? ORDER BY created_at, id",
    ).all(checkedAddress(ownerWallet, "Owner wallet"));
  }

  getRelease(releaseId, ownerWallet) {
    const id = checkedId(releaseId, "Release ID");
    const owner = checkedAddress(ownerWallet, "Owner wallet");
    const release = this.database.prepare(
      "SELECT * FROM releases WHERE id = ? AND owner_wallet = ?",
    ).get(id, owner);
    if (!release) return null;
    return {
      ...release,
      rightsVersions: this.database.prepare(
        "SELECT * FROM rights_versions WHERE release_id = ? ORDER BY version",
      ).all(id),
      assets: this.database.prepare("SELECT * FROM assets WHERE release_id = ? ORDER BY id").all(id),
      editions: this.database.prepare("SELECT * FROM editions WHERE release_id = ? ORDER BY id").all(id),
      tokens: this.database.prepare("SELECT * FROM token_records WHERE release_id = ? ORDER BY token_id").all(id),
      deployments: this.database.prepare(
        "SELECT * FROM deployment_profiles WHERE release_id = ? ORDER BY chain_id",
      ).all(id),
    };
  }
}

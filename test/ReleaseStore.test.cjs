const { expect } = require("chai");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HASH_A = "ab".repeat(32);
const HASH_B = "cd".repeat(32);
const BYTES_A = `0x${HASH_A}`;
const BYTES_B = `0x${HASH_B}`;
const WALLET_A = "0x1000000000000000000000000000000000000001";
const WALLET_B = "0x2000000000000000000000000000000000000002";
const WALLET_C = "0x3000000000000000000000000000000000000003";

describe("release data migrations and isolation", function () {
  let api;
  let directory;
  let store;

  before(async function () {
    api = await import("../server/storage.mjs");
  });

  beforeEach(function () {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "nft-console-data-"));
    store = api.openReleaseStore(path.join(directory, "test.sqlite"));
  });

  afterEach(function () {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function release(id, owner, values = {}) {
    return store.createRelease({
      id,
      ownerWallet: owner,
      name: values.name || id,
      symbol: values.symbol || id.slice(0, 4).toUpperCase(),
      maximumSupply: values.maximumSupply || 10,
      royaltyBps: values.royaltyBps ?? 600,
      royaltyRecipient: values.royaltyRecipient || owner,
    });
  }

  function content(releaseId, suffix, hash = HASH_A) {
    store.addRightsVersion(releaseId, {
      id: `rights-${suffix}`,
      version: 1,
      contentSha256: hash,
      byteLength: 123,
      mediaType: "text/plain",
      publicUri: `ipfs://rights-${suffix}`,
    });
    store.addEdition(releaseId, {
      id: `edition-${suffix}`,
      editionKey: "original",
      title: `Edition ${suffix}`,
      quantity: 1,
    });
    store.addToken(releaseId, {
      tokenId: 1,
      editionId: `edition-${suffix}`,
      title: `Token ${suffix}`,
      metadataUri: `ipfs://metadata-${suffix}`,
      mediaSha256: HASH_B,
      rightsVersionId: `rights-${suffix}`,
      rightsSha256: hash,
    });
  }

  it("applies ordered migrations idempotently", function () {
    expect(api.migrate(store.database)).to.equal(2);
    expect(api.migrate(store.database)).to.equal(2);
    const tables = store.database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all().map((row) => row.name);
    for (const name of [
      "activity_log", "assets", "deployment_profiles", "editions", "listings",
      "releases", "rights_versions", "token_records", "transaction_jobs",
    ]) expect(tables).to.include(name);
  });

  it("isolates two collections with overlapping token IDs and edition keys", function () {
    release("release-alpha", WALLET_A, { name: "Alpha", maximumSupply: 2 });
    release("release-beta", WALLET_B, { name: "Beta", maximumSupply: 99 });
    content("release-alpha", "alpha", HASH_A);
    content("release-beta", "beta", HASH_B);

    const alpha = store.getRelease("release-alpha", WALLET_A);
    const beta = store.getRelease("release-beta", WALLET_B);
    expect(alpha.name).to.equal("Alpha");
    expect(beta.name).to.equal("Beta");
    expect(alpha.tokens).to.have.length(1);
    expect(beta.tokens).to.have.length(1);
    expect(alpha.tokens[0].rights_sha256).to.equal(HASH_A);
    expect(beta.tokens[0].rights_sha256).to.equal(HASH_B);
    expect(store.getRelease("release-alpha", WALLET_B)).to.equal(null);
    expect(store.listReleases(WALLET_A).map((row) => row.id)).to.deep.equal(["release-alpha"]);
  });

  it("rejects cross-release edition and rights references", function () {
    release("release-alpha", WALLET_A);
    release("release-beta", WALLET_B);
    content("release-alpha", "alpha");

    expect(() => store.addToken("release-beta", {
      tokenId: 1,
      editionId: "edition-alpha",
      title: "Cross release",
      metadataUri: "ipfs://cross",
      mediaSha256: HASH_A,
      rightsVersionId: "rights-alpha",
      rightsSha256: HASH_A,
    })).to.throw();
  });

  it("preserves exact lowercase hashes and makes publication evidence append-only", function () {
    release("release-alpha", WALLET_A);
    store.addRightsVersion("release-alpha", {
      id: "rights-alpha",
      version: 1,
      contentSha256: HASH_A,
      byteLength: 64,
      mediaType: "text/plain",
      publicUri: "ipfs://exact-rights",
    });
    store.addAsset("release-alpha", {
      id: "asset-alpha",
      kind: "media",
      plaintextSha256: HASH_B,
      byteLength: 999,
      mediaType: "image/png",
      publishedUri: "ipfs://exact-media",
    });
    const graph = store.getRelease("release-alpha", WALLET_A);
    expect(graph.rightsVersions[0].content_sha256).to.equal(HASH_A);
    expect(graph.assets[0].plaintext_sha256).to.equal(HASH_B);
    expect(() => store.database.prepare(
      "UPDATE rights_versions SET content_sha256 = ? WHERE id = ?",
    ).run(HASH_B, "rights-alpha")).to.throw("append-only");
    expect(() => store.database.prepare(
      "UPDATE assets SET published_uri = ? WHERE id = ?",
    ).run("ipfs://changed", "asset-alpha")).to.throw("immutable");
    expect(() => store.addRightsVersion("release-alpha", {
      id: "rights-uppercase",
      version: 2,
      contentSha256: HASH_A.toUpperCase(),
      byteLength: 64,
      mediaType: "text/plain",
    })).to.throw("64 lowercase");
  });

  it("records immutable deployment evidence and append-only activity", function () {
    release("release-alpha", WALLET_A);
    store.recordDeployment("release-alpha", {
      id: "deployment-mainnet",
      chainId: 1,
      factoryAddress: WALLET_B,
      factoryVersion: BYTES_A,
      collectionCreationCodeId: BYTES_B,
      collectionAddress: WALLET_C,
      configHash: BYTES_A,
      initCodeHash: BYTES_B,
      transactionHash: "0x" + "ef".repeat(32),
      blockNumber: 123,
    });
    const sequence = store.appendActivity("release-alpha", WALLET_A, "deployment.confirmed", { block: 123 });
    expect(sequence).to.equal(1);
    expect(() => store.database.prepare(
      "UPDATE deployment_profiles SET block_number = 124 WHERE id = ?",
    ).run("deployment-mainnet")).to.throw("immutable");
    expect(() => store.database.prepare(
      "DELETE FROM activity_log WHERE sequence = ?",
    ).run(sequence)).to.throw("append-only");
  });
});

const { expect } = require("chai");
const { artifacts, ethers } = require("hardhat");
const { deployRelease } = require("../scripts/rehearse-deployments.cjs");

describe("NFTCollectionFactory", function () {
  const config = (values = {}) => ({
    name: "Factory Release",
    symbol: "FACT",
    seriesSize: 12,
    royaltyBps: 650,
    owner: values.owner,
    minter: values.minter,
    royaltyRecipient: values.royaltyRecipient,
    ...values,
  });

  async function fixture() {
    const [requester, owner, minter, recipient, other] = await ethers.getSigners();
    const factory = await (await ethers.getContractFactory("NFTCollectionFactory")).deploy();
    await factory.waitForDeployment();
    return { factory, requester, owner, minter, recipient, other };
  }

  it("publishes stable version and collection creation-code identifiers", async function () {
    const { factory } = await fixture();
    const artifact = await artifacts.readArtifact("NFTCollection");
    expect(await factory.FACTORY_VERSION()).to.equal(ethers.id("nft-console.collection-factory.v1"));
    expect(await factory.COLLECTION_CREATION_CODE_ID()).to.equal(ethers.keccak256(artifact.bytecode));
  });

  it("deploys to its predicted address and emits a complete deterministic receipt", async function () {
    const { factory, requester, owner, minter, recipient } = await fixture();
    const releaseId = ethers.id("release/2026/alpha");
    const values = config({
      owner: owner.address,
      minter: minter.address,
      royaltyRecipient: recipient.address,
    });
    const predicted = await factory.predictCollectionAddress(releaseId, values);
    const configHash = await factory.hashConfig(values);
    const initCodeHash = await factory.collectionInitCodeHash(values);
    const chainId = (await ethers.provider.getNetwork()).chainId;

    await expect(factory.deployCollection(releaseId, values))
      .to.emit(factory, "CollectionDeployed")
      .withArgs(
        releaseId,
        predicted,
        requester.address,
        chainId,
        await factory.FACTORY_VERSION(),
        await factory.COLLECTION_CREATION_CODE_ID(),
        configHash,
        initCodeHash,
      );
    expect(await factory.collectionForRelease(releaseId)).to.equal(predicted);
  });

  it("rejects duplicate release deployments without creating another collection", async function () {
    const { factory, owner, minter, recipient } = await fixture();
    const releaseId = ethers.id("release/duplicate");
    const values = config({
      owner: owner.address,
      minter: minter.address,
      royaltyRecipient: recipient.address,
    });
    await factory.deployCollection(releaseId, values);
    const deployed = await factory.collectionForRelease(releaseId);
    await expect(factory.deployCollection(releaseId, values))
      .to.be.revertedWithCustomError(factory, "DuplicateRelease")
      .withArgs(releaseId, deployed);
  });

  it("validates every constructor boundary before CREATE2", async function () {
    const { factory, owner, minter, recipient } = await fixture();
    const base = { owner: owner.address, minter: minter.address, royaltyRecipient: recipient.address };
    await expect(factory.deployCollection(ethers.ZeroHash, config(base))).to.be.revertedWithCustomError(factory, "EmptyReleaseId");
    await expect(factory.deployCollection(ethers.id("empty"), config({ ...base, name: "" }))).to.be.revertedWithCustomError(factory, "EmptyValue");
    await expect(factory.deployCollection(ethers.id("size"), config({ ...base, seriesSize: 0 }))).to.be.revertedWithCustomError(factory, "InvalidSeriesSize");
    await expect(factory.deployCollection(ethers.id("bps"), config({ ...base, royaltyBps: 10_001 }))).to.be.revertedWithCustomError(factory, "InvalidRoyalty");
    await expect(factory.deployCollection(ethers.id("owner"), config({ ...base, owner: ethers.ZeroAddress }))).to.be.revertedWithCustomError(factory, "ZeroAddress");
  });

  it("supports contract-wallet owner and minter roles without factory custody", async function () {
    const { factory, recipient } = await fixture();
    const ownerSafe = await (await ethers.getContractFactory("CallExecutor")).deploy();
    const minterSafe = await (await ethers.getContractFactory("CallExecutor")).deploy();
    await Promise.all([ownerSafe.waitForDeployment(), minterSafe.waitForDeployment()]);
    const values = config({
      owner: ownerSafe.target,
      minter: minterSafe.target,
      royaltyRecipient: recipient.address,
    });
    const receipt = await deployRelease(factory, "release/safe-roles", values);
    const collection = await ethers.getContractAt("NFTCollection", receipt.collection);

    expect(await collection.owner()).to.equal(ownerSafe.target);
    expect(await collection.MINTER()).to.equal(minterSafe.target);
    expect(await collection.owner()).not.to.equal(await factory.getAddress());
  });

  it("instantiates two unrelated app/script releases with isolated parameters", async function () {
    const { factory, owner, minter, recipient, other } = await fixture();
    const alpha = config({
      name: "Alpha",
      symbol: "ALP",
      seriesSize: 2,
      royaltyBps: 0,
      owner: owner.address,
      minter: minter.address,
      royaltyRecipient: recipient.address,
    });
    const beta = config({
      name: "Beta",
      symbol: "BET",
      seriesSize: 999,
      royaltyBps: 10_000,
      owner: other.address,
      minter: other.address,
      royaltyRecipient: other.address,
    });
    const [firstReceipt, secondReceipt] = [
      await deployRelease(factory, "app/alpha", alpha),
      await deployRelease(factory, "app/beta", beta),
    ];
    const first = await ethers.getContractAt("NFTCollection", firstReceipt.collection);
    const second = await ethers.getContractAt("NFTCollection", secondReceipt.collection);

    expect(firstReceipt.releaseId).not.to.equal(secondReceipt.releaseId);
    expect(firstReceipt.collection).not.to.equal(secondReceipt.collection);
    expect(await first.name()).to.equal("Alpha");
    expect(await first.SERIES_SIZE()).to.equal(2n);
    expect(await second.name()).to.equal("Beta");
    expect(await second.SERIES_SIZE()).to.equal(999n);
    expect(await first.owner()).to.equal(owner.address);
    expect(await second.owner()).to.equal(other.address);
  });
});

const { expect } = require("chai");
const { artifacts, ethers } = require("hardhat");

const MEDIA_HASH = "0x" + "ab".repeat(32);
const RIGHTS_HASH = "0x" + "cd".repeat(32);
const ZERO_HASH = ethers.ZeroHash;

describe("NFTCollection", function () {
  async function deployCollection(options = {}) {
    const [deployer, owner, minter, recipient, holder, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("NFTCollection");
    const values = {
      name: "Sample Release",
      symbol: "SAMPLE",
      size: 4,
      bps: 600,
      owner: owner.address,
      minter: minter.address,
      recipient: recipient.address,
      ...options,
    };
    const collection = await Factory.deploy(
      values.name, values.symbol, values.size, values.bps,
      values.owner, values.minter, values.recipient,
    );
    await collection.waitForDeployment();
    return { collection, values, deployer, owner, minter, recipient, holder, other };
  }

  async function installValidator(collection, owner, contractName = "TestTransferValidator") {
    const validator = await (await ethers.getContractFactory(contractName)).deploy();
    await validator.waitForDeployment();
    await collection.connect(owner).setTransferValidator(await validator.getAddress());
    return validator;
  }

  const work = (id, overrides = {}) => ({
    tokenId: id,
    title: `Work ${id}`,
    metadataURI: `ipfs://metadata/${id}`,
    mediaHash: MEDIA_HASH,
    rightsURI: `ipfs://rights/${id}`,
    rightsHash: RIGHTS_HASH,
    ...overrides,
  });

  const args = (value) => [
    value.tokenId, value.title, value.metadataURI,
    value.mediaHash, value.rightsURI, value.rightsHash,
  ];

  it("keeps deployed runtime bytecode below the EIP-170 limit", async function () {
    const artifact = await artifacts.readArtifact("NFTCollection");
    expect((artifact.deployedBytecode.length - 2) / 2).to.be.lessThan(24_576);
  });

  it("configures unrelated releases independently", async function () {
    const first = await deployCollection({ name: "Alpha", symbol: "ALP", size: 1, bps: 0 });
    const second = await deployCollection({ name: "Beta", symbol: "BET", size: 999, bps: 10_000 });
    expect(await first.collection.name()).to.equal("Alpha");
    expect(await first.collection.SERIES_SIZE()).to.equal(1n);
    expect((await first.collection.royaltyInfo(1, 10_000))[1]).to.equal(0n);
    expect(await second.collection.name()).to.equal("Beta");
    expect(await second.collection.SERIES_SIZE()).to.equal(999n);
    expect((await second.collection.royaltyInfo(1, 10_000))[1]).to.equal(10_000n);
  });

  it("rejects every invalid constructor boundary with the contract errors", async function () {
    const [, owner, minter, recipient] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("NFTCollection");
    await expect(Factory.deploy("", "SYM", 1, 600, owner.address, minter.address, recipient.address)).to.be.revertedWithCustomError(Factory, "EmptyValue");
    await expect(Factory.deploy("Name", "", 1, 600, owner.address, minter.address, recipient.address)).to.be.revertedWithCustomError(Factory, "EmptyValue");
    await expect(Factory.deploy("Name", "SYM", 0, 600, owner.address, minter.address, recipient.address)).to.be.revertedWithCustomError(Factory, "InvalidSeriesSize");
    await expect(Factory.deploy("Name", "SYM", 1, 10_001, owner.address, minter.address, recipient.address)).to.be.revertedWithCustomError(Factory, "InvalidRoyalty");
    await expect(Factory.deploy("Name", "SYM", 1, 600, ethers.ZeroAddress, minter.address, recipient.address)).to.be.revertedWithCustomError(Factory, "ZeroAddress");
    await expect(Factory.deploy("Name", "SYM", 1, 600, owner.address, ethers.ZeroAddress, recipient.address)).to.be.revertedWithCustomError(Factory, "ZeroAddress");
    await expect(Factory.deploy("Name", "SYM", 1, 600, owner.address, minter.address, ethers.ZeroAddress)).to.be.revertedWithCustomError(Factory, "ZeroAddress");
  });

  it("separates deployer, owner, minter, royalty recipient, and holder roles", async function () {
    const { collection, deployer, owner, minter, recipient, holder } = await deployCollection();
    expect(await collection.owner()).to.equal(owner.address);
    expect(await collection.MINTER()).to.equal(minter.address);
    expect(await collection.ROYALTY_RECIPIENT()).to.equal(recipient.address);
    await expect(collection.connect(deployer).mintWork(...args(work(1)))).to.be.revertedWithCustomError(collection, "OnlyMinter");
    await expect(collection.connect(owner).mintWork(...args(work(1)))).to.be.revertedWithCustomError(collection, "OnlyMinter");
    await installValidator(collection, owner);
    await collection.connect(minter).mintWork(...args(work(1)));
    await collection.connect(minter).transferFrom(minter.address, holder.address, 1);
    expect(await collection.ownerOf(1)).to.equal(holder.address);
  });

  it("persists exact immutable work fields and emits the canonical event", async function () {
    const { collection, minter } = await deployCollection();
    const value = work(1);
    await expect(collection.connect(minter).mintWork(...args(value)))
      .to.emit(collection, "WorkMinted")
      .withArgs(1, value.title, value.metadataURI, value.mediaHash, value.rightsURI, value.rightsHash);
    expect(await collection.tokenURI(1)).to.equal(value.metadataURI);
    expect(await collection.workTitle(1)).to.equal(value.title);
    expect(await collection.mediaSHA256(1)).to.equal(value.mediaHash);
    expect(await collection.rightsURI(1)).to.equal(value.rightsURI);
    expect(await collection.rightsSHA256(1)).to.equal(value.rightsHash);
  });

  it("rejects invalid token IDs, empty values, zero hashes, and duplicates", async function () {
    const { collection, minter } = await deployCollection({ size: 2 });
    await expect(collection.connect(minter).mintWork(...args(work(0)))).to.be.revertedWithCustomError(collection, "InvalidTokenId");
    await expect(collection.connect(minter).mintWork(...args(work(3)))).to.be.revertedWithCustomError(collection, "InvalidTokenId");
    for (const field of ["title", "metadataURI", "rightsURI"]) {
      await expect(collection.connect(minter).mintWork(...args(work(1, { [field]: "" })))).to.be.revertedWithCustomError(collection, "EmptyValue");
    }
    for (const field of ["mediaHash", "rightsHash"]) {
      await expect(collection.connect(minter).mintWork(...args(work(1, { [field]: ZERO_HASH })))).to.be.revertedWithCustomError(collection, "ZeroHash");
    }
    await collection.connect(minter).mintWork(...args(work(1)));
    await expect(collection.connect(minter).mintWork(...args(work(1)))).to.be.revertedWithCustomError(collection, "AlreadyMinted");
  });

  it("closes manually once and never reopens", async function () {
    const { collection, minter, holder } = await deployCollection();
    await expect(collection.connect(holder).closeMinting()).to.be.revertedWithCustomError(collection, "OnlyMinter");
    await expect(collection.connect(minter).closeMinting()).to.emit(collection, "MintingClosed").withArgs(0);
    await expect(collection.connect(minter).closeMinting()).to.be.revertedWithCustomError(collection, "MintingIsClosed");
    await expect(collection.connect(minter).mintWork(...args(work(1)))).to.be.revertedWithCustomError(collection, "MintingIsClosed");
  });

  it("closes automatically at arbitrary capacity, including sparse IDs", async function () {
    const { collection, minter } = await deployCollection({ size: 3 });
    await collection.connect(minter).mintWork(...args(work(3)));
    expect(await collection.mintingClosed()).to.equal(false);
    await collection.connect(minter).mintWork(...args(work(1)));
    await expect(collection.connect(minter).mintWork(...args(work(2))))
      .to.emit(collection, "MintingClosed")
      .withArgs(3);
    expect(await collection.mintingClosed()).to.equal(true);
  });

  it("accepts batch sizes 1 and 10 and rejects 0 and 11", async function () {
    const { collection, minter } = await deployCollection({ size: 20 });
    await expect(collection.connect(minter).mintWorksBatch([])).to.be.revertedWithCustomError(collection, "InvalidBatchSize");
    await collection.connect(minter).mintWorksBatch([work(1)]);
    await collection.connect(minter).mintWorksBatch(Array.from({ length: 10 }, (_, index) => work(index + 2)));
    expect(await collection.totalMinted()).to.equal(11n);
    await expect(collection.connect(minter).mintWorksBatch(Array.from({ length: 11 }, (_, index) => work(index + 10)))).to.be.revertedWithCustomError(collection, "InvalidBatchSize");
  });

  it("rolls back the whole batch when any later item is invalid or duplicated", async function () {
    const { collection, minter } = await deployCollection({ size: 4 });
    await expect(collection.connect(minter).mintWorksBatch([work(1), work(2, { rightsHash: ZERO_HASH })])).to.be.revertedWithCustomError(collection, "ZeroHash");
    expect(await collection.totalMinted()).to.equal(0n);
    await expect(collection.ownerOf(1)).to.be.reverted;
    await expect(collection.connect(minter).mintWorksBatch([work(1), work(1)])).to.be.revertedWithCustomError(collection, "AlreadyMinted");
    expect(await collection.totalMinted()).to.equal(0n);
  });

  it("emits ordered work events and one close event when a batch fills supply", async function () {
    const { collection, minter } = await deployCollection({ size: 2 });
    const tx = collection.connect(minter).mintWorksBatch([work(1), work(2)]);
    await expect(tx).to.emit(collection, "WorkMinted").withArgs(1, "Work 1", "ipfs://metadata/1", MEDIA_HASH, "ipfs://rights/1", RIGHTS_HASH);
    await expect(tx).to.emit(collection, "WorkMinted").withArgs(2, "Work 2", "ipfs://metadata/2", MEDIA_HASH, "ipfs://rights/2", RIGHTS_HASH);
    await expect(tx).to.emit(collection, "MintingClosed").withArgs(2);
  });

  it("keeps economics and work data free of mutation setters", async function () {
    const { collection } = await deployCollection();
    const names = collection.interface.fragments.filter((fragment) => fragment.type === "function").map((fragment) => fragment.name);
    const forbidden = ["setMinter", "setRoyalty", "setDefaultRoyalty", "setTokenURI", "setWorkTitle", "setRightsURI", "setSupply", "burn", "setAutomaticApprovalOfTransfersFromValidator"];
    for (const name of forbidden) expect(names).not.to.include(name);
  });

  it("transfers ownership to a nonzero account and always disables renunciation", async function () {
    const { collection, owner, other } = await deployCollection();
    await expect(collection.connect(other).transferOwnership(other.address)).to.be.reverted;
    await expect(collection.connect(owner).transferOwnership(ethers.ZeroAddress)).to.be.reverted;
    await collection.connect(owner).transferOwnership(other.address);
    expect(await collection.owner()).to.equal(other.address);
    await expect(collection.connect(other).renounceOwnership()).to.be.revertedWithCustomError(collection, "RenounceOwnershipDisabled");
  });

  it("restricts validator updates to owner and deployed contracts and documents zero disable", async function () {
    const { collection, owner, minter, other } = await deployCollection();
    expect(await collection.getTransferValidator()).to.equal(await collection.DEFAULT_TRANSFER_VALIDATOR());
    await expect(collection.connect(minter).setTransferValidator(ethers.ZeroAddress)).to.be.reverted;
    await expect(collection.connect(owner).setTransferValidator(other.address)).to.be.revertedWithCustomError(collection, "CreatorTokenBase__InvalidTransferValidatorContract");
    await collection.connect(owner).setTransferValidator(ethers.ZeroAddress);
    expect(await collection.getTransferValidator()).to.equal(ethers.ZeroAddress);
  });

  it("allows minting with a blocking validator but enforces it on holder transfers", async function () {
    const { collection, owner, minter, holder } = await deployCollection();
    const validator = await installValidator(collection, owner, "BlockingTransferValidator");
    await collection.connect(minter).mintWork(...args(work(1)));
    await expect(collection.connect(minter).transferFrom(minter.address, holder.address, 1)).to.be.revertedWithCustomError(validator, "TransferBlocked");
    expect(await collection.ownerOf(1)).to.equal(minter.address);
  });

  it("supports owner and minter smart-wallet call paths", async function () {
    const [, , , recipient, buyer] = await ethers.getSigners();
    const Executor = await ethers.getContractFactory("CallExecutor");
    const ownerWallet = await Executor.deploy();
    const minterWallet = await Executor.deploy();
    await ownerWallet.waitForDeployment();
    await minterWallet.waitForDeployment();
    const { collection } = await deployCollection({ owner: await ownerWallet.getAddress(), minter: await minterWallet.getAddress(), recipient: recipient.address });
    const validator = await (await ethers.getContractFactory("TestTransferValidator")).deploy();
    await validator.waitForDeployment();
    await ownerWallet.execute(await collection.getAddress(), collection.interface.encodeFunctionData("setTransferValidator", [await validator.getAddress()]));
    await minterWallet.execute(await collection.getAddress(), collection.interface.encodeFunctionData("mintWork", args(work(1))));
    expect(await collection.ownerOf(1)).to.equal(await minterWallet.getAddress());
    await minterWallet.execute(await collection.getAddress(), collection.interface.encodeFunctionData("transferFrom", [await minterWallet.getAddress(), buyer.address, 1]));
    expect(await collection.ownerOf(1)).to.equal(buyer.address);
  });

  it("reports all required ERC-165 interfaces", async function () {
    const { collection } = await deployCollection();
    const probe = await (await ethers.getContractFactory("InterfaceIdProbe")).deploy();
    await probe.waitForDeployment();
    const [creator, legacy] = await probe.creatorTokenIds();
    for (const id of ["0x01ffc9a7", "0x80ac58cd", "0x5b5e139f", "0x2a55205a", creator, legacy]) {
      expect(await collection.supportsInterface(id), id).to.equal(true);
    }
    expect(await collection.supportsInterface("0xffffffff")).to.equal(false);
  });

  it("keeps royalty recipient and rate fixed through validator changes", async function () {
    const { collection, owner, recipient } = await deployCollection({ bps: 375 });
    const before = await collection.royaltyInfo(1, 1_000_000);
    await installValidator(collection, owner);
    const after = await collection.royaltyInfo(1, 1_000_000);
    expect(before[0]).to.equal(recipient.address);
    expect(before[1]).to.equal(37_500n);
    expect(after[0]).to.equal(before[0]);
    expect(after[1]).to.equal(before[1]);
  });
});

const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("Limit Break v5 real-validator integration", function () {
  const RULESET_VANILLA = 1;
  const RULESET_SOULBOUND = 2;
  const RULESET_WHITELIST = 4;
  const LIST_WHITELIST = 1;
  const LIST_AUTHORIZERS = 2;
  const ENABLE_FREEZING = 4;
  const OPTIONS_6_ALLOW_7702_AND_SMART_WALLET_OTC = 6;

  let owner;
  let minter;
  let recipient;
  let outsider;
  let royaltyRecipient;
  let validator;
  let collection;
  let listId;
  let snapshot;

  async function deploy(name, ...args) {
    const instance = await (await ethers.getContractFactory(name)).deploy(...args);
    await instance.waitForDeployment();
    return instance;
  }

  before(async function () {
    [owner, minter, recipient, outsider, royaltyRecipient] = await ethers.getSigners();
    const registry = await deploy("MockEOARegistry");
    const management = await deploy("ModuleCollectionAndListManagement");
    const bindings = await deploy("ModuleRulesetBindings");
    validator = await deploy(
      "CreatorTokenTransferValidator",
      owner.address,
      registry.target,
      management.target,
      bindings.target,
      "NFT Console Validator",
      "5.0.0"
    );

    const vanilla = await deploy("RulesetVanilla");
    const soulbound = await deploy("RulesetSoulbound");
    const whitelist = await deploy("RulesetWhitelist", registry.target);
    for (const [id, ruleset] of [
      [RULESET_VANILLA, vanilla],
      [RULESET_SOULBOUND, soulbound],
      [RULESET_WHITELIST, whitelist],
    ]) {
      await validator.registerRuleset(ruleset.target);
      await validator.bindRuleset(id, ruleset.target);
    }

    collection = await deploy(
      "NFTCollection",
      "Real Validator Collection",
      "RVC",
      20,
      750,
      owner.address,
      minter.address,
      royaltyRecipient.address
    );
    await collection.connect(minter).mintWork(
      1,
      "Work One",
      "ipfs://metadata-1",
      ethers.keccak256(ethers.toUtf8Bytes("media-1")),
      "ipfs://rights-1",
      ethers.keccak256(ethers.toUtf8Bytes("rights-1"))
    );
    await collection.setTransferValidator(validator.target);

    listId = await validator.createList.staticCall("NFT Console integration list");
    await validator.createList("NFT Console integration list");
    await validator.applyListToCollection(collection.target, listId);
    await validator.setRulesetOfCollection(
      collection.target,
      RULESET_WHITELIST,
      ethers.ZeroAddress,
      0,
      OPTIONS_6_ALLOW_7702_AND_SMART_WALLET_OTC
    );
  });

  beforeEach(async function () {
    snapshot = await network.provider.send("evm_snapshot");
  });

  afterEach(async function () {
    await network.provider.send("evm_revert", [snapshot]);
  });

  it("pins options 6 and supports direct EOA and smart-wallet OTC transfers", async function () {
    const policy = await validator.getCollectionSecurityPolicy(collection.target);
    expect(policy.rulesetId).to.equal(RULESET_WHITELIST);
    expect(policy.listId).to.equal(listId);
    expect(policy.globalOptions).to.equal(0);
    expect(policy.rulesetOptions).to.equal(OPTIONS_6_ALLOW_7702_AND_SMART_WALLET_OTC);

    const wallet = await deploy("CallExecutor");
    await collection.connect(minter).transferFrom(minter.address, wallet.target, 1);
    await wallet.execute(
      collection.target,
      collection.interface.encodeFunctionData("transferFrom", [wallet.target, recipient.address, 1])
    );
    expect(await collection.ownerOf(1)).to.equal(recipient.address);
  });

  it("distinguishes EIP-7702 delegates from ordinary contract wallets", async function () {
    const probe = await deploy("ValidatorCollectionProbe", owner.address);
    await validator.setRulesetOfCollection(
      probe.target,
      RULESET_WHITELIST,
      ethers.ZeroAddress,
      0,
      OPTIONS_6_ALLOW_7702_AND_SMART_WALLET_OTC
    );

    const designation = `0xef0100${outsider.address.slice(2)}`;
    await network.provider.send("hardhat_setCode", [minter.address, designation]);
    await expect(
      probe.validate(validator.target, minter.address, minter.address, recipient.address)
    ).not.to.be.reverted;

    await validator.setRulesetOfCollection(probe.target, RULESET_WHITELIST, ethers.ZeroAddress, 0, 4);
    await expect(
      probe.validate(validator.target, minter.address, minter.address, recipient.address)
    ).to.be.revertedWithCustomError(validator, "CreatorTokenTransferValidator__OTCNotAllowedFor7702Delegates");
  });

  it("requires whitelist membership for operators and preserves holder approval", async function () {
    const marketplace = await deploy("MarketplaceOperator");
    await collection.connect(minter).approve(marketplace.target, 1);
    await expect(
      marketplace.transferNFT(collection.target, minter.address, recipient.address, 1)
    ).to.be.revertedWithCustomError(validator, "CreatorTokenTransferValidator__CallerOrFromMustBeWhitelisted");

    await validator.addAccountsToList(listId, LIST_WHITELIST, [marketplace.target]);
    await marketplace.transferNFT(collection.target, minter.address, recipient.address, 1);
    expect(await collection.ownerOf(1)).to.equal(recipient.address);

    const malicious = await deploy("MarketplaceOperator");
    await validator.addAccountsToList(listId, LIST_WHITELIST, [malicious.target]);
    await expect(
      malicious.transferNFT(collection.target, recipient.address, outsider.address, 1)
    ).to.be.revertedWith("ERC721: caller is not token owner or approved");
  });

  it("supports atomic signed-zone authorization but rejects unlisted authorizers", async function () {
    const zone = await deploy("SignedZoneAuthorizerMock");
    await collection.connect(minter).approve(zone.target, 1);
    await expect(
      zone.executeAuthorizedSale(validator.target, collection.target, minter.address, recipient.address, 1)
    ).to.be.reverted;

    await validator.addAccountsToList(listId, LIST_AUTHORIZERS, [zone.target]);
    await zone.executeAuthorizedSale(validator.target, collection.target, minter.address, recipient.address, 1);
    expect(await collection.ownerOf(1)).to.equal(recipient.address);
  });

  it("freezes and restores accounts only while freezing mode is enabled", async function () {
    await validator.setRulesetOfCollection(
      collection.target,
      RULESET_WHITELIST,
      ethers.ZeroAddress,
      ENABLE_FREEZING,
      OPTIONS_6_ALLOW_7702_AND_SMART_WALLET_OTC
    );
    await validator.freezeAccountsForCollection(collection.target, [minter.address]);
    await expect(
      collection.connect(minter).transferFrom(minter.address, recipient.address, 1)
    ).to.be.revertedWithCustomError(validator, "CreatorTokenTransferValidator__SenderAccountIsFrozen");

    await validator.unfreezeAccountsForCollection(collection.target, [minter.address]);
    await collection.connect(minter).transferFrom(minter.address, recipient.address, 1);
    expect(await collection.ownerOf(1)).to.equal(recipient.address);
  });

  it("limits policy changes to the collection owner and proves owner-controlled policy risk", async function () {
    await expect(
      validator.connect(outsider).setRulesetOfCollection(
        collection.target,
        RULESET_SOULBOUND,
        ethers.ZeroAddress,
        0,
        0
      )
    ).to.be.revertedWithCustomError(
      validator,
      "CreatorTokenTransferValidator__CallerMustHaveElevatedPermissionsForSpecifiedNFT"
    );

    await validator.setRulesetOfCollection(collection.target, RULESET_SOULBOUND, ethers.ZeroAddress, 0, 0);
    await expect(
      collection.connect(minter).transferFrom(minter.address, recipient.address, 1)
    ).to.be.revertedWithCustomError(validator, "CreatorTokenTransferValidator__TokenIsSoulbound");

    await validator.setRulesetOfCollection(collection.target, RULESET_VANILLA, ethers.ZeroAddress, 0, 0);
    await collection.connect(minter).transferFrom(minter.address, recipient.address, 1);
    expect(await collection.ownerOf(1)).to.equal(recipient.address);
  });

  it("documents that direct transfers do not enforce royalty payment", async function () {
    const salePrice = ethers.parseEther("1");
    const before = await collection.royaltyInfo(1, salePrice);
    const balanceBefore = await ethers.provider.getBalance(royaltyRecipient.address);
    await collection.connect(minter).transferFrom(minter.address, recipient.address, 1);
    const after = await collection.royaltyInfo(1, salePrice);
    expect(after).to.deep.equal(before);
    expect(await ethers.provider.getBalance(royaltyRecipient.address)).to.equal(balanceBefore);
    expect(await collection.ownerOf(1)).to.equal(recipient.address);
  });
});

const { ethers } = require("hardhat");

async function deployRelease(factory, releaseKey, config) {
  const releaseId = ethers.id(releaseKey);
  const predicted = await factory.predictCollectionAddress(releaseId, config);
  const tx = await factory.deployCollection(releaseId, config);
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error("Collection deployment failed");

  const event = receipt.logs
    .map((log) => {
      try { return factory.interface.parseLog(log); } catch { return null; }
    })
    .find((entry) => entry?.name === "CollectionDeployed");
  if (!event || event.args.releaseId !== releaseId || event.args.collection !== predicted) {
    throw new Error("Deployment receipt did not match the request");
  }

  return Object.freeze({
    releaseId,
    collection: predicted,
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    chainId: event.args.chainId,
    factoryVersion: event.args.factoryVersion,
    collectionCreationCodeId: event.args.collectionCreationCodeId,
    configHash: event.args.configHash,
    initCodeHash: event.args.initCodeHash,
  });
}

async function main() {
  const [requester, ownerA, minterA, royaltyA, ownerB, minterB, royaltyB] = await ethers.getSigners();
  const factory = await (await ethers.getContractFactory("NFTCollectionFactory", requester)).deploy();
  await factory.waitForDeployment();

  const alpha = await deployRelease(factory, "rehearsal/alpha", {
    name: "Alpha Rehearsal",
    symbol: "ALPHA",
    seriesSize: 2,
    royaltyBps: 500,
    owner: ownerA.address,
    minter: minterA.address,
    royaltyRecipient: royaltyA.address,
  });
  const beta = await deployRelease(factory, "rehearsal/beta", {
    name: "Beta Rehearsal",
    symbol: "BETA",
    seriesSize: 77,
    royaltyBps: 925,
    owner: ownerB.address,
    minter: minterB.address,
    royaltyRecipient: royaltyB.address,
  });

  process.stdout.write(JSON.stringify({
    factory: await factory.getAddress(),
    requester: requester.address,
    deployments: [alpha, beta],
  }, (_, value) => typeof value === "bigint" ? value.toString() : value, 2) + "\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { deployRelease };

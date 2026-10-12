const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const hre = require('hardhat');
const { deployRelease } = require('./rehearse-deployments.cjs');
const { ethers } = hre;
const mnemonic = 'test test test test test test test test test test test junk';
const URI = 'ipfs://bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq';
const hash = value => '0x' + createHash('sha256').update(value, 'utf8').digest('hex');

function assertDisposableContext(name, chainId, forking, accounts) {
  if (name !== 'hardhat' || chainId !== 31337n || forking || accounts.length < 7) throw new Error('Only the unforked disposable Hardhat fixture is supported.');
  for (let i = 0; i < 7; i++) {
    const expected = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, `m/44'/60'/0'/0/${i}`).address;
    if (accounts[i] !== expected) throw new Error('Rehearsal refuses non-fixture signing accounts.');
  }
}
async function main() {
  // Refuse external/forked networks before asking a provider for its chain.
  if (hre.network.name !== 'hardhat' || hre.network.config.forking) throw new Error('This rehearsal never runs on a public or forked chain.');
  const chain = await ethers.provider.getNetwork(), signers = await ethers.getSigners();
  assertDisposableContext(hre.network.name, chain.chainId, hre.network.config.forking, signers.map(item => item.address));
  const { prepareMintPlan, simulateMintBatch, verifyMintReceipt } = await import('../console/chain/mint.mjs');
  const [requester, ownerA, minterA, royaltyA, ownerB, minterB, royaltyB] = signers;
  const factory = await (await ethers.getContractFactory('NFTCollectionFactory', requester)).deploy();
  await factory.waitForDeployment();
  const releases = [];
  for (const [label, owner, minter, royalty, count, supply, bps] of [
    ['Alpha', ownerA, minterA, royaltyA, 21, 25, 600],
    ['Beta', ownerB, minterB, royaltyB, 3, 3, 0],
  ]) {
    const config = { name: `${label} synthetic rehearsal`, symbol: label.toUpperCase(), seriesSize: supply, royaltyBps: bps,
      owner: owner.address, minter: minter.address, royaltyRecipient: royalty.address };
    const deployment = await deployRelease(factory, `disposable-mint/${label}`, config);
    assert.equal(deployment.chainId, 31337n);
    const collection = await ethers.getContractAt('NFTCollection', deployment.collection);
    assert.equal(await collection.owner(), owner.address);
    assert.equal(await collection.MINTER(), minter.address);
    assert.equal(await collection.SERIES_SIZE(), BigInt(supply));
    const works = Array.from({ length: count }, (_, index) => ({ tokenId: String(index + 1), title: `${label} test work ${index + 1}`,
      metadataURI: `${URI}/${label}/${index + 1}.json`, mediaHash: hash(`${label} synthetic media ${index + 1}`),
      rightsURI: `${URI}/${label}/rights.txt`, rightsHash: hash(`${label} synthetic test rights\n`) }));
    // This anchor comes from the just-deployed, source-compiled local fixture.
    // It is NOT a production deployment attestation or public RPC trust anchor.
    const runtimeCodeHash = ethers.keccak256(await ethers.provider.getCode(deployment.collection));
    const plan = prepareMintPlan({ chainId: 31337, collection: deployment.collection, minter: minter.address, runtimeCodeHash, works });
    const receipts = [];
    for (const batch of plan.batches) {
      await simulateMintBatch(ethers.provider, batch);
      const transaction = await minter.sendTransaction({ to: batch.collection, data: batch.data, value: 0n });
      await transaction.wait();
      receipts.push(await verifyMintReceipt(ethers.provider, batch, transaction.hash, { minConfirmations: 1 }));
    }
    assert.equal(await collection.totalMinted(), BigInt(count));
    assert.equal(await collection.mintingClosed(), count === supply);
    const royaltyReadback = await collection.royaltyInfo(1, ethers.parseEther('1'));
    assert.equal(royaltyReadback[0], royalty.address);
    assert.equal(royaltyReadback[1], ethers.parseEther('1') * BigInt(bps) / 10000n);
    await assert.rejects(simulateMintBatch(ethers.provider, plan.batches[0]));
    releases.push({ label, config, deployment, runtimeCodeHash, mintedCount: count,
      batchSizes: plan.batches.map(batch => batch.works.length), receipts,
      erc2981Readback: { recipient: royaltyReadback[0], amountForOneEth: royaltyReadback[1] },
      royaltyPaymentVerified: false, listingVerified: false });
  }
  assert.notEqual(releases[0].deployment.collection, releases[1].deployment.collection);
  const report = { version: 1, scope: 'disposable-local-factory-to-mint-rehearsal', chainId: 31337,
    syntheticContent: true, publicContentVerified: false, productionReady: false, listingVerified: false,
    factory: await factory.getAddress(), totalMinted: releases.reduce((sum, release) => sum + release.mintedCount, 0), releases };
  const destination = path.resolve(__dirname, '../artifacts/rehearsal/mint-report.json');
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(report, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n', { mode: 0o600 });
  console.info('Disposable rehearsal passed: two independent collections, four batches, 24 verified local token mints. No public upload, public-chain funds or listing.');
  return report;
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main, assertDisposableContext };

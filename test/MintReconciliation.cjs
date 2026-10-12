const assert = require('node:assert/strict');
const { ethers, network } = require('hardhat');
let prepareMintPlan, simulateMintBatch, verifyMintReceipt, MINT_ABI;
const URI = 'ipfs://bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq';
const hash = byte => '0x' + byte.repeat(64);
const works = (count = 1, start = 1) => Array.from({ length: count }, (_, i) => ({ tokenId: String(i + start),
  title: `Independent work ${i + start}`, metadataURI: `${URI}/${i + start}.json`, mediaHash: hash('a'), rightsURI: `${URI}/rights.md`, rightsHash: hash('b') }));
function proxy(overrides) {
  return new Proxy(ethers.provider, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return overrides[key];
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
}
async function fixture(count = 1, supply = 50) {
  const [owner, minter, recipient] = await ethers.getSigners();
  const factory = await ethers.getContractFactory('NFTCollection');
  const collection = await factory.deploy('Independent fixture', 'ART', supply, 600, owner.address, minter.address, recipient.address);
  await collection.waitForDeployment();
  const input = { chainId: 31337, collection: await collection.getAddress(), minter: minter.address,
    runtimeCodeHash: ethers.keccak256(await ethers.provider.getCode(await collection.getAddress())), works: works(count) };
  const plan = prepareMintPlan(input), batch = plan.batches[0];
  async function mint(item = batch) {
    const tx = await minter.sendTransaction({ to: item.collection, data: item.data });
    return { tx, receipt: await tx.wait() };
  }
  return { owner, minter, recipient, collection, input, plan, batch, mint };
}
async function denied(promise, code) { await assert.rejects(promise, error => error.code === code); }

describe('Public batch intent and read-only mint reconciliation', function () {
  this.timeout(40000);
  before(async () => { ({ prepareMintPlan, simulateMintBatch, verifyMintReceipt, MINT_ABI } = await import('../console/chain/mint.mjs')); });
  it('rehearsal refuses public chains, forks and non-fixture accounts', async () => {
    const { assertDisposableContext } = require('../scripts/rehearse-mints.cjs');
    const accounts = (await ethers.getSigners()).map(signer => signer.address);
    assert.doesNotThrow(() => assertDisposableContext('hardhat', 31337n, undefined, accounts));
    for (const args of [['mainnet', 1n, undefined, accounts], ['hardhat', 1n, undefined, accounts],
      ['hardhat', 31337n, { enabled: true }, accounts], ['hardhat', 31337n, undefined, []],
      ['hardhat', 31337n, undefined, [accounts[1], ...accounts.slice(1)]]]) {
      assert.throws(() => assertDisposableContext(...args));
    }
  });
  it('splits 21 works into deterministic atomic batches without a signer', async () => {
    const h = await fixture(21);
    assert.deepEqual(h.plan.batches.map(x => x.works.length), [10, 10, 1]);
    assert.deepEqual(h.plan, prepareMintPlan(h.input));
    assert.ok(Object.isFrozen(h.plan) && Object.isFrozen(h.batch.works[0]));
    assert.equal(h.plan.productionReady, false); assert.equal(h.plan.listingVerified, false);
    for (const override of [{ chainId: 1 }, { collection: h.recipient.address }, { minter: h.owner.address }, { runtimeCodeHash: hash('c') }]) {
      assert.notEqual(prepareMintPlan({ ...h.input, ...override }).batches[0].id, h.batch.id);
    }
    h.input.works[0].title = 'Changed after prepare';
    assert.notEqual(prepareMintPlan(h.input).batches[0].id, h.batch.id);
    assert.equal(h.batch.works[0].title, 'Independent work 1');
  });
  it('rejects duplicate, oversized, sparse, accessor and private-field manifests', async () => {
    const { input } = await fixture();
    const badWorks = [[...works(), ...works()], works(501), new Array(1), [{ ...works()[0], collector_email: 'private' }]];
    for (const value of badWorks) assert.throws(() => prepareMintPlan({ ...input, works: value }));
    let read = false; const getter = { ...input }; Object.defineProperty(getter, 'works', { get() { read = true; return works(); }, enumerable: true });
    assert.throws(() => prepareMintPlan(getter)); assert.equal(read, false);
    assert.throws(() => prepareMintPlan({ ...input, privateKey: 'never-copy-me' }), error => !error.message.includes('never-copy-me'));
  });
  it('rejects noncanonical IDs, invalid addresses, digests and immutable text', async () => {
    const { input } = await fixture();
    for (const tokenId of ['0', '01', '-1', 1, String(1n << 256n)]) assert.throws(() => prepareMintPlan({ ...input, works: [{ ...works()[0], tokenId }] }));
    for (const changes of [{ mediaHash: hash('0') }, { rightsHash: '0x1234' }, { title: '' }, { title: '\ud800' }, { title: 'x'.repeat(513) }, { metadataURI: 'https://mutable.invalid' }, { rightsURI: URI + '\n' }]) {
      assert.throws(() => prepareMintPlan({ ...input, works: [{ ...works()[0], ...changes }] }));
    }
    for (const changes of [{ collection: ethers.ZeroAddress }, { minter: 'not-an-address' }, { chainId: 137 }]) assert.throws(() => prepareMintPlan({ ...input, ...changes }));
  });
  it('simulates without changing the chain and refuses repeat mints', async () => {
    const h = await fixture(); const number = await ethers.provider.getBlockNumber();
    const nonce = await h.minter.getNonce();
    const result = await simulateMintBatch(ethers.provider, h.batch);
    assert.equal(result.status, 'chain-simulation-passed'); assert.equal(result.publicContentVerified, false);
    assert.equal(await ethers.provider.getBlockNumber(), number); assert.equal(await h.minter.getNonce(), nonce);
    assert.equal(await h.collection.totalMinted(), 0n);
    await h.mint(); await denied(simulateMintBatch(ethers.provider, h.batch), 'RPC_OR_SIMULATION_REJECTED');
  });
  it('minting 21 works reconciles all three exact real-contract batches', async () => {
    const h = await fixture(21);
    for (const batch of h.plan.batches) {
      await simulateMintBatch(ethers.provider, batch);
      const { tx } = await h.mint(batch);
      const result = await verifyMintReceipt(ethers.provider, batch, tx.hash, { minConfirmations: 1 });
      assert.equal(result.status, 'mint-receipt-verified'); assert.deepEqual(result.tokenIds, batch.works.map(x => x.tokenId));
      assert.equal(result.initialRecipient, h.minter.address); assert.equal(result.listingVerified, false);
      assert.equal(result.ownershipNowVerified, false); assert.equal(result.publicContentVerified, false);
      assert.equal(result.validatorPolicyVerified, false); assert.equal(result.productionReady, false);
    }
    assert.equal(await h.collection.totalMinted(), 21n);
  });
  it('rejects pending, reverted and insufficiently confirmed receipts', async () => {
    const h = await fixture(); const { tx, receipt } = await h.mint();
    await denied(verifyMintReceipt(proxy({ getTransactionReceipt: async () => null }), h.batch, tx.hash), 'PENDING_OR_UNKNOWN');
    await denied(verifyMintReceipt(proxy({ getTransactionReceipt: async () => ({ ...receipt, status: 0 }) }), h.batch, tx.hash), 'TRANSACTION_REVERTED');
    await denied(verifyMintReceipt(ethers.provider, h.batch, tx.hash), 'INSUFFICIENT_CONFIRMATIONS');
    await network.provider.send('evm_mine');
    assert.equal((await verifyMintReceipt(ethers.provider, h.batch, tx.hash)).confirmations, 2);
  });
  it('rejects transaction substitution, unexpected payment and changed intent data', async () => {
    const h = await fixture(); const { tx } = await h.mint(); const actual = await ethers.provider.getTransaction(tx.hash);
    for (const change of [{ to: h.recipient.address }, { from: h.owner.address }, { data: '0x' }, { value: 1n }, { chainId: 1n }, { blockHash: hash('c') }]) {
      await denied(verifyMintReceipt(proxy({ getTransaction: async () => ({ ...actual, ...change }) }), h.batch, tx.hash, { minConfirmations: 1 }), 'TRANSACTION_MISMATCH');
    }
    for (const change of [{ type: 4 }, { type: 3 }, { authorizationList: [{}] }, { blobVersionedHashes: [hash('c')] }]) {
      await denied(verifyMintReceipt(proxy({ getTransaction: async () => ({ ...actual, ...change }) }), h.batch, tx.hash, { minConfirmations: 1 }), 'UNSUPPORTED_TRANSACTION_TYPE');
    }
    await denied(verifyMintReceipt(ethers.provider, { ...h.batch, data: '0x' }, tx.hash), 'INTENT_MISMATCH');
    await denied(verifyMintReceipt(ethers.provider, { ...h.batch, id: hash('d') }, tx.hash), 'INTENT_MISMATCH');
  });
  it('enforces the chain, runtime bytecode and direct-EOA envelope', async () => {
    const h = await fixture(); const { tx } = await h.mint();
    await denied(verifyMintReceipt(proxy({ getNetwork: async () => ({ chainId: 1n }) }), h.batch, tx.hash), 'CHAIN_MISMATCH');
    for (const [code, expected] of [['0x', 'CODE_MISMATCH'], ['0x1234', 'CODE_MISMATCH']]) {
      await denied(verifyMintReceipt(proxy({ getCode: async (address, block) => address === h.batch.collection ? code : ethers.provider.getCode(address, block) }), h.batch, tx.hash, { minConfirmations: 1 }), expected);
    }
    await denied(verifyMintReceipt(proxy({ getCode: async (address, block) => address === h.minter.address ? '0xef0100' : ethers.provider.getCode(address, block) }), h.batch, tx.hash, { minConfirmations: 1 }), 'UNSUPPORTED_WALLET_ENVELOPE');
  });
  it('rejects missing, extra, reordered, removed and foreign-emitter mint logs', async () => {
    const h = await fixture(); const { tx, receipt } = await h.mint();
    const logs = receipt.logs.map(log => ({ ...log }));
    const variants = [[], logs.slice(1), [...logs, logs[1]], [...logs].reverse(),
      logs.map(log => ({ ...log, removed: true })), logs.map(log => ({ ...log, address: h.recipient.address })),
      logs.map(log => ({ ...log, transactionHash: hash('c') }))];
    for (const changed of variants) await assert.rejects(verifyMintReceipt(proxy({ getTransactionReceipt: async () => ({ ...receipt, logs: changed }) }), h.batch, tx.hash, { minConfirmations: 1 }));
  });
  it('rejects a forged WorkMinted payload even beside a genuine Transfer event', async () => {
    const h = await fixture(); const { tx, receipt } = await h.mint(); const abi = new ethers.Interface(MINT_ABI);
    const altered = abi.encodeEventLog(abi.getEvent('WorkMinted'), [1, 'Not the reviewed title', h.batch.works[0].metadataURI, hash('a'), h.batch.works[0].rightsURI, hash('b')]);
    const logs = receipt.logs.map(log => log.topics[0] === abi.getEvent('WorkMinted').topicHash ? { ...log, ...altered } : log);
    await denied(verifyMintReceipt(proxy({ getTransactionReceipt: async () => ({ ...receipt, logs }) }), h.batch, tx.hash, { minConfirmations: 1 }), 'MINT_EVENTS_MISMATCH');
  });
  it('checks immutable read-back, not only logs and transaction success', async () => {
    const h = await fixture(); const { tx } = await h.mint(); const abi = new ethers.Interface(MINT_ABI);
    const bad = proxy({ call: async request => request.data.startsWith(abi.getFunction('workTitle').selector) ? abi.encodeFunctionResult('workTitle', ['wrong title']) : ethers.provider.call(request) });
    await denied(verifyMintReceipt(bad, h.batch, tx.hash, { minConfirmations: 1 }), 'IMMUTABLE_READBACK_MISMATCH');
  });
  it('detects missing block membership, mid-check reorganization and chain changes', async () => {
    const h = await fixture(); const { tx } = await h.mint();
    await denied(verifyMintReceipt(proxy({ getBlock: async tag => ({ ...await ethers.provider.getBlock(tag), transactions: [] }) }), h.batch, tx.hash, { minConfirmations: 1 }), 'TRANSACTION_MISSING_FROM_BLOCK');
    let reads = 0;
    await denied(verifyMintReceipt(proxy({ getBlock: async tag => ({ ...await ethers.provider.getBlock(tag), transactions: [tx.hash], ...(++reads > 1 ? { hash: hash('c') } : {}) }) }), h.batch, tx.hash, { minConfirmations: 1 }), 'REORG_OR_BLOCK_MISMATCH');
    let networks = 0;
    await denied(verifyMintReceipt(proxy({ getNetwork: async () => ({ chainId: ++networks > 1 ? 1n : 31337n }) }), h.batch, tx.hash, { minConfirmations: 1 }), 'CHAIN_MISMATCH');
  });
  it('does not confuse the initial mint recipient with later token ownership', async () => {
    const h = await fixture();
    // This local-only case explicitly selects no validator; it asserts no royalty enforcement.
    await (await h.collection.setTransferValidator(ethers.ZeroAddress)).wait();
    const { tx } = await h.mint();
    await (await h.collection.connect(h.minter).transferFrom(h.minter.address, h.recipient.address, 1)).wait();
    const result = await verifyMintReceipt(ethers.provider, h.batch, tx.hash);
    assert.equal(await h.collection.ownerOf(1), h.recipient.address);
    assert.equal(result.initialRecipient, h.minter.address); assert.equal(result.ownershipNowVerified, false);
  });
  it('fails closed on cancellation, RPC errors and invalid confirmation policy', async () => {
    const h = await fixture(); const { tx } = await h.mint(); const controller = new AbortController(); controller.abort();
    await denied(verifyMintReceipt(ethers.provider, h.batch, tx.hash, { signal: controller.signal }), 'CANCELLED');
    await denied(simulateMintBatch(ethers.provider, h.batch, { signal: controller.signal }), 'CANCELLED');
    await denied(verifyMintReceipt(proxy({ getNetwork: async () => { throw new Error('secret-rpc-provider-value'); } }), h.batch, tx.hash), 'RPC_VERIFICATION_UNAVAILABLE');
    for (const minConfirmations of [0, -1, 257, NaN, 1.5]) await denied(verifyMintReceipt(ethers.provider, h.batch, tx.hash, { minConfirmations }), 'INVALID_CONFIRMATIONS');
  });
  it('refuses closed or out-of-supply simulations before any transaction', async () => {
    const h = await fixture(2, 1);
    await denied(simulateMintBatch(ethers.provider, h.batch), 'MINT_STATE_MISMATCH');
    await (await h.collection.connect(h.minter).closeMinting()).wait();
    const batch = prepareMintPlan({ ...h.input, works: works() }).batches[0];
    await denied(simulateMintBatch(ethers.provider, batch), 'MINT_STATE_MISMATCH');
  });
});

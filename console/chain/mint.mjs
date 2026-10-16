import { AbiCoder, Contract, Interface, ZeroAddress, getAddress, keccak256, toUtf8Bytes } from 'ethers';

// Public-data primitives only. No signer, broadcast, storage, gas spending or production gate.
export const MINT_ABI = Object.freeze([
  'function mintWorksBatch((uint256 tokenId,string title,string metadataURI,bytes32 mediaHash,string rightsURI,bytes32 rightsHash)[] works)',
  'function MINTER() view returns (address)',
  'function MAX_BATCH() view returns (uint256)',
  'function SERIES_SIZE() view returns (uint256)',
  'function mintingClosed() view returns (bool)',
  'function tokenURI(uint256) view returns (string)',
  'function workTitle(uint256) view returns (string)',
  'function mediaSHA256(uint256) view returns (bytes32)',
  'function rightsURI(uint256) view returns (string)',
  'function rightsSHA256(uint256) view returns (bytes32)',
  'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
  'event WorkMinted(uint256 indexed tokenId,string title,string tokenURI,bytes32 mediaSHA256,string rightsURI,bytes32 rightsSHA256)',
]);
const iface = new Interface(MINT_ABI), coder = AbiCoder.defaultAbiCoder();
const workKeys = ['tokenId', 'title', 'metadataURI', 'mediaHash', 'rightsURI', 'rightsHash'];
const requestKeys = ['chainId', 'collection', 'minter', 'runtimeCodeHash', 'works'];
const batchKeys = [...requestKeys, 'id', 'data', 'value', 'version', 'status'];
const maxUint = (1n << 256n) - 1n;
const bytes32 = /^0x[0-9a-f]{64}$/;
export class MintCheckError extends Error {
  constructor(code) { super(`Mint verification stopped: ${code}. No mint or listing is confirmed by this result.`); this.name = 'MintCheckError'; this.code = code; }
}
const stop = code => { throw new MintCheckError(code); };
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) stop('INVALID_INPUT');
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => !keys.includes(key))) stop('INVALID_INPUT');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) stop('INVALID_INPUT');
  }
  return value;
}
function list(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < 1 || value.length > maximum ||
      Reflect.ownKeys(value).length !== value.length + 1) stop('INVALID_BATCH');
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) stop('INVALID_BATCH');
  }
  return value;
}
function address(value) {
  try { const result = getAddress(value); if (result === ZeroAddress) stop('INVALID_ADDRESS'); return result; }
  catch { stop('INVALID_ADDRESS'); }
}
function digest(value) {
  if (typeof value !== 'string' || !bytes32.test(value) || /^0x0+$/.test(value)) stop('INVALID_DIGEST');
  return value;
}
function text(value, limit, uri = false) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u001f\u007f]/u.test(value)) stop('INVALID_TEXT');
  let bytes; try { bytes = toUtf8Bytes(value); } catch { stop('INVALID_TEXT'); }
  if (bytes.length > limit || (uri && !value.startsWith('ipfs://'))) stop('INVALID_TEXT');
  return value; // No trim/normalization of the exact values committed on chain.
}
function chain(value) { if (![1, 11155111, 31337].includes(value)) stop('UNSUPPORTED_CHAIN'); return value; }
function work(value) {
  object(value, workKeys);
  if (typeof value.tokenId !== 'string' || !/^[1-9][0-9]{0,77}$/.test(value.tokenId) || BigInt(value.tokenId) > maxUint) stop('INVALID_TOKEN_ID');
  return Object.freeze({ tokenId: value.tokenId, title: text(value.title, 512), metadataURI: text(value.metadataURI, 2048, true),
    mediaHash: digest(value.mediaHash), rightsURI: text(value.rightsURI, 2048, true), rightsHash: digest(value.rightsHash) });
}
/** Exact, bounded calldata; no chain authorization or broadcast. */
export function prepareMintWorks(value) {
  const works = Object.freeze(list(value, 10).map(work));
  if (new Set(works.map(item => item.tokenId)).size !== works.length) stop('DUPLICATE_TOKEN_ID');
  return Object.freeze({ works, data: iface.encodeFunctionData('mintWorksBatch', [works]) });
}
function makeBatch(context, works) {
  const data = prepareMintWorks(works).data;
  const id = keccak256(coder.encode(['uint256', 'address', 'address', 'bytes32', 'bytes32'],
    [context.chainId, context.collection, context.minter, context.runtimeCodeHash, keccak256(data)]));
  return Object.freeze({ ...context, works: Object.freeze(works), id, data, value: '0x0', version: 1, status: 'prepared-unverified' });
}
/** Trust anchors must come from reviewed deployment records, never be learned from the same RPC being checked. */
export function prepareMintPlan(input) {
  object(input, requestKeys);
  const context = { chainId: chain(input.chainId), collection: address(input.collection), minter: address(input.minter), runtimeCodeHash: digest(input.runtimeCodeHash) };
  const works = list(input.works, 500).map(work);
  if (new Set(works.map(item => item.tokenId)).size !== works.length) stop('DUPLICATE_TOKEN_ID');
  if (toUtf8Bytes(JSON.stringify(works)).length > 2 * 1024 * 1024) stop('MANIFEST_TOO_LARGE');
  const batches = [];
  for (let i = 0; i < works.length; i += 10) batches.push(makeBatch(context, works.slice(i, i + 10)));
  return Object.freeze({ version: 1, status: 'prepared-unverified', batches: Object.freeze(batches), productionReady: false, listingVerified: false });
}
function snapshot(value) {
  object(value, batchKeys);
  const plan = prepareMintPlan(Object.fromEntries(requestKeys.map(key => [key, value[key]])));
  const expected = plan.batches[0];
  if (plan.batches.length !== 1 || ['id', 'data', 'value', 'version', 'status'].some(key => value[key] !== expected[key])) stop('INTENT_MISMATCH');
  return expected;
}
function cancelled(signal) { if (signal?.aborted) stop('CANCELLED'); }
function height(value) { if (!Number.isSafeInteger(value) || value < 0) stop('INVALID_BLOCK'); return value; }
async function network(provider, expected, signal) {
  cancelled(signal);
  if ((await provider.getNetwork()).chainId !== BigInt(expected)) stop('CHAIN_MISMATCH');
  cancelled(signal);
}
async function pinnedContract(provider, batch, blockNumber, signal) {
  const [code, minterCode] = await Promise.all([provider.getCode(batch.collection, blockNumber), provider.getCode(batch.minter, blockNumber)]);
  cancelled(signal);
  if (typeof code !== 'string' || code === '0x' || keccak256(code) !== batch.runtimeCodeHash) stop('CODE_MISMATCH');
  // Safe / delegated accounts need their own envelope verifier; do not treat them as direct EOAs.
  if (minterCode !== '0x') stop('UNSUPPORTED_WALLET_ENVELOPE');
  const contract = new Contract(batch.collection, MINT_ABI, provider);
  if (address(await contract.MINTER({ blockTag: blockNumber })) !== batch.minter) stop('MINTER_MISMATCH');
  cancelled(signal); return contract;
}
async function canonical(provider, number, hash, signal) {
  const block = await provider.getBlock(number); cancelled(signal);
  if (!block || block.number !== number || block.hash !== hash) stop('REORG_OR_BLOCK_MISMATCH');
  return block;
}
/** Chain simulation only, not a public-content, validator-policy, gas-budget or production sign-off. */
export async function simulateMintBatch(provider, value, { signal } = {}) {
  const batch = snapshot(value);
  try {
    await network(provider, batch.chainId, signal);
    const block = await provider.getBlock('latest');
    if (!block) stop('RPC_UNAVAILABLE');
    const number = height(block.number), hash = digest(block.hash);
    const contract = await pinnedContract(provider, batch, number, signal);
    const [maximum, supply, closed] = await Promise.all([contract.MAX_BATCH({ blockTag: number }), contract.SERIES_SIZE({ blockTag: number }), contract.mintingClosed({ blockTag: number })]);
    if (maximum !== 10n || closed || batch.works.some(item => BigInt(item.tokenId) > supply)) stop('MINT_STATE_MISMATCH');
    cancelled(signal);
    const result = await provider.call({ to: batch.collection, from: batch.minter, data: batch.data, value: 0n, blockTag: number });
    if (result !== '0x') stop('SIMULATION_MISMATCH');
    await canonical(provider, number, hash, signal); await network(provider, batch.chainId, signal);
    return Object.freeze({ status: 'chain-simulation-passed', intentId: batch.id, blockNumber: number, blockHash: hash,
      productionReady: false, publicContentVerified: false, validatorPolicyVerified: false, listingVerified: false });
  } catch (error) { if (error instanceof MintCheckError) throw error; cancelled(signal); stop('RPC_OR_SIMULATION_REJECTED'); }
}
/** Read-only receipt reconciliation for this exact direct-EOA batch. Never submits, retries or replaces a transaction. */
export async function verifyMintReceipt(provider, value, transactionHash, { minConfirmations = 2, signal } = {}) {
  const batch = snapshot(value), txHash = digest(transactionHash);
  if (!Number.isSafeInteger(minConfirmations) || minConfirmations < 1 || minConfirmations > 256) stop('INVALID_CONFIRMATIONS');
  try {
    await network(provider, batch.chainId, signal);
    const [receipt, tx] = await Promise.all([provider.getTransactionReceipt(txHash), provider.getTransaction(txHash)]);
    cancelled(signal);
    if (!receipt) stop('PENDING_OR_UNKNOWN');
    if (receipt.status !== 1) stop('TRANSACTION_REVERTED');
    if (!tx || receipt.hash !== txHash || tx.hash !== txHash || tx.chainId !== BigInt(batch.chainId) ||
        address(tx.to) !== batch.collection || address(receipt.to) !== batch.collection || address(tx.from) !== batch.minter ||
        address(receipt.from) !== batch.minter || tx.data !== batch.data || tx.value !== 0n) stop('TRANSACTION_MISMATCH');
    if (![0, 1, 2].includes(tx.type) || tx.authorizationList?.length || tx.blobVersionedHashes?.length) stop('UNSUPPORTED_TRANSACTION_TYPE');
    const number = height(receipt.blockNumber), hash = digest(receipt.blockHash);
    if (tx.blockNumber !== number || tx.blockHash !== hash) stop('TRANSACTION_MISMATCH');
    const block = await canonical(provider, number, hash, signal);
    if (!block.transactions.includes(txHash)) stop('TRANSACTION_MISSING_FROM_BLOCK');
    const latest = height(await provider.getBlockNumber());
    if (latest - number + 1 < minConfirmations) stop('INSUFFICIENT_CONFIRMATIONS');
    const contract = await pinnedContract(provider, batch, number, signal);
    if (!Array.isArray(receipt.logs) || receipt.logs.length > 256) stop('INVALID_LOGS');
    const selected = [], transferTopic = iface.getEvent('Transfer').topicHash, workTopic = iface.getEvent('WorkMinted').topicHash;
    let previousIndex = -1;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== batch.collection.toLowerCase()) continue;
      if (![transferTopic, workTopic].includes(log.topics[0])) continue;
      // Receipt logs may omit the subscription-only removed flag; canonical block checks remain mandatory.
      if ((log.removed !== undefined && log.removed !== false) || log.transactionHash !== txHash || log.blockHash !== hash || log.blockNumber !== number ||
          !Number.isSafeInteger(log.index) || log.index <= previousIndex) stop('INVALID_LOGS');
      previousIndex = log.index; selected.push(iface.parseLog(log));
    }
    if (selected.length !== batch.works.length * 2) stop('MINT_EVENTS_MISMATCH');
    for (let i = 0; i < batch.works.length; i++) {
      const item = batch.works[i], transfer = selected[i * 2], minted = selected[i * 2 + 1];
      if (transfer?.name !== 'Transfer' || transfer.args[0] !== ZeroAddress || transfer.args[1] !== batch.minter || transfer.args[2] !== BigInt(item.tokenId) ||
          minted?.name !== 'WorkMinted' || minted.args[0] !== BigInt(item.tokenId) || minted.args[1] !== item.title || minted.args[2] !== item.metadataURI ||
          minted.args[3] !== item.mediaHash || minted.args[4] !== item.rightsURI || minted.args[5] !== item.rightsHash) stop('MINT_EVENTS_MISMATCH');
      cancelled(signal);
      const options = { blockTag: number };
      const actual = await Promise.all([contract.workTitle(item.tokenId, options), contract.tokenURI(item.tokenId, options),
        contract.mediaSHA256(item.tokenId, options), contract.rightsURI(item.tokenId, options), contract.rightsSHA256(item.tokenId, options)]);
      if (actual.some((entry, index) => entry !== [item.title, item.metadataURI, item.mediaHash, item.rightsURI, item.rightsHash][index])) stop('IMMUTABLE_READBACK_MISMATCH');
    }
    await canonical(provider, number, hash, signal); await network(provider, batch.chainId, signal);
    return Object.freeze({ status: 'mint-receipt-verified', intentId: batch.id, transactionHash: txHash, blockNumber: number,
      blockHash: hash, confirmations: latest - number + 1, chainId: batch.chainId, collection: batch.collection,
      tokenIds: Object.freeze(batch.works.map(item => item.tokenId)), initialRecipient: batch.minter,
      ownershipNowVerified: false, publicContentVerified: false, validatorPolicyVerified: false, productionReady: false, listingVerified: false });
  } catch (error) { if (error instanceof MintCheckError) throw error; cancelled(signal); stop('RPC_VERIFICATION_UNAVAILABLE'); }
}

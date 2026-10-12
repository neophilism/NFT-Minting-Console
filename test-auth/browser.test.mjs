import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const source = await fs.readFile(new URL('../console/public/app.js', import.meta.url), 'utf8');
const WALLET = '0x1111111111111111111111111111111111111111';
const ORIGIN = 'https://console.example';
const flush = () => new Promise(resolve => setImmediate(resolve));
async function harness({ chainId = 11155111, role = 'owner', hostileChallenge = false, signing, initialStorage = [] } = {}) {
  const elements = new Map(), events = new Map(), calls = [], storage = [];
  let signatures = 0;
  const stored = new Map(initialStorage);
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', disabled: false, textContent: '', onclick: null });
    return elements.get(id);
  };
  const fakeSigner = { getAddress: async () => WALLET,
    signMessage: async () => { signatures++; if (signing) await signing; return '0xabcd'; } };
  const ethers = {
    // Deterministic substitute for storage-key control tests, not a keccak test.
    toUtf8Bytes: value => value,
    keccak256: value => '0x' + createHash('sha256').update(value).digest('hex'),
    BrowserProvider: class {
    async send() { return [WALLET]; }
    async getSigner() { return fakeSigner; }
    async getNetwork() { return { chainId: BigInt(chainId) }; }
  } };
  const fetch = async (route, options = {}) => {
    calls.push({ route, options });
    let body;
    if (route === '/api/config') body = { chainId: 11155111, chainName: 'Sepolia', capabilities: { deploy: true, publish: false, mint: false } };
    else if (route === '/api/auth/challenge') body = { challengeId: 'a'.repeat(64), chainId: 11155111,
      message: `${hostileChallenge ? 'https://evil.example' : ORIGIN} wants you to sign in with your Ethereum account:\n${WALLET}\n\nSign in.\n\nURI: ${ORIGIN}/\nChain ID: 11155111` };
    else if (route === '/api/auth/verify') body = { wallet: WALLET, csrf: 'c'.repeat(64), role };
    else if (route === '/api/auth/logout') body = { signedOut: true };
    else throw new Error(`Unexpected API call ${route}`);
    return { ok: true, status: 200, json: async () => body };
  };
  const context = vm.createContext({ document: { getElementById: element }, location: { origin: ORIGIN },
    window: { ethers, ethereum: { on: (name, callback) => events.set(name, callback) } }, ethers, fetch,
    localStorage: { getItem: key => { storage.push(['read', key]); return stored.get(key) || null; },
      setItem: (key, value) => { storage.push(['write', key, value]); stored.set(key, value); } },
    crypto: { randomUUID: () => 'test-only' } });
  vm.runInContext(source, context);
  await flush();
  return { element, events, calls, storage, stored, run: code => vm.runInContext(code, context), signatures: () => signatures };
}

test('initial browser load does not read or persist plaintext drafts', async () => {
  const h = await harness();
  assert.deepEqual(h.storage, []);
  assert.match(h.element('result').textContent, /memory-only/);
});
test('publication and minting remain disabled even when owner signs in', async () => {
  const h = await harness(); await h.element('connect').onclick();
  assert.equal(h.element('deploy').disabled, false);
  for (const id of ['prepare', 'preflight', 'mint']) assert.equal(h.element(id).disabled, true);
});
test('wrong network prevents signing or verification', async () => {
  const h = await harness({ chainId: 1 }); await h.element('connect').onclick();
  assert.equal(h.signatures(), 0);
  assert.ok(!h.calls.some(x => x.route === '/api/auth/verify'));
  assert.equal(h.element('deploy').disabled, true);
});
test('hostile challenge origin is rejected before a signature request', async () => {
  const h = await harness({ hostileChallenge: true }); await h.element('connect').onclick();
  assert.equal(h.signatures(), 0);
  assert.equal(h.element('deploy').disabled, true);
});
test('editor cannot enable rehearsal deployment', async () => {
  const h = await harness({ role: 'editor' }); await h.element('connect').onclick();
  assert.equal(h.element('deploy').disabled, true);
});
test('wallet changes immediately invalidate client controls and request server logout', async () => {
  const h = await harness(); await h.element('connect').onclick();
  h.events.get('accountsChanged')(); await flush();
  assert.equal(h.element('deploy').disabled, true);
  assert.ok(h.calls.some(x => x.route === '/api/auth/logout'));
});
test('wallet change while a signature is pending prevents session establishment', async () => {
  let release;
  const signing = new Promise(resolve => { release = resolve; });
  const h = await harness({ signing });
  const pending = h.element('connect').onclick(); await flush();
  h.events.get('chainChanged')(); release(); await pending;
  assert.ok(!h.calls.some(x => x.route === '/api/auth/verify'));
  assert.equal(h.element('deploy').disabled, true);
});
test('explicit sign-out clears local authority and makes a protected logout request', async () => {
  const h = await harness(); await h.element('connect').onclick(); await h.element('disconnect').onclick();
  assert.equal(h.element('deploy').disabled, true);
  assert.equal(h.element('disconnect').disabled, true);
  const request = h.calls.find(x => x.route === '/api/auth/logout');
  assert.equal(request.options.headers['X-CSRF-Token'], 'c'.repeat(64));
});

test('storage-key upgrade preserves an existing v2 release and its deployment identity', async () => {
  const key = `nftconsole-release-id:v2:11155111:${WALLET}:Example:EX`;
  const id = '0x' + 'b'.repeat(64);
  const h = await harness({ initialStorage: [[key, id]] });
  assert.equal(h.run(`releaseIdFor('Example', 'EX', '${WALLET}')`), id);
  assert.equal(h.stored.get(key), id);
  assert.equal(h.storage.filter(x => x[0] === 'write').length, 1);
  assert.equal(h.run(`releaseIdFor('Example', 'EX', '${WALLET}')`), id);
  assert.equal(h.storage.filter(x => x[0] === 'write').length, 1);
});
test('invalid legacy release identifier cannot silently trigger a second deployment', async () => {
  const key = `nftconsole-release-id:v2:11155111:${WALLET}:Example:EX`;
  const h = await harness({ initialStorage: [[key, 'corrupt']] });
  assert.throws(() => h.run(`releaseIdFor('Example', 'EX', '${WALLET}')`), /invalid/);
  assert.equal(h.storage.filter(x => x[0] === 'write').length, 0);
});
test('invalid current release identifier fails closed instead of being replaced', async () => {
  const h = await harness();
  h.run(`releaseIdFor('Example', 'EX', '${WALLET}')`);
  const key = h.storage.find(x => x[0] === 'write')[1];
  h.stored.set(key, 'corrupt');
  assert.throws(() => h.run(`releaseIdFor('Example', 'EX', '${WALLET}')`), /Do not redeploy/);
});

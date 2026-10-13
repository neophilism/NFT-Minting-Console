import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import pg from 'pg';
import { createApp } from '../console/server.mjs';
import { createAuthService } from '../console/auth/core.mjs';
import { PostgresAuthStore } from '../console/auth/postgres.mjs';
import { GuardedDatabasePool, databaseOptions } from '../console/data/pool.mjs';

// This file is intentionally excluded from the in-memory test glob. It only
// runs against the isolated PostgreSQL CI service, with a real restricted login.
const url = process.env.TEST_DATABASE_URL_UNPOOLED;
if (!url || process.env.NFT_TEST_DISPOSABLE_DATABASE !== 'yes' || new URL(url).pathname !== '/nft_console_ci') {
  throw new Error('Native HTTP acceptance requires the disposable nft_console_ci database.');
}
const ORIGIN = 'https://native-http.example';
const OWNER = '0x' + '55'.repeat(20), EDITOR = '0x' + '66'.repeat(20), OTHER = '0x' + '77'.repeat(20);
const roles = new Map([[OWNER, 'owner'], [EDITOR, 'editor'], [OTHER, 'owner']]);
const fixtureEnvelope = id => ({ id, ciphertext: randomBytes(32).toString('base64'), nonce: randomBytes(12).toString('base64') });

test('native restricted-runtime PostgreSQL and actual Express HTTP', async t => {
  const admin = new pg.Client(databaseOptions(url));
  await admin.connect();
  const password = randomBytes(32).toString('hex'); // Local test-only role secret; never logged.
  const runtimeUrl = new URL(url); runtimeUrl.username = 'nft_console_ci_runtime'; runtimeUrl.password = password;
  const apps = new Set(), extraPools = new Set();
  async function closeApp(item) {
    await new Promise((resolve, reject) => {
      item.server.close(error => error ? reject(error) : resolve());
      item.server.closeAllConnections();
    });
    await item.app.locals.close();
    apps.delete(item);
  }
  t.after(async () => {
    await Promise.all([...apps].map(closeApp));
    await Promise.all([...extraPools].map(pool => pool.end()));
    await admin.end();
  });
  assert.ok(Number((await admin.query('SHOW server_version_num')).rows[0].server_version_num) >= 180000);
  assert.ok((await admin.query("SELECT to_regclass('nft_console_auth.sessions') AS name")).rows[0].name);
  // The migration suite ran first against this disposable service. Never reuse
  // an operator or superuser credential for any application request below.
  await admin.query(`CREATE ROLE nft_console_ci_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
    NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
  await admin.query(`GRANT nft_console_api,nft_console_auth_service,nft_console_identity
    TO nft_console_ci_runtime WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);
  const raw = new pg.Pool(databaseOptions(runtimeUrl.toString())); extraPools.add(raw);
  const pool = new GuardedDatabasePool(raw);
  const store = () => new PostgresAuthStore({ pool, origin: ORIGIN, chainId: 11155111, roles });
  async function openApp() {
    const auth = createAuthService({ origin: ORIGIN, chainId: 11155111, store: store(),
      roles: () => roles, checksumAddress: x => x,
      // Signature checks are separately covered against actual ethers and Safe.
      // Here only the proof adapter is a fixture; SQL, privileges and HTTP are real.
      verifyWallet: async ({ signature }) => ({ valid: signature === '0xabcd', kind: 'eoa' }) });
    const app = createApp({ env: { NODE_ENV: 'test', PUBLIC_ORIGIN: ORIGIN, CHAIN_ID: '11155111',
      ADMIN_WALLETS: `${OWNER},${OTHER}`, EDITOR_WALLETS: EDITOR, DATABASE_URL: runtimeUrl.toString() }, authService: auth });
    await app.locals.ready;
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const item = { app, server, base: `http://127.0.0.1:${server.address().port}` }; apps.add(item); return item;
  }
  const request = (app, route, session, method = 'GET', body) => fetch(app.base + route, {
    method, headers: { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(session || {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  async function challenge(app, wallet = OWNER) {
    const response = await request(app, '/api/auth/challenge', null, 'POST', { wallet, chainId: 11155111 });
    assert.equal(response.status, 200);
    return { wallet, ...(await response.json()),
      cookie: response.headers.getSetCookie().find(x => x.startsWith('nft_challenge_v2=')).split(';')[0] };
  }
  async function finish(app, c) {
    return request(app, '/api/auth/verify', { Cookie: c.cookie }, 'POST',
      { wallet: c.wallet, chainId: 11155111, challengeId: c.challengeId, message: c.message, signature: '0xabcd' });
  }
  async function login(app, wallet = OWNER) {
    const response = await finish(app, await challenge(app, wallet)); assert.equal(response.status, 200);
    const body = await response.json();
    return { Cookie: response.headers.getSetCookie().find(x => x.startsWith('nft_session_v2=')).split(';')[0], 'X-CSRF-Token': body.csrf };
  }
  let a, b, owner, editor, stranger;
  const draft = fixtureEnvelope(randomUUID());
  await t.test('runtime guard rejects the actual migration login', async () => {
    const privileged = new pg.Pool(databaseOptions(url)); extraPools.add(privileged);
    await assert.rejects(new GuardedDatabasePool(privileged).connect(), /restricted runtime login/);
  });
  await t.test('restricted runtime passes guard but cannot read tables without SET ROLE', async () => {
    const client = await pool.connect();
    try { await assert.rejects(client.query('SELECT * FROM nft_console.releases'), error => error.code === '42501'); }
    finally { client.release(); }
  });
  await t.test('two application instances start with separate storage pools', async () => {
    a = await openApp(); b = await openApp();
    const body = await (await request(a, '/api/config')).json();
    assert.equal(body.authStore, 'postgresql'); assert.equal(body.capabilities.opaqueReleaseApi, true);
    assert.equal(body.capabilities.privateDrafts, false);
  });
  await t.test('one login challenge has exactly one winner across HTTP instances', async () => {
    const c = await challenge(a);
    const responses = await Promise.all([finish(a, c), finish(b, c)]);
    assert.deepEqual(responses.map(x => x.status).sort(), [200, 401]);
  });
  await t.test('sessions are recognized across independent app instances', async () => {
    owner = await login(a); editor = await login(a, EDITOR); stranger = await login(b, OTHER);
    const response = await request(b, '/api/auth/session', owner); assert.equal(response.status, 200);
    assert.equal((await response.json()).wallet, OWNER);
  });
  await t.test('release creation is durable and duplicate retries are idempotent', async () => {
    assert.equal((await request(a, '/api/releases', owner, 'POST', draft)).status, 201);
    assert.equal((await request(b, '/api/releases', owner, 'POST', draft)).status, 200);
    const response = await request(b, `/api/releases/${draft.id}`, owner); assert.equal(response.status, 200);
    assert.equal((await response.json()).ciphertext, draft.ciphertext);
  });
  await t.test('plaintext fields and unauthenticated draft writes are rejected', async () => {
    assert.equal((await request(a, '/api/releases', owner, 'POST', { ...draft, title: 'private plaintext' })).status, 400);
    assert.equal((await request(a, '/api/releases', null, 'POST', draft)).status, 401);
    assert.equal((await request(b, `/api/releases/${draft.id}`, stranger)).status, 404);
  });
  await t.test('viewer access permits reading but cannot edit or grant permissions', async () => {
    assert.equal((await request(a, `/api/releases/${draft.id}/permissions/${EDITOR}`, owner, 'PUT', { permission: 'viewer' })).status, 200);
    assert.equal((await request(b, `/api/releases/${draft.id}`, editor)).status, 200);
    const next = fixtureEnvelope(draft.id);
    assert.equal((await request(b, `/api/releases/${draft.id}`, editor, 'PUT',
      { ciphertext: next.ciphertext, nonce: next.nonce, expectedRevision: '1' })).status, 404);
    assert.equal((await request(a, `/api/releases/${draft.id}/permissions/${OTHER}`, editor, 'PUT', { permission: 'editor' })).status, 403);
  });
  await t.test('competing revision writes from two nodes cannot silently overwrite', async () => {
    assert.equal((await request(a, `/api/releases/${draft.id}/permissions/${EDITOR}`, owner, 'PUT', { permission: 'editor' })).status, 200);
    const write = (app, session) => { const next = fixtureEnvelope(draft.id); return request(app,
      `/api/releases/${draft.id}`, session, 'PUT', { ciphertext: next.ciphertext, nonce: next.nonce, expectedRevision: '1' }); };
    const responses = await Promise.all([write(a, owner), write(b, editor)]);
    assert.deepEqual(responses.map(x => x.status).sort(), [200, 409]);
  });
  await t.test('permission changes are audited and revocation applies across nodes', async () => {
    let response = await request(b, `/api/releases/${draft.id}/permission-events`, owner);
    assert.equal((await response.json()).events.length, 2);
    assert.equal((await request(a, `/api/releases/${draft.id}/permissions/${EDITOR}`, owner, 'DELETE')).status, 200);
    assert.equal((await request(b, `/api/releases/${draft.id}`, editor)).status, 404);
    response = await request(b, `/api/releases/${draft.id}/permission-events`, owner);
    assert.equal((await response.json()).events.length, 3);
  });
  await t.test('app shutdown and recreation preserve session and encrypted-envelope bytes', async () => {
    await closeApp(a); a = await openApp();
    assert.equal((await request(a, '/api/auth/session', owner)).status, 200);
    assert.equal((await request(a, `/api/releases/${draft.id}`, owner)).status, 200);
  });
  const mintBody={intentId:'0x'+'a1'.repeat(32),collection:'0x'+'ab'.repeat(20),runtimeCodeHash:'0x'+'b1'.repeat(32)};
  const mintPath='/api/mint-operations/'+mintBody.intentId;
  await t.test('journal HTTP is authenticated, CSRF-bound and refuses client completion claims',async()=>{
    assert.equal((await request(a,'/api/mint-operations',null)).status,401);
    assert.equal((await request(a,'/api/mint-operations',editor,'POST',mintBody)).status,403);
    assert.equal((await request(a,'/api/mint-operations',{Cookie:owner.Cookie},'POST',mintBody)).status,403);
    assert.equal((await request(a,'/api/mint-operations',owner,'POST',{...mintBody,state:'verified'})).status,400);
    assert.equal((await request(a,'/api/mint-operations',owner,'POST',mintBody)).status,201);
    assert.equal((await request(b,'/api/mint-operations',owner,'POST',mintBody)).status,200);
    assert.equal((await request(b,mintPath,stranger)).status,404);
  });
  await t.test('two HTTP nodes produce one wallet reservation and preserve it over restart',async()=>{
    const results=await Promise.all([request(a,mintPath+'/claim',owner,'POST',{expectedRevision:'1'}),request(b,mintPath+'/claim',owner,'POST',{expectedRevision:'1'})]);
    assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
    await closeApp(a);a=await openApp();
    const stored=await (await request(a,mintPath,owner)).json();assert.equal(stored.state,'wallet_pending');
    assert.equal((await request(a,mintPath+'/cancel',owner,'POST',{expectedRevision:stored.revision})).status,409);
    assert.equal((await request(b,mintPath+'/wallet-outcome',owner,'POST',{expectedRevision:stored.revision,attemptId:stored.attemptId,outcome:'unknown'})).status,200);
    const unknown=await (await request(a,mintPath,owner)).json();assert.equal(unknown.state,'attention');
    assert.equal((await request(a,mintPath+'/claim',owner,'POST',{expectedRevision:unknown.revision})).status,409);
  });
  await t.test('transaction attachment and audit persist but unavailable RPC never confirms a mint',async()=>{
    const transactionHash='0x'+'c1'.repeat(32);
    assert.equal((await request(a,mintPath+'/transaction',owner,'POST',{transactionHash})).status,200);
    const value=await (await request(b,mintPath+'/reconcile',owner,'POST',{})).json();
    assert.equal(value.state,'attention');assert.equal(value.lastCode,'RPC_VERIFICATION_UNAVAILABLE');assert.equal(value.listingVerified,false);
    assert.equal((await request(b,mintPath+'/reconcile',owner,'POST',{state:'verified'})).status,400);
    const events=await (await request(a,mintPath+'/events',owner)).json();assert.equal(events.events.length,5);
    await closeApp(b);b=await openApp();
    assert.equal((await (await request(b,mintPath,owner)).json()).transactionHash,transactionHash);
    assert.equal((await request(b,mintPath+'/events',stranger)).status,404);
  });
  await t.test('cross-instance logout cannot be undone by a stale session touch', async () => {
    assert.equal((await request(a, '/api/auth/logout', owner, 'POST', {})).status, 200);
    assert.equal((await request(b, '/api/auth/session', owner)).status, 401);
    owner = await login(a);
  });
  await t.test('unexpected role grants fail closed on the next real connection lease', async () => {
    await admin.query('CREATE ROLE nft_console_ci_extra NOLOGIN');
    await admin.query('GRANT nft_console_ci_extra TO nft_console_ci_runtime WITH INHERIT FALSE');
    try {
      await assert.rejects(pool.connect(), /restricted runtime login/);
      const response = await request(a, '/api/auth/session', owner);
      assert.equal(response.status, 503); assert.ok(!(await response.text()).includes(password));
    } finally { await admin.query('REVOKE nft_console_ci_extra FROM nft_console_ci_runtime'); }
    assert.equal((await request(b, '/api/auth/session', owner)).status, 200);
  });
  await t.test('HTTP publication and production remain gated despite durable auth', async () => {
    assert.equal((await request(a, '/api/prepare', owner, 'POST', {})).status, 409);
    assert.throws(() => createApp({ env: { NODE_ENV: 'production' } }), /Production startup is blocked/);
  });
});

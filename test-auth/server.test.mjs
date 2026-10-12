import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../console/server.mjs';
import { createAuthService, rolesFromEnvironment } from '../console/auth/core.mjs';

// Real Express/HTTP integration with a deliberately fake signature adapter.
// Real ethers/EVM proofs belong to test/AuthWallet.cjs, not these fixtures.
const OWNER = '0x1111111111111111111111111111111111111111';
const VIEWER = '0x2222222222222222222222222222222222222222';
const ORIGIN = 'https://console.example';
const SIG = '0xabcd';
async function fixture(t, { chainId = 11155111 } = {}) {
  const env = { PUBLIC_ORIGIN: ORIGIN, CHAIN_ID: String(chainId), ADMIN_WALLETS: OWNER,
    VIEWER_WALLETS: VIEWER, PINATA_JWT: 'private-fixture-do-not-return', NODE_ENV: 'test' };
  const roles = rolesFromEnvironment(env);
  const auth = createAuthService({ origin: ORIGIN, chainId, roles: () => roles,
    checksumAddress: value => value, verifyWallet: async ({ signature }) => ({ valid: signature === SIG, kind: 'eoa' }) });
  const app = createApp({ env, authService: auth });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
    app.locals.close();
  });
  const request = (route, options = {}) => fetch(base + route, { ...options,
    headers: { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin', ...options.headers } });
  const post = (route, data, headers = {}) => request(route, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  async function login(wallet = OWNER) {
    const response = await post('/api/auth/challenge', { wallet, chainId });
    assert.equal(response.status, 200);
    const challenge = await response.json();
    const cookie = response.headers.getSetCookie().find(x => x.startsWith('nft_challenge_v2=')).split(';')[0];
    const verified = await post('/api/auth/verify', { wallet, chainId, challengeId: challenge.challengeId,
      message: challenge.message, signature: SIG }, { Cookie: cookie });
    assert.equal(verified.status, 200);
    const body = await verified.json();
    const sessionCookie = verified.headers.getSetCookie().find(x => x.startsWith('nft_session_v2=')).split(';')[0];
    return { Cookie: sessionCookie, 'X-CSRF-Token': body.csrf };
  }
  return { app, request, post, login, env };
}

test('real HTTP handshake establishes and revokes an HttpOnly session', async t => {
  const h = await fixture(t), headers = await h.login();
  const session = await h.request('/api/auth/session', { headers });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).wallet, OWNER);
  assert.equal((await h.post('/api/auth/logout', {}, headers)).status, 200);
  assert.equal((await h.request('/api/auth/session', { headers })).status, 401);
});
test('config reports blocked features without returning provider secrets', async t => {
  const h = await fixture(t), response = await h.request('/api/config');
  const body = await response.json();
  assert.equal(body.productionReady, false);
  assert.equal(body.pinningReady, false);
  for (const key of ['mint', 'publish', 'list', 'privateDrafts']) assert.equal(body.capabilities[key], false);
  assert.ok(!JSON.stringify(body).includes(h.env.PINATA_JWT));
});
test('unauthenticated API requests cannot inspect readiness, preflight or artifacts', async t => {
  const h = await fixture(t);
  for (const route of ['/api/launch-readiness', '/api/artifact', '/api/preflight', '/api/opensea-url']) {
    assert.equal((await h.request(route)).status, 401);
  }
});
test('multipart artwork is rejected before the legacy publication handler can pin it', async t => {
  const h = await fixture(t), headers = await h.login();
  const form = new FormData();
  form.append('media', new Blob(['unreleased fixture artwork']), 'private.txt');
  const response = await h.request('/api/prepare', { method: 'POST', headers, body: form });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'publication_gated');
});
test('viewer cannot reach publishing even with a valid CSRF token', async t => {
  const h = await fixture(t), headers = await h.login(VIEWER);
  assert.equal((await h.post('/api/prepare', {}, headers)).status, 403);
  assert.equal((await h.request('/api/artifact', { headers })).status, 403);
});
test('owner still needs CSRF protection and the exact origin', async t => {
  const h = await fixture(t), headers = await h.login();
  assert.equal((await h.post('/api/prepare', {}, { Cookie: headers.Cookie })).status, 403);
  assert.equal((await h.post('/api/prepare', {}, { ...headers, Origin: 'https://evil.example' })).status, 403);
});
test('mainnet artifacts cannot be obtained through the rehearsal route', async t => {
  const h = await fixture(t, { chainId: 1 }), headers = await h.login();
  const response = await h.request('/api/artifact', { headers });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'mainnet_gated');
});
test('readiness is software evidence, not fabricated wallet inventory', async t => {
  const h = await fixture(t), headers = await h.login();
  const body = await (await h.request('/api/launch-readiness', { headers })).json();
  assert.equal(body.mintingEvidence, 'not-verified');
  assert.equal(body.listingEvidence, 'not-verified');
  assert.equal(Object.hasOwn(body, 'minted'), false);
  assert.equal(body.blockers.length, 6);
  assert.equal(body.authentication, 'software-integration-accepted');
  const milestones = body.blockers.flatMap(group => group.milestones);
  assert.ok(!milestones.includes('NFT-09'));
  assert.ok(!milestones.includes('NFT-15'));
  assert.ok(milestones.includes('NFT-10'));
  assert.ok(milestones.includes('NFT-26'));
  assert.equal(body.productionReady, false);
});
test('OpenSea URL is explicitly link-only and token identifiers are bounded', async t => {
  const h = await fixture(t), headers = await h.login();
  const response = await h.request(`/api/opensea-url?contract=${OWNER}&id=1`, { headers });
  const body = await response.json();
  assert.equal(body.status, 'link-only');
  assert.equal(body.listingVerified, false);
  assert.equal((await h.request(`/api/opensea-url?contract=${OWNER}&id=${1n << 256n}`, { headers })).status, 400);
});
test('deployment lookup cannot impersonate another requester', async t => {
  const h = await fixture(t), headers = await h.login();
  const response = await h.request(`/api/deployment/0x${'a'.repeat(64)}?requester=${VIEWER}`, { headers });
  assert.equal(response.status, 403);
});
test('HTTP errors are bounded and redacted, with security headers', async t => {
  const h = await fixture(t);
  const malformed = await h.request('/api/auth/challenge', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: '{private-fixture' });
  assert.equal(malformed.status, 400);
  assert.ok(!(await malformed.text()).includes('private-fixture'));
  const oversized = await h.post('/api/auth/challenge', { ignored: 'x'.repeat(70000) });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.headers.get('x-powered-by'), null);
  assert.equal(oversized.headers.get('cache-control'), 'no-store');
  assert.match(oversized.headers.get('content-security-policy'), /object-src 'none'/);
});
test('production cannot be enabled with a test-injected authentication service', () => {
  assert.throws(() => createApp({ env: { NODE_ENV: 'production' }, authService: {} }), /Production startup is blocked/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthError, createAuthService } from '../console/auth/core.mjs';
import { authFailure, cookieValue, installAuthRoutes } from '../console/auth/http.mjs';

const ORIGIN = 'https://console.example';
const WALLET = '0x1111111111111111111111111111111111111111';
const CHAIN = 11155111;
const BODY = { wallet: WALLET, chainId: CHAIN };
function setup(production = false) {
  const routes = new Map();
  const app = { get: (path, handler) => routes.set(`GET ${path}`, handler), post: (path, handler) => routes.set(`POST ${path}`, handler) };
  const auth = createAuthService({ origin: ORIGIN, chainId: CHAIN,
    roles: () => new Map([[WALLET, 'owner']]), checksumAddress: x => x,
    verifyWallet: async ({ signature }) => ({ valid: signature === '0xabcd', kind: 'eoa' }) });
  const required = installAuthRoutes(app, auth, { production });
  return { routes, required };
}
function request(body = BODY, headers = {}) {
  const h = { origin: ORIGIN, 'content-type': 'application/json', ...headers };
  return { method: 'POST', body, ip: '127.0.0.1', headers: h, get: name => h[name.toLowerCase()] };
}
function response() {
  return { statusCode: 200, headers: {}, cookies: [], cleared: [],
    status(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[key] = value; },
    cookie(name, value, options) { this.cookies.push({ name, value, options }); return this; },
    clearCookie(name, options) { this.cleared.push({ name, options }); return this; },
    json(value) { this.body = value; return this; } };
}
async function begin(f) {
  const res = response();
  await f.routes.get('POST /api/auth/challenge')(request(), res);
  return res;
}
async function login(f) {
  const c = await begin(f), res = response();
  await f.routes.get('POST /api/auth/verify')(request({ ...BODY, ...c.body, signature: '0xabcd' },
    { cookie: `${c.cookies[0].name}=${c.cookies[0].value}` }), res);
  return res;
}

test('cookie parser does not accept duplicate security cookies', () => {
  assert.throws(() => cookieValue('nft=a; nft=b', 'nft'), error => error.code === 'invalid_request');
  assert.equal(cookieValue('other=not-nft; nft=a', 'nft'), 'a');
  assert.equal(cookieValue(undefined, 'nft'), undefined);
});
test('cookie parser bounds header size and rejects nonstrings', () => {
  assert.throws(() => cookieValue('a'.repeat(8193), 'nft'));
  assert.throws(() => cookieValue(['nft=a'], 'nft'));
});
test('challenge cookie is HttpOnly, secure, SameSite Strict and not exposed in JSON', async () => {
  const res = await begin(setup());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.cookies[0].options, { httpOnly: true, sameSite: 'strict', secure: true, path: '/', maxAge: 300000 });
  assert.ok(!JSON.stringify(res.body).includes(res.cookies[0].value));
});
test('production HTTP adapter uses host-prefixed cookies without Domain', async () => {
  const res = await begin(setup(true));
  assert.equal(res.cookies[0].name, '__Host-nft_challenge');
  assert.equal(res.cookies[0].options.domain, undefined);
});
test('HTML-form challenges are rejected', async () => {
  const f = setup(), res = response();
  await f.routes.get('POST /api/auth/challenge')(request(BODY, { 'content-type': 'application/x-www-form-urlencoded' }), res);
  assert.equal(res.statusCode, 415);
  assert.equal(res.cookies.length, 0);
});
test('array and absent JSON bodies are rejected', async () => {
  for (const body of [[], null]) {
    const f = setup(), res = response();
    await f.routes.get('POST /api/auth/challenge')(request(body), res);
    assert.equal(res.statusCode, 415);
  }
});
test('cross-site and sibling-origin browser requests are rejected', async () => {
  for (const site of ['cross-site', 'same-site']) {
    const f = setup(), res = response();
    await f.routes.get('POST /api/auth/challenge')(request(BODY, { 'sec-fetch-site': site }), res);
    assert.equal(res.statusCode, 403);
  }
});
test('body-supplied Origin cannot override missing trusted request Origin', async () => {
  const f = setup(), res = response();
  await f.routes.get('POST /api/auth/challenge')(request({ ...BODY, origin: ORIGIN }, { origin: undefined }), res);
  assert.equal(res.statusCode, 403);
});
test('Host and Forwarded headers cannot change the SIWE origin', async () => {
  const f = setup(), res = response();
  await f.routes.get('POST /api/auth/challenge')(request(BODY, { host: 'evil.example', 'x-forwarded-host': 'evil.example' }), res);
  assert.ok(res.body.message.startsWith(`${ORIGIN} wants you`));
  assert.ok(!res.body.message.includes('evil.example'));
});
test('login returns CSRF not the bearer token and clears challenge and legacy cookies', async () => {
  const res = await login(setup());
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.role, 'owner');
  assert.ok(res.body.csrf);
  assert.ok(!JSON.stringify(res.body).includes(res.cookies[0].value));
  assert.deepEqual(res.cleared.map(x => x.name), ['nft_challenge_v2', 'nft_session']);
  assert.equal(res.cookies[0].options.httpOnly, true);
});
test('client cannot forge browser binding through a JSON field', async () => {
  const f = setup(), c = await begin(f), res = response();
  await f.routes.get('POST /api/auth/verify')(request({ ...BODY, ...c.body, signature: '0xabcd', binding: c.cookies[0].value }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.cookies.length, 0);
});
test('middleware protects unauthenticated endpoints before calling next', async () => {
  const f = setup(), res = response(); let called = false;
  await f.required('read')(request(), res, () => { called = true; });
  assert.equal(res.statusCode, 401); assert.equal(called, false);
});
test('middleware validates CSRF and binds verified actor rather than body-supplied wallet', async () => {
  const f = setup(), logged = await login(f);
  const cookie = `${logged.cookies[0].name}=${logged.cookies[0].value}`;
  const req = request({ wallet: 'forged' }, { cookie, 'x-csrf-token': logged.body.csrf });
  let called = false;
  await f.required('publish')(req, response(), () => { called = true; });
  assert.equal(called, true); assert.equal(req.actor.wallet, WALLET);
  const bad = response();
  await f.required('publish')(request(BODY, { cookie }), bad, () => assert.fail('must not execute'));
  assert.equal(bad.statusCode, 403);
});
test('session bootstrap reads require a valid cookie and reject cross-site requests', async () => {
  const f = setup(), logged = await login(f);
  const cookie = `${logged.cookies[0].name}=${logged.cookies[0].value}`;
  const res = response();
  await f.routes.get('GET /api/auth/session')(request({}, { cookie }), res);
  assert.equal(res.body.csrf, logged.body.csrf);
  const cross = response();
  await f.routes.get('GET /api/auth/session')(request({}, { cookie, 'sec-fetch-site': 'cross-site' }), cross);
  assert.equal(cross.statusCode, 403);
});
test('logout clears cookies and invalidates the server session', async () => {
  const f = setup(), logged = await login(f);
  const cookie = `${logged.cookies[0].name}=${logged.cookies[0].value}`;
  const out = response();
  await f.routes.get('POST /api/auth/logout')(request({}, { cookie, 'x-csrf-token': logged.body.csrf }), out);
  assert.equal(out.body.signedOut, true);
  assert.equal(out.cleared.length, 3);
  const old = response();
  await f.routes.get('GET /api/auth/session')(request({}, { cookie }), old);
  assert.equal(old.statusCode, 401);
});
test('rate-limit failures include Retry-After and redact unknown exceptions', () => {
  const res = response(); authFailure(new AuthError(429, 'rate_limited'), res);
  assert.equal(res.headers['Retry-After'], '60');
  const other = response(); authFailure(new Error('private-provider-key'), other);
  assert.equal(other.statusCode, 503);
  assert.ok(!JSON.stringify(other.body).includes('private-provider-key'));
});

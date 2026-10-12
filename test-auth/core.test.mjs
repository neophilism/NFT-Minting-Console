import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthError, MemoryAuthStore, assertReleaseAccess, assertRole, canonicalOrigin,
  createAuthService, digest, rolesFromEnvironment, sameSecret, walletKey } from '../console/auth/core.mjs';

const OWNER = '0x1111111111111111111111111111111111111111';
const EDITOR = '0x2222222222222222222222222222222222222222';
const VIEWER = '0x3333333333333333333333333333333333333333';
const OTHER = '0x4444444444444444444444444444444444444444';
const ORIGIN = 'https://console.example';
const CHAIN = 11155111;
const SIG = '0xabcd';
const IP = '127.0.0.1';
const errorCode = code => error => error instanceof AuthError && error.code === code;

// These are isolated protocol/control tests, NOT cryptographic signature tests.
// test/AuthWallet.cjs separately exercises the pinned ethers and EVM adapters.
function fixture(options = {}) {
  let time = Date.now();
  const roles = new Map([[OWNER, 'owner'], [EDITOR, 'editor'], [VIEWER, 'viewer']]);
  const events = [];
  const store = new MemoryAuthStore({ now: () => time, limit: options.limit || 1000 });
  let kind = 'eoa', valid = true, verifierCalls = 0;
  const auth = createAuthService({ origin: ORIGIN, chainId: CHAIN, roles: () => roles,
    checksumAddress: value => value, store, now: () => time, audit: value => events.push(value),
    verifyWallet: options.verifyWallet || (async ({ signature }) => {
      verifierCalls++;
      return { valid: valid && signature === SIG, kind };
    }) });
  return { auth, store, roles, events, advance: ms => { time += ms; },
    setKind: value => { kind = value; }, setValid: value => { valid = value; },
    calls: () => verifierCalls };
}
async function challenge(f, wallet = OWNER) {
  return f.auth.challenge({ wallet, chainId: CHAIN, origin: ORIGIN, ip: IP });
}
function proof(c, wallet = OWNER) {
  return { wallet, chainId: CHAIN, origin: ORIGIN, ip: IP, signature: SIG,
    challengeId: c.response.challengeId, message: c.response.message, binding: c.binding };
}
async function login(f, wallet = OWNER, previousToken) {
  return f.auth.verify({ ...proof(await challenge(f, wallet), wallet), previousToken });
}
function session(s, overrides = {}) { return { token: s.token, ip: IP, ...overrides }; }

for (const invalid of ['http://example.com', 'https://console.example/', 'https://u:p@console.example',
  'https://console.example/path', 'https://console.example?x=y', 'https://console.example#x', 'null', 'javascript:alert(1)']) {
  test(`rejects invalid authentication origin ${invalid}`, () => assert.throws(() => canonicalOrigin(invalid)));
}
test('allows exact HTTPS origins and development HTTP loopback', () => {
  assert.equal(canonicalOrigin(ORIGIN, true), ORIGIN);
  assert.equal(canonicalOrigin('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(canonicalOrigin('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.throws(() => canonicalOrigin('http://localhost:3000', true));
});
test('production cannot use in-memory authentication', () => {
  assert.throws(() => createAuthService({ origin: ORIGIN, chainId: CHAIN, production: true,
    roles: () => new Map(), verifyWallet: () => {}, checksumAddress: x => x }), /durable/);
});
test('rejects zero, non-string and malformed wallet addresses', () => {
  for (const value of ['0x' + '0'.repeat(40), '0x123', {}, null, 123]) assert.throws(() => walletKey(value), errorCode('invalid_request'));
});
test('normalizes wallet identity case', () => {
  assert.equal(walletKey('0x' + 'Aa'.repeat(20)), '0x' + 'aa'.repeat(20));
});
test('environment roles reject conflicting privileges and malformed addresses', () => {
  assert.throws(() => rolesFromEnvironment({ ADMIN_WALLETS: OWNER, VIEWER_WALLETS: OWNER }), /conflicting/);
  assert.throws(() => rolesFromEnvironment({ ADMIN_WALLETS: 'anything' }));
  assert.equal(rolesFromEnvironment({ ADMIN_WALLETS: OWNER, EDITOR_WALLETS: EDITOR, VIEWER_WALLETS: VIEWER }).get(EDITOR), 'editor');
});
test('canonical message binds scheme, host, address, chain, nonce, issue and expiry', async () => {
  const c = await challenge(fixture());
  assert.match(c.response.message, /^https:\/\/console\.example wants you to sign in with your Ethereum account:\n0x111/);
  for (const field of [`URI: ${ORIGIN}/`, 'Version: 1', `Chain ID: ${CHAIN}`, 'Issued At: ', 'Expiration Time: ']) assert.ok(c.response.message.includes(field));
  assert.match(c.response.message, /Nonce: [a-f0-9]{64}\n/);
  assert.match(c.response.message, /does not authorize publishing, minting, listing, or asset transfers/);
  assert.equal(c.response.chainId, CHAIN);
});
test('challenges and browser-binding cookies are independent high-entropy handles', async () => {
  const f = fixture(), a = await challenge(f), b = await challenge(f);
  assert.notEqual(a.binding, b.binding);
  assert.notEqual(a.response.challengeId, b.response.challengeId);
  assert.notEqual(a.binding, a.response.challengeId);
  assert.equal(a.binding.length, 64);
  assert.notEqual(a.response.message, b.response.message);
});
for (const origin of [undefined, 'null', 'https://evil.example', 'https://console.example.evil.test', 'http://console.example']) {
  test(`challenge rejects absent or mismatched origin ${origin}`, async () => {
    await assert.rejects(fixture().auth.challenge({ wallet: OWNER, chainId: CHAIN, origin, ip: IP }), errorCode('invalid_origin'));
  });
}
test('unallowlisted wallet cannot obtain a challenge', async () => {
  await assert.rejects(challenge(fixture(), OTHER), errorCode('forbidden'));
});
test('wrong-chain login is rejected before issuing a challenge', async () => {
  await assert.rejects(fixture().auth.challenge({ wallet: OWNER, chainId: 1, origin: ORIGIN, ip: IP }), errorCode('wrong_chain'));
});
test('successful login stores only a hashed bearer handle and returns role, csrf, expirations', async () => {
  const f = fixture(), s = await login(f);
  assert.equal(s.response.role, 'owner');
  assert.equal(s.response.wallet, OWNER);
  assert.equal(s.response.csrf.length, 64);
  assert.notEqual(s.response.csrf, s.token);
  assert.ok(f.store.sessions.has(digest(s.token)));
  assert.ok(!f.store.sessions.has(s.token));
  assert.ok(!JSON.stringify([...f.store.sessions.values()]).includes(SIG));
  assert.ok(Date.parse(s.response.expiresAt) > Date.parse(s.response.idleExpiresAt));
});
test('nonce can be used only once', async () => {
  const f = fixture(), p = proof(await challenge(f));
  await f.auth.verify(p);
  await assert.rejects(f.auth.verify(p), errorCode('invalid_challenge'));
  assert.equal(f.calls(), 1);
});
test('concurrent nonce replay has exactly one winner', async () => {
  const f = fixture(), p = proof(await challenge(f));
  const outcomes = await Promise.allSettled([f.auth.verify(p), f.auth.verify(p)]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(f.calls(), 1);
});
test('captured signature without browser-binding cookie cannot establish a session', async () => {
  const f = fixture(), p = proof(await challenge(f));
  await assert.rejects(f.auth.verify({ ...p, binding: undefined }), errorCode('invalid_challenge'));
  await assert.rejects(f.auth.verify({ ...p, binding: 'a'.repeat(64) }), errorCode('invalid_challenge'));
  await f.auth.verify(p); // A third party cannot consume an unbound victim challenge.
});
for (const patch of [{ wallet: OTHER }, { chainId: 1 }, { message: 'an altered message' }]) {
  test(`rejects changed proof fields ${Object.keys(patch)}`, async () => {
    const f = fixture(), p = proof(await challenge(f));
    await assert.rejects(f.auth.verify({ ...p, ...patch }), errorCode('invalid_challenge'));
    assert.equal(f.calls(), 0);
  });
}
test('rejects untrusted verify origins before consuming the challenge', async () => {
  const f = fixture(), p = proof(await challenge(f));
  await assert.rejects(f.auth.verify({ ...p, origin: 'https://evil.example' }), errorCode('invalid_origin'));
  await f.auth.verify(p);
});
test('invalid signature consumes the challenge and cannot be retried', async () => {
  const f = fixture(), p = proof(await challenge(f));
  await assert.rejects(f.auth.verify({ ...p, signature: '0x1122' }), errorCode('invalid_signature'));
  await assert.rejects(f.auth.verify(p), errorCode('invalid_challenge'));
});
for (const signature of [null, {}, 'no-hex', '0xa', '0x' + 'aa'.repeat(16385)]) {
  test(`rejects invalid or excessive signature input ${typeof signature}:${String(signature).slice(0, 12)}`, async () => {
    const f = fixture(), p = proof(await challenge(f));
    await assert.rejects(f.auth.verify({ ...p, signature }), errorCode('invalid_signature'));
    assert.equal(f.calls(), 0);
  });
}
test('challenge expires after five minutes', async () => {
  const f = fixture(), p = proof(await challenge(f));
  f.advance(300000);
  await assert.rejects(f.auth.verify(p), errorCode('invalid_challenge'));
});
test('rejects a challenge after wall-clock rollback', async () => {
  const f = fixture(), p = proof(await challenge(f));
  f.advance(-1000);
  await assert.rejects(f.auth.verify(p), errorCode('invalid_challenge'));
});
test('allowlist revocation between challenge and signature is enforced', async () => {
  const f = fixture(), p = proof(await challenge(f));
  f.roles.delete(OWNER);
  await assert.rejects(f.auth.verify(p), errorCode('forbidden'));
});
test('session rotation invalidates the previous token', async () => {
  const f = fixture(), first = await login(f), second = await login(f, OWNER, first.token);
  await assert.rejects(f.auth.authenticate(session(first)), errorCode('session_required'));
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.response.csrf, second.response.csrf);
  assert.equal((await f.auth.authenticate(session(second))).wallet, OWNER);
});
test('rejects expired idle sessions', async () => {
  const f = fixture(), s = await login(f);
  f.advance(30 * 60000);
  await assert.rejects(f.auth.authenticate(session(s)), errorCode('session_required'));
});
test('active requests cannot extend the signed absolute expiration', async () => {
  const f = fixture(), s = await login(f);
  for (let i = 0; i < 23; i++) { f.advance(20 * 60000); await f.auth.authenticate(session(s)); }
  f.advance(20 * 60000);
  await assert.rejects(f.auth.authenticate(session(s)), errorCode('session_required'));
});
test('session revocation remains final after a wallet is reallowlisted', async () => {
  const f = fixture(), s = await login(f);
  f.roles.delete(OWNER);
  await assert.rejects(f.auth.authenticate(session(s)), errorCode('forbidden'));
  f.roles.set(OWNER, 'owner');
  await assert.rejects(f.auth.authenticate(session(s)), errorCode('session_required'));
});
test('server-side role downgrade takes effect for existing sessions', async () => {
  const f = fixture(), s = await login(f);
  f.roles.set(OWNER, 'viewer');
  await assert.rejects(f.auth.authenticate(session(s, { action: 'deploy' })), errorCode('forbidden'));
  assert.equal((await f.auth.authenticate(session(s))).role, 'viewer');
});
test('mutations require both exact origin and correct CSRF', async () => {
  const f = fixture(), s = await login(f);
  await assert.rejects(f.auth.authenticate(session(s, { mutation: true })), errorCode('invalid_origin'));
  await assert.rejects(f.auth.authenticate(session(s, { mutation: true, origin: ORIGIN })), errorCode('invalid_csrf'));
  await assert.rejects(f.auth.authenticate(session(s, { mutation: true, origin: ORIGIN, csrf: s.token })), errorCode('invalid_csrf'));
  await f.auth.authenticate(session(s, { mutation: true, origin: ORIGIN, csrf: s.response.csrf }));
});
test('cross-origin authenticated reads are rejected when Origin is present', async () => {
  const f = fixture(), s = await login(f);
  await assert.rejects(f.auth.authenticate(session(s, { origin: 'https://evil.example' })), errorCode('invalid_origin'));
});
test('logout invalidates sessions and is independent of the RPC provider', async () => {
  const f = fixture(); f.setKind('contract');
  const s = await login(f); f.setValid(false);
  const before = f.calls();
  await f.auth.logout(session(s, { origin: ORIGIN, csrf: s.response.csrf }));
  assert.equal(f.calls(), before);
  await assert.rejects(f.auth.authenticate(session(s)), errorCode('session_required'));
});
test('logout rejects missing CSRF without deleting a valid session', async () => {
  const f = fixture(), s = await login(f);
  await assert.rejects(f.auth.logout(session(s, { origin: ORIGIN })), errorCode('invalid_csrf'));
  await f.auth.authenticate(session(s));
});
test('contract-wallet sessions revalidate on every protected request and revoke on state changes', async () => {
  const f = fixture(); f.setKind('contract');
  const s = await login(f);
  assert.equal(f.calls(), 1);
  await f.auth.authenticate(session(s));
  assert.equal(f.calls(), 2);
  f.setValid(false);
  await assert.rejects(f.auth.authenticate(session(s)), errorCode('invalid_signature'));
  f.setValid(true);
  await assert.rejects(f.auth.authenticate(session(s)), errorCode('session_required'));
});
test('contract proof cannot fall back to a newly EOA-classified address', async () => {
  const f = fixture(); f.setKind('contract');
  const s = await login(f); f.setKind('eoa');
  await assert.rejects(f.auth.authenticate(session(s)), errorCode('invalid_signature'));
});
test('verifier failures are redacted and cannot authenticate', async () => {
  const f = fixture({ verifyWallet: async () => { throw new Error('RPC_KEY=secret'); } });
  await assert.rejects(login(f), error => error.code === 'unavailable' && !error.message.includes('secret'));
});
test('malformed verifier success claims fail closed', async () => {
  const f = fixture({ verifyWallet: async () => ({ valid: true, kind: 'unknown' }) });
  await assert.rejects(login(f), errorCode('invalid_signature'));
});
test('challenge rate limit cannot be bypassed by changing wallet', async () => {
  const f = fixture();
  for (let i = 0; i < 15; i++) await challenge(f, i % 2 ? OWNER : EDITOR);
  await assert.rejects(challenge(f, VIEWER), errorCode('rate_limited'));
  f.advance(60000);
  await challenge(f);
});
test('pending challenges are bounded and expired entries are pruned', async () => {
  const f = fixture({ limit: 2 });
  await challenge(f); await challenge(f);
  await assert.rejects(challenge(f), errorCode('capacity'));
  f.advance(300001); await challenge(f);
  assert.equal(f.store.challenges.size, 1);
});
test('audit events omit cookies, signatures, raw wallets and IPs', async () => {
  const f = fixture(), s = await login(f);
  const value = JSON.stringify(f.events);
  for (const secret of [s.token, s.response.csrf, SIG, OWNER, IP]) assert.ok(!value.includes(secret));
  assert.deepEqual(f.events.map(x => x.event), ['auth.challenge', 'auth.login']);
});
test('constant-time secret comparison rejects malformed lengths', () => {
  assert.ok(sameSecret('a'.repeat(64), 'a'.repeat(64)));
  assert.ok(!sameSecret('a'.repeat(64), 'b'.repeat(64)));
  assert.ok(!sameSecret('', '')); assert.ok(!sameSecret(undefined, 'a'.repeat(64)));
});
test('unknown roles and actions never inherit object-prototype privileges', () => {
  for (const role of ['superuser', '__proto__', undefined]) assert.throws(() => assertRole(role, 'read'), errorCode('forbidden'));
  for (const action of ['toString', '__proto__', 'anything']) assert.throws(() => assertRole('owner', action), errorCode('forbidden'));
});
test('console role matrix restricts publication and signing to owners', () => {
  assertRole('viewer', 'read'); assertRole('editor', 'edit');
  for (const action of ['publish', 'deploy', 'mint', 'list', 'permissions']) {
    assertRole('owner', action);
    assert.throws(() => assertRole('editor', action), errorCode('forbidden'));
    assert.throws(() => assertRole('viewer', action), errorCode('forbidden'));
  }
});
test('release owner has rights only within the authenticated chain', () => {
  const release = { id: 'alpha', ownerWallet: OWNER, chainId: CHAIN };
  const actor = { wallet: OWNER, chainId: CHAIN, role: 'owner' };
  assertReleaseAccess(actor, release, null, 'publish');
  assert.throws(() => assertReleaseAccess({ ...actor, chainId: 1 }, release, null, 'read'), errorCode('forbidden'));
});
test('allowlisted console owner cannot access someone else\'s release', () => {
  assert.throws(() => assertReleaseAccess({ wallet: OWNER, chainId: CHAIN, role: 'owner' },
    { id: 'beta', ownerWallet: OTHER, chainId: CHAIN }, null, 'read'), errorCode('forbidden'));
});
test('release grants bind release, wallet and chain and cannot confer ownership', () => {
  const actor = { wallet: EDITOR, role: 'editor', chainId: CHAIN };
  const release = { id: 'alpha', ownerWallet: OWNER, chainId: CHAIN };
  const grant = { releaseId: 'alpha', wallet: EDITOR, chainId: CHAIN, permission: 'editor' };
  assertReleaseAccess(actor, release, grant, 'edit');
  for (const patch of [{ releaseId: 'beta' }, { wallet: OWNER }, { chainId: 1 }, { permission: 'owner' }, { permission: 'viewer' }]) {
    assert.throws(() => assertReleaseAccess(actor, release, { ...grant, ...patch }, 'edit'), errorCode('forbidden'));
  }
});
test('touch cannot resurrect a concurrently logged-out session', async () => {
  const f = fixture(), s = await login(f);
  await f.store.deleteSession(digest(s.token));
  assert.equal(await f.store.touchSession(digest(s.token), Date.now() + 1000), false);
  assert.equal(await f.store.getSession(digest(s.token)), null);
});

test('wallet verifier must return a literal true result, not a truthy value', async () => {
  const f = fixture({ verifyWallet: async () => ({ valid: 'true', kind: 'eoa' }) });
  await assert.rejects(login(f), errorCode('invalid_signature'));
  assert.equal(f.store.sessions.size, 0);
});

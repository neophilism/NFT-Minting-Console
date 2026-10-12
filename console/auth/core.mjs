import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HANDLE = /^[0-9a-f]{64}$/;
const CHAINS = new Set([1, 11155111, 31337]);
const ROLES = new Set(['owner', 'editor', 'viewer']);
const ACTIONS = Object.freeze({
  read: new Set(['owner', 'editor', 'viewer']),
  edit: new Set(['owner', 'editor']),
  publish: new Set(['owner']),
  deploy: new Set(['owner']),
  mint: new Set(['owner']),
  list: new Set(['owner']),
  permissions: new Set(['owner']),
});
const MESSAGES = Object.freeze({
  invalid_request: 'Invalid authentication request.',
  invalid_origin: 'Request origin does not match this console.',
  wrong_chain: 'Switch your wallet to the configured network.',
  forbidden: 'This wallet is not authorized for this operation.',
  invalid_challenge: 'Sign-in challenge expired or changed. Start sign-in again.',
  invalid_signature: 'Wallet signature could not be verified.',
  session_required: 'Sign in with an authorized wallet.',
  invalid_csrf: 'Session protection token is missing or invalid.',
  capacity: 'Authentication is busy. Please retry.',
  rate_limited: 'Too many requests. Please retry later.',
  unavailable: 'Authentication verification is temporarily unavailable.',
});

export class AuthError extends Error {
  constructor(status, code) {
    super(MESSAGES[code] || MESSAGES.invalid_request);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}
export const digest = value => createHash('sha256').update(value).digest('hex');
const fresh = () => randomBytes(32).toString('hex');
const csrfFor = token => createHmac('sha256', token).update('nft-console:csrf:v1').digest('hex');
const fail = (status, code) => { throw new AuthError(status, code); };
const validHandle = value => typeof value === 'string' && HANDLE.test(value);
export function sameSecret(a, b) {
  if (!validHandle(a) || !validHandle(b)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
export function walletKey(value) {
  if (typeof value !== 'string' || !ADDRESS.test(value) || /^0x0{40}$/i.test(value)) {
    fail(400, 'invalid_request');
  }
  return value.toLowerCase();
}
export function canonicalOrigin(value, production = false) {
  try {
    const url = new URL(value);
    if (value !== url.origin || url.username || url.password) throw new Error();
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !production &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error();
    return url.origin;
  } catch { throw new Error('PUBLIC_ORIGIN must be an exact HTTPS origin (HTTP loopback only in development).'); }
}
export function rolesFromEnvironment(env) {
  const roles = new Map();
  for (const [field, role] of [['ADMIN_WALLETS', 'owner'], ['EDITOR_WALLETS', 'editor'], ['VIEWER_WALLETS', 'viewer']]) {
    for (const value of (env[field] || '').split(',').map(x => x.trim()).filter(Boolean)) {
      const key = walletKey(value);
      if (roles.has(key) && roles.get(key) !== role) throw new Error('Wallet has conflicting console roles.');
      roles.set(key, role);
    }
  }
  return roles;
}
export function assertRole(role, action) {
  if (!ROLES.has(role) || !Object.hasOwn(ACTIONS, action) || !ACTIONS[action].has(role)) fail(403, 'forbidden');
}
// The release and grant MUST come from authorized server-side storage, never a
// request body. Console allowlisting does not confer ownership of all releases.
export function assertReleaseAccess(actor, release, grant, action) {
  assertRole(actor.role, action);
  if (actor.chainId !== release.chainId) fail(403, 'forbidden');
  if (actor.wallet === walletKey(release.ownerWallet)) return;
  const validGrant = grant && grant.releaseId === release.id &&
    grant.wallet === actor.wallet && grant.chainId === actor.chainId;
  const role = validGrant ? grant.permission : null;
  if (role === 'owner' || !['viewer', 'editor'].includes(role)) fail(403, 'forbidden');
  assertRole(role, action);
}

// Development-only. No raw cookie handles are retained. Production startup is
// explicitly refused until a shared durable store and its tests are accepted.
export class MemoryAuthStore {
  constructor({ now = Date.now, limit = 1000 } = {}) {
    this.now = now;
    this.limit = limit;
    this.challenges = new Map();
    this.sessions = new Map();
    this.rates = new Map();
    this.durable = false;
  }
  sweep() {
    const now = this.now();
    for (const [id, record] of this.challenges) if (record.challengeExpiresAt <= now) this.challenges.delete(id);
    for (const [id, record] of this.sessions) if (record.expiresAt <= now || record.idleExpiresAt <= now) this.sessions.delete(id);
    for (const [id, record] of this.rates) if (record.until <= now) this.rates.delete(id);
  }
  async limitRequest(key, maximum, interval = 60000) {
    this.sweep();
    let record = this.rates.get(key);
    if (!record) {
      if (this.rates.size >= this.limit) fail(503, 'capacity');
      record = { count: 0, until: this.now() + interval };
      this.rates.set(key, record);
    }
    if (++record.count > maximum) fail(429, 'rate_limited');
  }
  async putChallenge(id, record) {
    this.sweep();
    if (this.challenges.size >= this.limit) fail(503, 'capacity');
    this.challenges.set(id, structuredClone(record));
  }
  async consumeChallenge(id, bindingHash) {
    this.sweep();
    const record = this.challenges.get(id);
    if (!record || !sameSecret(record.bindingHash, bindingHash)) return null;
    // Deletion precedes all signature/RPC awaits: a nonce has only one winner.
    this.challenges.delete(id);
    return structuredClone(record);
  }
  async putSession(id, record) {
    this.sweep();
    if (this.sessions.size >= this.limit) fail(503, 'capacity');
    this.sessions.set(id, structuredClone(record));
  }
  async getSession(id) {
    this.sweep();
    const record = this.sessions.get(id);
    return record ? structuredClone(record) : null;
  }
  async touchSession(id, idleExpiresAt) {
    const record = this.sessions.get(id);
    // Never resurrect a session deleted by a concurrent logout.
    if (!record) return false;
    record.idleExpiresAt = Math.min(record.expiresAt, idleExpiresAt);
    return true;
  }
  async deleteSession(id) { this.sessions.delete(id); }
}

export function createAuthService({
  origin, chainId, roles, verifyWallet, checksumAddress,
  store = new MemoryAuthStore(), now = Date.now, audit = () => {},
  production = false,
}) {
  const realm = canonicalOrigin(origin, production);
  if (!CHAINS.has(chainId)) throw new Error('Unsupported authentication chain.');
  if (typeof roles !== 'function' || typeof verifyWallet !== 'function' || typeof checksumAddress !== 'function') {
    throw new Error('Authentication requires explicit role, wallet verifier and checksum adapters.');
  }
  if (production && store.durable !== true) throw new Error('Production requires an accepted durable authentication store.');
  const CHALLENGE_TTL = 5 * 60000;
  const SESSION_TTL = 8 * 3600000;
  const IDLE_TTL = 30 * 60000;
  let inFlight = 0;
  const emit = (event, wallet) => {
    // Authentication proofs, cookies, IPs, draft names and provider errors must
    // not enter logs. Account correlation uses a domain-specific pseudonym.
    audit({ event, at: new Date(now()).toISOString(), chainId,
      ...(wallet ? { accountDigest: digest(`${realm}:${chainId}:${wallet}`) } : {}) });
  };
  function checkOrigin(input) { if (input !== realm) fail(403, 'invalid_origin'); }
  function roleFor(wallet) {
    const role = roles().get(wallet);
    if (!ROLES.has(role)) fail(403, 'forbidden');
    return role;
  }
  async function limited(kind, ip, maximum) {
    if (typeof ip !== 'string' || ip.length > 128) fail(400, 'invalid_request');
    await store.limitRequest(`${kind}:${digest(ip)}`, maximum);
  }
  async function verifyProof(record, signature) {
    if (inFlight >= 8) fail(503, 'capacity');
    inFlight++;
    try {
      const result = await verifyWallet({ wallet: record.wallet, message: record.message, signature, chainId });
      if (result?.valid !== true || !['eoa', 'contract'].includes(result.kind)) fail(401, 'invalid_signature');
      return result.kind;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      fail(503, 'unavailable');
    } finally { inFlight--; }
  }
  function publicSession(record, token) {
    return { wallet: record.wallet, chainId, role: roleFor(record.wallet),
      csrf: csrfFor(token), expiresAt: new Date(record.expiresAt).toISOString(),
      idleExpiresAt: new Date(record.idleExpiresAt).toISOString() };
  }
  return {
    origin: realm, chainId, durable: store.durable,
    async challenge({ wallet, chainId: requestedChain, origin: requestOrigin, ip }) {
      checkOrigin(requestOrigin);
      await limited('challenge', ip, 15);
      if (requestedChain !== chainId) fail(400, 'wrong_chain');
      const key = walletKey(wallet);
      roleFor(key);
      const address = checksumAddress(key);
      if (walletKey(address) !== key) fail(400, 'invalid_request');
      const id = fresh(), binding = fresh(), nonce = fresh(), issuedAt = now();
      const expiresAt = issuedAt + SESSION_TTL;
      const message = `${realm} wants you to sign in with your Ethereum account:\n${address}\n\n` +
        'Sign in to NFT Console. This does not authorize publishing, minting, listing, or asset transfers.\n\n' +
        `URI: ${realm}/\nVersion: 1\nChain ID: ${chainId}\nNonce: ${nonce}\n` +
        `Issued At: ${new Date(issuedAt).toISOString()}\nExpiration Time: ${new Date(expiresAt).toISOString()}`;
      const record = { wallet: key, message, chainId, origin: realm, issuedAt, expiresAt,
        challengeExpiresAt: issuedAt + CHALLENGE_TTL, bindingHash: digest(binding) };
      await store.putChallenge(digest(id), record);
      emit('auth.challenge', key);
      return { binding, response: { challengeId: id, message, chainId,
        expiresAt: new Date(record.challengeExpiresAt).toISOString() } };
    },
    async verify({ wallet, chainId: requestedChain, origin: requestOrigin, ip,
      challengeId, binding, message, signature, previousToken }) {
      checkOrigin(requestOrigin);
      await limited('verify', ip, 15);
      if (!validHandle(challengeId) || !validHandle(binding)) fail(401, 'invalid_challenge');
      const record = await store.consumeChallenge(digest(challengeId), digest(binding));
      if (!record || record.origin !== realm || record.chainId !== chainId || requestedChain !== chainId ||
          walletKey(wallet) !== record.wallet || record.challengeExpiresAt <= now() ||
          record.issuedAt > now() || record.message !== message) fail(401, 'invalid_challenge');
      roleFor(record.wallet);
      if (typeof signature !== 'string' || signature.length > 32770 || !/^0x(?:[0-9a-fA-F]{2})*$/.test(signature)) {
        fail(401, 'invalid_signature');
      }
      const kind = await verifyProof(record, signature);
      if (record.challengeExpiresAt <= now()) fail(401, 'invalid_challenge');
      roleFor(record.wallet);
      const token = fresh();
      const session = { wallet: record.wallet, chainId, origin: realm, kind,
        expiresAt: record.expiresAt, idleExpiresAt: Math.min(record.expiresAt, now() + IDLE_TTL),
        // Contract sessions must be revalidated against live state; proofs are
        // transient memory only, never plaintext logs or durable draft storage.
        ...(kind === 'contract' ? { message: record.message, signature } : {}) };
      if (validHandle(previousToken)) await store.deleteSession(digest(previousToken));
      await store.putSession(digest(token), session);
      emit('auth.login', record.wallet);
      return { token, response: publicSession(session, token) };
    },
    async authenticate({ token, csrf, origin: requestOrigin, ip, mutation = false, action = 'read' }) {
      if (mutation || requestOrigin !== undefined) checkOrigin(requestOrigin);
      await limited('session', ip, 120);
      if (!validHandle(token)) fail(401, 'session_required');
      const id = digest(token), record = await store.getSession(id);
      if (!record || record.chainId !== chainId || record.origin !== realm ||
          record.expiresAt <= now() || record.idleExpiresAt <= now()) fail(401, 'session_required');
      let role;
      try { role = roleFor(record.wallet); }
      catch (error) { await store.deleteSession(id); throw error; }
      if (mutation && !sameSecret(csrf, csrfFor(token))) fail(403, 'invalid_csrf');
      assertRole(role, action);
      if (record.kind === 'contract') {
        try {
          if (await verifyProof(record, record.signature) !== 'contract') fail(401, 'invalid_signature');
        } catch (error) { await store.deleteSession(id); throw error; }
      }
      // Check expiry again after RPC, and keep a concurrent logout final.
      if (record.expiresAt <= now() || record.idleExpiresAt <= now()) {
        await store.deleteSession(id); fail(401, 'session_required');
      }
      record.idleExpiresAt = Math.min(record.expiresAt, now() + IDLE_TTL);
      if (!(await store.touchSession(id, record.idleExpiresAt))) fail(401, 'session_required');
      return publicSession(record, token);
    },
    async logout({ token, csrf, origin: requestOrigin, ip }) {
      checkOrigin(requestOrigin);
      await limited('logout', ip, 30);
      // Logout must work even when an RPC provider or contract signer is down.
      if (validHandle(token)) {
        if (!sameSecret(csrf, csrfFor(token))) fail(403, 'invalid_csrf');
        const record = await store.getSession(digest(token));
        await store.deleteSession(digest(token));
        emit('auth.logout', record?.wallet);
      }
    },
  };
}

import { AuthError } from './core.mjs';

export function cookieValue(header, name) {
  if (header === undefined) return undefined;
  if (typeof header !== 'string' || header.length > 8192) throw new AuthError(400, 'invalid_request');
  const matches = header.split(';').map(x => x.trim()).filter(x => x.startsWith(`${name}=`));
  // Cookie-tossing ambiguity must fail closed, not silently choose first/last.
  if (matches.length > 1) throw new AuthError(400, 'invalid_request');
  return matches[0]?.slice(name.length + 1);
}
export function authFailure(error, res) {
  const known = error instanceof AuthError;
  if (known && error.status === 429) res.setHeader('Retry-After', '60');
  return res.status(known ? error.status : 503).json({
    error: known ? error.message : 'Authentication is temporarily unavailable.',
    code: known ? error.code : 'unavailable',
  });
}

export function installAuthRoutes(app, auth, { production = false } = {}) {
  const sessionName = production ? '__Host-nft_session' : 'nft_session_v2';
  const challengeName = production ? '__Host-nft_challenge' : 'nft_challenge_v2';
  const options = { httpOnly: true, sameSite: 'strict', secure: production || auth.origin.startsWith('https:'), path: '/' };
  const cookies = req => ({
    token: cookieValue(req.headers.cookie, sessionName),
    binding: cookieValue(req.headers.cookie, challengeName),
  });
  const input = req => {
    if (req.get('Sec-Fetch-Site') && !['same-origin', 'none'].includes(req.get('Sec-Fetch-Site'))) {
      throw new AuthError(403, 'invalid_origin');
    }
    return { ...cookies(req), origin: req.get('Origin'), ip: req.ip || req.socket?.remoteAddress || 'unknown',
      csrf: req.get('X-CSRF-Token') };
  };
  const jsonInput = req => {
    if (!/^application\/json(?:\s*;|$)/i.test(req.get('Content-Type') || '') ||
        !req.body || Array.isArray(req.body) || typeof req.body !== 'object') {
      throw new AuthError(415, 'invalid_request');
    }
    return input(req);
  };
  const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (error) { authFailure(error, res); } };
  app.post('/api/auth/challenge', wrap(async (req, res) => {
    const result = await auth.challenge({ wallet: req.body?.wallet, chainId: req.body?.chainId, ...jsonInput(req) });
    res.cookie(challengeName, result.binding, { ...options, maxAge: 300000 });
    res.json(result.response);
  }));
  app.post('/api/auth/verify', wrap(async (req, res) => {
    const context = jsonInput(req);
    const result = await auth.verify({ wallet: req.body.wallet, chainId: req.body.chainId,
      challengeId: req.body.challengeId, message: req.body.message, signature: req.body.signature,
      ...context, previousToken: context.token });
    res.clearCookie(challengeName, options);
    res.clearCookie('nft_session', options); // Revoke the browser's legacy cookie.
    res.cookie(sessionName, result.token, { ...options,
      maxAge: Math.max(0, Date.parse(result.response.expiresAt) - Date.now()) });
    res.json(result.response);
  }));
  app.get('/api/auth/session', wrap(async (req, res) => {
    res.json(await auth.authenticate(input(req)));
  }));
  app.post('/api/auth/logout', wrap(async (req, res) => {
    await auth.logout(jsonInput(req));
    res.clearCookie(sessionName, options);
    res.clearCookie(challengeName, options);
    res.clearCookie('nft_session', options);
    res.json({ signedOut: true });
  }));
  return action => async (req, res, next) => {
    try {
      req.actor = await auth.authenticate({ ...input(req), action,
        mutation: !['GET', 'HEAD'].includes(req.method) });
      req.admin = req.actor.wallet;
      next();
    } catch (error) { authFailure(error, res); }
  };
}

import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ethers } from 'ethers';
import { FACTORY_VERSION, reconcileDeployment } from './deployment.mjs';
import { AuthError, createAuthService, rolesFromEnvironment } from './auth/core.mjs';
import { installAuthRoutes } from './auth/http.mjs';
import { createWalletVerifier } from './auth/wallet.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chainRegistry = JSON.parse(fs.readFileSync(path.join(root, 'config/chains.json'), 'utf8'));
const blockedFeatures = Object.freeze([
  { id: 'auth-durability', milestones: ['NFT-09'], description: 'Durable multi-instance authentication and database RBAC acceptance remain open.' },
  { id: 'private-workspace', milestones: ['NFT-10', 'NFT-11', 'NFT-12'], description: 'Reviewed client encryption, recovery and ciphertext storage are not implemented.' },
  { id: 'explicit-publication', milestones: ['NFT-13', 'NFT-19', 'NFT-20'], description: 'Exact-byte rights review and explicit public publication are not implemented.' },
  { id: 'release-experience', milestones: ['NFT-14', 'NFT-15', 'NFT-16', 'NFT-17', 'NFT-18'], description: 'The approved multi-release user experience and rights workflow are unfinished.' },
  { id: 'verified-chain-workflow', milestones: ['NFT-21', 'NFT-22', 'NFT-23', 'NFT-24', 'NFT-25'], description: 'Validator provisioning, wallet flows and complete mint read-back require implementation and rehearsal.' },
  { id: 'marketplace', milestones: ['NFT-26', 'NFT-27', 'NFT-28', 'NFT-29'], description: 'Order signing, posting, independent active-listing and royalty verification are not implemented.' },
  { id: 'production-evidence', milestones: ['NFT-30', 'NFT-31', 'NFT-32', 'NFT-33', 'NFT-34', 'NFT-35', 'NFT-36'], description: 'Audits, deployed infrastructure, real-sale rehearsal and final acceptance are not complete.' },
]);
const closed = (res, code, error) => res.status(409).json({ code, error, productionReady: false });

export function createApp({ env = process.env, authService } = {}) {
  const app = express();
  const production = env.NODE_ENV === 'production';
  if (production) throw new Error('Production startup is blocked until the durable authentication, publication and release gates are accepted.');
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT.');
  const chainId = Number(env.CHAIN_ID || 11155111);
  const profile = chainRegistry.chains[String(chainId)];
  if (!profile) throw new Error('Unsupported CHAIN_ID.');
  const origin = env.PUBLIC_ORIGIN || `http://localhost:${port}`;
  const roles = rolesFromEnvironment(env);
  const factoryValue = env.DEPLOYMENT_FACTORY_ADDRESS || '';
  if (factoryValue && !ethers.isAddress(factoryValue)) throw new Error('Invalid DEPLOYMENT_FACTORY_ADDRESS.');
  const factoryAddress = factoryValue ? ethers.getAddress(factoryValue) : null;
  let provider;
  if (env.RPC_URL) {
    const request = new ethers.FetchRequest(env.RPC_URL);
    request.timeout = 8000;
    provider = new ethers.JsonRpcProvider(request, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
  }
  const auth = authService || createAuthService({
    origin, chainId, production, roles: () => roles,
    checksumAddress: ethers.getAddress,
    verifyWallet: provider ? createWalletVerifier(provider) : async () => { throw new AuthError(503, 'unavailable'); },
    audit: record => console.info(JSON.stringify(record)),
  });
  if (auth.origin !== origin || auth.chainId !== chainId) throw new Error('Authentication realm does not match the server configuration.');
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (auth.origin.startsWith('https:')) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  app.use(express.json({ limit: '64kb', strict: true }));
  const requireAction = installAuthRoutes(app, auth, { production });
  app.get('/api/config', (_req, res) => res.json({
    chainId, chainSlug: profile.slug, chainName: profile.name, production: profile.production,
    deploymentFactory: factoryAddress, pinningReady: false,
    pinningConfigured: Boolean(env.PINATA_JWT), loginConfigured: roles.size > 0 && Boolean(provider),
    validator: env.TRANSFER_VALIDATOR_ADDRESS || profile.validator,
    signedZone: env.OPENSEA_SIGNED_ZONE || profile.signedZone,
    productionReady: false, authStore: 'development-memory',
    capabilities: { privateDrafts: false, publish: false, mint: false, list: false,
      deploy: chainId !== 1 && Boolean(factoryAddress) },
  }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, productionReady: false }));
  app.get('/api/launch-readiness', requireAction('read'), (_req, res) => res.json({
    productionReady: false, mintingEvidence: 'not-verified', listingEvidence: 'not-verified', blockers: blockedFeatures,
    authentication: 'implemented-partial-unaccepted',
    note: 'These are software gates, not a live wallet inventory or security certification.',
  }));
  app.get('/api/artifact', requireAction('deploy'), (_req, res) => {
    if (chainId === 1) return closed(res, 'mainnet_gated', 'Mainnet deployment is disabled until the reviewed production gates pass.');
    try {
      const collection = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/contracts/NFTCollection.sol/NFTCollection.json'), 'utf8'));
      const factory = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/contracts/NFTCollectionFactory.sol/NFTCollectionFactory.json'), 'utf8'));
      res.json({ collection: { abi: collection.abi, bytecode: collection.bytecode,
        creationCodeId: ethers.keccak256(collection.bytecode) },
      factory: { abi: factory.abi, bytecode: factory.bytecode, address: factoryAddress, version: FACTORY_VERSION } });
    } catch { res.status(503).json({ error: 'Contract build missing. Run the pinned compile gate.', code: 'build_required' }); }
  });
  app.get('/api/deployment/:releaseId', requireAction('read'), async (req, res) => {
    try {
      if (!/^0x[0-9a-fA-F]{64}$/.test(req.params.releaseId)) return res.status(400).json({ error: 'Invalid release identifier.' });
      if (req.query.requester && String(req.query.requester).toLowerCase() !== req.actor.wallet) {
        return res.status(403).json({ error: 'Deployment lookup is bound to the signed-in wallet.' });
      }
      if (!factoryAddress || !provider) return res.status(503).json({ error: 'Rehearsal factory or RPC is not configured.' });
      res.json(await reconcileDeployment(provider, { factory: factoryAddress, chainId,
        releaseId: req.params.releaseId, requester: req.actor.wallet }));
    } catch { res.status(503).json({ error: 'Deployment could not be verified. No transaction was sent.' }); }
  });
  // No multer, temporary plaintext files, pinning calls or raw artwork parsing.
  // Authentication runs before these fail-closed legacy endpoints.
  app.post('/api/prepare', requireAction('publish'), (_req, res) => closed(res, 'publication_gated',
    'Public upload is disabled until the private workspace and explicit publication review are accepted. No artwork was pinned.'));
  app.get('/api/preflight', requireAction('read'), (_req, res) => closed(res, 'mint_preflight_gated',
    'Complete validator-policy, bytecode, exact-token and rights preflight is not accepted. Do not mint from this prototype.'));
  app.get('/api/opensea-url', requireAction('read'), (req, res) => {
    const address = String(req.query.contract || ''), id = String(req.query.id || '');
    if (!ethers.isAddress(address) || !/^[1-9][0-9]{0,77}$/.test(id) || BigInt(id) > (1n << 256n) - 1n) {
      return res.status(400).json({ error: 'Invalid NFT identifier.' });
    }
    res.json({ url: `https://opensea.io/assets/${profile.slug}/${address}/${id}`,
      status: 'link-only', listingVerified: false });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use(express.static(path.join(root, 'console/public')));
  app.use('/vendor', express.static(path.join(root, 'node_modules/ethers/dist')));
  app.use((error, _req, res, _next) => {
    void _next; // Express recognizes error handlers by all four arguments.
    const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500;
    res.status(status).json({ error: status === 413 ? 'Request body is too large.' : 'Request could not be processed.' });
  });
  app.locals.close = () => provider?.destroy();
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const app = createApp();
  const server = app.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => {
    console.info('NFT Console development server listening; production publication and minting are gated.');
  });
  const stop = () => server.close(() => { app.locals.close(); process.exit(0); });
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

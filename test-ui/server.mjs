import http from 'node:http';
import { once } from 'node:events';
import hre from 'hardhat';
import { JsonRpcProvider, getAddress } from 'ethers';
import { createApp } from '../console/server.mjs';
import { createAuthService, MemoryAuthStore } from '../console/auth/core.mjs';
import { createWalletVerifier } from '../console/auth/wallet.mjs';
import { OWNER, VIEWER, EDITOR, ORIGIN } from './fixtures.mjs';

if (process.env.NFT_UI_FIXTURE !== '1') throw new Error('Browser fixture must be started explicitly by the test harness.');
if (Number(await hre.network.provider.send('eth_chainId')) !== 31337) throw new Error('Browser tests require the disposable local EVM.');
// Read-only JSON-RPC bridge to a real in-process Hardhat EVM. No transaction,
// signer, debug-write or private-key API is exposed by this HTTP server.
const methods = new Set(['eth_chainId', 'net_version', 'eth_blockNumber', 'eth_getCode', 'eth_call']);
const rpc = http.createServer(async (request, response) => {
  const chunks = []; let bytes = 0;
  try {
    if (request.method !== 'POST') { response.writeHead(405); response.end(); return; }
    for await (const chunk of request) { bytes += chunk.length; if (bytes > 65536) throw new Error('Too large'); chunks.push(chunk); }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!methods.has(payload.method)) throw new Error('Unsupported fixture method');
    const result = await hre.network.provider.send(payload.method, payload.params || []);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }));
  } catch { response.writeHead(400); response.end('Fixture RPC request rejected.'); }
});
rpc.listen(0, '127.0.0.1'); await once(rpc, 'listening');
const rpcUrl = `http://127.0.0.1:${rpc.address().port}`;
const provider = new JsonRpcProvider(rpcUrl, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
// Browser scenarios run many sign-ins in parallel. Only the fixture's quotas
// are enlarged; production quotas have separate negative unit/native tests.
class BrowserFixtureStore extends MemoryAuthStore {
  async limitRequest(key, maximum, interval) { return super.limitRequest(key, maximum * 100, interval); }
}
const roles = new Map([[OWNER.toLowerCase(), 'owner'], [VIEWER.toLowerCase(), 'viewer'], [EDITOR.toLowerCase(), 'editor']]);
const auth = createAuthService({ origin: ORIGIN, chainId: 31337, roles: () => roles,
  checksumAddress: getAddress, store: new BrowserFixtureStore({ limit: 10000 }), verifyWallet: createWalletVerifier(provider) });
const app = createApp({ env: { NODE_ENV: 'test', PORT: '4173', PUBLIC_ORIGIN: ORIGIN, CHAIN_ID: '31337',
  ADMIN_WALLETS: OWNER, VIEWER_WALLETS: VIEWER, EDITOR_WALLETS: EDITOR, RPC_URL: rpcUrl }, authService: auth });
await app.locals.ready;
const server = app.listen(4173, '127.0.0.1'); await once(server, 'listening');
console.info('Disposable browser fixture ready on loopback. Only local-EVM signatures are accepted.');
async function stop() {
  server.closeAllConnections(); rpc.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => rpc.close(resolve));
  provider.destroy(); await app.locals.close(); process.exit(0);
}
process.once('SIGTERM', () => void stop()); process.once('SIGINT', () => void stop());

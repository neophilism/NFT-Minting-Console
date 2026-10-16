import http from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import hre from 'hardhat';
import { Contract, ContractFactory, JsonRpcProvider, ZeroAddress, getAddress } from 'ethers';
import { createApp } from '../console/server.mjs';
import { createAuthService } from '../console/auth/core.mjs';
import { createWalletVerifier } from '../console/auth/wallet.mjs';
import { OWNER, VIEWER, EDITOR, SAFE, ORIGIN } from './fixtures.mjs';
import { startMintFixture } from './mint-fixture.mjs';
import {publicBrowserFetch} from './launch-content.mjs';
import { testWallets } from './fixtures.mjs';
import { setupBrowserDatabase } from './database.mjs';

if (hre.network.name !== 'hardhat' || hre.network.config.forking) throw new Error('Browser acceptance refuses nonlocal or forked networks.');
if (process.env.NFT_UI_FIXTURE !== '1') throw new Error('Browser fixture must be started explicitly by the test harness.');
if (Number(await hre.network.provider.send('eth_chainId')) !== 31337) throw new Error('Browser tests require the disposable local EVM.');
// Compile these exact upstream sources with npm run test:safe first. No test
// contract substitutes for Safe, and no public-chain RPC is used for setup.
const artifact = async name => JSON.parse(await readFile(new URL(`../artifacts-safe/vendor/safe/contracts/${name}`, import.meta.url), 'utf8'));
const safeArtifact = await artifact('Safe.sol/Safe.json');
const fallbackArtifact = await artifact('handler/CompatibilityFallbackHandler.sol/CompatibilityFallbackHandler.json');
const proxyArtifact = await artifact('proxies/SafeProxy.sol/SafeProxy.json');
const [deployer] = await hre.ethers.getSigners();
async function deploy(art, args = []) {
  const instance = await new ContractFactory(art.abi, art.bytecode, deployer).deploy(...args);
  await instance.waitForDeployment(); return instance;
}
const singleton = await deploy(safeArtifact), handler = await deploy(fallbackArtifact);
const proxy = await deploy(proxyArtifact, [await singleton.getAddress()]);
if (getAddress(await proxy.getAddress()) !== SAFE) throw new Error('Unexpected Safe fixture deployment address.');
const safe = new Contract(SAFE, safeArtifact.abi, deployer);
await (await safe.setup([OWNER, VIEWER, EDITOR], 2, ZeroAddress, '0x', await handler.getAddress(), ZeroAddress, 0, ZeroAddress)).wait();
if (await safe.VERSION() !== '1.4.1' || await safe.getThreshold() !== 2n) throw new Error('Safe fixture must be upstream 1.4.1 with a 2-of-3 threshold.');

// Read-only JSON-RPC bridge. No transaction, signer, debug-write or private-key
// API is exposed. All setup transactions above are local-EVM fixtures only.
const methods = new Set(['eth_chainId', 'net_version', 'eth_blockNumber', 'eth_getCode', 'eth_call', 'eth_getBlockByNumber', 'eth_getTransactionByHash', 'eth_getTransactionReceipt','eth_getTransactionCount','eth_estimateGas','eth_gasPrice','eth_getBalance']);
const rpc = http.createServer(async (request, response) => {
  const chunks = []; let bytes = 0;
  try {
    if (request.method !== 'POST') { response.writeHead(405); response.end(); return; }
    for await (const chunk of request) { bytes += chunk.length; if (bytes > 65536) throw new Error('Too large'); chunks.push(chunk); }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!methods.has(payload.method)) throw new Error('Unsupported fixture method');
    if (payload.jsonrpc !== '2.0' || !Number.isSafeInteger(payload.id) ||
        !Array.isArray(payload.params || [])) throw new Error('Invalid fixture request');
    let reply;
    try {
      const result = await hre.network.provider.send(payload.method, payload.params || []);
      reply = { jsonrpc: '2.0', id: payload.id, result };
    } catch (error) {
      // Preserve a real JSON-RPC denial, especially Safe signature reverts.
      // HTTP transport failure would misclassify invalid proofs as outages.
      const data = typeof error?.data === 'string' ? error.data : error?.data?.data;
      reply = { jsonrpc: '2.0', id: payload.id, error: {
        code: Number.isInteger(error?.code) ? error.code : -32603,
        message: String(error?.message || 'Local EVM request failed').slice(0, 2048),
        ...(typeof data === 'string' && /^0x(?:[a-fA-F0-9]{2})*$/.test(data) && data.length <= 32770 ? { data } : {}),
      } };
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(reply));
  } catch { response.writeHead(400); response.end('Fixture RPC request rejected.'); }
});
rpc.listen(0, '127.0.0.1'); await once(rpc, 'listening');
const rpcUrl = `http://127.0.0.1:${rpc.address().port}`;
const provider = new JsonRpcProvider(rpcUrl, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
const roles = new Map([[OWNER.toLowerCase(), 'owner'], [VIEWER.toLowerCase(), 'viewer'],
  [EDITOR.toLowerCase(), 'editor'], [SAFE.toLowerCase(), 'owner'], [testWallets[3].address.toLowerCase(), 'owner'], [testWallets[4].address.toLowerCase(), 'owner'], [testWallets[5].address.toLowerCase(), 'owner']]);
const database = await setupBrowserDatabase(roles);
const stopMintFixture = await startMintFixture(hre);
const auth = createAuthService({ origin: ORIGIN, chainId: 31337, roles: () => roles,
  checksumAddress: getAddress, store: database.store, verifyWallet: createWalletVerifier(provider) });
const app = createApp({ env: { NODE_ENV: 'test', PORT: '4173', PUBLIC_ORIGIN: ORIGIN, CHAIN_ID: '31337',
  NFT_UI_FIXTURE:'1',NFT_PUBLIC_LAUNCH:'1',NFT_LOCAL_MINT_REHEARSAL: '1', ADMIN_WALLETS: `${OWNER},${SAFE},${testWallets[3].address},${testWallets[4].address},${testWallets[5].address}`, VIEWER_WALLETS: VIEWER, EDITOR_WALLETS: EDITOR,
  RPC_URL: rpcUrl, DATABASE_URL: database.runtimeUrl }, authService: auth,launchContentOptions:{fetchImpl:publicBrowserFetch} });
await app.locals.ready;
const server = app.listen(4173, '127.0.0.1'); await once(server, 'listening');
console.info('Disposable browser fixture ready: restricted PostgreSQL and actual local Safe/EOA verification.');
async function stop() {
  server.closeAllConnections(); rpc.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => rpc.close(resolve));
  await stopMintFixture(); provider.destroy(); await app.locals.close(); await database.close(); process.exit(0);
}
process.once('SIGTERM', () => void stop()); process.once('SIGINT', () => void stop());

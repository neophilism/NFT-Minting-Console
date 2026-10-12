/* global ethers */
const el = id => document.getElementById(id);
const text = (id, value) => { el(id).textContent = value; };
let provider, signer, account, csrf, role, sessionWallet, config;
let walletEpoch = 0;
let connecting = false;

// Until reviewed client encryption is accepted, draft fields and selected files
// live only in memory. Do not hydrate/write the prototype's plaintext draft key.
// Public deployment receipts and opaque deployment identifiers remain durable.
function controls() {
  const signedIn = Boolean(csrf && account && sessionWallet === account.toLowerCase());
  el('connect').disabled = connecting || !config;
  el('disconnect').disabled = !csrf;
  el('readiness').disabled = !csrf;
  el('deploy').disabled = !signedIn || role !== 'owner' || config?.capabilities?.deploy !== true;
  for (const id of ['prepare', 'preflight', 'mint']) el(id).disabled = true;
  text('connect', signedIn ? `Signed in ${account.slice(0, 6)}...` : 'Connect & Sign In');
}
function resetSession() {
  csrf = undefined; role = undefined; sessionWallet = undefined;
  provider = undefined; signer = undefined; account = undefined;
  controls();
}
function fail(error) { text('result', `Error: ${error.shortMessage || error.message || 'Operation failed.'}`); }
async function api(route, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const response = await fetch(route, { ...options, headers, credentials: 'same-origin' });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) resetSession();
    throw new Error(result.error || 'Request failed.');
  }
  return result;
}
const post = (route, value) => api(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
async function endSession(token) {
  if (!token) return;
  const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: '{}' });
  if (!response.ok) throw new Error('Server sign-out could not be confirmed. Close this console and retry sign-out.');
}
async function wallet() {
  if (!window.ethereum || !window.ethers) throw new Error('Connect a supported browser wallet. Never enter a private key here.');
  provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send('eth_requestAccounts', []);
  signer = await provider.getSigner();
  account = await signer.getAddress();
  if (Number((await provider.getNetwork()).chainId) !== config.chainId) {
    throw new Error(`Switch your wallet to ${config.chainName} (${config.chainId}) before signing.`);
  }
  return signer;
}
function invalidateWallet() {
  walletEpoch++;
  const token = csrf;
  resetSession();
  text('result', 'Wallet or network changed. Sign in again before continuing.');
  endSession(token).catch(fail);
}
window.ethereum?.on?.('accountsChanged', invalidateWallet);
window.ethereum?.on?.('chainChanged', invalidateWallet);
window.ethereum?.on?.('disconnect', invalidateWallet);

el('connect').onclick = async () => {
  if (connecting || !config) return;
  connecting = true; controls();
  const epoch = walletEpoch;
  try {
    await wallet();
    const requestedAccount = account;
    const challenge = await post('/api/auth/challenge', { wallet: requestedAccount, chainId: config.chainId });
    const lines = challenge.message.split('\n');
    if (challenge.chainId !== config.chainId || lines[0] !== `${location.origin} wants you to sign in with your Ethereum account:` ||
        lines[1].toLowerCase() !== requestedAccount.toLowerCase() || !lines.includes(`URI: ${location.origin}/`) ||
        !lines.includes(`Chain ID: ${config.chainId}`)) throw new Error('Sign-in request does not match this console, account and network.');
    if (epoch !== walletEpoch) throw new Error('Wallet changed during sign-in.');
    const signature = await signer.signMessage(challenge.message);
    if (epoch !== walletEpoch) throw new Error('Wallet changed during sign-in.');
    const login = await post('/api/auth/verify', { wallet: requestedAccount, chainId: config.chainId,
      challengeId: challenge.challengeId, message: challenge.message, signature });
    if (epoch !== walletEpoch) { await endSession(login.csrf); throw new Error('Wallet changed during sign-in.'); }
    csrf = login.csrf; role = login.role; sessionWallet = login.wallet;
    for (const id of ['owner', 'minter', 'recipient']) if (!el(id).value) el(id).value = account;
    text('result', `Signed in as ${role}. No publishing or financial transaction has been authorized. Draft fields are not saved; do not enter confidential artwork until the private workspace is accepted.`);
  } catch (error) { fail(error); }
  finally { connecting = false; controls(); }
};
el('disconnect').onclick = async () => {
  const token = csrf; walletEpoch++; resetSession();
  try { await endSession(token); text('result', 'Signed out. No NFT transaction was sent.'); } catch (error) { fail(error); }
};
el('readiness').onclick = async () => {
  try {
    const status = await api('/api/launch-readiness');
    text('result', 'Not production-ready. Remaining launch gates:\n\n' + status.blockers.map(item =>
      `${item.milestones.join(', ')}: ${item.description}`).join('\n\n'));
  } catch (error) { fail(error); }
};
function needAddress(value, label) {
  if (!ethers.isAddress(value) || value === ethers.ZeroAddress) throw new Error(`${label} must be a nonzero Ethereum address.`);
  return ethers.getAddress(value);
}
function releaseIdFor(name, symbol, requester) {
  const discriminator = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify([config.chainId, requester.toLowerCase(), name, symbol])));
  const key = `nftconsole-release-id:v3:${discriminator}`;
  let id = localStorage.getItem(key);
  if (!id) {
    // Preserve earlier release identity: changing the storage key must not
    // create a second collection after upgrading the console.
    const legacyKey = `nftconsole-release-id:v2:${config.chainId}:${requester.toLowerCase()}:${name}:${symbol}`;
    id = localStorage.getItem(legacyKey);
    if (!id) id = ethers.keccak256(ethers.toUtf8Bytes(crypto.randomUUID()));
    if (!/^0x[0-9a-fA-F]{64}$/.test(id)) throw new Error('Stored release identifier is invalid. Preserve deployment receipts before repairing browser storage.');
    localStorage.setItem(key, id);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(id)) throw new Error('Stored release identifier is invalid. Do not redeploy.');
  return id;
}
function saveDeploymentReceipt(value) {
  const receipts = JSON.parse(localStorage.getItem('nftconsole-deployment-receipts') || '[]');
  if (!Array.isArray(receipts)) throw new Error('Existing public receipt storage is invalid. Export the transaction hash before clearing it.');
  receipts.push(value);
  localStorage.setItem('nftconsole-deployment-receipts', JSON.stringify(receipts));
}
el('deploy').onclick = async () => {
  try {
    if (el('deploy').disabled || !csrf || config.capabilities.deploy !== true || config.chainId === 1) {
      throw new Error('Deployment is available only to signed-in owners on configured rehearsal networks.');
    }
    const epoch = walletEpoch;
    await wallet();
    if (account.toLowerCase() !== sessionWallet) throw new Error('Signed-in wallet does not match the connected wallet.');
    const name = el('collection').value.trim(), symbol = el('symbol').value.trim();
    const supply = Number(el('supply').value), royalty = el('royalty').value;
    if (!name || !symbol || !Number.isSafeInteger(supply) || supply <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(royalty) || Number(royalty) > 100) {
      throw new Error('Enter collection name, symbol, positive supply and a royalty with at most two decimal places.');
    }
    const art = await api('/api/artifact');
    const factory = new ethers.Contract(config.deploymentFactory, art.factory.abi, signer);
    if (await factory.FACTORY_VERSION() !== art.factory.version || await factory.COLLECTION_CREATION_CODE_ID() !== art.collection.creationCodeId) {
      throw new Error('Factory does not match the reviewed build.');
    }
    const releaseId = releaseIdFor(name, symbol, account);
    const values = { name, symbol, seriesSize: supply, royaltyBps: Math.round(Number(royalty) * 100),
      owner: needAddress(el('owner').value, 'OWNER'), minter: needAddress(el('minter').value, 'MINTER'),
      royaltyRecipient: needAddress(el('recipient').value, 'Royalty recipient') };
    const requester = account;
    const predicted = await factory.predictCollectionAddress(requester, releaseId, values);
    const existing = await factory.collectionForRelease(requester, releaseId);
    if (existing !== ethers.ZeroAddress) {
      if (existing.toLowerCase() !== predicted.toLowerCase() || (await provider.getCode(existing)) === '0x') {
        throw new Error('Existing release does not match these immutable settings.');
      }
      el('address').value = existing;
      text('result', `Existing rehearsal deployment: ${existing}. No duplicate transaction was sent.`);
      return;
    }
    const configHash = await factory.hashConfig(values), initCodeHash = await factory.collectionInitCodeHash(values);
    if (epoch !== walletEpoch) throw new Error('Wallet changed. No transaction was sent.');
    text('result', `Review the rehearsal deployment in your wallet. Predicted address: ${predicted}`);
    const tx = await factory.deployCollection(releaseId, values);
    text('result', `Rehearsal transaction submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error('Rehearsal deployment failed on-chain.');
    const deployed = receipt.logs.filter(log => log.address.toLowerCase() === config.deploymentFactory.toLowerCase())
      .map(log => { try { return factory.interface.parseLog(log); } catch { return null; } })
      .find(log => log?.name === 'CollectionDeployed');
    if (!deployed || deployed.args.releaseId !== releaseId || deployed.args.requester.toLowerCase() !== requester.toLowerCase() ||
        deployed.args.collection.toLowerCase() !== predicted.toLowerCase() || deployed.args.chainId !== BigInt(config.chainId) ||
        deployed.args.factoryVersion !== art.factory.version || deployed.args.collectionCreationCodeId !== art.collection.creationCodeId ||
        deployed.args.configHash !== configHash || deployed.args.initCodeHash !== initCodeHash || (await provider.getCode(predicted)) === '0x') {
      throw new Error(`Deployment receipt mismatch. Preserve transaction ${tx.hash} for reconciliation; do not redeploy.`);
    }
    el('address').value = predicted;
    saveDeploymentReceipt({ releaseId, requester, collection: predicted, factory: config.deploymentFactory,
      chainId: config.chainId, transactionHash: tx.hash, blockNumber: receipt.blockNumber,
      factoryVersion: art.factory.version, collectionCreationCodeId: art.collection.creationCodeId, configHash, initCodeHash });
    text('result', `Rehearsal deployment verified: ${predicted}. Transaction: ${tx.hash}. This is not production approval or an OpenSea listing.`);
  } catch (error) { fail(error); }
};
controls();
(async () => {
  try {
    config = await api('/api/config');
    if (!window.ethers) throw new Error('Pinned wallet library did not load.');
    text('result', `Target: ${config.chainName} (${config.chainId}). Production publishing, minting and listing are blocked. Draft fields are memory-only; public receipts persist. Older versions may have left plaintext drafts in this browser; back them up before clearing site data.`);
  } catch (error) { fail(error); }
  finally { controls(); }
})();

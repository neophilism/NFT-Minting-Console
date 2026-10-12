const assert = require('node:assert/strict');
const { ethers } = require('hardhat');

// Actual upstream Safe 1.4.1 singleton, proxy and compatibility fallback handler.
// No substitute Safe contract or on-chain user funds are involved.
describe('Actual Safe 1.4.1 wallet identity', function () {
  let owners, safe, singleton, handler, verify, auth, wallet;
  async function deploySafe(threshold = 2, fallback) {
    const proxy = await (await ethers.getContractFactory('SafeProxy')).deploy(await singleton.getAddress());
    await proxy.waitForDeployment();
    const instance = await ethers.getContractAt('Safe', await proxy.getAddress());
    await (await instance.setup(owners.slice(0, 3).map(x => x.address), threshold, ethers.ZeroAddress,
      '0x', fallback === undefined ? await handler.getAddress() : fallback, ethers.ZeroAddress, 0, ethers.ZeroAddress)).wait();
    return instance;
  }
  async function signatures(message, signers = owners.slice(0, 2), target = wallet) {
    const domain = { chainId: 31337, verifyingContract: target };
    const types = { SafeMessage: [{ name: 'message', type: 'bytes' }] };
    const value = { message: ethers.hashMessage(message) };
    const entries = await Promise.all(signers.map(async signer => ({ address: signer.address.toLowerCase(),
      signature: await signer.signTypedData(domain, types, value) })));
    return ethers.concat(entries.sort((a, b) => a.address.localeCompare(b.address)).map(x => x.signature));
  }
  const proof = (message, signature, address = wallet) => ({ wallet: address, message, signature, chainId: 31337 });
  async function changeThreshold(value) {
    const data = safe.interface.encodeFunctionData('changeThreshold', [value]);
    const tx = { to: wallet, value: 0, data, operation: 0, safeTxGas: 0, baseGas: 0, gasPrice: 0,
      gasToken: ethers.ZeroAddress, refundReceiver: ethers.ZeroAddress, nonce: await safe.nonce() };
    const types = { SafeTx: [
      { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' },
      { name: 'operation', type: 'uint8' }, { name: 'safeTxGas', type: 'uint256' }, { name: 'baseGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' }, { name: 'gasToken', type: 'address' },
      { name: 'refundReceiver', type: 'address' }, { name: 'nonce', type: 'uint256' },
    ] };
    const signed = await Promise.all(owners.slice(0, 2).map(async signer => ({ address: signer.address.toLowerCase(),
      signature: await signer.signTypedData({ chainId: 31337, verifyingContract: wallet }, types, tx) })));
    const packed = ethers.concat(signed.sort((a, b) => a.address.localeCompare(b.address)).map(x => x.signature));
    await (await safe.execTransaction(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas,
      tx.gasPrice, tx.gasToken, tx.refundReceiver, packed)).wait();
    assert.equal(await safe.getThreshold(), BigInt(value));
  }
  beforeEach(async function () {
    owners = await ethers.getSigners();
    singleton = await (await ethers.getContractFactory('Safe')).deploy();
    handler = await (await ethers.getContractFactory('CompatibilityFallbackHandler')).deploy();
    await Promise.all([singleton.waitForDeployment(), handler.waitForDeployment()]);
    safe = await deploySafe(); wallet = await safe.getAddress();
    const { createWalletVerifier } = await import('../console/auth/wallet.mjs');
    const { createAuthService } = await import('../console/auth/core.mjs');
    verify = createWalletVerifier(ethers.provider);
    auth = createAuthService({ origin: 'https://safe-test.example', chainId: 31337,
      roles: () => new Map([[wallet.toLowerCase(), 'owner']]), checksumAddress: ethers.getAddress, verifyWallet: verify });
  });
  it('accepts the exact 2-of-3 Safe threshold through the real fallback handler', async function () {
    const message = 'Actual Safe identity fixture';
    assert.deepEqual(await verify(proof(message, await signatures(message))), { valid: true, kind: 'contract' });
    assert.equal(await safe.VERSION(), '1.4.1');
  });
  it('rejects one owner when the Safe requires two', async function () {
    const message = 'Threshold fixture';
    assert.equal((await verify(proof(message, await signatures(message, [owners[0]])))).valid, false);
  });
  it('rejects an outsider instead of counting arbitrary signatures', async function () {
    const message = 'Outsider fixture';
    assert.equal((await verify(proof(message, await signatures(message, [owners[0], owners[4]])))).valid, false);
  });
  it('rejects an individual EOA login signature for a Safe address', async function () {
    const message = 'No EOA fallback';
    assert.equal((await verify(proof(message, await owners[0].signMessage(message)))).valid, false);
  });
  it('rejects signatures copied to a different Safe with the same owners', async function () {
    const other = await deploySafe(); const message = 'Safe address binding';
    assert.equal((await verify(proof(message, await signatures(message), await other.getAddress()))).valid, false);
  });
  it('rejects changed message bytes and incomplete/duplicate signatures', async function () {
    const message = 'Exact bytes';
    assert.equal((await verify(proof(message + ' ', await signatures(message)))).valid, false);
    assert.equal((await verify(proof(message, await signatures(message, [owners[0], owners[0]])))).valid, false);
    assert.equal((await verify(proof(message, '0x'))).valid, false);
  });
  it('rejects a Safe without an ERC-1271-compatible fallback handler', async function () {
    const other = await deploySafe(2, ethers.ZeroAddress), address = await other.getAddress(), message = 'No handler';
    assert.equal((await verify(proof(message, await signatures(message, owners.slice(0, 2), address), address))).valid, false);
  });
  it('completes the issued SIWE challenge and authenticates as the Safe, not an owner', async function () {
    const origin = 'https://safe-test.example', ip = 'fixture';
    const challenge = await auth.challenge({ wallet, chainId: 31337, origin, ip });
    const signature = await signatures(challenge.response.message);
    const nonceBefore = await safe.nonce();
    const login = await auth.verify({ ...challenge.response, wallet, origin, ip, signature, binding: challenge.binding });
    assert.equal(login.response.wallet, wallet.toLowerCase());
    const session = await auth.authenticate({ token: login.token, ip });
    assert.equal(session.wallet, wallet.toLowerCase());
    assert.equal(await safe.nonce(), nonceBefore, 'Login must not execute a Safe transaction');
  });
  it('revokes a live session after a real Safe threshold-change transaction', async function () {
    const origin = 'https://safe-test.example', ip = 'fixture';
    const challenge = await auth.challenge({ wallet, chainId: 31337, origin, ip });
    const login = await auth.verify({ ...challenge.response, wallet, origin, ip,
      signature: await signatures(challenge.response.message), binding: challenge.binding });
    await changeThreshold(3);
    await assert.rejects(auth.authenticate({ token: login.token, ip }), error => error.code === 'invalid_signature');
    await assert.rejects(auth.authenticate({ token: login.token, ip }), error => error.code === 'session_required');
  });
});

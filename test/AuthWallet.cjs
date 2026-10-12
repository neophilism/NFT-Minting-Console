const { expect } = require('chai');
const assert = require('node:assert/strict');
const { ethers } = require('hardhat');

// Real ethers/EVM signature tests. The ERC-1271 fixture is NOT an actual Safe;
// wallet-product/browser compatibility and real Safe acceptance remain open.
describe('PR-09 wallet identity adapter', function () {
  let verify, owner, other, contract, message;
  beforeEach(async function () {
    const { createWalletVerifier } = await import('../console/auth/wallet.mjs');
    verify = createWalletVerifier(ethers.provider);
    [owner, other] = await ethers.getSigners();
    contract = await (await ethers.getContractFactory('AuthWalletFixture')).deploy(owner.address);
    await contract.waitForDeployment();
    message = 'https://console.example wants you to sign in with your Ethereum account:\n' + owner.address +
      '\n\nSign in to NFT Console.\n\nURI: https://console.example/\nVersion: 1\nChain ID: 31337\nNonce: 1234567890abcdef\nIssued At: 2026-10-12T00:00:00.000Z';
  });
  const input = (wallet, message, signature) => ({ wallet, message, signature, chainId: 31337 });
  it('accepts an actual EIP-191 EOA signature', async function () {
    expect(await verify(input(owner.address, message, await owner.signMessage(message)))).to.deep.equal({ valid: true, kind: 'eoa' });
  });
  it('rejects a different EOA signer', async function () {
    expect((await verify(input(owner.address, message, await other.signMessage(message)))).valid).to.equal(false);
  });
  it('rejects changes to signed message bytes', async function () {
    expect((await verify(input(owner.address, message + ' ', await owner.signMessage(message)))).valid).to.equal(false);
  });
  it('rejects malformed EOA signature bytes', async function () {
    expect((await verify(input(owner.address, message, '0xabcd'))).valid).to.equal(false);
  });
  it('accepts the ERC-1271 magic value from a deployed contract', async function () {
    expect(await verify(input(await contract.getAddress(), message, await owner.signMessage(message))))
      .to.deep.equal({ valid: true, kind: 'contract' });
  });
  it('does not treat one arbitrary EOA signature as a Safe/contract identity', async function () {
    expect(await verify(input(await contract.getAddress(), message, await other.signMessage(message))))
      .to.deep.equal({ valid: false, kind: 'contract' });
  });
  it('rejects a contract revert without EOA fallback', async function () {
    await (await contract.setReverts(true)).wait();
    expect(await verify(input(await contract.getAddress(), message, await owner.signMessage(message))))
      .to.deep.equal({ valid: false, kind: 'contract' });
  });
  it('observes contract signing-policy changes at a new block', async function () {
    const request = input(await contract.getAddress(), message, await owner.signMessage(message));
    expect((await verify(request)).valid).to.equal(true);
    await (await contract.setSigner(other.address)).wait();
    expect((await verify(request)).valid).to.equal(false);
  });
  it('binds contract lookup to the authenticated chain', async function () {
    await assert.rejects(verify({ ...input(await contract.getAddress(), message, await owner.signMessage(message)), chainId: 1 }),
      error => error.code === 'unavailable');
  });
  it('does not deploy or approve a counterfactual wallet', async function () {
    const unowned = ethers.Wallet.createRandom().address;
    const before = await ethers.provider.getTransactionCount(owner.address);
    expect((await verify(input(unowned, message, await owner.signMessage(message)))).valid).to.equal(false);
    expect(await ethers.provider.getCode(unowned)).to.equal('0x');
    expect(await ethers.provider.getTransactionCount(owner.address)).to.equal(before);
  });
  it('verifies EOA and contract signatures using only reads', async function () {
    const before = await ethers.provider.getTransactionCount(owner.address);
    const signature = await owner.signMessage(message);
    await verify(input(owner.address, message, signature));
    await verify(input(await contract.getAddress(), message, signature));
    expect(await ethers.provider.getTransactionCount(owner.address)).to.equal(before);
  });
});

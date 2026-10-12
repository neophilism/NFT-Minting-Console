import test from 'node:test';
import assert from 'node:assert/strict';
import { isSignatureRevert, createWalletVerifier } from '../console/auth/wallet.mjs';

for (const [name, error] of [
  ['ethers call exception', { code: 'CALL_EXCEPTION' }],
  ['malformed contract reply', { code: 'BAD_DATA' }],
  ['raw EVM revert', { data: '0x08c379a0' }],
  ['empty EVM revert', { data: '0x' }],
]) {
  test(`classifies ${name} as a denied signature`, () => assert.equal(isSignatureRevert(error), true));
}
for (const [name, error] of [
  ['timeout', { code: 'TIMEOUT' }], ['network', { code: 'NETWORK_ERROR' }],
  ['malformed hex', { data: '0xa' }], ['string message', { message: 'reverted' }],
  ['non-hex data', { data: 'RPC failed' }], ['missing error', undefined],
]) {
  test(`does not disguise ${name} as a contract response`, () => assert.equal(isSignatureRevert(error), false));
}
test('transport failure cannot authenticate or trigger a signature fallback', async () => {
  const error = Object.assign(new Error('fixture outage'), { code: 'NETWORK_ERROR' });
  const verify = createWalletVerifier({ getNetwork: async () => { throw error; } });
  await assert.rejects(verify({ chainId: 11155111 }), caught => caught === error);
});

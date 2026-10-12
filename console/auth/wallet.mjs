import { Contract, getAddress, hashMessage, verifyMessage } from 'ethers';
import { AuthError } from './core.mjs';

const ERC1271_ABI = ['function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)'];
const MAGIC = '0x1626ba7e';

// Some EIP-1193 providers (including Hardhat's EDR adapter) propagate raw
// revert bytes without ethers' CALL_EXCEPTION code. This only classifies a
// denial: it must never turn an exception into a valid signature or EOA fallback.
export function isSignatureRevert(error) {
  return error?.code === 'CALL_EXCEPTION' || error?.code === 'BAD_DATA' ||
    (typeof error?.data === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(error.data));
}

// Read-only verification: never submits a transaction, deploys a wallet, invokes
// a counterfactual-wallet factory, or falls back from failed contract validation
// to an individual Safe owner's EOA signature.
export function createWalletVerifier(provider) {
  if (!provider) throw new Error('An explicit chain RPC provider is required for wallet authentication.');
  return async ({ wallet, message, signature, chainId }) => {
    if (Number((await provider.getNetwork()).chainId) !== chainId) throw new AuthError(503, 'unavailable');
    const address = getAddress(wallet);
    const blockTag = await provider.getBlockNumber();
    const code = await provider.getCode(address, blockTag);
    if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(code)) throw new AuthError(503, 'unavailable');
    if (code === '0x') {
      try { return { valid: getAddress(verifyMessage(message, signature)) === address, kind: 'eoa' }; }
      catch { return { valid: false, kind: 'eoa' }; }
    }
    const contract = new Contract(address, ERC1271_ABI, provider);
    try {
      const result = await contract.isValidSignature.staticCall(hashMessage(message), signature, { blockTag });
      return { valid: result.toLowerCase() === MAGIC, kind: 'contract' };
    } catch (error) {
      if (isSignatureRevert(error)) return { valid: false, kind: 'contract' };
      throw error; // The service converts infrastructure errors to a redacted 503.
    }
  };
}

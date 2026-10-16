export const SETUP_PURPOSE='Register this wallet as the first NFT Console administrator. This is not a transaction and does not authorize publishing, minting, listing or asset transfers.';
export function setupMessage({origin,wallet,chainId,nonce,issuedAt,expiresAt}) {
  return [SETUP_PURPOSE,`Origin: ${origin}`,`Wallet: ${wallet}`,`Chain ID: ${chainId}`,`Nonce: ${nonce}`,`Issued At: ${issuedAt}`,`Expires At: ${expiresAt}`].join('\n');
}

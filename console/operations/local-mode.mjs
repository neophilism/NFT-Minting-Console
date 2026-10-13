/** Explicit isolated-chain rehearsal, never a mainnet or hosted production bypass. */
export function localMintMode(env,chainId,origin) {
  if(env.NFT_LOCAL_MINT_REHEARSAL===undefined)return false;
  if(env.NFT_LOCAL_MINT_REHEARSAL!=='1')throw new Error('Invalid local mint rehearsal setting.');
  const loopback=value=>{try{const url=new URL(value);return url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&!url.username&&!url.password;}catch{return false;}};
  if(env.NODE_ENV==='production'||chainId!==31337||!loopback(origin)||!loopback(env.RPC_URL)||!env.DATABASE_URL)
    throw new Error('Local mint rehearsal requires chain 31337, a durable database and loopback HTTP origin/RPC.');
  return true;
}

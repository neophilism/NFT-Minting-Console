/** Explicitly scoped public launch. Absent by default; never turns on private-draft features. */
export function publicLaunchMode(env,chainId,origin,roles){
  if(env.NFT_PUBLIC_LAUNCH===undefined)return false;
  if(env.NFT_PUBLIC_LAUNCH!=='1')throw new Error('Invalid NFT_PUBLIC_LAUNCH.');
  const url=new URL(origin),rpc=new URL(env.RPC_URL||'invalid:');
  const local=value=>['localhost','127.0.0.1','[::1]'].includes(value.hostname);
  if(![1,11155111,31337].includes(chainId)||!env.DATABASE_URL||![...roles.values()].includes('owner')||
    url.username||url.password||rpc.username||rpc.password||
    !(url.protocol==='https:'||(chainId===31337&&env.NODE_ENV!=='production'&&url.protocol==='http:'&&local(url)))||
    !(rpc.protocol==='https:'||(chainId===31337&&env.NODE_ENV!=='production'&&rpc.protocol==='http:'&&local(rpc))))
    throw new Error('Public launch requires a durable database, authorized owner, HTTPS origin and HTTPS RPC (loopback only for local tests).');
  if(chainId===1&&env.NFT_MAINNET_ACK!=='ethereum-mainnet-real-fees')throw new Error('Explicit mainnet fee acknowledgement required.');
  return true;
}

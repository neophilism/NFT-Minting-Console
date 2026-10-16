import test from 'node:test';
import assert from 'node:assert/strict';
import {publicLaunchMode} from '../console/launch/mode.mjs';
const roles=new Map([['0x'+'11'.repeat(20),'owner']]);
const env={NFT_PUBLIC_LAUNCH:'1',NODE_ENV:'production',DATABASE_URL:'postgres://configured',RPC_URL:'https://rpc.example',NFT_MAINNET_ACK:'ethereum-mainnet-real-fees'};
test('public launch is explicit, restricted, HTTPS-only and mainnet fee-acknowledged',()=>{
  assert.equal(publicLaunchMode({},1,'https://console.example',roles),false);
  assert.equal(publicLaunchMode(env,1,'https://console.example',roles),true);
  for(const change of [{NFT_PUBLIC_LAUNCH:'true'},{DATABASE_URL:''},{RPC_URL:'http://rpc.example'},{NFT_MAINNET_ACK:''}])assert.throws(()=>publicLaunchMode({...env,...change},1,'https://console.example',roles));
  assert.throws(()=>publicLaunchMode(env,1,'http://localhost',roles));
  assert.throws(()=>publicLaunchMode(env,1,'https://console.example',new Map()));
  assert.equal(publicLaunchMode({...env,NODE_ENV:'test',RPC_URL:'http://localhost:8545'},31337,'http://localhost:3000',roles),true);
});

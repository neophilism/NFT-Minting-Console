import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntime} from '../console/runtime.mjs';
const production={NODE_ENV:'production',NFT_SETUP_ENABLED:'1',PUBLIC_ORIGIN:'https://installation.example',CHAIN_ID:'1',RPC_URL:'https://rpc.example',DATABASE_URL:'postgres://unused@db.example/unused'};
test('unclaimed production startup validates launch acknowledgment before accepting enrollment',async()=>{
  await assert.rejects(createRuntime({env:production}),/launch scope/);
  await assert.rejects(createRuntime({env:{...production,NFT_PUBLIC_LAUNCH:'1'}}),/launch scope/);
});
test('a wrong RPC network blocks setup before reading or claiming an owner and closes resources',async()=>{
  let reads=0,poolClosed=0,providerClosed=0;
  await assert.rejects(createRuntime({env:{NODE_ENV:'test',NFT_SETUP_ENABLED:'1',PUBLIC_ORIGIN:'http://127.0.0.1:4140',CHAIN_ID:'31337',RPC_URL:'http://127.0.0.1:4141',NFT_SETUP_CODE:'a'.repeat(64)},testDependencies:{pool:{end:async()=>{poolClosed++;}},store:{owner:async()=>{reads++;return null;}},provider:{getNetwork:async()=>({chainId:1n}),destroy:()=>{providerClosed++;}}}}),/RPC network/);
  assert.equal(reads,0);assert.equal(poolClosed,1);assert.equal(providerClosed,1);
});

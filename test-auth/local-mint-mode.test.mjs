import test from 'node:test';
import assert from 'node:assert/strict';
import {localMintMode} from '../console/operations/local-mode.mjs';
const env={NODE_ENV:'test',NFT_LOCAL_MINT_REHEARSAL:'1',RPC_URL:'http://127.0.0.1:8545',DATABASE_URL:'configured-test-only'};
test('local signing capability is off by default and needs a durable isolated environment',()=>{
  assert.equal(localMintMode({},31337,'http://localhost:3000'),false);
  assert.equal(localMintMode(env,31337,'http://localhost:3000'),true);
  for(const [patch,chain,origin] of [[{NODE_ENV:'production'},31337,'http://localhost:3000'],[{},1,'http://localhost:3000'],[{},11155111,'http://localhost:3000'],[{},31337,'https://console.example'],[{RPC_URL:'https://mainnet.example'},31337,'http://localhost:3000'],[{DATABASE_URL:''},31337,'http://localhost:3000'],[{RPC_URL:'http://secret@localhost:8545'},31337,'http://localhost:3000'],[{NFT_LOCAL_MINT_REHEARSAL:'true'},31337,'http://localhost:3000']]){
    assert.throws(()=>localMintMode({...env,...patch},chain,origin));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {OpenSeaReadOnlyClient,OpenSeaReadError} from '../console/marketplace/read-only.mjs';
const addr='0x'+'a'.repeat(40),hash='0x'+'b'.repeat(64),key='fixture-test-only-123';
const reply=(data,status=200,headers={'content-type':'application/json'})=>new Response(
  typeof data==='string'?data:JSON.stringify(data),{status,headers});
const errorCode=(code)=>e=>e instanceof OpenSeaReadError&&e.code===code;
test('only fixed HTTPS OpenSea GET paths are reachable',async()=>{
  const seen=[];
  const client=new OpenSeaReadOnlyClient({apiKey:key,fetchImpl:async(url,options)=>{
    seen.push({url,options});return reply({order_hash:hash,status:'ACTIVE'});
  }});
  const result=await client.getOrder({protocol:addr,hash,method:'POST',chain:'ethereum'});
  assert.deepEqual(Object.keys(result).sort(),['apiResponse','chainVerified','feesVerified','listingVerified']);
  assert.equal(result.listingVerified,false);
  assert.equal(result.apiResponse.status,'ACTIVE');
  assert.equal(seen[0].url,'https://api.opensea.io/api/v2/orders/chain/ethereum/protocol/'+addr+'/'+hash);
  assert.equal(seen[0].options.method,'GET');
  assert.equal(seen[0].options.redirect,'manual');
  assert.equal(seen[0].options.credentials,'omit');
  assert.equal(seen[0].options.body,undefined);
  assert.equal(seen[0].options.headers['X-API-KEY'],key);
  await client.getNFT({collection:addr,id:'42'});
  await client.getCollection({name:'androids-of-the-vine'});
  assert.equal(seen.length,3);
  assert.ok(seen[1].url.endsWith('/chain/ethereum/contract/'+addr+'/nfts/42'));
  assert.ok(seen[2].url.endsWith('/collections/androids-of-the-vine'));
});
test('invalid paths, chains and missing/weak keys fail before network',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;return reply({});};
  for(const input of [{chain:'polygon',protocol:addr,hash},{protocol:'https://evil.test',hash},{protocol:addr,hash:'x/../../admin'},{protocol:addr,hash:'0x'+'0'.repeat(64)}]){
    const client=new OpenSeaReadOnlyClient({apiKey:key,fetchImpl});
    await assert.rejects(client.getOrder(input),errorCode(input.chain==='polygon'?'UNSUPPORTED_CHAIN':input.protocol!==addr?'INVALID_ADDRESS':'INVALID_ORDER_HASH'));
  }
  assert.throws(()=>new OpenSeaReadOnlyClient({apiKey:'short',fetchImpl}),errorCode('NOT_CONFIGURED'));
  assert.throws(()=>new OpenSeaReadOnlyClient({apiKey:key,fetchImpl,timeoutMs:-1}),errorCode('INVALID_TRANSPORT'));
  assert.equal(calls,0);
});
test('redirects, rate limits, missing and non-JSON responses are never listings',async()=>{
  for(const [status,code] of [[302,'REDIRECT_REFUSED'],[404,'NOT_FOUND'],[429,'RATE_LIMITED'],[500,'HTTP_UNAVAILABLE']]){
    const client=new OpenSeaReadOnlyClient({apiKey:key,fetchImpl:async()=>reply({error:'not an order'},status)});
    await assert.rejects(client.getOrder({protocol:addr,hash}),errorCode(code));
  }
  const bad=new OpenSeaReadOnlyClient({apiKey:key,fetchImpl:async()=>reply('HTML',200,{'content-type':'text/html'})});
  await assert.rejects(bad.getOrder({protocol:addr,hash}),errorCode('INVALID_CONTENT_TYPE'));
});
test('bounded body and invalid JSON/UTF-8 fail closed',async()=>{
  const huge=new OpenSeaReadOnlyClient({apiKey:key,fetchImpl:async()=>reply('x'.repeat(270000))});
  await assert.rejects(huge.getOrder({protocol:addr,hash}),errorCode('TOO_LARGE'));
  const corrupted=new OpenSeaReadOnlyClient({apiKey:key,fetchImpl:async()=>reply('{broken')});
  await assert.rejects(corrupted.getOrder({protocol:addr,hash}),errorCode('INVALID_JSON'));
  const wrongLength=new OpenSeaReadOnlyClient({apiKey:key,fetchImpl:async()=>reply('{}',200,{'content-type':'application/json','content-length':'300000'})});
  await assert.rejects(wrongLength.getOrder({protocol:addr,hash}),errorCode('TOO_LARGE'));
});
test('network failure never exposes API key or returns verified state',async()=>{
  const client=new OpenSeaReadOnlyClient({apiKey:key,fetchImpl:async()=>{throw new Error('private '+key);}});
  await assert.rejects(client.getOrder({protocol:addr,hash}),e=>errorCode('NETWORK_UNAVAILABLE')(e)&&!e.message.includes(key));
});
test('user aborted request never sends a GET',async()=>{
  const client=new OpenSeaReadOnlyClient({apiKey:key,fetchImpl:()=>{throw Error('network must not be used');}});
  const controller=new AbortController();controller.abort();
  await assert.rejects(client.getOrder({protocol:addr,hash,signal:controller.signal}),errorCode('CANCELLED'));
});
test('unsafe large numeric JSON never silently rounds order counters',async()=>{
  const counter='90071992547409933333333333333333333';
  const raw='{"counter":'+counter+',"status":"ACTIVE"}';
  const client=new OpenSeaReadOnlyClient({apiKey:key,fetchImpl:async()=>reply(raw)});
  const observation=await client.getOrder({protocol:addr,hash});
  assert.equal(observation.apiResponse.counter,counter);
  assert.equal(observation.listingVerified,false);
});
test('no write, approve, listing sign or POST APIs are exposed',()=>{
  const client=new OpenSeaReadOnlyClient({apiKey:key,fetchImpl:async()=>reply({})});
  for(const op of ['postListing','send','approve','sign','post','createOrder'])assert.equal(typeof client[op],'undefined');
});

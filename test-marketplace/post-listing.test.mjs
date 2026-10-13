import test from 'node:test';
import assert from 'node:assert/strict';
import {OpenSeaSignedListingTransport,ListingTransportError,SEAPORT} from '../console/marketplace/post-listing.mjs';
const seller='0x'+'a'.repeat(40),nft='0x'+'b'.repeat(40),royalty='0x'+'c'.repeat(40),zero='0x'+'0'.repeat(40),hash='0x'+'d'.repeat(64);
const key='fixture-only-fake-api-key';
const order={parameters:{offerer:seller,zone:zero,offer:[{itemType:2,token:nft,identifierOrCriteria:'1',startAmount:'1',endAmount:'1'}],
 consideration:[{itemType:0,token:zero,identifierOrCriteria:'0',startAmount:'950',endAmount:'950',recipient:seller},{itemType:0,token:zero,identifierOrCriteria:'0',startAmount:'50',endAmount:'50',recipient:royalty}],
 orderType:0,startTime:'1',endTime:'9999',zoneHash:'0x'+'0'.repeat(64),salt:'1',conduitKey:'0x'+'0'.repeat(64),counter:'0',totalOriginalConsiderationItems:'2'},signature:'0x'+'e'.repeat(130)};
const review={approved:true,seller,collection:nft,tokenId:'1',priceWei:'1000',endTime:'9999',payments:[{recipient:seller,amountWei:'950'},{recipient:royalty,amountWei:'50'}]};
const code=name=>e=>e instanceof ListingTransportError&&e.code===name;
const reply=(data,status=200,headers={'content-type':'application/json'})=>new Response(typeof data==='string'?data:JSON.stringify(data),{status,headers});
test('only the fixed OpenSea signed listing endpoint is posted to, never declared verified',async()=>{
 let observed;
 const c=new OpenSeaSignedListingTransport({apiKey:key,fetchImpl:async(url,opts)=>{observed={url,opts};return reply({order_hash:hash,status:'ACTIVE'});}});
 const result=await c.submit({order,review});
 assert.deepEqual(result,{orderHash:hash,apiAccepted:true,listingVerified:false,chainVerified:false,royaltiesVerified:false});
 assert.equal(observed.url,'https://api.opensea.io/api/v2/orders/ethereum/seaport/listings');
 assert.equal(observed.opts.method,'POST');assert.equal(observed.opts.redirect,'manual');assert.equal(observed.opts.credentials,'omit');
 assert.equal(observed.opts.headers['X-API-KEY'],key);
 assert.deepEqual(JSON.parse(observed.opts.body),{parameters:order.parameters,protocol_address:SEAPORT,signature:order.signature});
});
test('any token, price, royalty recipient, signature or reviewed data change rejects before POST',async()=>{
 let calls=0;
 const c=new OpenSeaSignedListingTransport({apiKey:key,fetchImpl:async()=>{calls++;return reply({order_hash:hash});}});
 const modify=[
 x=>x.order.parameters.offer[0].identifierOrCriteria='2',
 x=>x.order.parameters.offer[0].token=royalty,
 x=>x.order.parameters.offerer=royalty,
 x=>x.order.parameters.consideration[0].startAmount='900',
 x=>x.order.parameters.consideration[1].recipient=seller,
 x=>x.order.signature='0x123',
 x=>x.order.parameters.consideration[0].endAmount='900',
 x=>x.review.priceWei='2',x=>x.review.approved=false
 ];
 for(const fn of modify){
  const x={order:structuredClone(order),review:structuredClone(review)};
  fn(x);await assert.rejects(c.submit(x),e=>e instanceof ListingTransportError);
 }
 assert.equal(calls,0);
});
test('network errors do not leak secrets or retry an uncertain POST',async()=>{
 let calls=0;
 const c=new OpenSeaSignedListingTransport({apiKey:key,fetchImpl:async()=>{calls++;throw Error('secret '+key);}});
 await assert.rejects(c.submit({order,review}),e=>code('NETWORK')(e)&&!e.message.includes(key));assert.equal(calls,1);
 for(const [status,expected] of [[302,'REDIRECT'],[409,'UNCERTAIN_DUPLICATE'],[429,'RATE_LIMITED'],[500,'REJECTED']]){
   const x=new OpenSeaSignedListingTransport({apiKey:key,fetchImpl:async()=>reply({error:'no'},status)});
   await assert.rejects(x.submit({order,review}),code(expected));
 }
});
test('missing hash, corrupt responses, content type and large responses fail closed',async()=>{
 const cases=[[reply({status:'ACTIVE'}),'ORDER_HASH'],[reply('{oops'),'JSON'],[reply('{}',200,{'content-type':'text/html'}),'CONTENT_TYPE'],[reply('x'.repeat(270000)),'TOO_LARGE']];
 for(const [res,expected] of cases){
  const c=new OpenSeaSignedListingTransport({apiKey:key,fetchImpl:async()=>res});
  await assert.rejects(c.submit({order,review}),code(expected));
 }
});
test('unsupported chain and aborted request never send a network call',async()=>{
 let calls=0;const c=new OpenSeaSignedListingTransport({apiKey:key,fetchImpl:async()=>{calls++;return reply({order_hash:hash});}});
 await assert.rejects(c.submit({chain:'polygon',order,review}),code('CHAIN_OR_PROTOCOL'));
 await assert.rejects(c.submit({protocolAddress:nft,order,review}),code('CHAIN_OR_PROTOCOL'));
 const abort=new AbortController();abort.abort();
 await assert.rejects(c.submit({order,review,signal:abort.signal}),code('CANCELLED'));
 assert.equal(calls,0);
});
test('no signing, wallet approval or order creation capability is exposed',()=>{
 const c=new OpenSeaSignedListingTransport({apiKey:key,fetchImpl:async()=>reply({order_hash:hash})});
 for(const name of ['sign','approve','createOrder','connectWallet','createListing'])assert.equal(typeof c[name],'undefined');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,TypedDataEncoder} from 'ethers';
import {buildReviewedOrder,signReviewedEOA,SeaportReviewError,SEAPORT_16,EIP712_TYPES} from '../console/marketplace/seaport-order.mjs';
const seller=Wallet.createRandom(),outsider=Wallet.createRandom();
const collection='0x'+'a'.repeat(40),royalty='0x'+'b'.repeat(40);
const input=()=>({seller:seller.address,collection,tokenId:'1',priceWei:'1000000',
  payments:[{recipient:seller.address,amountWei:'940000'},{recipient:royalty,amountWei:'60000'}],
  counter:'0',startTime:'1000',endTime:'2000'});
const matches=x=>e=>e instanceof SeaportReviewError&&e.code===x;
test('Seaport 1.6 EIP712 order binds collection, token, recipient amounts and account',()=>{
 const p=buildReviewedOrder(input());
 assert.equal(p.domain.verifyingContract,SEAPORT_16);
 assert.equal(p.domain.version,'1.6');
 assert.equal(p.domain.chainId,1);
 assert.equal(p.parameters.offer[0].identifierOrCriteria,'1');
 assert.equal(p.parameters.consideration[1].startAmount,'60000');
 assert.equal(p.parameters.orderType,0);
 assert.equal(p.review.approved,false);
 assert.equal(TypedDataEncoder.hash(p.domain,EIP712_TYPES,p.parameters),p.digest);
 const q=buildReviewedOrder(input());
 assert.notEqual(p.parameters.salt,q.parameters.salt);
});
test('bad fee totals, recipients, expiry, token, counter, price are rejected before signing',()=>{
 const changes=[
  x=>x.payments[1].amountWei='1',x=>x.payments[0].recipient='not-an-address',
  x=>x.endTime='999999999',x=>x.startTime=x.endTime,x=>x.counter='-1',
  x=>x.tokenId='-4',x=>x.priceWei='0',x=>x.payments=[],
 ];
 for(const change of changes){const x=input();change(x);assert.throws(()=>buildReviewedOrder(x),e=>e instanceof SeaportReviewError);}
});
test('direct EOA signs exact typed data only after user confirmation and correct chain',async()=>{
 const plan=buildReviewedOrder(input());let signing=0;
 const provider={request:async({method,params})=>{
  if(method==='eth_chainId')return '0x1';
  if(method==='eth_accounts')return [seller.address];
  if(method==='eth_signTypedData_v4'){
    signing++;
    const p=JSON.parse(params[1]);assert.equal(p.domain.verifyingContract.toLowerCase(),SEAPORT_16.toLowerCase());
    return seller.signTypedData(plan.domain,EIP712_TYPES,plan.parameters);
  }
  throw Error('unknown');
 }};
 await assert.rejects(signReviewedEOA({plan,provider}),matches('NOT_AUTHORIZED'));
 assert.equal(signing,0);
 const signed=await signReviewedEOA({plan,provider,confirmed:true});
 assert.equal(signing,1);assert.equal(signed.parameters.offerer,seller.address);
 assert.equal(signed.signature.length,130);
});
test('wrong chain, wrong EOA signer and mutated review never produce an accepted order',async()=>{
 const plan=buildReviewedOrder(input());
 const badChain={request:async({method})=>method==='eth_chainId'?'0xaa36a7':[seller.address]};
 await assert.rejects(signReviewedEOA({plan,provider:badChain,confirmed:true}),matches('WRONG_CHAIN'));
 const wrongWallet={request:async({method})=>method==='eth_chainId'?'0x1':[outsider.address]};
 await assert.rejects(signReviewedEOA({plan,provider:wrongWallet,confirmed:true}),matches('WRONG_WALLET'));
 const badSignature={request:async({method})=>{
  if(method==='eth_chainId')return '0x1';
  if(method==='eth_accounts')return [seller.address];
  return outsider.signTypedData(plan.domain,EIP712_TYPES,plan.parameters);
 }};
 await assert.rejects(signReviewedEOA({plan,provider:badSignature,confirmed:true}),matches('WRONG_SIGNATURE'));
 const tampered={...plan,parameters:{...plan.parameters,counter:'9'}};
 await assert.rejects(signReviewedEOA({plan:tampered,provider:badSignature,confirmed:true}),matches('MUTATED_REVIEW'));
 const misleading={...plan,review:{...plan.review,priceWei:'1'}};
 await assert.rejects(signReviewedEOA({plan:misleading,provider:badSignature,confirmed:true}),matches('MUTATED_REVIEW'));
 assert.equal(Object.isFrozen(plan.review.payments),true);
 assert.equal(Object.isFrozen(plan.parameters.offer[0]),true);
});
test('signed zone produces full restricted order rather than accidental open order',()=>{
 const p=buildReviewedOrder({...input(),zone:royalty});
 assert.equal(p.parameters.orderType,2);
 assert.equal(p.parameters.zone.toLowerCase(),royalty);
});

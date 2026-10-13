import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,Interface} from 'ethers';
import {OPEN_SEA,SeaportIntentError,buildSeaportIntent,checkedSeaportIntent,signableSeaportPayload,verifySeaportSignature,exactTokenApproval,exactOrderCancellation,checkedOrderPostBody} from '../console/marketplace/seaport-intent.mjs';

const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),C='0x'+'c'.repeat(40);
const hash=v=>'0x'+v.repeat(64);
const owner=new Wallet('0x'+'1'.repeat(64)),outsider=new Wallet('0x'+'2'.repeat(64));
const profile=()=>({...OPEN_SEA,protocolCodeHash:hash('a'),controllerCodeHash:hash('b'),conduitCodeHash:hash('c'),zoneCodeHash:hash('d')});
const terms=()=>({seller:owner.address,collection:A,collectionCodeHash:hash('e'),tokenId:'1',priceWei:'1000000000000000000',
  royaltyRecipient:B,royaltyBps:600,marketplaceBps:50,startTime:1760000000,endTime:1760086400,salt:'111112222233333',counter:'0'});
const build=()=>buildSeaportIntent(terms(),profile());
const code=c=>e=>e instanceof SeaportIntentError&&e.code===c;

test('exact one ERC721 and explicit creator and marketplace payouts',()=>{
  const listing=build();
  assert.equal(listing.listingVerified,false);
  assert.equal(listing.productionReady,false);
  assert.equal(listing.components.offer.length,1);
  assert.equal(listing.components.offer[0].itemType,2);
  assert.equal(listing.components.offer[0].identifierOrCriteria,'1');
  assert.deepEqual(listing.economics,{priceWei:'1000000000000000000',sellerNetWei:'935000000000000000',
    royaltyWei:'60000000000000000',marketplaceWei:'5000000000000000'});
  assert.equal(listing.components.consideration.length,3);
  assert.equal(listing.parameters.totalOriginalConsiderationItems,3);
  assert.equal(BigInt(listing.economics.sellerNetWei)+BigInt(listing.economics.royaltyWei)+BigInt(listing.economics.marketplaceWei),BigInt(listing.terms.priceWei));
  assert.equal(listing.domain.chainId,1);
  assert.equal(listing.domain.verifyingContract,OPEN_SEA.protocol);
  assert.equal(listing.components.zone,OPEN_SEA.zone);
  assert.equal(listing.components.orderType,2);
  assert.ok(Object.isFrozen(listing));
});
test('deterministic EIP712 data and signatures permit only original EOA',async()=>{
  const intent=build();
  const payload=signableSeaportPayload(intent);
  assert.ok(!JSON.stringify(payload).includes('privateKey'));
  const signature=await owner.signTypedData(intent.domain,intent.types,intent.components);
  assert.equal(verifySeaportSignature(intent,signature),signature.toLowerCase());
  const body=checkedOrderPostBody(intent,signature);
  assert.equal(body.protocol_address,OPEN_SEA.protocol);
  assert.equal(body.signature,signature.toLowerCase());
  assert.equal(body.parameters.totalOriginalConsiderationItems,3);
  const wrong=await outsider.signTypedData(intent.domain,intent.types,intent.components);
  assert.throws(()=>verifySeaportSignature(intent,wrong),code('WRONG_SIGNER'));
});
test('review cannot be altered after signing or silently update fees',()=>{
  const intent=build();
  assert.equal(checkedSeaportIntent(intent).orderHash,intent.orderHash);
  const changed=JSON.parse(JSON.stringify(intent));
  changed.components.offer[0].identifierOrCriteria='2';
  assert.throws(()=>checkedSeaportIntent(changed),code('TAMPERED_ORDER'));
  const verified=JSON.parse(JSON.stringify(intent));verified.listingVerified=true;
  assert.throws(()=>checkedSeaportIntent(verified),code('TAMPERED_ORDER'));
  const changedFee=JSON.parse(JSON.stringify(intent));changedFee.economics.royaltyWei='0';
  assert.throws(()=>checkedSeaportIntent(changedFee),code('TAMPERED_ORDER'));
});
test('only one-token ERC721 approval and exact Seaport cancellation data',()=>{
  const intent=build();
  const approval=exactTokenApproval(intent),erc721=new Interface(['function approve(address,uint256)']);
  const decoded=erc721.parseTransaction({data:approval.data});
  assert.equal(approval.to,intent.terms.collection);
  assert.equal(approval.value,'0x0');
  assert.equal(decoded.name,'approve');
  assert.equal(decoded.args[1],1n);
  assert.equal(decoded.args[0].toLowerCase(),intent.profile.conduit);
  assert.equal(intent.parameters.offer.length,1);
  const cancel=exactOrderCancellation(intent);
  assert.equal(cancel.to,OPEN_SEA.protocol);
  assert.equal(cancel.value,'0x0');
  assert.ok(cancel.data.startsWith('0x'));
});
test('mainnet domain and unreviewed conduit or protocol replacements rejected',()=>{
  for(const field of ['protocol','conduit','zone','feeRecipient','controller']){
    const p=profile();p[field]=C;
    assert.throws(()=>buildSeaportIntent(terms(),p),code('UNREVIEWED_MAINNET_CONFIGURATION'));
  }
  const wrong=profile();wrong.chainId=8453;wrong.chain='base';
  assert.throws(()=>buildSeaportIntent(terms(),wrong),code('CHAIN_UNSUPPORTED'));
  const bad=profile();bad.protocolCodeHash=hash('0');
  assert.throws(()=>buildSeaportIntent(terms(),bad),code('INVALID_HASH'));
});
test('fees, duration and dusty prices fail closed',()=>{
  for(const price of ['0','10','-1','1.1','1e18','00001']){
    const t=terms();t.priceWei=price;assert.throws(()=>buildSeaportIntent(t,profile()));
  }
  for(const bps of [-1,10000,10001,0.5]){
    const t=terms();t.royaltyBps=bps;assert.throws(()=>buildSeaportIntent(t,profile()));
  }
  for(const duration of [0,1,299,31*86400]){
    const t=terms();t.endTime=t.startTime+duration;assert.throws(()=>buildSeaportIntent(t,profile()),code('INVALID_TERMS'));
  }
});
test('large safe uint256 strings do not pass through JavaScript floating point',()=>{
  const t=terms();t.counter='115792089237316195423570985008687907853269984665640564039457584007913129639934';
  const result=buildSeaportIntent(t,profile());
  assert.equal(result.components.counter,t.counter);
  t.counter='115792089237316195423570985008687907853269984665640564039457584007913129639936';
  assert.throws(()=>buildSeaportIntent(t,profile()),code('INVALID_INTEGER'));
});
test('unexpected financial metadata, getters or cycles fail before use',()=>{
  const t=terms();t.investmentPriority='special';
  assert.throws(()=>buildSeaportIntent(t,profile()),code('INVALID_SHAPE'));
  const b=terms();Object.defineProperty(b,'priceWei',{get(){throw Error('getter');},enumerable:true});
  assert.throws(()=>buildSeaportIntent(b,profile()),code('INVALID_SHAPE'));
  const x=JSON.parse(JSON.stringify(build()));x.self=x;
  assert.throws(()=>checkedSeaportIntent(x),code('INVALID_SHAPE'));
});
test('local synthetic Hardhat profile never misrepresents mainnet status',()=>{
  const p=profile();p.chainId=31337;p.chain='hardhat';p.zone='0x'+'0'.repeat(40);p.zoneCodeHash='0x'+'0'.repeat(64);
  const result=buildSeaportIntent(terms(),p);
  assert.equal(result.components.orderType,0);
  assert.equal(result.profile.chainId,31337);
  assert.equal(result.productionReady,false);
});

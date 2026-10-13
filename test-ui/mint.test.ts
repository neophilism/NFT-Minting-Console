import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareMintPlan} from '../console/chain/mint.mjs';
import {sendLocalMint} from '../console/ui/src/mint-wallet.ts';
import type {MintReview,JournalCall} from '../console/ui/src/mint-wallet.ts';
import {operation,operationPage,readManifest} from '../console/ui/src/mint-model.ts';
import type {Session} from '../console/ui/src/model.ts';
import type {WalletProvider} from '../console/ui/src/auth.ts';
const hash=(value:string)=>'0x'+value.repeat(64);
const wallet='0x'+'11'.repeat(20),collection='0x'+'22'.repeat(20);
const session:Session={wallet,chainId:31337,role:'owner',csrf:'a'.repeat(64),expiresAt:new Date(Date.now()+100000).toISOString(),idleExpiresAt:new Date(Date.now()+100000).toISOString()};
const manifest={chainId:31337,collection,minter:wallet,runtimeCodeHash:hash('a'),works:[{tokenId:'1',title:'Public fixture',metadataURI:'ipfs://fixture/1.json',mediaHash:hash('b'),rightsURI:'ipfs://fixture/rights',rightsHash:hash('c')}]};
const batch=prepareMintPlan(manifest).batches[0]!;
const review=():MintReview=>({intentId:batch.id,reviewedAt:Date.now(),gas:'0x186a0',gasPrice:'0x1',nonce:'0x0',maximumCost:'100000',blockNumber:1});
const row=()=>({intentId:batch.id,chainId:31337,collection,runtimeCodeHash:hash('a'),state:'prepared',revision:'1',attemptId:null as string|null,transactionHash:null as string|null,observedBlock:null,observedBlockHash:null,confirmations:0,lastCode:null,updatedAt:new Date().toISOString(),listingVerified:false});
function harness(mode='success'){
  let state=row();const calls:{path:string;body:unknown}[]=[],walletCalls:string[]=[];const controller=new AbortController();
  const provider:WalletProvider={async request({method}){
    walletCalls.push(method);
    if(method==='eth_chainId')return mode==='wrong-chain'?'0x1':'0x7a69';
    if(method==='eth_accounts')return mode==='wrong-wallet'?[collection]:[wallet];
    if(method==='eth_getTransactionCount'){if(mode==='nonce-error')throw new Error('private-provider-message');return mode==='nonce-change'||(mode==='nonce-after-claim'&&walletCalls.filter(x=>x===method).length>1)?'0x1':'0x0';}
    if(method==='eth_sendTransaction'){
      if(mode==='reject')throw {code:4001};
      if(mode==='unknown')throw {code:4900,message:'private-provider-message'};
      return mode==='bad-hash'?'not-a-hash':hash('d');
    }
    throw new Error('unexpected wallet method');
  }};
  const call:JournalCall=async(path,options)=>{
    calls.push({path,body:options.body});const body=options.body as Record<string,unknown>;
    if(path.endsWith('/claim')){
      if(mode==='lost-claim')throw new Error('simulated transport failure');
      state={...state,state:'wallet_pending',revision:'2',attemptId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'};
      if(mode==='abort-claim')controller.abort();
    }else if(path.endsWith('/wallet-outcome'))state={...state,state:body.outcome==='rejected'?'prepared':'attention',attemptId:body.outcome==='rejected'?null:state.attemptId};
    else if(path.endsWith('/transaction')){if(mode==='lost-save')throw new Error('save unavailable');state={...state,state:'submitted',revision:'3',transactionHash:body.transactionHash as string};}
    else if(mode==='already-pending')state={...state,state:'attention'};
    return {...state};
  };
  return {provider,call,calls,walletCalls,controller,state:()=>state};
}
test('mint model validates historical observations and rejects false listing/completion records',()=>{
  const valid=row();assert.equal(operation(valid,31337).state,'prepared');
  for(const changed of [{listingVerified:true},{state:'listed'},{state:'verified'},{chainId:1},{transactionHash:'bad'},{attemptId:'bad'}])assert.throws(()=>operation({...valid,...changed},31337));
  assert.throws(()=>operationPage({items:[valid,valid],nextCursor:null},31337));
  assert.throws(()=>operationPage({items:[],nextCursor:'bad'},31337));
});
test('manifest import binds the local chain and current wallet and rejects private keys',()=>{
  assert.equal(readManifest(JSON.stringify(manifest),session).length,1);
  for(const value of [{...manifest,chainId:1},{...manifest,minter:collection},{...manifest,privateKey:'do-not-echo'}])assert.throws(()=>readManifest(JSON.stringify(value),session));
  assert.throws(()=>readManifest('x'.repeat(2*1024*1024+1),session));
});
test('one explicit send persists only commitments before the exact wallet call',async()=>{
  const h=harness();const result=await sendLocalMint(h.provider,batch,review(),session,h.controller.signal,h.call);
  assert.equal(result.state,'submitted');assert.equal(result.transactionHash,hash('d'));assert.equal(result.listingVerified,false);
  assert.equal(h.walletCalls.filter(value=>value==='eth_sendTransaction').length,1);
  assert.deepEqual(h.calls.map(value=>value.path.split('/').at(-1)),['mint-operations','claim','transaction']);
  assert.ok(!JSON.stringify(h.calls).includes('Public fixture'));assert.ok(!JSON.stringify(h.calls).includes('ipfs://'));
});
for(const mode of ['wrong-chain','wrong-wallet','nonce-change','lost-claim','abort-claim','already-pending']){
  test(`does not send after ${mode}`,async()=>{const h=harness(mode);await assert.rejects(sendLocalMint(h.provider,batch,review(),session,h.controller.signal,h.call));assert.ok(!h.walletCalls.includes('eth_sendTransaction'));});
}
test('expired or changed reviewed intent is rejected before any network request',async()=>{
  for(const changed of [{reviewedAt:Date.now()-121000},{intentId:hash('c')}]){const h=harness();await assert.rejects(sendLocalMint(h.provider,batch,{...review(),...changed},session,h.controller.signal,h.call));assert.equal(h.walletCalls.length,0);assert.equal(h.calls.length,0);}
});
for(const [mode,state] of [['reject','prepared'],['unknown','attention'],['bad-hash','attention']]){
  test(`wallet ${mode} produces ${state} without retry`,async()=>{const h=harness(mode);await assert.rejects(sendLocalMint(h.provider,batch,review(),session,h.controller.signal,h.call),error=>error instanceof Error&&!error.message.includes('private-provider-message'));assert.equal(h.state().state,state);assert.equal(h.walletCalls.filter(value=>value==='eth_sendTransaction').length,1);});
}
test('lost hash persistence preserves the returned transaction for manual recovery, never a resend',async()=>{
  const h=harness('lost-save');await assert.rejects(sendLocalMint(h.provider,batch,review(),session,h.controller.signal,h.call),(error:unknown)=>!!error&&typeof error==='object'&&(error as {transactionHash?:string}).transactionHash===hash('d'));
  assert.equal(h.walletCalls.filter(value=>value==='eth_sendTransaction').length,1);
});

test('nonce change after reservation never reaches a wallet send or enables automatic retry',async()=>{
  const h=harness('nonce-after-claim');await assert.rejects(sendLocalMint(h.provider,batch,review(),session,h.controller.signal,h.call));
  assert.equal(h.state().state,'attention');assert.ok(!h.walletCalls.includes('eth_sendTransaction'));
});
test('nonce-provider failures are redacted before any operation is reserved',async()=>{
  const h=harness('nonce-error');await assert.rejects(sendLocalMint(h.provider,batch,review(),session,h.controller.signal,h.call),error=>error instanceof Error&&!error.message.includes('private-provider-message'));
  assert.equal(h.calls.length,0);assert.ok(!h.walletCalls.includes('eth_sendTransaction'));
});

test('invalid or tampered fee reviews fail before all wallet and server requests',async()=>{
  for(const changed of [{reviewedAt:NaN},{gas:'0xffffffff'},{gasPrice:'0xffffffffffff'},{maximumCost:'0'},{blockNumber:-1}]){
    const h=harness();await assert.rejects(sendLocalMint(h.provider,batch,{...review(),...changed},session,h.controller.signal,h.call));
    assert.equal(h.walletCalls.length,0);assert.equal(h.calls.length,0);
  }
});

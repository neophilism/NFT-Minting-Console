import test from 'node:test';import assert from 'node:assert/strict';
import {keccak256} from 'ethers';
import {prepareMintPlan} from '../console/chain/mint.mjs';
import {mintActionId} from '../console/launch/contracts.mjs';
import {launchOperation,sendLaunch} from '../console/ui/src/launch-wallet.ts';
import type {LaunchOperation,LaunchReview} from '../console/ui/src/launch-wallet.ts';
import type {Session} from '../console/ui/src/model.ts';
import type {WalletProvider} from '../console/ui/src/auth.ts';
const hash=(c:string)=>'0x'+c.repeat(64),wallet='0x'+'11'.repeat(20),collection='0x'+'22'.repeat(20);
const session:Session={wallet,chainId:1,role:'owner',csrf:'a'.repeat(64),expiresAt:new Date().toISOString(),idleExpiresAt:new Date().toISOString()};
function input():LaunchOperation{
  const batch=prepareMintPlan({chainId:1,collection,minter:wallet,runtimeCodeHash:hash('a'),works:[{tokenId:'1',title:'Public fixture',metadataURI:'ipfs://fixture/1.json',mediaHash:hash('b'),rightsURI:'ipfs://fixture/rights',rightsHash:hash('c')}]}).batches[0]!;
  const intentId=mintActionId(batch.id,0);
  return {intentId,chainId:1,collection,runtimeCodeHash:hash('a'),state:'prepared',revision:'1',attemptId:null,transactionHash:null,observedBlock:null,observedBlockHash:null,confirmations:0,lastCode:null,updatedAt:new Date().toISOString(),listingVerified:false,
    plan:{version:1,kind:'mint',intentId,chainId:1,from:wallet,to:collection,data:batch.data,value:'0x0',nonce:0,expected:{collection,runtimeCodeHash:hash('a'),config:{name:'Fixture',symbol:'TST',seriesSize:'87',royaltyBps:'600',owner:wallet,minter:wallet,royaltyRecipient:wallet}},batch,publicFilesVerifiedAt:new Date().toISOString(),validator:collection,validatorPolicyVerified:false}};
}
const review=(row:LaunchOperation):LaunchReview=>({intentId:row.intentId,reviewedAt:Date.now(),gas:'0x186a0',gasPrice:'0x1',maximumCost:'100000',nonce:'0x0',commitment:keccak256(new TextEncoder().encode(JSON.stringify(row.plan)))});
function harness(mode='ok'){
  let row=input();const calls:string[]=[],requests:{method:string;params?:unknown[]|Record<string,unknown>}[]=[],controller=new AbortController();
  const provider:WalletProvider={async request(request){requests.push(request);const {method}=request;
    if(method==='eth_chainId')return mode==='wrong-chain'?'0xaa36a7':'0x1';if(method==='eth_accounts')return [mode==='wrong-wallet'?collection:wallet];
    if(method==='eth_getTransactionCount')return mode==='nonce-changed'?'0x1':'0x0';
    if(method==='eth_sendTransaction'){if(mode==='rejected')throw {code:4001};if(mode==='unknown')throw {message:'secret-rpc-url'};if(mode==='abort-after-send')controller.abort();return hash('d');}throw new Error('Unexpected method');}};
  const call=async(path:string,options:{body:unknown})=>{calls.push(path);const body=options.body as Record<string,unknown>;
    if(path.endsWith('/check'))return {checked:mode!=='failed-check',intentId:row.intentId};
    if(path.endsWith('/claim')){if(mode==='lost-claim')throw new Error('Network failed');row={...row,state:'wallet_pending',revision:'2',attemptId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'};if(mode==='abort-after-claim')controller.abort();}
    if(path.endsWith('/wallet-outcome'))row={...row,state:body.outcome==='rejected'?'prepared':'attention',attemptId:body.outcome==='rejected'?null:row.attemptId};
    if(path.endsWith('/transaction')){if(mode==='lost-save')throw new Error('Save lost');row={...row,state:'submitted',revision:'3',transactionHash:body.transactionHash as string};}
    return row;};
  return {provider,call,calls,requests,controller,row:()=>row};
}
test('public mint plans bind exact chain, wallet, action ID, collection and calldata',()=>{
  const row=input();assert.equal(launchOperation(row,session).intentId,row.intentId);
  for(const change of [{to:wallet},{data:'0x1234'},{nonce:1},{value:'0x1'},{chainId:11155111}])assert.throws(()=>launchOperation({...row,plan:{...row.plan,...change}},session));
});
test('explicit mainnet request sends one exact zero-value transaction after durable reservation',async()=>{
  const h=harness(),row=h.row();const result=await sendLaunch(h.provider,row,review(row),session,h.controller.signal,h.call);
  assert.equal(result.state,'submitted');const sends=h.requests.filter(x=>x.method==='eth_sendTransaction');assert.equal(sends.length,1);
  const tx=(sends[0]!.params as Record<string,string>[])[0]!;assert.equal(tx.chainId,'0x1');assert.equal(tx.to,collection);assert.equal(tx.value,'0x0');assert.equal(tx.data,row.plan.data);
  assert.deepEqual(h.calls.map(x=>x.split('/').at(-1)),['check','claim','transaction']);
});
for(const mode of ['wrong-chain','wrong-wallet','nonce-changed','failed-check','lost-claim','abort-after-claim'])test('never sends after '+mode,async()=>{
  const h=harness(mode),row=h.row();await assert.rejects(sendLaunch(h.provider,row,review(row),session,h.controller.signal,h.call));assert.ok(!h.requests.some(x=>x.method==='eth_sendTransaction'));
});
for(const mode of ['rejected','unknown','lost-save','abort-after-send'])test('preserves recovery without resend after '+mode,async()=>{
  const h=harness(mode),row=h.row();await assert.rejects(sendLaunch(h.provider,row,review(row),session,h.controller.signal,h.call),e=>e instanceof Error&&!e.message.includes('secret-rpc-url')&&(!['lost-save','abort-after-send'].includes(mode)||(e as {transactionHash?:string}).transactionHash===hash('d')));
  assert.equal(h.requests.filter(x=>x.method==='eth_sendTransaction').length,1);
});
test('tampered fee or transaction review is rejected before any request',async()=>{
  for(const change of [{maximumCost:'0'},{commitment:hash('c')},{reviewedAt:Date.now()-121000},{gas:'0xffffffffff'}]){const h=harness(),row=h.row();await assert.rejects(sendLaunch(h.provider,row,{...review(row),...change},session,h.controller.signal,h.call));assert.equal(h.requests.length,0);assert.equal(h.calls.length,0);}
});

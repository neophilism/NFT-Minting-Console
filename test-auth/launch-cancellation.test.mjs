import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyNonceCancellation} from '../console/launch/cancellation.mjs';
const wallet='0x'+'11'.repeat(20),other='0x'+'22'.repeat(20),hash='0x'+'aa'.repeat(32),blockHash='0x'+'bb'.repeat(32),finalHash='0x'+'cc'.repeat(32);
const plan={chainId:11155111,from:wallet,nonce:7};
function fixture(change=()=>{}){
  const tx={hash,chainId:11155111n,from:wallet,to:wallet,nonce:7,data:'0x',value:0n,gasLimit:21000n,type:2,accessList:[],blockNumber:90,blockHash};
  const receipt={hash,status:1,from:wallet,to:wallet,gasUsed:21000n,contractAddress:null,logs:[],blockNumber:90,blockHash};
  const state={tx,receipt,block:{number:90,hash:blockHash,transactions:[hash]},finalized:{number:98,hash:finalHash},code:'0x',reorg:false};
  change(state);
  let canonicalReads=0;
  const provider={getNetwork:async()=>({chainId:11155111n}),getTransaction:async()=>state.tx,getTransactionReceipt:async()=>state.receipt,
    getCode:async()=>state.code,getBlock:async tag=>{
      if(tag==='latest')return {number:100,hash:'0x'+'dd'.repeat(32)};
      if(tag==='finalized')return state.finalized;
      if(tag===90){canonicalReads++;return state.reorg&&canonicalReads>1?{...state.block,hash:'0x'+'ee'.repeat(32)}:state.block;}
      if(tag===98)return {number:98,hash:finalHash};return null;
    }};
  return {provider,state};
}
test('a finalized inert self-transfer proves nonce consumption without verifying or retrying the original action',async()=>{
  const {provider}=fixture(),proof=await verifyNonceCancellation(provider,plan,hash);
  assert.equal(proof.transactionHash,hash);assert.equal(proof.nonce,7);assert.equal(proof.confirmations,9);
  assert.equal(proof.originalActionVerified,false);assert.equal(proof.transactionSent,false);assert.equal(proof.kind,'finalized-self-cancellation');
});
for(const [name,change,code] of [
  ['not yet mined',s=>{s.receipt=null;},'PENDING_OR_UNKNOWN'],
  ['wrong nonce',s=>{s.tx.nonce++;},'CANCELLATION_MISMATCH'],
  ['other recipient',s=>{s.tx.to=other;},'CANCELLATION_MISMATCH'],
  ['nonzero value',s=>{s.tx.value=1n;},'CANCELLATION_MISMATCH'],
  ['contract calldata',s=>{s.tx.data='0x12';},'CANCELLATION_MISMATCH'],
  ['gas limit can execute code',s=>{s.tx.gasLimit=22000n;},'CANCELLATION_MISMATCH'],
  ['delegation gas charged',s=>{s.receipt.gasUsed=21100n;},'CANCELLATION_MISMATCH'],
  ['delegation authorization',s=>{s.tx.authorizationList=[{}];},'CANCELLATION_MISMATCH'],
  ['authorization transaction type',s=>{s.tx.type=4;},'CANCELLATION_MISMATCH'],
  ['access list',s=>{s.tx.accessList=[{}];},'CANCELLATION_MISMATCH'],
  ['receipt logs',s=>{s.receipt.logs=[{}];},'CANCELLATION_MISMATCH'],
  ['failed receipt',s=>{s.receipt.status=0;},'CANCELLATION_MISMATCH'],
  ['unfinalized receipt',s=>{s.finalized.number=89;},'CANCELLATION_NOT_FINALIZED'],
  ['missing finalized tag',s=>{s.finalized=null;},'CANCELLATION_NOT_FINALIZED'],
  ['receipt absent from block',s=>{s.block.transactions=[];},'CHAIN_REORG'],
  ['code-bearing sender',s=>{s.code='0xef0100'+'11'.repeat(20);},'EOA_REQUIRED'],
  ['canonical block changed',s=>{s.reorg=true;},'CHAIN_REORG'],
]){
  test('nonce resolution rejects '+name,async()=>{const {provider}=fixture(change);await assert.rejects(verifyNonceCancellation(provider,plan,hash),e=>e.code===code);});
}

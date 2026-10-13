import { prepareMintPlan } from '../../chain/mint.mjs';
import type { MintBatch } from '../../chain/mint.mjs';
import type { Session } from './model';
export type MintState='prepared'|'wallet_pending'|'submitted'|'verified'|'attention'|'cancelled';
export interface MintOperation {
  intentId:string;chainId:number;collection:string;runtimeCodeHash:string;state:MintState;revision:string;
  attemptId:string|null;transactionHash:string|null;observedBlock:number|null;observedBlockHash:string|null;
  confirmations:number;lastCode:string|null;updatedAt:string;listingVerified:false;
}
export const HASH=/^0x[0-9a-f]{64}$/;
const STATES=new Set(['prepared','wallet_pending','submitted','verified','attention','cancelled']);
const fail=():never=>{throw new Error('The transaction record could not be verified. No mint or listing is confirmed.');};
export function operation(value:unknown,chainId:number):MintOperation {
  if(!value||typeof value!=='object')fail();
  const v=value as Record<string,unknown>;
  const hash=(value:unknown)=>typeof value==='string'&&HASH.test(value)&&!/^0x0+$/.test(value);
  if(!hash(v.intentId)||v.chainId!==chainId||typeof v.collection!=='string'||!/^0x[0-9a-f]{40}$/.test(v.collection)||/^0x0+$/.test(v.collection)||
    !hash(v.runtimeCodeHash)||!STATES.has(v.state as string)||typeof v.revision!=='string'||!/^[1-9][0-9]{0,18}$/.test(v.revision)||
    (v.attemptId!==null&&(typeof v.attemptId!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v.attemptId)))||
    (v.transactionHash!==null&&!hash(v.transactionHash))||(v.observedBlockHash!==null&&!hash(v.observedBlockHash))||
    (v.observedBlock!==null&&(!Number.isSafeInteger(v.observedBlock)||(v.observedBlock as number)<0))||
    !Number.isSafeInteger(v.confirmations)||(v.confirmations as number)<0||
    (v.lastCode!==null&&(typeof v.lastCode!=='string'||!/^[A-Z_]{1,64}$/.test(v.lastCode)))||
    typeof v.updatedAt!=='string'||!Number.isFinite(Date.parse(v.updatedAt))||v.listingVerified!==false)fail();
  if(v.state==='verified'&&(!v.transactionHash||v.observedBlock===null||!v.observedBlockHash||!(v.confirmations as number)||v.lastCode!==null))fail();
  if(v.state==='submitted'&&!v.transactionHash)fail();
  if(v.state==='wallet_pending'&&(!v.attemptId||v.transactionHash!==null))fail();
  if(['prepared','cancelled'].includes(v.state as string)&&(v.transactionHash!==null||v.attemptId!==null))fail();
  return {intentId:v.intentId as string,chainId,collection:v.collection as string,runtimeCodeHash:v.runtimeCodeHash as string,state:v.state as MintState,
    revision:v.revision as string,attemptId:v.attemptId as string|null,transactionHash:v.transactionHash as string|null,observedBlock:v.observedBlock as number|null,
    observedBlockHash:v.observedBlockHash as string|null,confirmations:v.confirmations as number,lastCode:v.lastCode as string|null,updatedAt:v.updatedAt as string,listingVerified:false};
}
export function operationPage(value:unknown,chainId:number):{items:MintOperation[];nextCursor:string|null} {
  if(!value||typeof value!=='object')fail();const v=value as Record<string,unknown>;
  if(!Array.isArray(v.items)||v.items.length>100||(v.nextCursor!==null&&(typeof v.nextCursor!=='string'||!HASH.test(v.nextCursor))))fail();
  const items=(v.items as unknown[]).map(item=>operation(item,chainId));
  if(new Set(items.map(item=>item.intentId)).size!==items.length)fail();
  return {items,nextCursor:v.nextCursor as string|null};
}
export function readManifest(text:string,session:Session):readonly MintBatch[] {
  if(text.length>2*1024*1024)throw new Error('The mint manifest exceeds 2 MiB.');
  let plan;try{plan=prepareMintPlan(JSON.parse(text));}catch{throw new Error('The mint manifest is invalid. Use an exact public-data manifest without private fields.');}
  if(plan.batches.some(batch=>batch.chainId!==31337||session.chainId!==31337||batch.minter.toLowerCase()!==session.wallet.toLowerCase()||batch.data.length>131074))
    throw new Error('Rehearsal manifests must match this wallet on chain 31337 and the bounded transaction size.');
  return plan.batches;
}
export const statusText:Record<MintState,string>={prepared:'Ready for review',wallet_pending:'Wallet outcome not yet recorded',submitted:'Awaiting receipt verification',verified:'Receipt verified at recorded block',attention:'Needs attention',cancelled:'Cancelled before wallet request'};

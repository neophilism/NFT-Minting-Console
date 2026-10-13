import { BrowserProvider, getAddress, toQuantity } from 'ethers';
import { simulateMintBatch } from '../../chain/mint.mjs';
import type { MintBatch } from '../../chain/mint.mjs';
import type { WalletProvider } from './auth';
import type { Session } from './model';
import { operation, HASH } from './mint-model.ts';
import type { MintOperation } from './mint-model.ts';
export type JournalCall=(path:string,options:{method:string;body:unknown;csrf:string;signal?:AbortSignal})=>Promise<unknown>;
export interface MintReview {readonly intentId:string;readonly reviewedAt:number;readonly gas:string;readonly gasPrice:string;readonly nonce:string;readonly maximumCost:string;readonly blockNumber:number}
export class MintFlowError extends Error {readonly transactionHash?:string;constructor(message:string,transactionHash?:string){super(message);this.transactionHash=transactionHash;}}
function active(signal:AbortSignal){if(signal.aborted)throw new MintFlowError('Wallet session changed or this operation was cancelled. Inspect your wallet before retrying.');}
function quantity(value:unknown):bigint {if(typeof value!=='string'||value.length>66||!/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value))throw new MintFlowError('The wallet returned an invalid network value.');return BigInt(value);}
export async function matchingWallet(wallet:WalletProvider,batch:MintBatch,session:Session,signal:AbortSignal){
  try{
  active(signal);
  const chain=await wallet.request({method:'eth_chainId'});active(signal);
  const accounts=await wallet.request({method:'eth_accounts'});active(signal);
  if(quantity(chain)!==31337n||session.chainId!==31337||batch.chainId!==31337||!Array.isArray(accounts)||typeof accounts[0]!=='string'||
    getAddress(accounts[0])!==getAddress(session.wallet)||getAddress(batch.minter)!==getAddress(session.wallet))
    throw new MintFlowError('Wallet or network changed. Reconnect the matching wallet on the disposable local network.');
  }catch(error){if(error instanceof MintFlowError)throw error;throw new MintFlowError('The selected wallet could not be checked. No new transaction was requested.');}
}
export async function reviewLocalMint(wallet:WalletProvider,batch:MintBatch,session:Session,signal:AbortSignal):Promise<MintReview>{
  await matchingWallet(wallet,batch,session,signal);
  const provider=new BrowserProvider(wallet,undefined,{cacheTimeout:-1});
  try{
    const result=await simulateMintBatch(provider,batch,{signal});active(signal);
    const estimate=quantity(await wallet.request({method:'eth_estimateGas',params:[{from:batch.minter,to:batch.collection,data:batch.data,value:'0x0'}]}));active(signal);
    const gas=(estimate*120n+99n)/100n;
    const gasPrice=quantity(await wallet.request({method:'eth_gasPrice'}));active(signal);
    const nonce=quantity(await wallet.request({method:'eth_getTransactionCount',params:[batch.minter,'pending']}));active(signal);
    const balance=quantity(await wallet.request({method:'eth_getBalance',params:[batch.minter,'latest']}));active(signal);
    if(gas<21000n||gas>12000000n||gasPrice<1n||gasPrice>1000000000000n||gas*gasPrice>100000000000000000n||balance<gas*gasPrice||nonce>BigInt(Number.MAX_SAFE_INTEGER))
      throw new MintFlowError('The local gas estimate, fee cap or test-wallet balance is outside rehearsal limits.');
    await matchingWallet(wallet,batch,session,signal);
    return Object.freeze({intentId:batch.id,reviewedAt:Date.now(),gas:toQuantity(gas),gasPrice:toQuantity(gasPrice),nonce:toQuantity(nonce),maximumCost:String(gas*gasPrice),blockNumber:result.blockNumber});
  }catch(error){if(error instanceof MintFlowError)throw error;active(signal);throw new MintFlowError('Local mint simulation or fee checks failed. No transaction was sent. Check the public manifest and test network.');}finally{provider.destroy();}
}
function reviewedSnapshot(value:MintReview):Readonly<MintReview>{
  const keys=['intentId','reviewedAt','gas','gasPrice','nonce','maximumCost','blockNumber'];
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length||
    keys.some(key=>{const d=Object.getOwnPropertyDescriptor(value,key);return !d||!('value' in d)||!d.enumerable;}))
    throw new MintFlowError('The fee review is invalid. Simulate and review the transaction again.');
  const snapshot=Object.freeze({...value}),gas=quantity(snapshot.gas),price=quantity(snapshot.gasPrice),nonce=quantity(snapshot.nonce);
  if(!Number.isSafeInteger(snapshot.reviewedAt)||!Number.isSafeInteger(snapshot.blockNumber)||snapshot.blockNumber<0||
    gas<21000n||gas>12000000n||price<1n||price>1000000000000n||gas*price>100000000000000000n||
    snapshot.maximumCost!==String(gas*price)||nonce>BigInt(Number.MAX_SAFE_INTEGER))
    throw new MintFlowError('The fee review is outside rehearsal limits. Simulate and review the transaction again.');
  return snapshot;
}
/** One explicit invocation = at most one wallet send. Never retry a lost reservation or uncertain wallet response. */
export async function sendLocalMint(wallet:WalletProvider,batch:MintBatch,reviewInput:MintReview,session:Session,signal:AbortSignal,call:JournalCall):Promise<MintOperation>{
  const review=reviewedSnapshot(reviewInput);
  if(review.intentId!==batch.id||Date.now()-review.reviewedAt>120000||review.reviewedAt>Date.now()+1000)throw new MintFlowError('The reviewed transaction expired. Simulate and review it again.');
  await matchingWallet(wallet,batch,session,signal);
  let nonce:bigint;
  try{nonce=quantity(await wallet.request({method:'eth_getTransactionCount',params:[batch.minter,'pending']}));}
  catch{throw new MintFlowError('The wallet nonce could not be checked. No new transaction was requested.');}
  active(signal);
  if(nonce!==quantity(review.nonce))throw new MintFlowError('The wallet nonce changed. Review the transaction again before signing.');
  const root='/api/mint-operations',path=root+'/'+batch.id;
  const post=(url:string,body:unknown)=>call(url,{method:'POST',body,csrf:session.csrf,signal});
  const saved=operation(await post(root,{intentId:batch.id,collection:batch.collection,runtimeCodeHash:batch.runtimeCodeHash}),session.chainId);active(signal);
  if(saved.intentId!==batch.id||saved.collection!==batch.collection.toLowerCase()||saved.runtimeCodeHash!==batch.runtimeCodeHash||saved.state!=='prepared')
    throw new MintFlowError('This operation already exists or changed. Use transaction recovery; do not send it again.');
  const claim=operation(await post(path+'/claim',{expectedRevision:saved.revision}),session.chainId);active(signal);
  if(claim.intentId!==batch.id||claim.state!=='wallet_pending'||!claim.attemptId||claim.collection!==saved.collection||claim.runtimeCodeHash!==saved.runtimeCodeHash)
    throw new MintFlowError('The wallet reservation could not be verified. Reload the journal; no automatic resend is allowed.');
  let hash:unknown;
  try{
    await matchingWallet(wallet,batch,session,signal);active(signal);
    if(quantity(await wallet.request({method:'eth_getTransactionCount',params:[batch.minter,'pending']}))!==quantity(review.nonce))throw new MintFlowError('The wallet nonce changed after reservation. No new transaction was requested; inspect the journal before continuing.');
    active(signal);
    // The wallet receives the exact reviewed transaction, never an approval, arbitrary call or chain switch.
    hash=await wallet.request({method:'eth_sendTransaction',params:[{chainId:'0x7a69',from:batch.minter,to:batch.collection,data:batch.data,value:'0x0',gas:review.gas,gasPrice:review.gasPrice,nonce:review.nonce}]});
  }catch(error){
    const rejected=(error as {code?:unknown})?.code===4001;
    try{await post(path+'/wallet-outcome',{expectedRevision:claim.revision,attemptId:claim.attemptId,outcome:rejected?'rejected':'unknown'});}catch{throw new MintFlowError('The wallet outcome could not be saved. Inspect the wallet and recover this operation; do not resend automatically.');}
    throw new MintFlowError(rejected?'You declined the mint request. Nothing was submitted by this request.':'The wallet outcome is uncertain. Inspect wallet history and recover the transaction hash; do not resend.');
  }
  if(typeof hash!=='string'||!HASH.test(hash)||/^0x0+$/.test(hash)){
    try{await post(path+'/wallet-outcome',{expectedRevision:claim.revision,attemptId:claim.attemptId,outcome:'unknown'});}catch{/* Reserved remains non-resendable. */}
    throw new MintFlowError('The wallet did not return a valid transaction hash. Inspect wallet history before continuing.');
  }
  active(signal);
  try{
    const attached=operation(await post(path+'/transaction',{transactionHash:hash}),session.chainId);
    if(attached.intentId!==batch.id||attached.transactionHash!==hash)throw new Error('Attachment mismatch');
    return attached;
  }catch{throw new MintFlowError('The wallet returned a transaction, but saving its hash was not confirmed. Record this hash through transaction recovery; do not mint again.',hash);}
}

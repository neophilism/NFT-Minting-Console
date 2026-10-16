import {BrowserProvider, getAddress, keccak256, toQuantity} from 'ethers';
import {simulateDeployment,verifyCollection,mintActionId} from '../../launch/contracts.mjs';
import type {DeployPlan,CollectionExpected} from '../../launch/contracts.mjs';
import {prepareMintPlan,simulateMintBatch} from '../../chain/mint.mjs';
import type {MintBatch} from '../../chain/mint.mjs';
import type {Session} from './model';
import type {WalletProvider} from './auth';
import type {JournalCall} from './mint-wallet.ts';
import {MintFlowError} from './mint-wallet.ts';
import {operation,HASH} from './mint-model.ts';
import type {MintOperation} from './mint-model.ts';
export interface PublicMintPlan {version:1;kind:'mint';intentId:string;chainId:number;from:string;to:string;data:string;value:'0x0';nonce:number;expected:CollectionExpected;batch:MintBatch;publicFilesVerifiedAt:string;validator:string;validatorPolicyVerified:false}
export type LaunchPlan=DeployPlan|PublicMintPlan;
export interface LaunchOperation extends MintOperation {plan:LaunchPlan}
export interface LaunchReview {intentId:string;reviewedAt:number;gas:string;gasPrice:string;maximumCost:string;nonce:string;commitment:string}
const fail=(message:string):never=>{throw new MintFlowError(message);};
const active=(signal:AbortSignal)=>{if(signal.aborted)fail('Wallet session changed. Recover any pending operation before continuing.');};
function quantity(value:unknown):bigint {if(typeof value!=='string'||value.length>66||!/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value))fail('The wallet returned an invalid value.');return BigInt(value as string);}
export function launchOperation(value:unknown,session:Session):LaunchOperation {
  const base=operation(value,session.chainId),p=(value as {plan?:unknown}).plan;
  if(!p||typeof p!=='object')fail('The public transaction plan is missing.');const plan=p as LaunchPlan;
  if(plan.version!==1||!['deploy','mint'].includes(plan.kind)||plan.chainId!==session.chainId||plan.intentId!==base.intentId||
    typeof plan.from!=='string'||plan.from.toLowerCase()!==session.wallet.toLowerCase()||plan.value!=='0x0'||
    !Number.isSafeInteger(plan.nonce)||plan.nonce<0||typeof plan.data!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(plan.data)||plan.data.length>131074||
    plan.expected?.collection.toLowerCase()!==base.collection||plan.expected.runtimeCodeHash!==base.runtimeCodeHash)fail('The public transaction plan does not match this wallet and operation.');
  if(plan.kind==='deploy'){
    if(plan.to!==null||typeof plan.runtime!=='string'||keccak256(plan.runtime)!==plan.expected.runtimeCodeHash)fail('The deployment runtime cannot be verified.');
  }else{
    const batch=prepareMintPlan({chainId:plan.batch.chainId,collection:plan.batch.collection,minter:plan.batch.minter,runtimeCodeHash:plan.batch.runtimeCodeHash,works:plan.batch.works}).batches[0]!;
    if(plan.to.toLowerCase()!==base.collection||mintActionId(batch.id,plan.nonce)!==base.intentId||batch.data!==plan.data||batch.collection.toLowerCase()!==base.collection||batch.minter.toLowerCase()!==session.wallet.toLowerCase())fail('The mint calldata does not match its public token fields.');
  }
  return {...base,plan:structuredClone(plan)};
}
async function matching(wallet:WalletProvider,plan:LaunchPlan,session:Session,signal:AbortSignal){
  active(signal);const network=quantity(await wallet.request({method:'eth_chainId'}));active(signal);
  const accounts=await wallet.request({method:'eth_accounts'});active(signal);
  if(network!==BigInt(plan.chainId)||plan.chainId!==session.chainId||!Array.isArray(accounts)||typeof accounts[0]!=='string'||getAddress(accounts[0])!==getAddress(session.wallet)||getAddress(plan.from)!==getAddress(session.wallet))fail('Reconnect the signing wallet on the configured network.');
}
const commitment=(plan:LaunchPlan)=>keccak256(new TextEncoder().encode(JSON.stringify(plan)));
/** Independently simulate the exact public transaction through the selected wallet, then show its bounded fee. */
export async function reviewLaunch(wallet:WalletProvider,input:LaunchOperation,session:Session,signal:AbortSignal):Promise<LaunchReview>{
  const row=launchOperation(input,session),plan=row.plan;await matching(wallet,plan,session,signal);
  const provider=new BrowserProvider(wallet,undefined,{cacheTimeout:-1});
  try{
    if(plan.kind==='deploy')await simulateDeployment(provider,plan);
    else{await verifyCollection(provider,plan.expected,plan.chainId);await simulateMintBatch(provider,plan.batch,{signal});}
    active(signal);
    if(await provider.getCode(plan.from)!=='0x')fail('The public launch signer must be a direct EOA wallet.');
    const tx={from:plan.from,...(plan.to?{to:plan.to}:{}),data:plan.data,value:'0x0'};
    const estimate=quantity(await wallet.request({method:'eth_estimateGas',params:[tx]}));active(signal);
    const gas=(estimate*120n+99n)/100n,price=quantity(await wallet.request({method:'eth_gasPrice'}));active(signal);
    const nonce=quantity(await wallet.request({method:'eth_getTransactionCount',params:[plan.from,'pending']}));active(signal);
    const balance=quantity(await wallet.request({method:'eth_getBalance',params:[plan.from,'pending']}));active(signal);
    if(nonce!==BigInt(plan.nonce))fail('The wallet nonce changed. Prepare a fresh operation before signing.');
    if(gas<21000n||gas>12000000n||price<1n||price>1000000000000n||gas*price>100000000000000000n)fail('Estimated fees exceed the launch limits. Check network fees before continuing.');
    if(balance<gas*price)fail('The signing wallet needs '+String(gas*price-balance)+' additional wei to cover this fee cap.');
    await matching(wallet,plan,session,signal);
    return {intentId:row.intentId,reviewedAt:Date.now(),gas:toQuantity(gas),gasPrice:toQuantity(price),maximumCost:String(gas*price),nonce:toQuantity(nonce),commitment:commitment(plan)};
  }catch(e){if(e instanceof MintFlowError)throw e;active(signal);return fail('Wallet simulation or fee verification failed. No transaction was requested.');}finally{provider.destroy();}
}
export async function sendLaunch(wallet:WalletProvider,input:LaunchOperation,reviewInput:LaunchReview,session:Session,signal:AbortSignal,call:JournalCall):Promise<LaunchOperation>{
  const row=launchOperation(input,session),plan=row.plan,review=structuredClone(reviewInput);
  if(row.state!=='prepared'||review.intentId!==row.intentId||review.commitment!==commitment(plan)||!Number.isSafeInteger(review.reviewedAt)||
    Date.now()-review.reviewedAt>120000||review.reviewedAt>Date.now()+1000||quantity(review.nonce)!==BigInt(plan.nonce)||
    quantity(review.gas)<21000n||quantity(review.gas)>12000000n||quantity(review.gasPrice)<1n||quantity(review.gasPrice)>1000000000000n||
    review.maximumCost!==String(quantity(review.gas)*quantity(review.gasPrice))||BigInt(review.maximumCost)>100000000000000000n)fail('The reviewed transaction expired or changed. Review its fees again.');
  await matching(wallet,plan,session,signal);
  const root='/api/launch/operations/'+row.intentId;
  const post=(path:string,body:unknown)=>call(root+path,{method:'POST',body,csrf:session.csrf,signal});
  const checked=await post('/check',{}) as {checked?:unknown;intentId?:unknown};active(signal);
  if(checked.checked!==true||checked.intentId!==row.intentId)fail('The server preflight could not be confirmed.');
  const claim=launchOperation(await post('/claim',{expectedRevision:row.revision}),session);active(signal);
  if(claim.state!=='wallet_pending'||!claim.attemptId||commitment(claim.plan)!==commitment(plan))fail('The saved wallet reservation does not match. Recover this operation.');
  let hash:unknown;
  try{
    await matching(wallet,plan,session,signal);
    const nonce=quantity(await wallet.request({method:'eth_getTransactionCount',params:[plan.from,'pending']}));active(signal);
    if(nonce!==BigInt(plan.nonce))fail('The wallet nonce changed after reservation. Inspect wallet history.');
    hash=await wallet.request({method:'eth_sendTransaction',params:[{chainId:toQuantity(plan.chainId),from:plan.from,...(plan.to?{to:plan.to}:{}),data:plan.data,value:'0x0',nonce:review.nonce,gas:review.gas,gasPrice:review.gasPrice}]});
  }catch(e){
    const rejected=(e as {code?:unknown})?.code===4001;
    try{await post('/wallet-outcome',{expectedRevision:claim.revision,attemptId:claim.attemptId,outcome:rejected?'rejected':'unknown'});}catch{/* A lost reservation remains blocked. */}
    fail(rejected?'You declined the transaction. Review it again when ready.':'The wallet outcome is unknown. Recover the transaction from wallet history; do not send again.');
  }
  if(typeof hash!=='string'||!HASH.test(hash)||/^0x0+$/.test(hash)){
    try{await post('/wallet-outcome',{expectedRevision:claim.revision,attemptId:claim.attemptId,outcome:'unknown'});}catch{/* Remains reserved. */}
    fail('The wallet did not return a valid hash. Inspect wallet history before continuing.');
  }
  // Preserve a wallet-returned hash even if the page/session was cancelled while the wallet was open.
  if(signal.aborted)throw new MintFlowError('The session changed after submission. Save this transaction hash for recovery.',hash as string);
  try{return launchOperation(await post('/transaction',{transactionHash:hash}),session);}
  catch{throw new MintFlowError('Saving the transaction hash was not confirmed. Recover this operation without sending again.',hash as string);}
}

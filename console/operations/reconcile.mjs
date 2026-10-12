import { Interface } from 'ethers';
import { MINT_ABI, MintCheckError, prepareMintPlan, verifyMintReceipt } from '../chain/mint.mjs';
import { JournalError } from './journal.mjs';
const iface=new Interface(MINT_ABI);
const denied=code=>{throw new MintCheckError(code);};
/** Recover exact public calldata from the observed transaction, not an unpublished server draft. */
export function recoverMintBatch(operation,actor,tx) {
  if(!tx)denied('PENDING_OR_UNKNOWN');
  if(tx.hash!==operation.transactionHash||tx.chainId!==BigInt(actor.chainId)||
     tx.from?.toLowerCase()!==actor.wallet||tx.to?.toLowerCase()!==operation.collection||tx.value!==0n||
     ![0,1,2].includes(tx.type)||tx.authorizationList?.length||tx.blobVersionedHashes?.length)denied('TRANSACTION_MISMATCH');
  if(typeof tx.data!=='string'||tx.data.length>131074)denied('TRANSACTION_MISMATCH');
  let parsed;
  try {parsed=iface.parseTransaction({data:tx.data,value:tx.value});} catch {denied('TRANSACTION_MISMATCH');}
  if(parsed?.name!=='mintWorksBatch'||parsed.args[0].length<1||parsed.args[0].length>10)denied('TRANSACTION_MISMATCH');
  const works=parsed.args[0].map(item=>({tokenId:String(item[0]),title:item[1],metadataURI:item[2],mediaHash:item[3],rightsURI:item[4],rightsHash:item[5]}));
  const batch=prepareMintPlan({chainId:actor.chainId,collection:operation.collection,minter:actor.wallet,runtimeCodeHash:operation.runtimeCodeHash,works}).batches[0];
  if(batch.id!==operation.intentId||batch.data!==tx.data)denied('INTENT_MISMATCH');
  return batch;
}
export async function reconcileJournal(journal,actor,id,provider,{minConfirmations=2}={}) {
  if(actor.role!=='owner')throw new JournalError(403,'forbidden','An authorized owner wallet is required.');
  const operation=await journal.get(actor,id);
  if(!operation.transactionHash)throw new JournalError(409,'transaction_required','No transaction hash is recorded. Inspect the wallet before taking further action.');
  let observation;
  try {
    if(!provider)denied('RPC_VERIFICATION_UNAVAILABLE');
    if((await provider.getNetwork()).chainId!==BigInt(actor.chainId))denied('CHAIN_MISMATCH');
    const batch=recoverMintBatch(operation,actor,await provider.getTransaction(operation.transactionHash));
    const evidence=await verifyMintReceipt(provider,batch,operation.transactionHash,{minConfirmations});
    observation={state:'verified',block:evidence.blockNumber,blockHash:evidence.blockHash,confirmations:Math.min(evidence.confirmations,2147483647),code:null};
  } catch(error) {
    const code=error instanceof MintCheckError?error.code:'RPC_VERIFICATION_UNAVAILABLE';
    observation={state:['PENDING_OR_UNKNOWN','INSUFFICIENT_CONFIRMATIONS'].includes(code)?'submitted':'attention',block:null,blockHash:null,confirmations:0,code};
  }
  // Network work happens outside SQL locks. CAS prevents an old response replacing newer evidence.
  return journal.observe(actor,id,operation.revision,observation);
}

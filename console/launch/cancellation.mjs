import {address,anchor,canonical,digest,stop} from './contracts.mjs';

/** A narrow, read-only proof that the original nonce was consumed by an inert
 * self-transfer. Finality and exact 21,000 gas exclude delegated self-execution.
 * Never creates, signs, cancels, replaces or broadcasts a transaction. */
export async function verifyNonceCancellation(provider,plan,transactionHash){
  const hash=digest(transactionHash),wallet=address(plan.from);
  if(!Number.isSafeInteger(plan.nonce)||plan.nonce<0)stop('INVALID_NONCE');
  await anchor(provider,plan.chainId);
  const [tx,receipt]=await Promise.all([provider.getTransaction(hash),provider.getTransactionReceipt(hash)]);
  if(!tx||!receipt)stop('PENDING_OR_UNKNOWN');
  if(receipt.status!==1||tx.hash!==hash||receipt.hash!==hash||tx.chainId!==BigInt(plan.chainId)||
    address(tx.from)!==wallet||address(tx.to)!==wallet||address(receipt.from)!==wallet||address(receipt.to)!==wallet||
    tx.nonce!==plan.nonce||tx.data!=='0x'||tx.value!==0n||tx.gasLimit!==21000n||receipt.gasUsed!==21000n||
    ![0,1,2].includes(tx.type)||tx.authorizationList?.length||tx.blobVersionedHashes?.length||tx.accessList?.length||
    receipt.contractAddress!==null||!Array.isArray(receipt.logs)||receipt.logs.length)stop('CANCELLATION_MISMATCH');
  const number=receipt.blockNumber,blockHash=digest(receipt.blockHash);
  if(!Number.isSafeInteger(number)||number<1||tx.blockNumber!==number||tx.blockHash!==blockHash)stop('CANCELLATION_MISMATCH');
  const block=await provider.getBlock(number),finalized=await provider.getBlock('finalized');
  if(!block||block.hash!==blockHash||!Array.isArray(block.transactions)||!block.transactions.includes(hash))stop('CHAIN_REORG');
  if(!finalized||!Number.isSafeInteger(finalized.number)||finalized.number<number+1)stop('CANCELLATION_NOT_FINALIZED');
  digest(finalized.hash);
  if(await provider.getCode(wallet,number-1)!=='0x'||await provider.getCode(wallet,number)!=='0x')stop('EOA_REQUIRED');
  const confirmations=finalized.number-number+1;
  await canonical(provider,plan.chainId,{number,hash:blockHash});
  await canonical(provider,plan.chainId,{number:finalized.number,hash:finalized.hash});
  return {version:1,kind:'finalized-self-cancellation',chainId:plan.chainId,wallet,nonce:plan.nonce,transactionHash:hash,
    blockNumber:number,blockHash,finalizedBlockNumber:finalized.number,finalizedBlockHash:finalized.hash,
    confirmations:Math.min(confirmations,2147483647),originalActionVerified:false,transactionSent:false};
}

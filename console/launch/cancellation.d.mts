import type {Provider} from 'ethers';
export interface NonceCancellationProof {
  version:1;kind:'finalized-self-cancellation';chainId:number;wallet:string;nonce:number;transactionHash:string;
  blockNumber:number;blockHash:string;finalizedBlockNumber:number;finalizedBlockHash:string;confirmations:number;
  originalActionVerified:false;transactionSent:false;
}
export function verifyNonceCancellation(provider:Provider,plan:{chainId:number;from:string;nonce:number},transactionHash:string):Promise<NonceCancellationProof>;

import { AbiCoder, Contract, Interface, ZeroAddress, getAddress, getCreateAddress, keccak256, toUtf8Bytes, zeroPadValue, toBeHex } from 'ethers';

const HASH=/^0x[0-9a-f]{64}$/;
const CONFIG_KEYS=['name','symbol','seriesSize','royaltyBps','owner','minter','royaltyRecipient'];
export class LaunchError extends Error {
  constructor(code){super('Launch check stopped: '+code+'. No transaction is automatically retried.');this.name='LaunchError';this.code=code;}
}
export const stop=code=>{throw new LaunchError(code);};
export function exact(value,keys){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length)stop('INVALID_INPUT');
  for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!('value' in d)||!d.enumerable)stop('INVALID_INPUT');}
  return value;
}
export function digest(value){if(typeof value!=='string'||!HASH.test(value)||/^0x0+$/.test(value))stop('INVALID_HASH');return value;}
export function address(value){try{const a=getAddress(value);if(a===ZeroAddress)stop('INVALID_ADDRESS');return a;}catch{stop('INVALID_ADDRESS');}}
export function chain(value){if(![1,11155111,31337].includes(value))stop('WRONG_CHAIN');return value;}
function uint(value,allowZero=false){
  if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(value)||BigInt(value)>=(1n<<256n)||(!allowZero&&value==='0'))stop('INVALID_UINT');return value;
}
function label(value,max){if(typeof value!=='string'||!value.trim()||toUtf8Bytes(value).length>max||/[\u0000-\u001f\u007f]/u.test(value))stop('INVALID_TEXT');return value;}
export function collectionConfig(value){
  exact(value,CONFIG_KEYS);
  const result={name:label(value.name,120),symbol:label(value.symbol,16),seriesSize:uint(value.seriesSize),royaltyBps:uint(value.royaltyBps,true),
    owner:address(value.owner),minter:address(value.minter),royaltyRecipient:address(value.royaltyRecipient)};
  if(BigInt(result.royaltyBps)>10000n)stop('INVALID_ROYALTY');return Object.freeze(result);
}
/** Patch compiler-declared immutable locations using the reviewed constructor values. Never learn a trust anchor from RPC. */
export function expectedRuntime(artifact,config){
  const values={SERIES_SIZE:config.seriesSize,CREATOR_ROYALTY_BPS:config.royaltyBps,MINTER:config.minter,ROYALTY_RECIPIENT:config.royaltyRecipient};
  if(!artifact||!/^0x(?:[a-f0-9]{2})+$/i.test(artifact.deployedBytecode)||!artifact.immutables||
    Object.keys(artifact.immutables).sort().join(',')!==Object.keys(values).sort().join(','))stop('INVALID_ARTIFACT');
  const bytes=artifact.deployedBytecode.slice(2).split('');const used=new Set();
  for(const [name,references] of Object.entries(artifact.immutables)){
    if(!Array.isArray(references)||!references.length)stop('INVALID_ARTIFACT');
    const replacement=zeroPadValue(toBeHex(BigInt(values[name])),32).slice(2);
    for(const {start,length} of references){
      if(!Number.isSafeInteger(start)||start<0||length!==32||(start+length)*2>bytes.length)stop('INVALID_ARTIFACT');
      for(let i=start*2;i<(start+length)*2;i++){if(used.has(i))stop('INVALID_ARTIFACT');used.add(i);bytes[i]=replacement[i-start*2];}
    }
  }
  return '0x'+bytes.join('');
}
/** Chain-independent constructor bytes for read-only multi-call simulation. */
export function prepareCollectionCreation(artifact,input,{requester,nonce}){
  const config=collectionConfig(input);requester=address(requester);
  if(!Number.isSafeInteger(nonce)||nonce<0)stop('INVALID_NONCE');
  if(!/^0x(?:[a-f0-9]{2})+$/i.test(artifact?.bytecode)||!Array.isArray(artifact.abi))stop('INVALID_ARTIFACT');
  const data=artifact.bytecode+new Interface(artifact.abi).encodeDeploy(CONFIG_KEYS.map(key=>config[key])).slice(2);
  const collection=getCreateAddress({from:requester,nonce}),runtime=expectedRuntime(artifact,config);
  return Object.freeze({from:requester,to:null,data,value:'0x0',nonce,
    expected:Object.freeze({collection,config,runtimeCodeHash:keccak256(runtime)}),runtime});
}
export function prepareCollectionDeployment(artifact,input,{chainId,requester,nonce}){
  chain(chainId);const creation=prepareCollectionCreation(artifact,input,{requester,nonce});
  const intentId=keccak256(AbiCoder.defaultAbiCoder().encode(['string','uint256','address','uint256','bytes32'],['nft-console.direct-deploy.v1',chainId,creation.from,nonce,keccak256(creation.data)]));
  return Object.freeze({version:1,kind:'deploy',intentId,chainId,...creation});
}
export async function anchor(provider,chainId){
  if((await provider.getNetwork()).chainId!==BigInt(chain(chainId)))stop('WRONG_CHAIN');
  const block=await provider.getBlock('latest');
  if(!block||!Number.isSafeInteger(block.number)||block.number<0)stop('INVALID_BLOCK');digest(block.hash);
  return {number:block.number,hash:block.hash};
}
export async function canonical(provider,chainId,block){
  if((await provider.getBlock(block.number))?.hash!==block.hash||(await provider.getNetwork()).chainId!==BigInt(chainId))stop('CHAIN_REORG');
}
export async function verifyCollection(provider,expected,chainId,blockTag='latest'){
  const {collection,config,runtimeCodeHash}=expected;
  if(keccak256(await provider.getCode(collection,blockTag))!==digest(runtimeCodeHash))stop('BYTECODE_MISMATCH');
  const c=new Contract(collection,[
    'function owner() view returns(address)','function MINTER() view returns(address)',
    'function SERIES_SIZE() view returns(uint256)','function CREATOR_ROYALTY_BPS() view returns(uint96)',
    'function ROYALTY_RECIPIENT() view returns(address)','function name() view returns(string)',
    'function symbol() view returns(string)','function royaltyInfo(uint256,uint256) view returns(address,uint256)',
  ],provider),o={blockTag};
  const v=await Promise.all([c.name(o),c.symbol(o),c.SERIES_SIZE(o),c.CREATOR_ROYALTY_BPS(o),c.owner(o),c.MINTER(o),c.ROYALTY_RECIPIENT(o)]);
  if(v.some((x,i)=>String(x)!==String(config[CONFIG_KEYS[i]])))stop('CONFIG_MISMATCH');
  const royalty=await c.royaltyInfo(1n,10000n,o);
  if(royalty[0]!==config.royaltyRecipient||royalty[1]!==BigInt(config.royaltyBps))stop('ROYALTY_MISMATCH');
  if((await provider.getNetwork()).chainId!==BigInt(chainId))stop('WRONG_CHAIN');
  return {collection,runtimeCodeHash,config,bytecodeVerified:true,royaltyVerified:true};
}
export async function simulateDeployment(provider,plan){
  const block=await anchor(provider,plan.chainId);
  if(await provider.getCode(plan.from,block.number)!=='0x')stop('EOA_REQUIRED');
  if(await provider.getCode(plan.expected.collection,block.number)!=='0x')stop('ALREADY_DEPLOYED');
  if(await provider.getTransactionCount(plan.from,'pending')!==plan.nonce)stop('NONCE_CHANGED');
  const output=await provider.call({from:plan.from,data:plan.data,value:0n,blockTag:block.number});
  if(output!==plan.runtime)stop('CONSTRUCTOR_SIMULATION_MISMATCH');
  const gas=await provider.estimateGas({from:plan.from,data:plan.data,value:0n});
  await canonical(provider,plan.chainId,block);
  return {blockNumber:block.number,blockHash:block.hash,gas:String(gas),bytecodeSimulated:true};
}
/** Verify a specific signed transaction, its canonical inclusion, then all immutable collection fields. */
export async function verifyDeploymentReceipt(provider,plan,hash,{minConfirmations=2}={}){
  digest(hash);if(!Number.isSafeInteger(minConfirmations)||minConfirmations<1||minConfirmations>256)stop('INVALID_CONFIRMATIONS');
  const head=await anchor(provider,plan.chainId);
  const [tx,r]=await Promise.all([provider.getTransaction(hash),provider.getTransactionReceipt(hash)]);
  if(!tx||!r)stop('PENDING_OR_UNKNOWN');
  if(r.status!==1)stop('TRANSACTION_REVERTED');
  if(tx.hash!==hash||r.hash!==hash||tx.chainId!==BigInt(plan.chainId)||tx.from!==plan.from||r.from!==plan.from||tx.to!==null||r.to!==null||
     tx.data!==plan.data||tx.value!==0n||tx.nonce!==plan.nonce||![0,1,2].includes(tx.type)||tx.authorizationList?.length||tx.blobVersionedHashes?.length||
     r.contractAddress!==plan.expected.collection||tx.blockHash!==r.blockHash||tx.blockNumber!==r.blockNumber)stop('TRANSACTION_MISMATCH');
  const confirmations=head.number-r.blockNumber+1;if(confirmations<minConfirmations)stop('INSUFFICIENT_CONFIRMATIONS');
  const block=await provider.getBlock(r.blockNumber);
  if(!block||block.hash!==r.blockHash||!block.transactions.includes(hash))stop('CHAIN_REORG');
  const verified=await verifyCollection(provider,plan.expected,plan.chainId,r.blockNumber);
  await canonical(provider,plan.chainId,{number:r.blockNumber,hash:r.blockHash});
  return {...verified,status:'deployment-verified',transactionHash:hash,blockNumber:r.blockNumber,blockHash:r.blockHash,confirmations,listingVerified:false};
}

export function mintActionId(batchId,nonce){
  digest(batchId);if(!Number.isSafeInteger(nonce)||nonce<0)stop('INVALID_NONCE');
  return keccak256(AbiCoder.defaultAbiCoder().encode(['string','bytes32','uint256'],['nft-console.public-mint.v1',batchId,nonce]));
}
/** A confirmed revert consumed its nonce but did not perform the intended action. Retain evidence without trapping all later operations. */
export async function verifyFailedTransaction(provider,plan,hash,{minConfirmations=2}={}){
  digest(hash);const head=await anchor(provider,plan.chainId);
  if(!Number.isSafeInteger(minConfirmations)||minConfirmations<1||minConfirmations>256)stop('INVALID_CONFIRMATIONS');
  const [tx,r]=await Promise.all([provider.getTransaction(hash),provider.getTransactionReceipt(hash)]);
  if(!tx||!r)stop('PENDING_OR_UNKNOWN');
  if(r.status!==0||tx.hash!==hash||r.hash!==hash||tx.chainId!==BigInt(plan.chainId)||tx.from!==plan.from||r.from!==plan.from||
    tx.to!==plan.to||r.to!==plan.to||tx.data!==plan.data||tx.value!==0n||tx.nonce!==plan.nonce||![0,1,2].includes(tx.type)||
    tx.authorizationList?.length||tx.blobVersionedHashes?.length||tx.blockHash!==r.blockHash||tx.blockNumber!==r.blockNumber)stop('TRANSACTION_MISMATCH');
  const confirmations=head.number-r.blockNumber+1;if(confirmations<minConfirmations)stop('INSUFFICIENT_CONFIRMATIONS');
  const block=await provider.getBlock(r.blockNumber);if(!block||block.hash!==r.blockHash||!block.transactions.includes(hash))stop('CHAIN_REORG');
  await canonical(provider,plan.chainId,{number:r.blockNumber,hash:r.blockHash});
  return {blockNumber:r.blockNumber,blockHash:r.blockHash,confirmations,failed:true};
}

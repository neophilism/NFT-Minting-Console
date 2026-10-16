import {Interface,ZeroAddress,getAddress,toQuantity,formatEther,keccak256} from 'ethers';
import {exact,address,collectionConfig,prepareCollectionCreation,digest,stop,LaunchError} from './contracts.mjs';
import {prepareMintWorks,MINT_ABI,MintCheckError} from '../chain/mint.mjs';
import {launchFeeBudget,LAUNCH_FEE_LIMITS} from './fees.mjs';
const DEFAULT_VALIDATOR=getAddress('0x721C008fdff27BF06E7E123956E2Fe03B63342e3');
const quantity=value=>{
  if(typeof value!=='string'||!/^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/.test(value))stop('INVALID_SIMULATION_QUANTITY');
  return BigInt(value);
};
const bytes=value=>{if(typeof value!=='string'||value.length>131074||!/^0x(?:[a-f0-9]{2})*$/i.test(value))stop('INVALID_SIMULATION_BYTES');return value.toLowerCase();};
function success(call){
  if(!call||call.status!=='0x1'||call.error!==undefined||!Array.isArray(call.logs)||call.logs.length>256)stop('SIMULATED_CALL_FAILED');
  bytes(call.returnData);return call;
}
function peak(call,cap){
  success(call);if(call.maxUsedGas===undefined)stop('PEAK_GAS_REQUIRED');const used=quantity(call.gasUsed),maximum=quantity(call.maxUsedGas);
  if(used<21000n||maximum<used||maximum>cap)stop('PEAK_GAS_REQUIRED');
  return maximum;
}
function validateMintLogs(call,creation,works){
  const iface=new Interface(MINT_ABI),topics=['Transfer','WorkMinted'].map(name=>iface.getEvent(name).topicHash);
  const selected=[];let previous=-1n;
  for(const log of call.logs){
    if(typeof log.address!=='string'||log.address.toLowerCase()!==creation.expected.collection.toLowerCase())continue;
    if(!Array.isArray(log.topics)||!topics.includes(log.topics[0]?.toLowerCase()))continue;
    if(log.removed!==undefined&&log.removed!==false)stop('SIMULATED_LOGS_MISMATCH');
    const index=quantity(log.logIndex);if(index<=previous)stop('SIMULATED_LOGS_MISMATCH');previous=index;
    let event;try{event=iface.parseLog(log);}catch{stop('SIMULATED_LOGS_MISMATCH');}selected.push(event);
  }
  if(selected.length!==works.length*2)stop('SIMULATED_LOGS_MISMATCH');
  for(let i=0;i<works.length;i++){
    const w=works[i],t=selected[i*2],m=selected[i*2+1];
    if(t?.name!=='Transfer'||t.args[0]!==ZeroAddress||t.args[1]!==creation.expected.config.minter||t.args[2]!==BigInt(w.tokenId)||
      m?.name!=='WorkMinted'||m.args[0]!==BigInt(w.tokenId)||m.args[1]!==w.title||m.args[2]!==w.metadataURI||
      m.args[3]!==w.mediaHash||m.args[4]!==w.rightsURI||m.args[5]!==w.rightsHash)stop('SIMULATED_LOGS_MISMATCH');
  }
}
/** Uses only read-only RPC methods. Virtual transactions/hashes are never live receipt evidence. */
export async function inspectCombinedBudget(provider,artifact,request,workInputs,chainId){
  exact(request,['version','wallet','collection']);if(request.version!==1)stop('INVALID_INPUT');
  if(!Number.isSafeInteger(chainId)||chainId<1)stop('WRONG_CHAIN');
  const config=collectionConfig(request.collection),wallet=address(request.wallet),mint=prepareMintWorks(workInputs);
  if(mint.works.some(w=>BigInt(w.tokenId)>BigInt(config.seriesSize)))stop('TOKEN_OUTSIDE_SUPPLY');
  if((await provider.getNetwork()).chainId!==BigInt(chainId))stop('WRONG_CHAIN');
  const block=await provider.getBlock('latest');
  if(!block||!Number.isSafeInteger(block.number)||block.number<0||typeof block.gasLimit!=='bigint')stop('INVALID_BLOCK');digest(block.hash);
  const cap=block.gasLimit<LAUNCH_FEE_LIMITS.maximumGas?block.gasLimit:LAUNCH_FEE_LIMITS.maximumGas;
  if(cap<21000n)stop('INVALID_BLOCK');
  const wallets=[];
  for(const account of [...new Set([wallet,config.minter])]){
    const [code,nonce,pendingNonce,balance,pendingBalance]=await Promise.all([
      provider.getCode(account,block.number),provider.getTransactionCount(account,block.number),provider.getTransactionCount(account,'pending'),
      provider.getBalance(account,block.number),provider.getBalance(account,'pending')]);
    if(code!=='0x')stop('EOA_REQUIRED');
    if(!Number.isSafeInteger(nonce)||nonce<0||nonce>Number.MAX_SAFE_INTEGER-100||pendingNonce!==nonce)stop('PENDING_WALLET_ACTIVITY');
    if(typeof balance!=='bigint'||balance<0n||balance>=(1n<<256n)||pendingBalance!==balance)stop('PENDING_WALLET_ACTIVITY');
    wallets.push({wallet:account,nonce,balance});
  }
  const nonceOf=account=>wallets.find(w=>w.wallet===account).nonce;
  const creation=prepareCollectionCreation(artifact,config,{requester:wallet,nonce:nonceOf(wallet)});
  if(await provider.getCode(creation.expected.collection,block.number)!=='0x')stop('ALREADY_DEPLOYED');
  const price=quantity(await provider.send('eth_gasPrice',[]));
  if(price<1n||price>LAUNCH_FEE_LIMITS.maximumGasPrice)stop('FEE_POLICY_EXCEEDED');
  const iface=new Interface(artifact.abi),views=[];
  const view=(name,args,expected)=>views.push({name,args,expected:iface.encodeFunctionResult(name,expected)});
  for(const [name,value] of [['owner',config.owner],['MINTER',config.minter],['SERIES_SIZE',config.seriesSize],['CREATOR_ROYALTY_BPS',config.royaltyBps],
    ['ROYALTY_RECIPIENT',config.royaltyRecipient],['name',config.name],['symbol',config.symbol]])view(name,[],[value]);
  view('royaltyInfo',[1n,10000n],[config.royaltyRecipient,config.royaltyBps]);
  view('totalMinted',[],[mint.works.length]);
  view('mintingClosed',[],[BigInt(mint.works.length)===BigInt(config.seriesSize)]);
  for(const w of mint.works)for(const [name,value] of [['workTitle',w.title],['tokenURI',w.metadataURI],['mediaSHA256',w.mediaHash],['rightsURI',w.rightsURI],['rightsSHA256',w.rightsHash],['ownerOf',config.minter]])view(name,[w.tokenId],[value]);
  views.push({name:'getTransferValidator',args:[],expected:null});
  const mintNonce=nonceOf(config.minter)+(config.minter===wallet?1:0);
  const tx=(from,nonce,data,to,gas)=>({from,nonce:toQuantity(nonce),input:data,...(to?{to}:{}),value:'0x0',gas:toQuantity(gas),gasPrice:toQuantity(price)});
  const payload={validation:true,traceTransfers:false,returnFullTransactions:false,blockStateCalls:[
    {stateOverrides:Object.fromEntries(wallets.map(w=>[w.wallet,{balance:toQuantity(10n**24n)}])),
      calls:[tx(wallet,creation.nonce,creation.data,null,cap)]},
    {calls:[tx(config.minter,mintNonce,mint.data,creation.expected.collection,cap),
      ...views.map((v,i)=>tx(config.minter,mintNonce+1+i,iface.encodeFunctionData(v.name,v.args),creation.expected.collection,300000n))]}
  ]};
  let simulated;
  try{simulated=await provider.send('eth_simulateV1',[payload,toQuantity(block.number)]);}
  catch{stop('COMBINED_SIMULATION_UNAVAILABLE');}
  if(!Array.isArray(simulated)||simulated.length!==2||simulated[0]?.parentHash!==block.hash||
    simulated[1]?.parentHash!==simulated[0]?.hash||quantity(simulated[0]?.number)!==BigInt(block.number)+1n||
    quantity(simulated[1]?.number)!==BigInt(block.number)+2n||!Array.isArray(simulated[0]?.calls)||simulated[0].calls.length!==1||
    !Array.isArray(simulated[1]?.calls)||simulated[1].calls.length!==views.length+1)stop('INVALID_SIMULATION_RESULT');
  digest(simulated[0].hash);digest(simulated[1].hash);
  const deployed=success(simulated[0].calls[0]),minted=success(simulated[1].calls[0]);
  if(bytes(deployed.returnData)!==creation.runtime.toLowerCase()||bytes(minted.returnData)!=='0x')stop('SIMULATED_DEPLOYMENT_MISMATCH');
  validateMintLogs(minted,creation,mint.works);
  let validator;
  for(let i=0;i<views.length;i++){
    const actual=success(simulated[1].calls[i+1]);if(actual.logs.length)stop('SIMULATED_READBACK_MISMATCH');
    if(views[i].expected!==null){if(bytes(actual.returnData)!==views[i].expected.toLowerCase())stop('SIMULATED_READBACK_MISMATCH');}
    else{try{validator=address(iface.decodeFunctionResult('getTransferValidator',actual.returnData)[0]);if(bytes(actual.returnData)!==iface.encodeFunctionResult('getTransferValidator',[validator]).toLowerCase())stop('INVALID_VALIDATOR');}catch{stop('INVALID_VALIDATOR');}}
  }
  if(validator!==DEFAULT_VALIDATOR)stop('INVALID_VALIDATOR');
  const validatorCode=await provider.getCode(validator,block.number);bytes(validatorCode);const validatorContractPresent=validatorCode!=='0x';
  const operations=[['deploy',wallet,deployed,creation.data],['first-mint',config.minter,minted,mint.data]].map(([kind,from,call,data])=>{
    const maximum=peak(call,cap),fee=launchFeeBudget(maximum,price,0n);
    return {kind,wallet:from,gasUsed:quantity(call.gasUsed).toString(),peakGas:maximum.toString(),gasLimit:fee.gasLimit,gasPriceWei:fee.gasPrice,
      maximumCostWei:fee.maximumCostWei,withinLimits:fee.withinLimits&&BigInt(fee.gasLimit)<=cap,calldataHash:keccak256(data)};
  });
  const funding=wallets.map(w=>{
    const selected=operations.filter(op=>op.wallet===w.wallet),required=selected.reduce((n,op)=>n+BigInt(op.maximumCostWei),0n),additional=required>w.balance?required-w.balance:0n;
    return {wallet:getAddress(w.wallet),operations:selected.map(op=>op.kind),balanceWei:w.balance.toString(),maximumCostWei:required.toString(),
      additionalWei:additional.toString(),additionalEth:formatEther(additional),funded:w.balance>=required};
  });
  if((await provider.getBlock(block.number))?.hash!==block.hash||(await provider.getNetwork()).chainId!==BigInt(chainId))stop('CHAIN_REORG');
  for(const w of wallets)if(await provider.getTransactionCount(w.wallet,'pending')!==w.nonce||await provider.getBalance(w.wallet,'pending')!==w.balance)stop('WALLET_CHANGED_DURING_SIMULATION');
  return {version:1,readOnly:true,method:'eth_simulateV1',chainId,observedBlock:block.number,observedBlockHash:block.hash,
    predictedCollection:creation.expected.collection,deploymentNonce:creation.nonce,firstMintNonce:mintNonce,tokenIds:mint.works.map(w=>w.tokenId),
    constructorRuntimeMatched:true,simulatedMintEventsMatched:true,simulatedImmutableReadbackMatched:true,sourceWalletStateUnchanged:true,
    operations,funding,totalMaximumCostWei:operations.reduce((n,op)=>n+BigInt(op.maximumCostWei),0n).toString(),
    totalAdditionalWei:funding.reduce((n,w)=>n+BigInt(w.additionalWei),0n).toString(),totalAdditionalEth:formatEther(funding.reduce((n,w)=>n+BigInt(w.additionalWei),0n)),
    feeCapsWithinLimits:operations.every(op=>op.withinLimits),signingWalletsFunded:funding.every(w=>w.funded),
    validator,validatorContractPresent,validatorPolicyVerified:false,publicFilesVerified:false,readyForFundingReview:false,
    transactionSent:false,mintingVerified:false,listingVerified:false,walletOwnershipVerified:false,estimateIsTimeSensitive:true,
    scope:'One new collection and its first batch of up to ten works. Policy changes, approvals, listings, later batches and exchange/bridge costs are excluded.'};
}
export function budgetErrorCode(error){return error instanceof LaunchError||error instanceof MintCheckError?error.code:'BUDGET_VERIFICATION_UNAVAILABLE';}

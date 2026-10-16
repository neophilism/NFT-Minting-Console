import {Contract,Interface,ZeroAddress,getAddress,toQuantity,formatEther,keccak256,hexlify,randomBytes} from 'ethers';
import {exact,address,collectionConfig,prepareCollectionCreation,verifyCollection,digest,stop,LaunchError} from './contracts.mjs';
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
/** Read-only simulation only. Existing plans come from the authorized journal, never client-supplied bytecode. */
export async function inspectCombinedBudget(provider,artifact,request,workInputs,chainId,{existing=null,signal}={}){
  const check=()=>{if(signal?.aborted)stop('QUOTE_CANCELLED');};check();
  exact(request,['version','wallet','collection']);if(request.version!==1)stop('INVALID_INPUT');
  if(!Number.isSafeInteger(chainId)||chainId<1)stop('WRONG_CHAIN');
  if(!Array.isArray(workInputs)||Object.getPrototypeOf(workInputs)!==Array.prototype||workInputs.length<1||workInputs.length>500||
    Reflect.ownKeys(workInputs).length!==workInputs.length+1)stop('INVALID_BATCH');
  for(let i=0;i<workInputs.length;i++){
    const descriptor=Object.getOwnPropertyDescriptor(workInputs,String(i));
    if(!descriptor||!('value' in descriptor)||!descriptor.enumerable)stop('INVALID_BATCH');
  }
  const config=collectionConfig(request.collection),wallet=address(request.wallet),mints=[];
  if(existing&&(existing.kind!=='deploy'||existing.chainId!==chainId||wallet!==config.minter))stop('DEPLOYMENT_REQUIRED');
  for(let i=0;i<workInputs.length;i+=10)mints.push(prepareMintWorks(workInputs.slice(i,i+10)));
  const works=mints.flatMap(mint=>mint.works);
  if(new Set(works.map(w=>w.tokenId)).size!==works.length)stop('DUPLICATE_TOKEN_ID');
  if(works.some(w=>BigInt(w.tokenId)>BigInt(config.seriesSize)))stop('TOKEN_OUTSIDE_SUPPLY');
  if((await provider.getNetwork()).chainId!==BigInt(chainId))stop('WRONG_CHAIN');
  const block=await provider.getBlock('latest');
  if(!block||!Number.isSafeInteger(block.number)||block.number<0||typeof block.gasLimit!=='bigint')stop('INVALID_BLOCK');digest(block.hash);
  const cap=block.gasLimit<LAUNCH_FEE_LIMITS.maximumGas?block.gasLimit:LAUNCH_FEE_LIMITS.maximumGas;
  if(cap<21000n)stop('INVALID_BLOCK');
  const wallets=[];
  for(const account of [...new Set(existing?[config.minter]:[wallet,config.minter])]){
    check();const [code,nonce,pendingNonce,balance,pendingBalance]=await Promise.all([
      provider.getCode(account,block.number),provider.getTransactionCount(account,block.number),provider.getTransactionCount(account,'pending'),
      provider.getBalance(account,block.number),provider.getBalance(account,'pending')]);
    if(code!=='0x')stop('EOA_REQUIRED');
    if(!Number.isSafeInteger(nonce)||nonce<0||nonce>Number.MAX_SAFE_INTEGER-100||pendingNonce!==nonce)stop('PENDING_WALLET_ACTIVITY');
    if(typeof balance!=='bigint'||balance<0n||balance>=(1n<<256n)||pendingBalance!==balance)stop('PENDING_WALLET_ACTIVITY');
    wallets.push({wallet:account,nonce,balance});
  }
  const nonceOf=account=>wallets.find(w=>w.wallet===account).nonce;
  const creation=prepareCollectionCreation(artifact,config,{requester:existing?existing.from:wallet,nonce:existing?existing.nonce:nonceOf(wallet)});
  let previouslyMinted=0n;
  if(existing){
    if(existing.data!==creation.data||existing.expected?.collection!==creation.expected.collection||existing.expected?.runtimeCodeHash!==creation.expected.runtimeCodeHash)stop('DEPLOYMENT_MISMATCH');
    await verifyCollection(provider,creation.expected,chainId,block.number);
    const c=new Contract(creation.expected.collection,artifact.abi,provider);
    previouslyMinted=await c.totalMinted({blockTag:block.number});
    if(typeof previouslyMinted!=='bigint'||previouslyMinted<0n||previouslyMinted+BigInt(works.length)>BigInt(config.seriesSize)||await c.mintingClosed({blockTag:block.number}))stop('SUPPLY_UNAVAILABLE');
  }else if(await provider.getCode(creation.expected.collection,block.number)!=='0x')stop('ALREADY_DEPLOYED');
  const price=quantity(await provider.send('eth_gasPrice',[]));
  if(price<1n||price>LAUNCH_FEE_LIMITS.maximumGasPrice)stop('FEE_POLICY_EXCEEDED');
  const reader=getAddress(hexlify(randomBytes(20)));
  if([wallet,config.minter,creation.expected.collection,DEFAULT_VALIDATOR,ZeroAddress].includes(reader))stop('SIMULATION_READER_COLLISION');
  const [readerCode,readerNonce,readerBalance]=await Promise.all([
    provider.getCode(reader,block.number),provider.getTransactionCount(reader,block.number),provider.getBalance(reader,block.number)]);
  if(readerCode!=='0x'||!Number.isSafeInteger(readerNonce)||readerNonce<0||readerNonce>Number.MAX_SAFE_INTEGER-5000||
    typeof readerBalance!=='bigint'||readerBalance<0n||readerBalance>=(1n<<256n))stop('INVALID_SIMULATION_READER');
  const iface=new Interface(artifact.abi),batchViews=[],offset=existing?0:1;
  let mintedCount=previouslyMinted,readNonce=readerNonce;
  const firstMintNonce=nonceOf(config.minter)+(!existing&&config.minter===wallet?1:0);
  const tx=(from,nonce,data,to,gas)=>({from,nonce:toQuantity(nonce),input:data,...(to?{to}:{}),value:'0x0',gas:toQuantity(gas),gasPrice:toQuantity(price)});
  const overrides=Object.fromEntries([...wallets.map(w=>[w.wallet,{balance:toQuantity(10n**24n)}]),[reader,{balance:toQuantity(10n**24n)}]]);
  const blockStateCalls=existing?[]:[{calls:[tx(wallet,creation.nonce,creation.data,null,cap)]}];
  for(let batchIndex=0;batchIndex<mints.length;batchIndex++){
    check();const mint=mints[batchIndex],views=[];
    const view=(name,args,expected)=>views.push({name,args,expected:iface.encodeFunctionResult(name,expected)});
    for(const [name,value] of [['owner',config.owner],['MINTER',config.minter],['SERIES_SIZE',config.seriesSize],['CREATOR_ROYALTY_BPS',config.royaltyBps],
      ['ROYALTY_RECIPIENT',config.royaltyRecipient],['name',config.name],['symbol',config.symbol]])view(name,[],[value]);
    view('royaltyInfo',[mint.works[0].tokenId,10000n],[config.royaltyRecipient,config.royaltyBps]);
    mintedCount+=BigInt(mint.works.length);view('totalMinted',[],[mintedCount]);
    view('mintingClosed',[],[mintedCount===BigInt(config.seriesSize)]);
    for(const w of mint.works)for(const [name,value] of [['workTitle',w.title],['tokenURI',w.metadataURI],['mediaSHA256',w.mediaHash],['rightsURI',w.rightsURI],['rightsSHA256',w.rightsHash],['ownerOf',config.minter]])view(name,[w.tokenId],[value]);
    views.push({name:'getTransferValidator',args:[],expected:null});batchViews.push(views);
    blockStateCalls.push({calls:[tx(config.minter,firstMintNonce+batchIndex,mint.data,creation.expected.collection,cap),
      ...views.map(v=>tx(reader,readNonce++,iface.encodeFunctionData(v.name,v.args),creation.expected.collection,300000n))]});
  }
  blockStateCalls[0].stateOverrides=overrides;
  const payload={validation:true,traceTransfers:false,returnFullTransactions:false,blockStateCalls};
  let simulated;check();
  try{simulated=await provider.send('eth_simulateV1',[payload,toQuantity(block.number)]);}
  catch{stop('COMBINED_SIMULATION_UNAVAILABLE');}check();
  if(!Array.isArray(simulated)||simulated.length!==mints.length+offset)stop('INVALID_SIMULATION_RESULT');
  const virtualHashes=new Set();
  for(let i=0;i<simulated.length;i++){
    const virtual=simulated[i],expectedCalls=!existing&&i===0?1:batchViews[i-offset].length+1;
    if(virtual?.parentHash!==(i===0?block.hash:simulated[i-1].hash)||quantity(virtual?.number)!==BigInt(block.number)+BigInt(i)+1n||
      !Array.isArray(virtual?.calls)||virtual.calls.length!==expectedCalls)stop('INVALID_SIMULATION_RESULT');
    digest(virtual.hash);if(virtualHashes.has(virtual.hash))stop('INVALID_SIMULATION_RESULT');virtualHashes.add(virtual.hash);
  }
  const operation=(kind,from,call,data,tokenIds=[])=>{
    const maximum=peak(call,cap),fee=launchFeeBudget(maximum,price,0n),gasUsed=quantity(call.gasUsed);
    return {kind,wallet:from,tokenIds,gasUsed:gasUsed.toString(),peakGas:maximum.toString(),gasLimit:fee.gasLimit,gasPriceWei:fee.gasPrice,
      estimatedCostWei:(gasUsed*price).toString(),maximumCostWei:fee.maximumCostWei,withinLimits:fee.withinLimits&&BigInt(fee.gasLimit)<=cap,calldataHash:keccak256(data)};
  };
  const operations=[];
  if(!existing){const deployed=success(simulated[0].calls[0]);if(bytes(deployed.returnData)!==creation.runtime.toLowerCase())stop('SIMULATED_DEPLOYMENT_MISMATCH');operations.push(operation('deploy',wallet,deployed,creation.data));}
  for(let batchIndex=0;batchIndex<mints.length;batchIndex++){
    const mint=mints[batchIndex],minted=success(simulated[batchIndex+offset].calls[0]),views=batchViews[batchIndex];
    if(bytes(minted.returnData)!=='0x')stop('SIMULATED_DEPLOYMENT_MISMATCH');
    validateMintLogs(minted,creation,mint.works);
    for(let i=0;i<views.length;i++){
      const actual=success(simulated[batchIndex+offset].calls[i+1]);if(actual.logs.length)stop('SIMULATED_READBACK_MISMATCH');
      if(views[i].expected!==null){if(bytes(actual.returnData)!==views[i].expected.toLowerCase())stop('SIMULATED_READBACK_MISMATCH');}
      else{
        let observedValidator;try{observedValidator=address(iface.decodeFunctionResult('getTransferValidator',actual.returnData)[0]);}catch{stop('INVALID_VALIDATOR');}
        if(observedValidator!==DEFAULT_VALIDATOR||bytes(actual.returnData)!==iface.encodeFunctionResult('getTransferValidator',[DEFAULT_VALIDATOR]).toLowerCase())stop('INVALID_VALIDATOR');
      }
    }
    operations.push(operation(batchIndex===0?'first-mint':'mint-batch-'+(batchIndex+1),config.minter,minted,mint.data,mint.works.map(w=>w.tokenId)));
  }
  const validator=DEFAULT_VALIDATOR,validatorCode=await provider.getCode(validator,block.number);bytes(validatorCode);const validatorContractPresent=validatorCode!=='0x';
  const funding=wallets.map(w=>{
    const selected=operations.filter(op=>op.wallet===w.wallet),required=selected.reduce((n,op)=>n+BigInt(op.maximumCostWei),0n),additional=required>w.balance?required-w.balance:0n;
    return {wallet:getAddress(w.wallet),operations:selected.map(op=>op.kind),balanceWei:w.balance.toString(),maximumCostWei:required.toString(),
      additionalWei:additional.toString(),additionalEth:formatEther(additional),funded:w.balance>=required};
  });
  check();if((await provider.getBlock(block.number))?.hash!==block.hash||(await provider.getNetwork()).chainId!==BigInt(chainId))stop('CHAIN_REORG');
  for(const w of wallets)if(await provider.getTransactionCount(w.wallet,'pending')!==w.nonce||await provider.getBalance(w.wallet,'pending')!==w.balance)stop('WALLET_CHANGED_DURING_SIMULATION');
  if(await provider.getTransactionCount(reader,'pending')!==readerNonce||await provider.getBalance(reader,'pending')!==readerBalance)stop('WALLET_CHANGED_DURING_SIMULATION');
  check();return {version:1,readOnly:true,method:'eth_simulateV1',chainId,observedBlock:block.number,observedBlockHash:block.hash,
    mode:existing?'existing':'new',previouslyMinted:previouslyMinted.toString(),predictedCollection:creation.expected.collection,deploymentNonce:existing?null:creation.nonce,firstMintNonce,mintBatchCount:mints.length,suppliedWorkCount:works.length,seriesSize:config.seriesSize,entireSeriesIncluded:BigInt(works.length)===BigInt(config.seriesSize),allRemainingSupplyIncluded:previouslyMinted+BigInt(works.length)===BigInt(config.seriesSize),simulationReader:reader,tokenIds:works.map(w=>w.tokenId),
    constructorRuntimeMatched:true,simulatedMintEventsMatched:true,simulatedImmutableReadbackMatched:true,sourceWalletStateUnchanged:true,
    operations,funding,totalEstimatedCostWei:operations.reduce((n,op)=>n+BigInt(op.estimatedCostWei),0n).toString(),totalMaximumCostWei:operations.reduce((n,op)=>n+BigInt(op.maximumCostWei),0n).toString(),
    totalAdditionalWei:funding.reduce((n,w)=>n+BigInt(w.additionalWei),0n).toString(),totalAdditionalEth:formatEther(funding.reduce((n,w)=>n+BigInt(w.additionalWei),0n)),
    feeCapsWithinLimits:operations.every(op=>op.withinLimits),signingWalletsFunded:funding.every(w=>w.funded),
    validator,validatorContractPresent,validatorPolicyVerified:false,publicFilesVerified:false,readyForFundingReview:false,
    transactionSent:false,mintingVerified:false,listingVerified:false,walletOwnershipVerified:false,estimateIsTimeSensitive:true,
    scope:(existing?'Remaining supplied mint batches only; deployment is already paid.':'One new collection and every supplied work (up to 500), in batches of ten.')+' Policy changes, approvals, listings, unsupplied works, hosting/storage subscriptions and exchange/bridge costs are excluded.'};
}
export function budgetErrorCode(error){return error instanceof LaunchError||error instanceof MintCheckError?error.code:'BUDGET_VERIFICATION_UNAVAILABLE';}

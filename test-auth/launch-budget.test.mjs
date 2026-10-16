import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {Interface,ZeroAddress,toQuantity,getAddress} from 'ethers';
import {loadCollectionArtifact} from '../console/launch/artifacts.mjs';
import {prepareCollectionCreation} from '../console/launch/contracts.mjs';
import {inspectCombinedBudget} from '../console/launch/budget.mjs';
const artifact=loadCollectionArtifact(),iface=new Interface(artifact.abi);
const wallet=getAddress('0x'+'11'.repeat(20)),other=getAddress('0x'+'22'.repeat(20)),validator=getAddress('0x721C008fdff27BF06E7E123956E2Fe03B63342e3');
const block={number:100,hash:'0x'+'ab'.repeat(32),gasLimit:30000000n};
const requestFor=minter=>({version:1,wallet,collection:{name:'Reviewed budget',symbol:'BUD',seriesSize:'2',royaltyBps:'600',owner:wallet,minter,royaltyRecipient:wallet}});
const works=[{tokenId:'1',title:'Exact final title',metadataURI:'ipfs://metadata/1',mediaHash:'0x'+'31'.repeat(32),rightsURI:'ipfs://rights/1',rightsHash:'0x'+'41'.repeat(32)}];
function fixture({separate=false,mutate,changed=false,delegated=false}={}){
  const request=requestFor(separate?other:wallet),creation=prepareCollectionCreation(artifact,request.collection,{requester:wallet,nonce:0}),sent=[];let simulated=false;
  const valueFor=call=>{
    const p=iface.parseTransaction({data:call.input}),name=p.name,tokenId=p.args.length?p.args[0]:null,w=works.find(w=>BigInt(w.tokenId)===tokenId);
    const plain={owner:request.collection.owner,MINTER:request.collection.minter,SERIES_SIZE:request.collection.seriesSize,CREATOR_ROYALTY_BPS:request.collection.royaltyBps,
      ROYALTY_RECIPIENT:request.collection.royaltyRecipient,name:request.collection.name,symbol:request.collection.symbol,totalMinted:works.length,mintingClosed:false,getTransferValidator:validator};
    const fields={workTitle:'title',tokenURI:'metadataURI',mediaSHA256:'mediaHash',rightsURI:'rightsURI',rightsSHA256:'rightsHash'};
    const values=name==='royaltyInfo'?[request.collection.royaltyRecipient,BigInt(request.collection.royaltyBps)*p.args[1]/10000n]:
      name==='ownerOf'?[request.collection.minter]:fields[name]?[w[fields[name]]]:[plain[name]];
    return {status:'0x1',returnData:iface.encodeFunctionResult(name,values),logs:[],gasUsed:'0x6000',maxUsedGas:'0x6000'};
  };
  const provider={
    getNetwork:async()=>({chainId:31337n}),getBlock:async()=>block,
    getCode:async address=>delegated&&address===wallet?'0xef0100'+'01'.repeat(20):address===validator?'0x6000':'0x',
    getTransactionCount:async()=>changed&&simulated?1:0,
    getBalance:async address=>address===wallet?1000000000000000n:2000000000000000n,
    send:async(method,params)=>{
      sent.push(method);if(method==='eth_gasPrice')return '0x77359400';
      assert.equal(method,'eth_simulateV1','No signing or broadcast method is permitted.');
      const [payload,tag]=params;assert.equal(tag,'0x64');assert.equal(payload.validation,true);assert.equal(payload.traceTransfers,false);
      assert.equal(payload.returnFullTransactions,false);assert.equal(payload.blockStateCalls.length,2);
      for(const override of Object.values(payload.blockStateCalls[0].stateOverrides))assert.deepEqual(Object.keys(override),['balance']);
      const create=payload.blockStateCalls[0].calls[0],calls=payload.blockStateCalls[1].calls;
      assert.equal(create.from,wallet);assert.equal(create.input,creation.data);assert.equal(create.to,undefined);assert.equal(create.value,'0x0');assert.equal(create.nonce,'0x0');
      assert.equal(calls[0].from,request.collection.minter);assert.equal(calls[0].to,creation.expected.collection);assert.equal(calls[0].value,'0x0');
      assert.equal(calls[0].nonce,separate?'0x0':'0x1');
      assert.equal(iface.parseTransaction({data:calls[0].input}).name,'mintWorksBatch');
      const logs=[];for(const w of works)for(const [name,args] of [['Transfer',[ZeroAddress,request.collection.minter,BigInt(w.tokenId)]],['WorkMinted',[BigInt(w.tokenId),w.title,w.metadataURI,w.mediaHash,w.rightsURI,w.rightsHash]]]){
        const encoded=iface.encodeEventLog(iface.getEvent(name),args);logs.push({address:creation.expected.collection,topics:encoded.topics,data:encoded.data,logIndex:toQuantity(logs.length),removed:false});
      }
      const h1='0x'+'d1'.repeat(32),h2='0x'+'d2'.repeat(32),response=[
        {number:'0x65',hash:h1,parentHash:block.hash,calls:[{status:'0x1',returnData:creation.runtime,logs:[],gasUsed:toQuantity(1800000),maxUsedGas:toQuantity(2000000)}]},
        {number:'0x66',hash:h2,parentHash:h1,calls:[{status:'0x1',returnData:'0x',logs,gasUsed:toQuantity(300000),maxUsedGas:toQuantity(350000)},...calls.slice(1).map(valueFor)]}
      ];mutate?.(response);simulated=true;return response;
    }
  };return {provider,request,sent};
}
test('combined cap subtracts one shared-wallet balance once and uses peak gas before refunds',async()=>{
  const f=fixture(),r=await inspectCombinedBudget(f.provider,artifact,f.request,works,31337);
  assert.equal(r.funding.length,1);assert.equal(r.suppliedWorkCount,1);assert.equal(r.entireSeriesIncluded,false);assert.equal(r.totalMaximumCostWei,'5640000000000000');assert.equal(r.totalAdditionalWei,'4640000000000000');
  assert.equal(r.operations[0].gasLimit,'2400000');assert.equal(r.operations[1].gasLimit,'420000');
  assert.equal(r.readyForFundingReview,false);assert.equal(r.transactionSent,false);assert.equal(r.validatorPolicyVerified,false);
  assert.deepEqual(f.sent,['eth_gasPrice','eth_simulateV1']);
});
test('distinct deployment/minter wallets keep separate balances and funding shortfalls',async()=>{
  const f=fixture({separate:true}),r=await inspectCombinedBudget(f.provider,artifact,f.request,works,31337);
  assert.equal(r.funding.length,2);assert.equal(r.funding[0].additionalWei,'3800000000000000');assert.equal(r.funding[1].additionalWei,'0');
  assert.equal(r.totalAdditionalWei,'3800000000000000');
});
for(const [name,mutate,code] of [
  ['constructor runtime',r=>{r[0].calls[0].returnData='0x6000';},'SIMULATED_DEPLOYMENT_MISMATCH'],
  ['missing peak gas',r=>{delete r[0].calls[0].maxUsedGas;},'PEAK_GAS_REQUIRED'],
  ['mint logs',r=>{r[1].calls[0].logs=[];},'SIMULATED_LOGS_MISMATCH'],
  ['immutable readback',r=>{r[1].calls[1].returnData=iface.encodeFunctionResult('owner',[other]);},'SIMULATED_READBACK_MISMATCH'],
  ['wrong parent',r=>{r[0].parentHash='0x'+'ff'.repeat(32);},'INVALID_SIMULATION_RESULT'],
  ['failed mint',r=>{r[1].calls[0].status='0x0';},'SIMULATED_CALL_FAILED'],
]){
  test('rejects invalid simulator evidence: '+name,async()=>{const f=fixture({mutate});await assert.rejects(inspectCombinedBudget(f.provider,artifact,f.request,works,31337),e=>e.code===code);});
}
test('pending wallet changes and delegated signers cannot produce a funding quote',async()=>{
  const changed=fixture({changed:true});await assert.rejects(inspectCombinedBudget(changed.provider,artifact,changed.request,works,31337),e=>e.code==='WALLET_CHANGED_DURING_SIMULATION');
  const delegated=fixture({delegated:true});await assert.rejects(inspectCombinedBudget(delegated.provider,artifact,delegated.request,works,31337),e=>e.code==='EOA_REQUIRED');
});
test('CLI configuration failures stay redacted and require no credentials or network call',()=>{
  const r=spawnSync(process.execPath,['scripts/budget-launch.mjs','private-input-never-print.json','private-bundle-never-print.json'],{
    env:{...process.env,CHAIN_ID:'5',RPC_URL:'https://rpc.example/secret-token-never-print'},encoding:'utf8',timeout:5000});
  assert.equal(r.status,1);assert.match(r.stderr,/RPC_CONFIGURATION_REQUIRED/);assert.match(r.stderr,/Usage:/);
  assert.equal((r.stdout+r.stderr).includes('secret-token-never-print'),false);assert.equal((r.stdout+r.stderr).includes('private-input-never-print'),false);
});

test('multiple batches reject duplicate IDs, oversized lists and accessor arrays before any RPC',async()=>{
  const provider={getNetwork:async()=>{throw new Error('Input rejection must precede RPC');}};
  const eleven=Array.from({length:11},(_,i)=>({...works[0],tokenId:String(i+1)})),request=requestFor(wallet);
  const duplicate=[...eleven.slice(0,10),{...eleven[10],tokenId:'1'}];
  await assert.rejects(inspectCombinedBudget(provider,artifact,{...request,collection:{...request.collection,seriesSize:'11'}},duplicate,31337),e=>e.code==='DUPLICATE_TOKEN_ID');
  await assert.rejects(inspectCombinedBudget(provider,artifact,request,Array.from({length:501},()=>works[0]),31337),e=>e.code==='INVALID_BATCH');
  let evaluated=false;const accessor=[works[0]];
  Object.defineProperty(accessor,'0',{get(){evaluated=true;return works[0];},enumerable:true});
  await assert.rejects(inspectCombinedBudget(provider,artifact,request,accessor,31337),e=>e.code==='INVALID_BATCH');assert.equal(evaluated,false);
  await assert.rejects(inspectCombinedBudget(provider,artifact,request,eleven,31337),e=>e.code==='TOKEN_OUTSIDE_SUPPLY');
});

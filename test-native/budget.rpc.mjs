import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {loadCollectionArtifact} from '../console/launch/artifacts.mjs';
import {inspectCombinedBudget} from '../console/launch/budget.mjs';
const url='http://127.0.0.1:18545';
if(process.env.NFT_TEST_DISPOSABLE_GETH!=='yes'||process.env.NFT_BUDGET_TEST_RPC!==url)throw new Error('Use only the private disposable Geth CI fixture.');
test('actual Geth eth_simulateV1 verifies deployment and mint without keys, funds or source-state changes',async t=>{
  const provider=new ethers.JsonRpcProvider(url,undefined,{batchMaxCount:1,cacheTimeout:-1});t.after(()=>provider.destroy());
  assert.equal((await provider.getNetwork()).chainId,1337n);
  assert.match(await provider.send('web3_clientVersion',[]),/Geth\/v1\.17\.8/);
  const artifact=loadCollectionArtifact();
  for(const separate of [false,true]){
    const wallet=ethers.Wallet.createRandom().address,minter=separate?ethers.Wallet.createRandom().address:wallet;
    const request={version:1,wallet,collection:{name:'Synthetic budget',symbol:'BUDGET',seriesSize:'2',royaltyBps:'600',owner:wallet,minter,royaltyRecipient:wallet}};
    const works=['1','2'].map(tokenId=>({tokenId,title:'Synthetic '+tokenId,metadataURI:'ipfs://metadata/'+tokenId,mediaHash:'0x'+'11'.repeat(32),rightsURI:'ipfs://rights/'+tokenId,rightsHash:'0x'+'22'.repeat(32)}));
    const before=await provider.getBlock('latest');
    assert.equal(await provider.getBalance(wallet),0n);assert.equal(await provider.getTransactionCount(wallet),0);
    const result=await inspectCombinedBudget(provider,artifact,request,works,1337);
    assert.equal(result.readOnly,true);assert.equal(result.constructorRuntimeMatched,true);assert.equal(result.simulatedMintEventsMatched,true);
    assert.equal(result.simulatedImmutableReadbackMatched,true);assert.equal(result.sourceWalletStateUnchanged,true);
    assert.equal(result.transactionSent,false);assert.equal(result.mintingVerified,false);assert.equal(result.publicFilesVerified,false);
    assert.equal(result.validatorContractPresent,false,'The default validator is absent on this private fixture; do not promote presence from a virtual result.');
    assert.equal(result.readyForFundingReview,false);assert.equal(result.funding.length,separate?2:1);assert.equal(result.feeCapsWithinLimits,true);
    assert.equal(result.totalAdditionalWei,result.totalMaximumCostWei);
    assert.equal(result.firstMintNonce,separate?0:1);
    for(const op of result.operations){assert.ok(BigInt(op.peakGas)>=BigInt(op.gasUsed));assert.equal(BigInt(op.maximumCostWei),BigInt(op.gasLimit)*BigInt(op.gasPriceWei));}
    assert.equal(await provider.getCode(result.predictedCollection),'0x');assert.equal(await provider.getTransactionCount(wallet),0);
    assert.equal(await provider.getTransactionCount(minter),0);assert.equal(await provider.getBalance(wallet),0n);assert.equal(await provider.getBalance(minter),0n);
    assert.equal((await provider.getBlock('latest')).hash,before.hash);
  }
});

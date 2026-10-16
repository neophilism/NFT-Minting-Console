import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {loadCollectionArtifact} from '../console/launch/artifacts.mjs';
import {inspectCombinedBudget} from '../console/launch/budget.mjs';
import {prepareCollectionCreation} from '../console/launch/contracts.mjs';
import {prepareMintWorks} from '../console/chain/mint.mjs';
const url='http://127.0.0.1:18545';
if(process.env.NFT_TEST_DISPOSABLE_GETH!=='yes'||process.env.NFT_BUDGET_TEST_RPC!==url)throw new Error('Use only the private disposable Geth CI fixture.');
test('existing collection quote charges only remaining mint batches with exact live-state readback',async t=>{
  const provider=new ethers.JsonRpcProvider(url,undefined,{batchMaxCount:1,cacheTimeout:-1});t.after(()=>provider.destroy());assert.equal((await provider.getNetwork()).chainId,1337n);assert.match(await provider.send('web3_clientVersion',[]),/Geth\/v1\.17\.8/);
  const signer=await provider.getSigner(),wallet=await signer.getAddress(),artifact=loadCollectionArtifact(),config={name:'Existing quote fixture',symbol:'EXIST',seriesSize:'12',royaltyBps:'600',owner:wallet,minter:wallet,royaltyRecipient:wallet};
  // This private-chain fixture uses measured gas, not an arbitrary limit above its genesis block limit.
  async function fixtureSend(tx){const estimate=await signer.estimateGas(tx),gasLimit=(estimate*120n+99n)/100n;assert.ok(gasLimit<=(await provider.getBlock('latest')).gasLimit);const sent=await signer.sendTransaction({...tx,gasLimit});return sent.wait();}
  const nonce=await provider.getTransactionCount(wallet,'pending'),creation=prepareCollectionCreation(artifact,config,{requester:wallet,nonce});await fixtureSend({data:creation.data});
  const works=Array.from({length:12},(_,i)=>({tokenId:String(i+1),title:'Existing synthetic '+(i+1),metadataURI:'ipfs://metadata/'+(i+1),mediaHash:'0x'+'11'.repeat(32),rightsURI:'ipfs://rights/'+(i+1),rightsHash:'0x'+'22'.repeat(32)}));
  await fixtureSend({to:creation.expected.collection,data:prepareMintWorks(works.slice(0,1)).data});
  const before=await provider.getBlock('latest'),balance=await provider.getBalance(wallet),currentNonce=await provider.getTransactionCount(wallet,'pending');
  const report=await inspectCombinedBudget(provider,artifact,{version:1,wallet,collection:config},works.slice(1),1337,{existing:{...creation,kind:'deploy',chainId:1337}});
  assert.equal(report.mode,'existing');assert.equal(report.previouslyMinted,'1');assert.equal(report.operations.length,2);assert.equal(report.mintBatchCount,2);assert.equal(report.suppliedWorkCount,11);assert.equal(report.allRemainingSupplyIncluded,true);assert.equal(report.deploymentNonce,null);assert.equal(report.operations.some(op=>op.kind==='deploy'),false);assert.equal(report.firstMintNonce,currentNonce);assert.ok(BigInt(report.totalEstimatedCostWei)<=BigInt(report.totalMaximumCostWei));assert.equal(await provider.getBalance(wallet),balance);assert.equal(await provider.getTransactionCount(wallet,'pending'),currentNonce);assert.equal((await provider.getBlock('latest')).hash,before.hash);assert.equal(report.transactionSent,false);
});

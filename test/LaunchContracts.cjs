const {expect}=require('chai');
const {ethers}=require('hardhat');
describe('First-mint direct collection deployment',function(){
  let m,artifact,from,other,config;
  before(async()=>{m=await import('../console/launch/contracts.mjs');artifact=(await import('../console/launch/artifacts.mjs')).loadCollectionArtifact();[from,other]=await ethers.getSigners();config={name:'Independent release',symbol:'IND',seriesSize:'87',royaltyBps:'600',owner:from.address,minter:from.address,royaltyRecipient:other.address};});
  it('predicts exact constructor output before sending and verifies exact runtime/roles after mining',async()=>{
    const plan=m.prepareCollectionDeployment(artifact,config,{chainId:31337,requester:from.address,nonce:await from.getNonce()});
    expect((await m.simulateDeployment(ethers.provider,plan)).bytecodeSimulated).eq(true);
    const tx=await from.sendTransaction({data:plan.data,nonce:plan.nonce});await tx.wait();await ethers.provider.send('evm_mine');
    const result=await m.verifyDeploymentReceipt(ethers.provider,plan,tx.hash);
    expect(result.collection).eq(plan.expected.collection);expect(result.bytecodeVerified).eq(true);
    expect(result.listingVerified).eq(false);expect(ethers.keccak256(await ethers.provider.getCode(result.collection))).eq(plan.expected.runtimeCodeHash);
    await expect(m.verifyCollection(ethers.provider,{...plan.expected,config:{...config,royaltyBps:'601'}},31337)).rejectedWith('CONFIG_MISMATCH');
    await expect(m.verifyDeploymentReceipt(ethers.provider,{...plan,data:plan.data+'00'},tx.hash)).rejectedWith('TRANSACTION_MISMATCH');
    await expect(m.simulateDeployment(ethers.provider,plan)).rejectedWith('ALREADY_DEPLOYED');
  });
  it('supports unrelated releases and different immutable values without a second factory deployment',async()=>{
    const second={...config,name:'Another work',symbol:'OTHER',seriesSize:'2',royaltyBps:'0',minter:other.address};
    const plan=m.prepareCollectionDeployment(artifact,second,{chainId:31337,requester:from.address,nonce:await from.getNonce()});
    const tx=await from.sendTransaction({data:plan.data});await tx.wait();await ethers.provider.send('evm_mine');
    expect((await m.verifyDeploymentReceipt(ethers.provider,plan,tx.hash)).config).deep.eq(second);
  });
  it('reconciles a real disposable-chain self-cancellation without resending the planned action',async()=>{
    const {verifyNonceCancellation}=await import('../console/launch/cancellation.mjs');
    const nonce=await from.getNonce(),plan=m.prepareCollectionDeployment(artifact,config,{chainId:31337,requester:from.address,nonce});
    const tx=await from.sendTransaction({to:from.address,value:0n,data:'0x',gasLimit:21000n,nonce});
    await tx.wait();await ethers.provider.send('evm_mine');await ethers.provider.send('evm_mine');
    const proof=await verifyNonceCancellation(ethers.provider,plan,tx.hash);
    expect(proof.nonce).eq(nonce);expect(proof.originalActionVerified).eq(false);expect(proof.transactionSent).eq(false);
    expect(await ethers.provider.getCode(plan.expected.collection)).eq('0x');
    const count=await from.getNonce();await verifyNonceCancellation(ethers.provider,plan,tx.hash);expect(await from.getNonce()).eq(count);
    await expect(verifyNonceCancellation(ethers.provider,{...plan,nonce:nonce+1},tx.hash)).rejectedWith('CANCELLATION_MISMATCH');
  });
  it('rejects malformed configuration, unsupported chain and incomplete immutable maps',()=>{
    for(const change of [{seriesSize:'0'},{royaltyBps:'10001'},{owner:ethers.ZeroAddress},{privateKey:'secret'}])expect(()=>m.prepareCollectionDeployment(artifact,{...config,...change},{chainId:1,requester:from.address,nonce:0})).to.throw();
    expect(()=>m.prepareCollectionDeployment(artifact,config,{chainId:5,requester:from.address,nonce:0})).to.throw('WRONG_CHAIN');
    expect(()=>m.expectedRuntime({...artifact,immutables:{}},config)).to.throw('INVALID_ARTIFACT');
  });
  it('read-only funding inspection simulates the exact constructor without spending gas or changing the nonce',async()=>{
    const {inspectDeploymentFunding}=await import('../console/launch/doctor.mjs');
    const nonce=await from.getNonce(),balance=await ethers.provider.getBalance(from.address);
    const result=await inspectDeploymentFunding(ethers.provider,artifact,{version:1,wallet:from.address,collection:config},31337);
    expect(result.constructorSimulated).eq(true);expect(result.withinLimits).eq(true);expect(result.funded).eq(true);
    expect(BigInt(result.maximumCostWei)).eq(BigInt(result.gasLimit)*BigInt(result.gasPrice));
    expect(result.additionalWei).eq('0');expect(result.transactionSent).eq(false);expect(result.mintGasIncluded).eq(false);
    expect(await from.getNonce()).eq(nonce);expect(await ethers.provider.getBalance(from.address)).eq(balance);
    expect(await ethers.provider.getCode(result.predictedCollection)).eq('0x');
    const empty=ethers.Wallet.createRandom();
    const unfunded=await inspectDeploymentFunding(ethers.provider,artifact,{version:1,wallet:empty.address,collection:{...config,minter:empty.address}},31337);
    expect(unfunded.funded).eq(false);expect(unfunded.additionalWei).eq(unfunded.maximumCostWei);
  });
});

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
  it('rejects malformed configuration, unsupported chain and incomplete immutable maps',()=>{
    for(const change of [{seriesSize:'0'},{royaltyBps:'10001'},{owner:ethers.ZeroAddress},{privateKey:'secret'}])expect(()=>m.prepareCollectionDeployment(artifact,{...config,...change},{chainId:1,requester:from.address,nonce:0})).to.throw();
    expect(()=>m.prepareCollectionDeployment(artifact,config,{chainId:5,requester:from.address,nonce:0})).to.throw('WRONG_CHAIN');
    expect(()=>m.expectedRuntime({...artifact,immutables:{}},config)).to.throw('INVALID_ARTIFACT');
  });
});

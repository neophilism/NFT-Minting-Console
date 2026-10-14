import test from 'node:test';
import assert from 'node:assert/strict';
import {keccak256} from 'ethers';
import {verifyMainnetCollection,MainnetPreflightError} from '../console/chain/mainnet-preflight.mjs';
const owner='0x'+'a'.repeat(40),minter='0x'+'b'.repeat(40),recipient='0x'+'c'.repeat(40),collection='0x'+'d'.repeat(40),validator='0x'+'e'.repeat(40);
const code='0x6001600055',hash=keccak256(code),blockHash='0x'+'f'.repeat(64);
const config=()=>({chainId:1,collection,runtimeCodeHash:hash,owner,minter,royaltyRecipient:recipient,seriesSize:'40',royaltyBps:'600',name:'Sample Series',symbol:'SAMP'});
const sample=()=>({
  getNetwork:async()=>({chainId:1n}),
  getBlock:async number=>({number:number==='latest'?100:number,hash:blockHash}),
  getCode:async(address)=>address.toLowerCase()===collection.toLowerCase()?code:'0x6001'
});
const contract=()=>({
  owner:async()=>owner,MINTER:async()=>minter,SERIES_SIZE:async()=>40n,
  CREATOR_ROYALTY_BPS:async()=>600n,ROYALTY_RECIPIENT:async()=>recipient,
  totalMinted:async()=>0n,mintingClosed:async()=>false,name:async()=>config().name,
  symbol:async()=>config().symbol,getTransferValidator:async()=>validator,
  royaltyInfo:async()=>[recipient,600n]
});
const expected=x=>e=>e instanceof MainnetPreflightError&&e.code===x;
test('read-only exact chain-1 configuration and code checks do not authorize signing',async()=>{
  const p=sample(),result=await verifyMainnetCollection(p,config(),{contractFactory:contract});
  assert.equal(result.checkedBlock,99);assert.equal(result.bytecodeVerified,true);
  assert.equal(result.rolesAndImmutablesVerified,true);assert.equal(result.royaltyVerified,true);
  assert.equal(result.firstMintPossible,true);assert.equal(result.mainnetReady,false);
  assert.equal(result.validatorPolicyVerified,false);assert.equal(result.transactionAuthorized,false);
});
test('wrong chain, bytecode, roles and royalties fail before any readiness flag',async()=>{
  const chain=sample();chain.getNetwork=async()=>({chainId:11155111n});
  await assert.rejects(verifyMainnetCollection(chain,config(),{contractFactory:contract}),expected('WRONG_CHAIN'));
  await assert.rejects(verifyMainnetCollection(sample(),{...config(),runtimeCodeHash:'0x'+'e'.repeat(64)},{contractFactory:contract}),expected('BYTECODE_MISMATCH'));
  const wrong=contract();wrong.owner=async()=>validator;
  await assert.rejects(verifyMainnetCollection(sample(),config(),{contractFactory:()=>wrong}),expected('CONFIG_MISMATCH'));
  wrong.owner=async()=>owner;wrong.royaltyInfo=async()=>[recipient,700n];
  await assert.rejects(verifyMainnetCollection(sample(),config(),{contractFactory:()=>wrong}),expected('ROYALTY_MISMATCH'));
});
test('missing deployed validator, closed mint, minted supply, reorg and unknown RPC refuse false positives',async()=>{
 const absent=sample();absent.getCode=async(address)=>address.toLowerCase()===collection.toLowerCase()?code:'0x';
 await assert.rejects(verifyMainnetCollection(absent,config(),{contractFactory:contract}),expected('VALIDATOR_NOT_DEPLOYED'));
 const c=contract();c.totalMinted=async()=>1n;
 const old=await verifyMainnetCollection(sample(),config(),{contractFactory:()=>c});
 assert.equal(old.firstMintPossible,false);
 c.totalMinted=async()=>0n;c.mintingClosed=async()=>true;
 assert.equal((await verifyMainnetCollection(sample(),config(),{contractFactory:()=>c})).firstMintPossible,false);
 let times=0;const reorg=sample();reorg.getBlock=async n=>({number:n==='latest'?100:n,hash:++times>2?'0x'+'a'.repeat(64):blockHash});
 await assert.rejects(verifyMainnetCollection(reorg,config(),{contractFactory:contract}),expected('CHAIN_REORG'));
 const gone=sample();gone.getCode=async()=>{throw Error('RPC unavailable');};
 await assert.rejects(verifyMainnetCollection(gone,config(),{contractFactory:contract}),expected('RPC_OR_CONTRACT_UNAVAILABLE'));
});
test('reject unsupported or arbitrary chain and malformed expected configuration before RPC',async()=>{
 for(const value of [{...config(),chainId:11155111},{...config(),collection:'bad'},
  {...config(),royaltyBps:'10001'},{...config(),name:''},
  {...config(),unexpected:'admin'}]){
  await assert.rejects(verifyMainnetCollection(sample(),value,{contractFactory:contract}),e=>e instanceof MainnetPreflightError);
 }
});

import {Contract,getAddress,keccak256,ZeroAddress} from 'ethers';

const ABI=Object.freeze([
  'function owner() view returns(address)',
  'function MINTER() view returns(address)',
  'function SERIES_SIZE() view returns(uint256)',
  'function CREATOR_ROYALTY_BPS() view returns(uint96)',
  'function ROYALTY_RECIPIENT() view returns(address)',
  'function totalMinted() view returns(uint256)',
  'function mintingClosed() view returns(bool)',
  'function name() view returns(string)',
  'function symbol() view returns(string)',
  'function getTransferValidator() view returns(address)',
  'function royaltyInfo(uint256,uint256) view returns(address,uint256)',
]);
const HEX32=/^0x[0-9a-fA-F]{64}$/;
export class MainnetPreflightError extends Error{
  constructor(code){super('Mainnet collection preflight: '+code);this.name='MainnetPreflightError';this.code=code;}
}
const fail=code=>{throw new MainnetPreflightError(code);};
function address(value){
  try{const x=getAddress(value);if(x===ZeroAddress)fail('ZERO_ADDRESS');return x;}
  catch{fail('INVALID_ADDRESS');}
}
function uint(value,zeroAllowed=false){
  if(typeof value!=='string'||!/^(?:0|[1-9][0-9]{0,77})$/.test(value))fail('INVALID_UINT');
  const n=BigInt(value);
  if(n>(1n<<256n)-1n||(!zeroAllowed&&n===0n))fail('INVALID_UINT');
  return n;
}
function expectedSnapshot(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Reflect.ownKeys(input).length!==10)fail('INVALID_CONFIG');
  const keys=['chainId','collection','runtimeCodeHash','owner','minter','royaltyRecipient','seriesSize',
    'royaltyBps','name','symbol'];
  if(Reflect.ownKeys(input).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(input,k)))fail('INVALID_CONFIG');
  if(input.chainId!==1||typeof input.runtimeCodeHash!=='string'||
    !HEX32.test(input.runtimeCodeHash)||/^0x0+$/.test(input.runtimeCodeHash))fail('INVALID_CONFIG');
  const size=uint(input.seriesSize),bps=uint(input.royaltyBps,true);
  if(bps>10000n||typeof input.name!=='string'||typeof input.symbol!=='string'||
    !input.name||!input.symbol||input.name.length>200||input.symbol.length>50)fail('INVALID_CONFIG');
  return Object.freeze({chainId:1,collection:address(input.collection),runtimeCodeHash:input.runtimeCodeHash.toLowerCase(),
    owner:address(input.owner),minter:address(input.minter),royaltyRecipient:address(input.royaltyRecipient),
    seriesSize:size,royaltyBps:bps,name:input.name,symbol:input.symbol});
}
/**
 * A chain-1, read-only check of immutable collection configuration and code.
 * No private keys, transaction simulation, token approvals, publication or live validator
 * list-policy proof. Caller must supply independently reviewed expected bytecode hash.
 */
export async function verifyMainnetCollection(provider,config,{
  contractFactory=(addr,abi,runner)=>new Contract(addr,abi,runner),
  minConfirmations=2
}={}){
  const e=expectedSnapshot(config);
  if(!provider||typeof provider.getNetwork!=='function'||typeof provider.getBlock!=='function'||
    typeof provider.getCode!=='function'||!Number.isSafeInteger(minConfirmations)||
    minConfirmations<1||minConfirmations>128||typeof contractFactory!=='function')fail('INVALID_PROVIDER');
  try{
    if((await provider.getNetwork()).chainId!==1n)fail('WRONG_CHAIN');
    const observed=await provider.getBlock('latest');
    if(!observed||!Number.isSafeInteger(observed.number)||observed.number<minConfirmations||
      !HEX32.test(observed.hash||''))fail('INVALID_BLOCK');
    const block=observed.number-minConfirmations+1;
    const anchor=await provider.getBlock(block);
    if(!anchor||anchor.number!==block||!HEX32.test(anchor.hash||''))fail('INVALID_BLOCK');
    const code=await provider.getCode(e.collection,block);
    if(!/^0x(?:[0-9a-fA-F]{2})+$/.test(code||'')||
      keccak256(code).toLowerCase()!==e.runtimeCodeHash)fail('BYTECODE_MISMATCH');
    const c=contractFactory(e.collection,ABI,provider);
    const opts={blockTag:block};
    const [owner,minter,size,bps,recipient,minted,closed,name,symbol,validator,royalty]=await Promise.all([
      c.owner(opts),c.MINTER(opts),c.SERIES_SIZE(opts),c.CREATOR_ROYALTY_BPS(opts),
      c.ROYALTY_RECIPIENT(opts),c.totalMinted(opts),c.mintingClosed(opts),c.name(opts),c.symbol(opts),
      c.getTransferValidator(opts),c.royaltyInfo(1n,10000n,opts)
    ]);
    if(address(owner)!==e.owner||address(minter)!==e.minter||BigInt(size)!==e.seriesSize||
      BigInt(bps)!==e.royaltyBps||address(recipient)!==e.royaltyRecipient||
      name!==e.name||symbol!==e.symbol)fail('CONFIG_MISMATCH');
    if(typeof closed!=='boolean'||typeof minted!=='bigint'||minted<0n||minted>e.seriesSize)fail('MINT_STATE_INVALID');
    const v=address(validator);
    if(await provider.getCode(v,block)==='0x')fail('VALIDATOR_NOT_DEPLOYED');
    if(address(royalty[0])!==e.royaltyRecipient||
      BigInt(royalty[1])!==10000n*e.royaltyBps/10000n)fail('ROYALTY_MISMATCH');
    const repeat=await provider.getBlock(block);
    if(!repeat||repeat.hash!==anchor.hash||(await provider.getNetwork()).chainId!==1n)
      fail('CHAIN_REORG');
    return Object.freeze({
      chainId:1,collection:e.collection,checkedBlock:block,blockHash:anchor.hash,
      bytecodeVerified:true,rolesAndImmutablesVerified:true,royaltyVerified:true,
      validatorContractPresent:true,mintingClosed:closed,totalMinted:minted.toString(),
      firstMintPossible:!closed&&minted===0n,
      validatorPolicyVerified:false,publicFilesVerified:false,
      transactionAuthorized:false,mainnetReady:false,
      // Presence of a deployed transfer validator is not proof OpenSea is allowed.
      note:'Read-only snapshot only. Transfer policy, approved bytes, gas, ownership and wallet signing remain separate gates.'
    });
  }catch(err){
    if(err instanceof MainnetPreflightError)throw err;
    fail('RPC_OR_CONTRACT_UNAVAILABLE');
  }
}

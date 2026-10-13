import {Interface, TypedDataEncoder, ZeroAddress, getAddress, verifyTypedData} from 'ethers';

export class SeaportIntentError extends Error {
  constructor(code) {super('Seaport preparation refused: '+code);this.name='SeaportIntentError';this.code=code;}
}
const reject=code=>{throw new SeaportIntentError(code);};
const ZERO='0x'+'0'.repeat(64);
const HEX=/^0x[0-9a-fA-F]{64}$/;
const PROFILE_KEYS=['chainId','chain','protocol','protocolCodeHash','controller','controllerCodeHash','conduit','conduitCodeHash','conduitKey','zone','zoneCodeHash','feeRecipient'];
const TERM_KEYS=['seller','collection','collectionCodeHash','tokenId','priceWei','royaltyRecipient','royaltyBps','marketplaceBps','startTime','endTime','salt','counter'];
export const OPEN_SEA=Object.freeze({
  chainId:1,chain:'ethereum',protocol:'0x0000000000000068f116a894984e2db1123eb395',
  controller:'0x00000000f9490004c11cef243f5400493c00ad63',
  conduit:'0x1e0049783f008a0085193e00003d00cd54003c71',
  conduitKey:'0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000',
  zone:'0x000056f7000000ece9003ca63978907a00ffd100',
  feeRecipient:'0x0000a26b00c1f0df003000390027140000faa719',
});
export const SEAPORT_TYPES=Object.freeze({
  OfferItem:Object.freeze([{name:'itemType',type:'uint8'},{name:'token',type:'address'},{name:'identifierOrCriteria',type:'uint256'},{name:'startAmount',type:'uint256'},{name:'endAmount',type:'uint256'}].map(Object.freeze)),
  ConsiderationItem:Object.freeze([{name:'itemType',type:'uint8'},{name:'token',type:'address'},{name:'identifierOrCriteria',type:'uint256'},{name:'startAmount',type:'uint256'},{name:'endAmount',type:'uint256'},{name:'recipient',type:'address'}].map(Object.freeze)),
  OrderComponents:Object.freeze([{name:'offerer',type:'address'},{name:'zone',type:'address'},{name:'offer',type:'OfferItem[]'},{name:'consideration',type:'ConsiderationItem[]'},{name:'orderType',type:'uint8'},{name:'startTime',type:'uint256'},{name:'endTime',type:'uint256'},{name:'zoneHash',type:'bytes32'},{name:'salt',type:'uint256'},{name:'conduitKey',type:'bytes32'},{name:'counter',type:'uint256'}].map(Object.freeze)),
});
function shape(v,keys) {
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype||
    Reflect.ownKeys(v).length!==keys.length)reject('INVALID_SHAPE');
  for(const key of keys){const d=Object.getOwnPropertyDescriptor(v,key);if(!d||!d.enumerable||!('value'in d))reject('INVALID_SHAPE');}
  return v;
}
function finitePlain(v) {
  let nodes=0,chars=0;const parents=new Set();
  function visit(x,depth) {
    if(++nodes>12000||depth>18)reject('INVALID_SHAPE');
    if(x===null||typeof x==='boolean')return;
    if(typeof x==='number') {if(!Number.isSafeInteger(x))reject('INVALID_NUMBER');return;}
    if(typeof x==='string'){chars+=x.length;if(chars>262144)reject('TOO_LARGE');return;}
    if(!x||typeof x!=='object'||parents.has(x))reject('INVALID_SHAPE');
    const array=Array.isArray(x),keys=Reflect.ownKeys(x);
    if(Object.getPrototypeOf(x)!==(array?Array.prototype:Object.prototype)||keys.length>1001||
      (array&&(keys.length!==x.length+1||x.length>1000)))reject('INVALID_SHAPE');
    parents.add(x);
    for(const key of keys){
      if(array&&key==='length')continue;
      const d=Object.getOwnPropertyDescriptor(x,key);
      if(typeof key!=='string'||key==='__proto__'||!d||!d.enumerable||!('value'in d)||
        (array&&!/^(0|[1-9][0-9]*)$/.test(key)))reject('INVALID_SHAPE');
      chars+=key.length;visit(d.value,depth+1);
    }
    parents.delete(x);
  }
  visit(v,0);
}
function address(v,zero=false){if(typeof v!=='string')reject('INVALID_ADDRESS');
  try{const a=getAddress(v).toLowerCase();if(!zero&&a===ZeroAddress)reject('INVALID_ADDRESS');return a;}
  catch(e){if(e instanceof SeaportIntentError)throw e;reject('INVALID_ADDRESS');}
}
function hash(v,zero=false){if(typeof v!=='string'||!HEX.test(v)||(!zero&&v.toLowerCase()===ZERO))reject('INVALID_HASH');return v.toLowerCase();}
function unsigned(v,required=false){if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(v)||BigInt(v)>=(1n<<256n)||(required&&v==='0'))reject('INVALID_INTEGER');return v;}
function fees(v){if(!Number.isInteger(v)||v<0||v>10000)reject('INVALID_BPS');return v;}
function timestamp(v){if(!Number.isSafeInteger(v)||v<0)reject('INVALID_TIME');return v;}
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
export function validateSeaportProfile(value) {
  shape(value,PROFILE_KEYS);
  if(![1,31337].includes(value.chainId)||value.chain!==(value.chainId===1?'ethereum':'hardhat'))reject('CHAIN_UNSUPPORTED');
  const result={chainId:value.chainId,chain:value.chain};
  for(const name of ['protocol','controller','conduit','zone','feeRecipient'])result[name]=address(value[name],name==='zone');
  for(const name of ['protocolCodeHash','controllerCodeHash','conduitCodeHash'])result[name]=hash(value[name]);
  result.conduitKey=hash(value.conduitKey);result.zoneCodeHash=hash(value.zoneCodeHash,result.zone===ZeroAddress);
  if(result.zone===ZeroAddress&&result.zoneCodeHash!==ZERO)reject('INVALID_ZONE');
  if(value.chainId===1)for(const name of ['protocol','controller','conduit','conduitKey','zone','feeRecipient'])
    if(result[name]!==OPEN_SEA[name])reject('UNREVIEWED_MAINNET_CONFIGURATION');
  return freeze(result);
}
export function validateSeaportTerms(value){
  shape(value,TERM_KEYS);
  const result={seller:address(value.seller),collection:address(value.collection),collectionCodeHash:hash(value.collectionCodeHash),
    tokenId:unsigned(value.tokenId,true),priceWei:unsigned(value.priceWei,true),
    royaltyRecipient:address(value.royaltyRecipient),royaltyBps:fees(value.royaltyBps),
    marketplaceBps:fees(value.marketplaceBps),startTime:timestamp(value.startTime),
    endTime:timestamp(value.endTime),salt:unsigned(value.salt,true),counter:unsigned(value.counter)};
  const duration=result.endTime-result.startTime;
  if(duration<300||duration>30*86400||result.royaltyBps+result.marketplaceBps>=10000)reject('INVALID_TERMS');
  return freeze(result);
}
export function buildSeaportIntent(termsInput,profileInput){
  const terms=validateSeaportTerms(termsInput),profile=validateSeaportProfile(profileInput);
  const total=BigInt(terms.priceWei),royalty=total*BigInt(terms.royaltyBps)/10000n,marketFee=total*BigInt(terms.marketplaceBps)/10000n,net=total-royalty-marketFee;
  if(net<=0n||(terms.royaltyBps>0&&royalty===0n)||(terms.marketplaceBps>0&&marketFee===0n))reject('INSUFFICIENT_PRICE');
  const eth=(recipient,amount)=>({itemType:0,token:ZeroAddress,identifierOrCriteria:'0',startAmount:String(amount),endAmount:String(amount),recipient});
  const consideration=[eth(terms.seller,net)];
  if(marketFee>0n)consideration.push(eth(profile.feeRecipient,marketFee));
  if(royalty>0n)consideration.push(eth(terms.royaltyRecipient,royalty));
  const components={offerer:terms.seller,zone:profile.zone,
    offer:[{itemType:2,token:terms.collection,identifierOrCriteria:terms.tokenId,startAmount:'1',endAmount:'1'}],
    consideration,orderType:profile.zone===ZeroAddress?0:2,
    startTime:String(terms.startTime),endTime:String(terms.endTime),zoneHash:ZERO,
    salt:terms.salt,conduitKey:profile.conduitKey,counter:terms.counter};
  const domain={name:'Seaport',version:'1.6',chainId:profile.chainId,verifyingContract:profile.protocol};
  return freeze({version:1,terms,profile,components,
    parameters:{...components,totalOriginalConsiderationItems:consideration.length},
    domain,types:SEAPORT_TYPES,
    orderHash:TypedDataEncoder.hashStruct('OrderComponents',SEAPORT_TYPES,components).toLowerCase(),
    signingDigest:TypedDataEncoder.hash(domain,SEAPORT_TYPES,components).toLowerCase(),
    economics:{priceWei:String(total),sellerNetWei:String(net),royaltyWei:String(royalty),marketplaceWei:String(marketFee)},
    listingVerified:false,productionReady:false});
}
export function checkedSeaportIntent(value){
  finitePlain(value);
  const keys=['version','terms','profile','components','parameters','domain','types','orderHash','signingDigest','economics','listingVerified','productionReady'];
  shape(value,keys);
  const fresh=buildSeaportIntent(value.terms,value.profile);
  for(const name of keys)if(JSON.stringify(value[name])!==JSON.stringify(fresh[name]))reject('TAMPERED_ORDER');
  return fresh;
}
export function verifySeaportSignature(value,signature){
  const intent=checkedSeaportIntent(value);
  if(typeof signature!=='string'||!/^0x[0-9a-fA-F]{130}$/.test(signature))reject('INVALID_SIGNATURE');
  try{if(address(verifyTypedData(intent.domain,SEAPORT_TYPES,intent.components,signature))!==intent.terms.seller)reject('WRONG_SIGNER');}
  catch(e){if(e instanceof SeaportIntentError)throw e;reject('INVALID_SIGNATURE');}
  return signature.toLowerCase();
}
export function signableSeaportPayload(value){
  const intent=checkedSeaportIntent(value);
  return TypedDataEncoder.getPayload(intent.domain,SEAPORT_TYPES,intent.components);
}
const ERC721=new Interface(['function approve(address,uint256)']);
const SEAPORT=new Interface(['function cancel((address offerer,address zone,(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)[] offer,(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount,address recipient)[] consideration,uint8 orderType,uint256 startTime,uint256 endTime,bytes32 zoneHash,uint256 salt,bytes32 conduitKey,uint256 counter)[] orders)']);
export function exactTokenApproval(value){
  const intent=checkedSeaportIntent(value);
  return freeze({to:intent.terms.collection,value:'0x0',data:ERC721.encodeFunctionData('approve',[intent.profile.conduit,intent.terms.tokenId])});
}
export function exactOrderCancellation(value){
  const intent=checkedSeaportIntent(value);
  return freeze({to:intent.profile.protocol,value:'0x0',data:SEAPORT.encodeFunctionData('cancel',[[intent.components]])});
}
export function checkedOrderPostBody(value,signature){
  const intent=checkedSeaportIntent(value);
  return freeze({parameters:intent.parameters,protocol_address:intent.profile.protocol,signature:verifySeaportSignature(intent,signature)});
}

import {getAddress,TypedDataEncoder,verifyTypedData,Signature} from 'ethers';
const ZERO='0x'+'0'.repeat(40);
export const SEAPORT_16='0x0000000000000068F116a894984e2DB1123eB395';
export const EIP712_TYPES=Object.freeze({
  OrderComponents:[
    {name:'offerer',type:'address'},{name:'zone',type:'address'},
    {name:'offer',type:'OfferItem[]'},{name:'consideration',type:'ConsiderationItem[]'},
    {name:'orderType',type:'uint8'},{name:'startTime',type:'uint256'},
    {name:'endTime',type:'uint256'},{name:'zoneHash',type:'bytes32'},
    {name:'salt',type:'uint256'},{name:'conduitKey',type:'bytes32'},
    {name:'counter',type:'uint256'},
  ],
  OfferItem:[
    {name:'itemType',type:'uint8'},{name:'token',type:'address'},
    {name:'identifierOrCriteria',type:'uint256'},
    {name:'startAmount',type:'uint256'},{name:'endAmount',type:'uint256'},
  ],
  ConsiderationItem:[
    {name:'itemType',type:'uint8'},{name:'token',type:'address'},
    {name:'identifierOrCriteria',type:'uint256'},
    {name:'startAmount',type:'uint256'},{name:'endAmount',type:'uint256'},
    {name:'recipient',type:'address'},
  ],
});
export class SeaportReviewError extends Error{
  constructor(code){super('Seaport review failed: '+code);this.name='SeaportReviewError';this.code=code;}
}
function fail(code){throw new SeaportReviewError(code);}
function address(s,allowZero=false){
  let a;try{a=getAddress(s);}catch{fail('ADDRESS');}
  if(!allowZero&&a.toLowerCase()===ZERO)fail('ADDRESS');
  return a;
}
function uint(s,zero=true){
  if(typeof s!=='string'||!/^(?:0|[1-9][0-9]{0,77})$/.test(s))fail('UINT');
  const n=BigInt(s);
  if(n>(1n<<256n)-1n||(!zero&&n===0n))fail('UINT');
  return n;
}
function bytes32(s){
  if(typeof s!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(s))fail('BYTES32');
  return s.toLowerCase();
}
function deepFreeze(value){
  if(value&&typeof value==='object'){
    for(const item of Object.values(value))deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
function secureSalt(){
  const c=globalThis.crypto;
  if(!c||typeof c.getRandomValues!=='function')fail('NO_SECURE_RANDOM');
  const b=new Uint8Array(32);c.getRandomValues(b);
  const salt=BigInt('0x'+Array.from(b,x=>x.toString(16).padStart(2,'0')).join(''));
  if(salt===0n)fail('INVALID_SALT');
  return salt.toString();
}
/**
 * Pure review preview. Caller must independently verify seller ERC721 ownership,
 * current Seaport counter, ERC721C transfer policy, approvals, payout fee split,
 * and runtime chain before enabling a wallet signature.
 */
export function buildReviewedOrder({seller,collection,tokenId,priceWei,payments,counter,
  startTime,endTime,zone=ZERO,zoneHash='0x'+'0'.repeat(64),conduitKey='0x'+'0'.repeat(64)}={}){
  const offerer=address(seller),token=address(collection);
  const id=uint(tokenId),gross=uint(priceWei,false);
  if(!Array.isArray(payments)||!payments.length||payments.length>16)fail('PAYMENTS');
  let sum=0n;const consideration=[];
  for(const p of payments){
    const amount=uint(p?.amountWei,false),recipient=address(p?.recipient);
    sum+=amount;if(sum>gross)fail('PAYMENTS');
    consideration.push({itemType:0,token:ZERO,identifierOrCriteria:'0',
      startAmount:amount.toString(),endAmount:amount.toString(),recipient});
  }
  if(sum!==gross)fail('PAYMENTS');
  const begin=uint(startTime),end=uint(endTime);
  if(end<=begin||end-begin>2678400n)fail('EXPIRATION');
  const nominatedZone=address(zone,true),hash=bytes32(zoneHash),conduit=bytes32(conduitKey);
  const parameters={
    offerer,zone:nominatedZone,offer:[{itemType:2,token,identifierOrCriteria:id.toString(),startAmount:'1',endAmount:'1'}],
    consideration,orderType:nominatedZone.toLowerCase()===ZERO?0:2,
    startTime:begin.toString(),endTime:end.toString(),zoneHash:hash,
    salt:secureSalt(),conduitKey:conduit,counter:uint(counter).toString(),
    totalOriginalConsiderationItems:consideration.length.toString(),
  };
  const domain={name:'Seaport',version:'1.6',chainId:1,verifyingContract:SEAPORT_16};
  const digest=TypedDataEncoder.hash(domain,EIP712_TYPES,parameters);
  const review={approved:false,seller:offerer,collection:token,tokenId:id.toString(),
    priceWei:gross.toString(),endTime:end.toString(),payments:consideration.map(x=>({
      recipient:x.recipient,amountWei:x.startAmount,
    }))};
  return deepFreeze({domain,types:EIP712_TYPES,parameters,review,digest,chainId:1,
    productionReady:false,signatureAuthorized:false});
}
/**
 * A direct EOA-only wallet signature operation, never invoked automatically.
 * The user-facing UI must show and confirm every reviewed field, then call on
 * a real click with confirmed=true after live chain/validator checks.
 */
export async function signReviewedEOA({plan,provider,confirmed=false}={}){
  if(confirmed!==true||!plan||!provider||typeof provider.request!=='function')fail('NOT_AUTHORIZED');
  if(plan.chainId!==1||plan.domain?.verifyingContract!==SEAPORT_16||
     plan.domain?.version!=='1.6'||plan.domain?.name!=='Seaport')fail('DOMAIN');
  const digest=TypedDataEncoder.hash(plan.domain,EIP712_TYPES,plan.parameters);
  if(digest!==plan.digest)fail('MUTATED_REVIEW');
  const p=plan.parameters,r=plan.review;
  if(!r||r.seller!==p.offerer||r.collection!==p.offer?.[0]?.token||
     r.tokenId!==p.offer?.[0]?.identifierOrCriteria||r.endTime!==p.endTime||
     !Array.isArray(r.payments)||r.payments.length!==p.consideration?.length||
     r.priceWei!==p.consideration.reduce((sum,x)=>sum+uint(x.startAmount),0n).toString()||
     r.payments.some((x,i)=>x.recipient!==p.consideration[i].recipient||
       x.amountWei!==p.consideration[i].startAmount))fail('MUTATED_REVIEW');
  const chain=await provider.request({method:'eth_chainId',params:[]});
  if(chain!=='0x1')fail('WRONG_CHAIN');
  const accounts=await provider.request({method:'eth_accounts',params:[]});
  if(!Array.isArray(accounts)||!accounts.some(x=>{
    try{return address(x)===address(plan.parameters.offerer);}catch{return false;}
  }))fail('WRONG_WALLET');
  const payload=TypedDataEncoder.getPayload(plan.domain,EIP712_TYPES,plan.parameters);
  const raw=await provider.request({method:'eth_signTypedData_v4',params:[
    plan.parameters.offerer,JSON.stringify(payload),
  ]});
  if(typeof raw!=='string'||!/^0x[0-9a-fA-F]{130}$/.test(raw))fail('BAD_SIGNATURE');
  let recovered;try{recovered=verifyTypedData(plan.domain,EIP712_TYPES,plan.parameters,raw);}
  catch{fail('BAD_SIGNATURE');}
  if(address(recovered)!==address(plan.parameters.offerer))fail('WRONG_SIGNATURE');
  return Object.freeze({parameters:plan.parameters,signature:Signature.from(raw).compactSerialized});
}

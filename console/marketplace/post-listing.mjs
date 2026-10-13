import {Buffer} from 'node:buffer';
const SEAPORT='0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC';
const ZERO='0x'+'0'.repeat(40);
const MAX=(1n<<256n)-1n;
export class ListingTransportError extends Error {
  constructor(code){super('Listing transport: '+code);this.code=code;this.name='ListingTransportError';}
}
function fail(code){throw new ListingTransportError(code);}
function addr(s,allowZero=false){
  if(typeof s!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(s)||(!allowZero&&s.toLowerCase()===ZERO))fail('ADDRESS');
  return s.toLowerCase();
}
function uint(x){
  if(typeof x!=='string'||!/^(?:0|[1-9][0-9]{0,77})$/.test(x)||BigInt(x)>MAX)fail('UINT');
  return BigInt(x);
}
function fixedOrder(order,review){
  if(!order||typeof order!=='object'||!order.parameters||typeof order.parameters!=='object')fail('ORDER');
  const p=order.parameters;
  if(!Array.isArray(p.offer)||p.offer.length!==1||!Array.isArray(p.consideration)||p.consideration.length<1||p.consideration.length>16)fail('ORDER');
  if(!/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(order.signature||''))fail('SIGNATURE');
  if(![0,2].includes(p.orderType)||typeof p.orderType!=='number'||!/^0x[0-9a-fA-F]{64}$/.test(p.zoneHash||'')||
     !/^0x[0-9a-fA-F]{64}$/.test(p.conduitKey||''))fail('ORDER');
  addr(p.zone,true);uint(p.salt);uint(p.counter);
  if(uint(p.endTime)<=uint(p.startTime))fail('EXPIRATION');
  const item=p.offer[0];
  if(item.itemType!==2||addr(item.token)===ZERO||uint(item.startAmount)!==1n||
     uint(item.endAmount)!==1n)fail('NFT_ITEM');
  const tokenId=uint(item.identifierOrCriteria).toString(),seller=addr(p.offerer);
  if(uint(p.totalOriginalConsiderationItems)!==BigInt(p.consideration.length))fail('CONSIDERATION');
  let price=0n;
  const payments=[];
  for(const v of p.consideration){
    if(v.itemType!==0||addr(v.token,true)!==ZERO||uint(v.identifierOrCriteria)!==0n||
       uint(v.startAmount)===0n||uint(v.startAmount)!==uint(v.endAmount))fail('CONSIDERATION');
    price+=uint(v.startAmount);
    if(price>MAX)fail('CONSIDERATION');
    payments.push({recipient:addr(v.recipient),amountWei:uint(v.startAmount).toString()});
  }
  if(!review||review.approved!==true||addr(review.seller)!==seller||
     addr(review.collection)!==addr(item.token)||uint(review.tokenId).toString()!==tokenId||
     uint(review.priceWei)!==price||uint(review.endTime)!==uint(p.endTime)||
     !Array.isArray(review.payments)||review.payments.length!==payments.length)fail('REVIEW');
  for(let i=0;i<payments.length;i++){
    if(addr(review.payments[i]?.recipient)!==payments[i].recipient||
       uint(review.payments[i]?.amountWei).toString()!==payments[i].amountWei)fail('REVIEW');
  }
  const body=JSON.stringify({parameters:p,protocol_address:SEAPORT,signature:order.signature});
  if(Buffer.byteLength(body)>65536)fail('TOO_LARGE');
  return body;
}
async function readResult(response){
  if(!response||typeof response.status!=='number')fail('RESPONSE');
  if(response.status>=300&&response.status<400)fail('REDIRECT');
  if(response.status===429)fail('RATE_LIMITED');
  if(response.status===409)fail('UNCERTAIN_DUPLICATE');
  if(!response.ok)fail('REJECTED');
  if(!/^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type')||''))fail('CONTENT_TYPE');
  const len=response.headers.get('content-length');
  if(len!==null&&(!/^[0-9]+$/.test(len)||BigInt(len)>262144n))fail('TOO_LARGE');
  if(!response.body||typeof response.body.getReader!=='function')fail('RESPONSE');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{
    for(;;){const next=await reader.read();if(next.done)break;
      if(!(next.value instanceof Uint8Array))fail('RESPONSE');
      size+=next.value.length;
      if(size>262144){await reader.cancel().catch(()=>{});fail('TOO_LARGE');}
      chunks.push(next.value);
    }
  }finally{reader.releaseLock();}
  const all=new Uint8Array(size);let n=0;
  for(const chunk of chunks){all.set(chunk,n);n+=chunk.length;}
  let result;
  try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));}
  catch{fail('JSON');}
  if(!result||typeof result!=='object'||!/^0x[0-9a-fA-F]{64}$/.test(result.order_hash||''))fail('ORDER_HASH');
  return Object.freeze({orderHash:result.order_hash.toLowerCase(),apiAccepted:true,listingVerified:false,chainVerified:false,royaltiesVerified:false});
}
export class OpenSeaSignedListingTransport {
  #key;#fetch;#timeout;
  constructor({apiKey,fetchImpl=globalThis.fetch,timeoutMs=12000}={}){
    if(typeof window!=='undefined')fail('SERVER_ONLY');
    if(typeof apiKey!=='string'||apiKey.length<8||apiKey.length>512||/[\s\u0000-\u001f\u007f]/u.test(apiKey))fail('KEY');
    if(typeof fetchImpl!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<10||timeoutMs>30000)fail('CONFIG');
    this.#key=apiKey;this.#fetch=fetchImpl;this.#timeout=timeoutMs;
  }
  async submit({chain='ethereum',protocolAddress=SEAPORT,order,review,signal}={}){
    if(signal?.aborted)fail('CANCELLED');
    if(chain!=='ethereum'||addr(protocolAddress)!==SEAPORT.toLowerCase())fail('CHAIN_OR_PROTOCOL');
    const body=fixedOrder(order,review);
    const controller=new AbortController(),abort=()=>controller.abort();
    signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,this.#timeout);
    try{
      const response=await this.#fetch('https://api.opensea.io/api/v2/orders/ethereum/seaport/listings',{
        method:'POST',redirect:'manual',credentials:'omit',
        headers:{Accept:'application/json','Content-Type':'application/json','X-API-KEY':this.#key},
        body,signal:controller.signal,
      });
      if(controller.signal.aborted)fail(signal?.aborted?'CANCELLED':'TIMEOUT');
      const result=await readResult(response);
      if(controller.signal.aborted)fail(signal?.aborted?'CANCELLED':'TIMEOUT');
      return result;
    }catch(e){
      if(e instanceof ListingTransportError)throw e;
      fail(controller.signal.aborted?(signal?.aborted?'CANCELLED':'TIMEOUT'):'NETWORK');
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
}
export {SEAPORT};

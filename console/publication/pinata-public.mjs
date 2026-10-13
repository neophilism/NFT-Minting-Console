import {createHash} from 'node:crypto';
import {publicIpfsUri} from './ipfs-uri.mjs';
import {verifyPublicFiles} from './readback.mjs';

export const PUBLIC_UPLOAD_TYPES=Object.freeze({
  metadata:{max:131072,extensions:['.json']},
  rights:{max:8388608,extensions:['.md','.txt','.pdf']},
  image:{max:33554432,extensions:['.png','.jpg','.jpeg','.webp','.gif']},
  media:{max:2147483648,extensions:['.mp4','.webm','.mp3','.m4a']}
});
const MIME=Object.freeze({'.json':'application/json','.md':'text/markdown','.txt':'text/plain','.pdf':'application/pdf',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif',
  '.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.m4a':'audio/mp4'});
export class PublicUploadError extends Error{
  constructor(code,cid=null){super('Public IPFS upload: '+code);this.name='PublicUploadError';this.code=code;this.cid=cid;}
}
const fail=(code,cid)=>{throw new PublicUploadError(code,cid);};
function fileType(kind,name,blob){
  const format=PUBLIC_UPLOAD_TYPES[kind];
  if(!format||typeof name!=='string'||name.length>200||!name||name==='.'||name==='..'||
     name.trim()!==name||name.includes('/')||/[\\\u0000-\u001f\u007f]/u.test(name)||!blob||typeof blob.stream!=='function'||
     !Number.isSafeInteger(blob.size)||blob.size<1||blob.size>format.max)fail('INVALID_FILE');
  const ext=name.slice(name.lastIndexOf('.')).toLowerCase();
  if(!format.extensions.includes(ext))fail('INVALID_FILE_TYPE');
  return MIME[ext];
}
async function boundedResponse(res){
  if(!res||typeof res.status!=='number')fail('INVALID_RESPONSE');
  if(res.status>=300&&res.status<400)fail('REFUSED_REDIRECT');
  if(res.status===429)fail('RATE_LIMITED');
  if(!res.ok)fail('UPLOAD_REJECTED');
  if(!/^application\/json(?:\s*;|$)/i.test(res.headers?.get('content-type')||''))fail('INVALID_RESPONSE_TYPE');
  const declared=res.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||BigInt(declared)>16384n))fail('RESPONSE_TOO_LARGE');
  if(!res.body||typeof res.body.getReader!=='function')fail('INVALID_RESPONSE');
  const reader=res.body.getReader(),chunks=[];let n=0;
  try{
    for(;;){const p=await reader.read();if(p.done)break;
      if(!(p.value instanceof Uint8Array))fail('INVALID_RESPONSE');
      n+=p.value.byteLength;
      if(n>16384){await reader.cancel().catch(()=>{});fail('RESPONSE_TOO_LARGE');}
      chunks.push(p.value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(n);let off=0;
  for(const c of chunks){bytes.set(c,off);off+=c.byteLength;}
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{fail('INVALID_JSON');}
  if(!value||typeof value!=='object'||Array.isArray(value)||!value.data||
     typeof value.data!=='object'||Array.isArray(value.data))fail('INVALID_JSON');
  return value.data;
}
/**
 * Dedicated explicit-publication path: never drafts, autosave or private data.
 * A CID is not the uploaded file hash. Confirm exact independent readback.
 */
export async function publishReviewedFile({
  kind,name,blob,sha256,acknowledgePublic=false,jwt,
  fetchImpl=globalThis.fetch,verifyGateway='pinata',timeoutMs=1200000
}={}){
  const mime=fileType(kind,name,blob);
  if(blob.type&&blob.type!==mime)fail('INVALID_MIME_TYPE');
  if(acknowledgePublic!==true)fail('PUBLIC_CONSENT_REQUIRED');
  if(typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256))fail('INVALID_SHA256');
  if(typeof jwt!=='string'||jwt.length<16||jwt.length>8192||/[\s\u0000-\u001f\u007f]/u.test(jwt))fail('JWT_UNAVAILABLE');
  if(typeof fetchImpl!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>3600000)fail('INVALID_TRANSPORT');
  const digest=createHash('sha256');let n=0;
  try{for await(const chunk of blob.stream()){
    if(!(chunk instanceof Uint8Array))fail('INVALID_STREAM');
    n+=chunk.byteLength;if(n>blob.size)fail('SOURCE_CHANGED');
    digest.update(chunk);
  }}catch(e){if(e instanceof PublicUploadError)throw e;fail('SOURCE_UNREADABLE');}
  if(n!==blob.size||digest.digest('hex')!==sha256)fail('REVIEW_DIGEST_MISMATCH');
  const form=new FormData();form.append('network','public');form.append('cid_version','v1');
  form.append('file',blob,name);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  let cid=null;
  try{
    const res=await fetchImpl('https://uploads.pinata.cloud/v3/files',{
      method:'POST',redirect:'manual',credentials:'omit',headers:{Accept:'application/json',Authorization:'Bearer '+jwt},
      body:form,signal:controller.signal
    });
    if(controller.signal.aborted)fail('UPLOAD_TIMEOUT');
    const data=await boundedResponse(res);
    cid=data.cid;
    const uri='ipfs://'+String(cid||'');
    try{publicIpfsUri(uri);}catch{fail('INVALID_CID');}
    if(!Number.isSafeInteger(data.size)||data.size!==blob.size)fail('UPLOAD_SIZE_MISMATCH',cid);
    if(data.network!==undefined&&data.network!=='public')fail('NOT_PUBLIC',cid);
    const manifest={version:1,publicDisclosureConfirmed:true,files:[{kind,uri,sha256,byteLength:blob.size}]};
    try{
      const result=await verifyPublicFiles(manifest,{fetchImpl,gateway:verifyGateway,timeoutMs:300000});
      if(result.bytesVerified!==true)fail('READBACK_PENDING',cid);
    }catch{fail('READBACK_PENDING',cid);}
    return Object.freeze({uri,manifest,publicUploadAccepted:true,exactBytesVerified:true,mintAuthorized:false});
  }catch(e){
    if(e instanceof PublicUploadError)throw e;
    fail(controller.signal.aborted?'UPLOAD_TIMEOUT':'NETWORK_FAILURE',cid);
  }finally{clearTimeout(timer);controller.abort();}
}

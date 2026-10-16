import {WorkbenchError,descriptor} from './workbench-model.mjs';
export function signedUploadUrl(value){
  if(typeof value!=='string'||value.length>8192)throw new WorkbenchError('INVALID_UPLOAD_CAPABILITY');
  let url;try{url=new URL(value);}catch{throw new WorkbenchError('INVALID_UPLOAD_CAPABILITY');}
  if(url.origin!=='https://uploads.pinata.cloud'||url.pathname!=='/v3/files'||!url.search||url.username||url.password||url.hash)throw new WorkbenchError('INVALID_UPLOAD_CAPABILITY');
  return url.href;
}
async function responseJson(response){
  if(response.status!==200||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))throw new WorkbenchError(response.status===401||response.status===403?'PINATA_CREDENTIAL_REJECTED':'UPLOAD_AUTHORIZATION_UNAVAILABLE');
  if(!response.body)throw new WorkbenchError('INVALID_UPLOAD_CAPABILITY');const reader=response.body.getReader();let bytes=0;const chunks=[];
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>16384){await reader.cancel();throw new WorkbenchError('INVALID_UPLOAD_CAPABILITY');}chunks.push(part.value);}}
  finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new WorkbenchError('INVALID_UPLOAD_CAPABILITY');}
}
/** Short-lived public-upload capability only. Never return or log the account JWT. */
export async function authorizePublicUpload(file,{jwt,fetchImpl=globalThis.fetch,signal,issuedAt}={}){
  const clean=descriptor(file);
  if(typeof jwt!=='string'||jwt.length<16||jwt.length>8192||/\s/.test(jwt))throw new WorkbenchError('PINATA_CREDENTIAL_REQUIRED');
  const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)throw new WorkbenchError('PUBLICATION_CANCELLED');signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,15000);
  try{
    const issued=issuedAt===undefined?Date.now():new Date(issuedAt).getTime();
    if(!Number.isFinite(issued)||issued>Date.now()+1000||Date.now()-issued>30000)throw new WorkbenchError('UPLOAD_AUTHORIZATION_EXPIRED');
    const date=Math.floor(issued/1000);
    const response=await fetchImpl('https://uploads.pinata.cloud/v3/files/sign',{method:'POST',redirect:'manual',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({date,expires:300,network:'public',max_file_size:clean.byteLength,allow_mime_types:[clean.mime],filename:clean.name,cid_version:'v1'})});
    const value=await responseJson(response);return {url:signedUploadUrl(value.data),expiresAt:new Date((date+300)*1000).toISOString()};
  }catch(e){if(e instanceof WorkbenchError)throw e;throw new WorkbenchError('UPLOAD_AUTHORIZATION_UNAVAILABLE');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
}

import {sha256} from '@noble/hashes/sha256';
import {publicIpfsUri} from '../../publication/ipfs-uri.mjs';
export type FileKind='image'|'media'|'rights'|'metadata';
export interface PublicFile {kind:FileKind;name:string;mime:string;byteLength:number;sha256:string}
export interface PublicSlot extends PublicFile {attempts:number;issuedAt:string|null;candidateUri:string|null;verifiedUri:string|null}
export interface PublicPlan {version:1;id:string;tokenId:string;title:string;description:string;rightsScope:'token'|'collection';files:PublicFile[];publicDisclosureConfirmed:true}
export interface PublicWorkRow {id:string;plan:PublicPlan;metadataJson:string|null;files:PublicSlot[];createdAt:string}
const formats:Record<FileKind,{max:number;extensions:Record<string,string>}>= {
  image:{max:33554432,extensions:{'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'}},
  rights:{max:8388608,extensions:{'.txt':'text/plain','.md':'text/markdown','.pdf':'application/pdf'}},
  media:{max:2147483648,extensions:{'.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.m4a':'audio/mp4'}},
  metadata:{max:131072,extensions:{'.json':'application/json'}}
};
const hex=(bytes:Uint8Array)=>Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('');
export async function describeFile(kind:FileKind,file:File,signal?:AbortSignal):Promise<PublicFile>{
  const type=formats[kind],mime=type.extensions[file.name.slice(file.name.lastIndexOf('.')).toLowerCase()];
  if(!mime||file.size<1||file.size>type.max||file.name.length>200||/[\\/]/.test(file.name))throw new Error('Choose a supported, nonempty '+kind+' file within its size limit.');
  const digest=sha256.create(),reader=file.stream().getReader();let size=0;
  try{for(;;){if(signal?.aborted)throw new Error('File review cancelled.');const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>file.size)throw new Error('File changed during review.');digest.update(part.value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  if(size!==file.size)throw new Error('File could not be read completely.');
  return {kind,name:file.name,mime,byteLength:size,sha256:hex(digest.digest())};
}
export function publicRow(value:unknown):PublicWorkRow{
  const v=value as PublicWorkRow;
  if(!v||typeof v.id!=='string'||!v.plan||v.plan.id!==v.id||v.plan.version!==1||v.plan.publicDisclosureConfirmed!==true||typeof v.plan.title!=='string'||!Array.isArray(v.files)||v.files.length<2||v.files.length>4)throw new Error('The saved public work could not be read.');
  for(const f of v.files){if(!formats[f.kind]||typeof f.name!=='string'||typeof f.mime!=='string'||typeof f.sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256)||!Number.isSafeInteger(f.byteLength)||f.byteLength<1||f.byteLength>formats[f.kind].max||!Number.isInteger(f.attempts)||f.attempts<0||f.attempts>20)throw new Error('The saved file commitment is invalid.');if(f.verifiedUri)publicIpfsUri(f.verifiedUri);if(f.candidateUri)publicIpfsUri(f.candidateUri);}
  if(v.metadataJson!==null&&(typeof v.metadataJson!=='string'||new TextEncoder().encode(v.metadataJson).length>131072))throw new Error('The metadata is invalid.');
  return v;
}
export async function uploadWithCapability(value:unknown,expected:PublicSlot,file:File,signal:AbortSignal):Promise<string>{
  const cap=value as {url:string;expiresAt:string;kind:string;sha256:string;byteLength:number;publicOnly:boolean};
  if(!cap||cap.publicOnly!==true||cap.kind!==expected.kind||cap.sha256!==expected.sha256||cap.byteLength!==expected.byteLength||typeof cap.url!=='string'||cap.url.length>8192||(!Number.isFinite(Date.parse(cap.expiresAt))||Date.parse(cap.expiresAt)<=Date.now()||Date.parse(cap.expiresAt)>Date.now()+301000))throw new Error('The upload permission did not match the reviewed file.');
  const url=new URL(cap.url);
  if(url.origin!=='https://uploads.pinata.cloud'||url.pathname!=='/v3/files'||!url.search||url.username||url.password||url.hash)throw new Error('The upload destination could not be verified.');
  const checked=await describeFile(expected.kind,file,signal);
  if(checked.sha256!==expected.sha256||checked.byteLength!==expected.byteLength||checked.mime!==expected.mime||checked.name!==expected.name)throw new Error('Reselect the exact originally reviewed file.');
  const form=new FormData();form.append('network','public');form.append('cid_version','v1');form.append('file',new File([file],expected.name,{type:expected.mime}),expected.name);
  const response=await fetch(url.href,{method:'POST',body:form,credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal});
  if(!response.ok||!response.body||!response.headers.get('Content-Type')?.includes('application/json'))throw new Error('The upload outcome is not verified. Check publication history and Pinata before requesting another upload.');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16384)throw new Error('The upload response was too large.');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let result;try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('The upload returned an invalid response. Recover its CID from publication history or Pinata before trying again.');}
  if(result?.data?.size!==expected.byteLength||(result.data.network!==undefined&&result.data.network!=='public')||typeof result.data.cid!=='string')throw new Error('The upload result did not match the reviewed public file.');
  try{publicIpfsUri('ipfs://'+result.data.cid);if(result.data.cid.includes('/'))throw new Error();}catch{throw new Error('The public file identifier could not be verified. Recover the original upload before retrying.');}return result.data.cid;
}

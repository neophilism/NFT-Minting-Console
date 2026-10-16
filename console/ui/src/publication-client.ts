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
function invalidRow():never{throw new Error('The saved public work or its exact file commitments could not be verified.');}
function record(value:unknown,keys:string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)invalidRow();
  const v=value as Record<string,unknown>;
  if(Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))invalidRow();return v;
}
function identity(value:unknown):string{if(typeof value!=='string'||!(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i).test(value))invalidRow();return value;}
function tokenId(value:unknown):string{if(typeof value!=='string'||!(/^[1-9][0-9]{0,77}$/).test(value)||BigInt(value)>=1n<<256n)invalidRow();return value;}
function timestamp(value:unknown):string{if(typeof value!=='string'||value.length>40||!Number.isFinite(Date.parse(value)))invalidRow();return value;}
function title(value:unknown):string{if(typeof value!=='string'||!value.trim()||new TextEncoder().encode(value).length>200)invalidRow();return value;}
function fileDescription(value:Record<string,unknown>):PublicFile{
  const {kind,name,mime,byteLength}=value;
  if(typeof kind!=='string'||!Object.hasOwn(formats,kind)||typeof name!=='string'||!name||name.length>200||name.trim()!==name||/[\\/]/.test(name)||Array.from(name).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))invalidRow();
  const format=formats[kind as FileKind],ext=name.slice(name.lastIndexOf('.')).toLowerCase();
  if(!Object.hasOwn(format.extensions,ext)||format.extensions[ext]!==mime||typeof byteLength!=='number'||!Number.isSafeInteger(byteLength)||byteLength<1||byteLength>format.max||typeof value.sha256!=='string'||!(/^[a-f0-9]{64}$/).test(value.sha256))invalidRow();
  return {kind:kind as FileKind,name,mime:mime as string,byteLength,sha256:value.sha256};
}
function savedUri(value:unknown):string|null{if(value===null)return null;if(typeof value!=='string'||value.slice(7).includes('/'))invalidRow();return publicIpfsUri(value);}
export function publicRow(value:unknown,expectedId?:string):PublicWorkRow{
  const v=record(value,['id','plan','metadataJson','files','createdAt']),id=identity(v.id),p=record(v.plan,['version','id','tokenId','title','description','rightsScope','files','publicDisclosureConfirmed']);
  if((expectedId!==undefined&&id!==expectedId)||p.version!==1||p.id!==id||p.publicDisclosureConfirmed!==true||typeof p.description!=='string'||p.description.length>12000||!['token','collection'].includes(p.rightsScope as string)||!Array.isArray(p.files)||p.files.length<2||p.files.length>3)invalidRow();
  const original=p.files.map(f=>fileDescription(record(f,['kind','name','mime','byteLength','sha256']))),kinds=new Set(original.map(f=>f.kind));
  if(kinds.size!==original.length||!kinds.has('image')||!kinds.has('rights')||kinds.has('metadata'))invalidRow();
  if(!Array.isArray(v.files)||v.files.length!==original.length+(v.metadataJson===null?0:1))invalidRow();
  const files=v.files.map(input=>{const f=record(input,['kind','name','mime','byteLength','sha256','attempts','issuedAt','candidateUri','verifiedUri']),description=fileDescription(f);
    if(typeof f.attempts!=='number'||!Number.isInteger(f.attempts)||f.attempts<0||f.attempts>20)invalidRow();
    const issuedAt=f.issuedAt===null?null:timestamp(f.issuedAt),candidateUri=savedUri(f.candidateUri),verifiedUri=savedUri(f.verifiedUri);
    if((f.attempts===0)!==(issuedAt===null)||(verifiedUri!==null&&verifiedUri!==candidateUri))invalidRow();
    return {...description,attempts:f.attempts,issuedAt,candidateUri,verifiedUri};});
  if(new Set(files.map(f=>f.kind)).size!==files.length)invalidRow();
  for(const f of original){const saved=files.find(x=>x.kind===f.kind);if(!saved||saved.name!==f.name||saved.mime!==f.mime||saved.byteLength!==f.byteLength||saved.sha256!==f.sha256)invalidRow();}
  let metadataJson:string|null=null;
  if(v.metadataJson!==null){
    if(typeof v.metadataJson!=='string')invalidRow();const bytes=new TextEncoder().encode(v.metadataJson),metadata=files.find(f=>f.kind==='metadata');
    if(bytes.length>131072||!metadata||metadata.byteLength!==bytes.length||metadata.sha256!==hex(sha256(bytes)))invalidRow();metadataJson=v.metadataJson;
  }
  return {id,plan:{version:1,id,tokenId:tokenId(p.tokenId),title:title(p.title),description:p.description,rightsScope:p.rightsScope as 'token'|'collection',files:original,publicDisclosureConfirmed:true},files,metadataJson,createdAt:timestamp(v.createdAt)};
}
export interface PublicWorkHistory {items:{id:string;title:string;tokenId:string;createdAt:string}[];nextCursor:string|null}
export function publicHistory(value:unknown):PublicWorkHistory{
  const v=record(value,['items','nextCursor']);if(!Array.isArray(v.items)||v.items.length>50)invalidRow();
  const items=v.items.map(input=>{const r=record(input,['id','title','tokenId','createdAt']);return {id:identity(r.id),title:title(r.title),tokenId:tokenId(r.tokenId),createdAt:timestamp(r.createdAt)};});
  if(new Set(items.map(r=>r.id)).size!==items.length)invalidRow();
  const nextCursor=v.nextCursor===null?null:identity(v.nextCursor);if(nextCursor!==null&&nextCursor!==items.at(-1)?.id)invalidRow();return {items,nextCursor};
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

import {createHash} from 'node:crypto';
import {publicIpfsUri} from './ipfs-uri.mjs';
import {reviewedWork} from '../launch/public-content.mjs';
export class WorkbenchError extends Error{constructor(code,status=409){super(code);this.code=code;this.status=status;}}
export const stop=code=>{throw new WorkbenchError(code);};
export const TYPES=Object.freeze({
  image:{max:33554432,mime:{'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'}},
  rights:{max:8388608,mime:{'.txt':'text/plain','.md':'text/markdown','.pdf':'application/pdf'}},
  media:{max:2147483648,mime:{'.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.m4a':'audio/mp4'}},
  metadata:{max:131072,mime:{'.json':'application/json'}}
});
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function exact(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))stop('INVALID_PUBLICATION_INPUT');}
export function workId(value){if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value))stop('INVALID_PUBLICATION_ID');return value.toLowerCase();}
export function descriptor(v){
  exact(v,['kind','name','mime','byteLength','sha256']);const type=TYPES[v.kind];
  if(!type||typeof v.name!=='string'||!v.name||v.name.length>200||v.name.trim()!==v.name||/[\\/]/.test(v.name)||Array.from(v.name).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))stop('INVALID_FILE_DESCRIPTION');
  const extension=v.name.slice(v.name.lastIndexOf('.')).toLowerCase();
  if(type.mime[extension]!==v.mime||!Number.isSafeInteger(v.byteLength)||v.byteLength<1||v.byteLength>type.max||typeof v.sha256!=='string'||!/^[a-f0-9]{64}$/.test(v.sha256))stop('INVALID_FILE_DESCRIPTION');
  return {kind:v.kind,name:v.name,mime:v.mime,byteLength:v.byteLength,sha256:v.sha256};
}
export function publicWork(v){
  exact(v,['version','id','tokenId','title','description','rightsScope','files','publicDisclosureConfirmed']);
  if(v.version!==1||v.publicDisclosureConfirmed!==true)stop('PUBLIC_CONSENT_REQUIRED');
  const id=workId(v.id);
  if(typeof v.tokenId!=='string'||!/^[1-9][0-9]{0,77}$/.test(v.tokenId)||BigInt(v.tokenId)>=(1n<<256n)||typeof v.title!=='string'||!v.title.trim()||Buffer.byteLength(v.title)>200||typeof v.description!=='string'||v.description.length>12000||!['token','collection'].includes(v.rightsScope))stop('INVALID_PUBLIC_WORK');
  if(!Array.isArray(v.files)||v.files.length<2||v.files.length>3)stop('INVALID_PUBLIC_WORK');
  const files=v.files.map(descriptor).sort((a,b)=>a.kind.localeCompare(b.kind)),kinds=new Set(files.map(f=>f.kind));
  if(kinds.size!==files.length||!kinds.has('image')||!kinds.has('rights')||kinds.has('metadata'))stop('INVALID_PUBLIC_WORK');
  return {version:1,id,tokenId:v.tokenId,title:v.title,description:v.description,rightsScope:v.rightsScope,files,publicDisclosureConfirmed:true};
}
export function metadataFor(plan,files){
  const by=Object.fromEntries(files.map(f=>[f.kind,f]));
  for(const file of plan.files){if(!by[file.kind]?.verifiedUri)stop('PUBLIC_FILES_NOT_VERIFIED');publicIpfsUri(by[file.kind].verifiedUri);}
  const metadata={name:plan.title,description:plan.description,image:by.image.verifiedUri,...(by.media?{animation_url:by.media.verifiedUri}:{}),attributes:[],properties:{media_sha256:(by.media||by.image).sha256,...(by.media?{poster_sha256:by.image.sha256}:{}),rights_uri:by.rights.verifiedUri,rights_sha256:by.rights.sha256,rights_scope:plan.rightsScope}};
  const text=JSON.stringify(metadata,null,2)+'\n';
  const file=descriptor({kind:'metadata',name:'token-'+plan.tokenId+'.json',mime:'application/json',byteLength:Buffer.byteLength(text),sha256:sha(text)});
  return {text,file};
}
export function bundleFor(plan,files,metadataJson){
  const by=Object.fromEntries(files.map(f=>[f.kind,f]));
  if(!metadataJson||!by.metadata?.verifiedUri||files.some(f=>!f.verifiedUri))stop('METADATA_NOT_VERIFIED');
  const work={tokenId:plan.tokenId,title:plan.title,metadataURI:by.metadata.verifiedUri,mediaHash:'0x'+(by.media||by.image).sha256,rightsURI:by.rights.verifiedUri,rightsHash:'0x'+by.rights.sha256};
  const item={work,files:{version:1,publicDisclosureConfirmed:true,files:files.map(f=>({kind:f.kind,uri:f.verifiedUri,sha256:f.sha256,byteLength:f.byteLength}))},metadataJson};
  reviewedWork(item);return {version:1,works:[item]};

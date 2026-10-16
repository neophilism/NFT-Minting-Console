import { createHash } from 'node:crypto';
import { publicFileManifest, verifyPublicFiles } from '../publication/readback.mjs';
import { exact, stop } from './contracts.mjs';
/** Bind public metadata bytes and all public file digests to the exact on-chain mint values. */
export function reviewedWork(input){
  exact(input,['work','files','metadataJson']);
  const files=publicFileManifest(input.files),byKind=Object.fromEntries(files.map(f=>[f.kind,f]));
  const {work,metadataJson}=input;
  if(typeof metadataJson!=='string'||Buffer.byteLength(metadataJson)>131072||!byKind.metadata||!byKind.image||!byKind.rights)stop('PUBLIC_CONTENT_REQUIRED');
  const digest=createHash('sha256').update(metadataJson,'utf8').digest('hex');
  if(digest!==byKind.metadata.sha256||Buffer.byteLength(metadataJson)!==byKind.metadata.byteLength)stop('METADATA_BYTES_MISMATCH');
  let metadata;try{metadata=JSON.parse(metadataJson);}catch{stop('INVALID_METADATA');}
  const allowed=['name','description','image','animation_url','attributes','properties'];
  if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)||Object.keys(metadata).some(k=>!allowed.includes(k))||
    JSON.stringify(metadata,null,2)+'\n'!==metadataJson||typeof metadata.description!=='string'||!Array.isArray(metadata.attributes)||metadata.attributes.length>100)stop('INVALID_METADATA');
  const p=metadata.properties,media=byKind.media||byKind.image;
  if(!p||Object.keys(p).some(k=>!['media_sha256','poster_sha256','rights_uri','rights_sha256','rights_scope'].includes(k))||
    !['collection','token'].includes(p.rights_scope)||metadata.name!==work.title||metadata.image!==byKind.image.uri||
    (byKind.media?metadata.animation_url!==byKind.media.uri:metadata.animation_url!==undefined)||
    p.media_sha256!==media.sha256||(byKind.media?p.poster_sha256!==byKind.image.sha256:p.poster_sha256!==undefined)||
    p.rights_uri!==byKind.rights.uri||p.rights_sha256!==byKind.rights.sha256||
    work.metadataURI!==byKind.metadata.uri||work.rightsURI!==byKind.rights.uri||work.mediaHash!=='0x'+media.sha256||work.rightsHash!=='0x'+byKind.rights.sha256)stop('PUBLIC_COMMITMENT_MISMATCH');
  return Object.freeze({work:Object.freeze({...work}),manifest:{version:1,publicDisclosureConfirmed:true,files}});
}
export async function verifyReviewedWorks(inputs,options={}){
  if(!Array.isArray(inputs)||inputs.length<1||inputs.length>10)stop('INVALID_BATCH');
  const reviewed=inputs.map(reviewedWork),seen=new Set();
  for(const {manifest} of reviewed){
    const files=manifest.files.filter(f=>{const key=JSON.stringify(f);if(seen.has(key))return false;seen.add(key);return true;});
    if(files.length)await verifyPublicFiles({...manifest,files},options);
  }
  return reviewed.map(x=>x.work);
}

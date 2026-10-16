import {createHash} from 'node:crypto';
import {readFile,lstat,open,rename,mkdir} from 'node:fs/promises';
import {openAsBlob} from 'node:fs';
import path from 'node:path';
import {exact,stop} from './contracts.mjs';
import {publishReviewedFile,PUBLIC_UPLOAD_TYPES} from '../publication/pinata-public.mjs';
import {reviewedWork} from './public-content.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Operator-only: local inputs become public only after an exact-file digest review and explicit consent. */
export async function inspectRelease(file){
  const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>131072)stop('INVALID_RELEASE_FILE');
  const text=await readFile(file,'utf8'),release=JSON.parse(text);exact(release,['version','tokenId','title','description','image','media','rights','rightsScope']);
  if(release.version!==1||typeof release.tokenId!=='string'||!/^[1-9][0-9]{0,77}$/.test(release.tokenId)||BigInt(release.tokenId)>=(1n<<256n)||
    typeof release.title!=='string'||!release.title.trim()||Buffer.byteLength(release.title)>200||
    typeof release.description!=='string'||release.description.length>12000||!['collection','token'].includes(release.rightsScope))stop('INVALID_RELEASE_FILE');
  const assets={};
  for(const kind of ['image','media','rights']){
    const relative=release[kind];if(kind==='media'&&relative===null)continue;
    if(typeof relative!=='string'||!relative||relative.length>4096)stop('INVALID_RELEASE_FILE');
    const source=path.resolve(path.dirname(file),relative),stat=await lstat(source);
    const type=PUBLIC_UPLOAD_TYPES[kind];
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>type.max||!type.extensions.includes(path.extname(source).toLowerCase()))stop('INVALID_SOURCE');
    const blob=await openAsBlob(source),digest=createHash('sha256');let n=0;
    for await(const chunk of blob.stream()){digest.update(chunk);n+=chunk.length;}
    if(n!==stat.size)stop('SOURCE_CHANGED');
    assets[kind]={source,name:path.basename(source),sha256:digest.digest('hex'),byteLength:stat.size};
  }
  return {version:1,release,assets,reviewSha256:sha(JSON.stringify({release,assets}))};
}
async function exclusiveJson(file,value){
  await mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const handle=await open(file,'wx',0o600);try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}
}
async function checkpoint(file,value){
  const temporary=file+'.next';await exclusiveJson(temporary,value);await rename(temporary,file);
}
/** Sequential, checkpointed publication. An uncertain upload is never blindly retried. */
export async function publishRelease(file,reviewSha256,output,{jwt,publish=publishReviewedFile}={}){
  const inspected=await inspectRelease(file);if(inspected.reviewSha256!==reviewSha256)stop('RELEASE_REVIEW_CHANGED');
  const stateFile=path.resolve(output)+'.publication.json';
  let state;
  try{
    state=JSON.parse(await readFile(stateFile,'utf8'));
    if(state.reviewSha256!==reviewSha256)stop('PUBLICATION_STATE_MISMATCH');
    if(state.pending)stop('UNCERTAIN_UPLOAD_REQUIRES_RECONCILIATION');
  }catch(e){if(e.code!=='ENOENT')throw e;state={version:1,reviewSha256,pending:null,uploaded:{}};await exclusiveJson(stateFile,state);}
  const upload=async(kind,name,blob,digest)=>{
    if(state.uploaded[kind])return state.uploaded[kind];
    state.pending={kind,name,sha256:digest,byteLength:blob.size};await checkpoint(stateFile,state);
    const result=await publish({kind,name,blob,sha256:digest,acknowledgePublic:true,jwt});
    state.uploaded[kind]=result.manifest.files[0];state.pending=null;await checkpoint(stateFile,state);return state.uploaded[kind];
  };
  for(const [kind,asset] of Object.entries(inspected.assets))await upload(kind,asset.name,await openAsBlob(asset.source),asset.sha256);
  const {release}=inspected,f=state.uploaded;
  const metadata={name:release.title,description:release.description,image:f.image.uri,...(f.media?{animation_url:f.media.uri}:{}),attributes:[],
    properties:{media_sha256:(f.media||f.image).sha256,...(f.media?{poster_sha256:f.image.sha256}:{}),rights_uri:f.rights.uri,rights_sha256:f.rights.sha256,rights_scope:release.rightsScope}};
  const metadataJson=JSON.stringify(metadata,null,2)+'\n';
  await upload('metadata','token-'+release.tokenId+'.json',new Blob([metadataJson],{type:'application/json'}),sha(metadataJson));
  const work={tokenId:release.tokenId,title:release.title,metadataURI:f.metadata.uri,mediaHash:'0x'+(f.media||f.image).sha256,rightsURI:f.rights.uri,rightsHash:'0x'+f.rights.sha256};
  const item={work,files:{version:1,publicDisclosureConfirmed:true,files:Object.values(f)},metadataJson};reviewedWork(item);
  const bundle={version:1,works:[item]};await exclusiveJson(path.resolve(output),bundle);return {output:path.resolve(output),tokenId:release.tokenId,publicFilesVerified:true,mintAuthorized:false};
}

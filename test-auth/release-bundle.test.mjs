import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {inspectRelease,publishRelease} from '../console/launch/bundle.mjs';
const cid='bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq';
test('reviewed public release builds exact linked mint bundle; resumed successful files are not uploaded again',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'public-release-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const release={version:1,tokenId:'1',title:'Synthetic release',description:'Public test',image:'poster.png',media:'video.mp4',rights:'rights.md',rightsScope:'token'};
  const file=path.join(dir,'release.json');await writeFile(file,JSON.stringify(release));
  for(const name of ['poster.png','video.mp4','rights.md'])await writeFile(path.join(dir,name),'synthetic '+name);
  const inspected=await inspectRelease(file),output=path.join(dir,'bundle.json');let calls=0;
  const publish=async({kind,sha256,blob})=>{calls++;return {manifest:{files:[{kind,uri:'ipfs://'+cid+'/'+kind,sha256,byteLength:blob.size}]}};};
  await assert.rejects(publishRelease(file,'0'.repeat(64),output,{publish}),e=>e.code==='RELEASE_REVIEW_CHANGED');assert.equal(calls,0);
  const result=await publishRelease(file,inspected.reviewSha256,output,{publish});assert.equal(calls,4);assert.equal(result.mintAuthorized,false);
  const bundle=JSON.parse(await readFile(output,'utf8'));assert.equal(bundle.works[0].work.title,release.title);assert.equal(bundle.works[0].files.files.length,4);
  await assert.rejects(publishRelease(file,inspected.reviewSha256,output,{publish}),e=>e.code==='EEXIST');assert.equal(calls,4);
  await writeFile(path.join(dir,'rights.md'),'changed rights');await assert.rejects(publishRelease(file,inspected.reviewSha256,output,{publish}),e=>e.code==='RELEASE_REVIEW_CHANGED');
});
test('uncertain public upload leaves a blocking checkpoint across process restart',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'public-uncertain-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const release={version:1,tokenId:'1',title:'Test',description:'',image:'poster.png',media:null,rights:'rights.md',rightsScope:'collection'};
  const file=path.join(dir,'release.json'),output=path.join(dir,'bundle.json');await writeFile(file,JSON.stringify(release));await writeFile(path.join(dir,'poster.png'),'test');await writeFile(path.join(dir,'rights.md'),'rights');
  const review=await inspectRelease(file);let calls=0;const publish=async()=>{calls++;throw new Error('Lost upload response');};
  await assert.rejects(publishRelease(file,review.reviewSha256,output,{publish}));
  await assert.rejects(publishRelease(file,review.reviewSha256,output,{publish}),e=>e.code==='UNCERTAIN_UPLOAD_REQUIRES_RECONCILIATION');assert.equal(calls,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {publishReviewedFile,PublicUploadError} from '../console/publication/pinata-public.mjs';
const cid='bafkreidvbhs33ighmljlvr7zbv2ywwzcmp5adtf4kqvlly67cy56bdtmve';
const jwt='synthetic-fixture-only-credential-1234567';
const bytes=Buffer.from('Approved legal document\r\n');
const sha256=createHash('sha256').update(bytes).digest('hex');
const approved=()=>({kind:'rights',name:'RIGHTS.md',blob:new Blob([bytes],{type:'text/markdown'}),sha256,acknowledgePublic:true,jwt});
const code=name=>e=>e instanceof PublicUploadError&&e.code===name;
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json'}});
test('explicit review posts one public file with server credential and verifies returned gateway bytes',async()=>{
  let posts=0,reads=0;
  const result=await publishReviewedFile({...approved(),fetchImpl:async(url,options)=>{
    if(url==='https://uploads.pinata.cloud/v3/files'){
      posts++;
      assert.equal(options.method,'POST');
      assert.equal(options.redirect,'manual');
      assert.equal(options.credentials,'omit');
      assert.equal(options.headers.Authorization,'Bearer '+jwt);
      assert.equal(options.body.get('network'),'public');
      assert.equal(options.body.get('cid_version'),'v1');
      const file=options.body.get('file');
      assert.equal(file.name,'RIGHTS.md');
      assert.deepEqual(Buffer.from(await file.arrayBuffer()),bytes);
      return json({data:{cid,size:bytes.length,network:'public'}});
    }
    reads++;
    assert.equal(url,'https://gateway.pinata.cloud/ipfs/'+cid);
    assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,undefined);
    return new Response(bytes,{headers:{'content-length':String(bytes.length)}});
  }});
  assert.equal(posts,1);assert.equal(reads,1);
  assert.equal(result.uri,'ipfs://'+cid);
  assert.equal(result.exactBytesVerified,true);
  assert.equal(result.mintAuthorized,false);
  assert.equal(result.manifest.files[0].sha256,sha256);
});
test('no public upload without consent, exact original digest, bounded type and valid file name',async()=>{
  let called=0;const fetchImpl=async()=>{called++;throw Error('should not upload');};
  const changes=[
    a=>a.acknowledgePublic=false,a=>a.sha256='0'.repeat(64),
    a=>a.name='../sensitive.md',a=>a.name='document.html',
    a=>a.blob=new Blob([]),a=>a.kind='metadata',
    a=>a.jwt='tiny',a=>a.name='evil\n.txt'
  ];
  for(const change of changes){
    const args=approved();change(args);
    await assert.rejects(publishReviewedFile({...args,fetchImpl}),e=>e instanceof PublicUploadError);
  }
  assert.equal(called,0);
});
test('wrong size, wrong network and invalid CID do not claim a verified publication',async()=>{
  for(const [payload,error] of [
    [{cid,size:bytes.length+1,network:'public'},'UPLOAD_SIZE_MISMATCH'],
    [{cid,size:bytes.length,network:'private'},'NOT_PUBLIC'],
    [{cid:'https://evil.invalid',size:bytes.length},'INVALID_CID']
  ]){
    await assert.rejects(publishReviewedFile({...approved(),fetchImpl:async()=>json({data:payload})}),code(error));
  }
});
test('a same-length gateway tampering is rejected and the API POST is never retried',async()=>{
  let uploads=0,downloads=0;
  await assert.rejects(publishReviewedFile({...approved(),fetchImpl:async url=>{
    if(url.includes('uploads.pinata.cloud')){uploads++;return json({data:{cid,size:bytes.length,network:'public'}});}
    downloads++;return new Response(Buffer.alloc(bytes.length,35));
  }}),e=>code('READBACK_PENDING')(e)&&e.cid===cid);
  assert.equal(uploads,1);assert.equal(downloads,1);
});
test('remote redirects, huge responses and remote secret-bearing errors fail closed',async()=>{
  await assert.rejects(publishReviewedFile({...approved(),fetchImpl:async()=>new Response(null,{status:302,headers:{Location:'https://evil.invalid'}})}),code('REFUSED_REDIRECT'));
  await assert.rejects(publishReviewedFile({...approved(),fetchImpl:async()=>new Response('x'.repeat(17000),{headers:{'content-type':'application/json'}})}),code('RESPONSE_TOO_LARGE'));
  await assert.rejects(publishReviewedFile({...approved(),fetchImpl:async()=>{throw Error('secret '+jwt)}}),e=>code('NETWORK_FAILURE')(e)&&!e.message.includes(jwt));
});

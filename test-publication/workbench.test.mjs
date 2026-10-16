import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {migrate} from '../scripts/migrate.mjs';
import {migrateAuth} from '../scripts/migrate-auth.mjs';
import {ReleaseRepository} from '../console/data/releases.mjs';
import {publicWork,descriptor,sha} from '../console/publication/workbench-model.mjs';
import {PublicationWorkbenchStore} from '../console/publication/workbench-store.mjs';
import {authorizePublicUpload,signedUploadUrl} from '../console/publication/signed-upload.mjs';
const uri='ipfs://bafkreifopysboafwtjobwrxsktuvqa6xhatvq4uww22jn3tedhemzwvfwa';
const file=kind=>({kind,name:kind==='rights'?'rights.md':'art.png',mime:kind==='rights'?'text/markdown':'image/png',byteLength:kind==='rights'?5:6,sha256:sha(kind==='rights'?'terms':'pixels')});
const plan=()=>({version:1,id:randomUUID(),tokenId:'1',title:'Only approved public art',description:'A public description',rightsScope:'token',files:[file('image'),file('rights')],publicDisclosureConfirmed:true});
class Pool{constructor(db){this.db=db;this.queue=Promise.resolve();}async connect(){const previous=this.queue;let release;this.queue=new Promise(resolve=>{release=resolve;});await previous;return{query:(...args)=>this.db.query(...args),release};}}
test('publication plans reject unknown fields, private payloads, bad types and changed commitments',()=>{
  assert.equal(publicWork(plan()).files.length,2);
  for(const patch of [{publicDisclosureConfirmed:false},{privateKey:'none'},{tokenId:'0'},{files:[file('image')]},{files:[file('rights'),file('rights')]},{rightsScope:'unspecified'}])assert.throws(()=>publicWork({...plan(),...patch}));
  for(const patch of [{name:'../rights.md'},{name:'bad\n.md'},{mime:'text/html'},{sha256:'invalid'},{byteLength:0}])assert.throws(()=>descriptor({...file('rights'),...patch}));
});
test('Pinata upload authorization is HTTPS-host-bound, public, MIME/size bounded and does not expose JWT',async()=>{
  let body;const result=await authorizePublicUpload(file('image'),{jwt:'synthetic-not-a-real-jwt',fetchImpl:async(url,options)=>{assert.equal(url,'https://uploads.pinata.cloud/v3/files/sign');assert.equal(options.redirect,'manual');body=JSON.parse(options.body);return new Response(JSON.stringify({data:'https://uploads.pinata.cloud/v3/files?synthetic=secret'}),{status:200,headers:{'Content-Type':'application/json'}});}});
  assert.equal(body.network,'public');assert.equal(body.expires,300);assert.equal(body.max_file_size,6);assert.deepEqual(body.allow_mime_types,['image/png']);assert.equal(Object.hasOwn(result,'jwt'),false);
  for(const url of ['http://uploads.pinata.cloud/v3/files?x=y','https://attacker.invalid/v3/files?x=y','https://uploads.pinata.cloud/v3/files','https://uploads.pinata.cloud/v3/tus?x=y'])assert.throws(()=>signedUploadUrl(url));
  await assert.rejects(authorizePublicUpload(file('image'),{jwt:'synthetic-not-a-real-jwt',fetchImpl:async()=>new Response('secret-response',{status:403})}),e=>e.code==='PINATA_CREDENTIAL_REJECTED'&&!e.message.includes('secret-response'));
});
test('actual SQL public workbench is isolated, idempotent and does not blindly retry uploads',async t=>{
  const db=new PGlite();await db.waitReady;await migrate(db);await migrateAuth(db);await db.query('GRANT nft_console_api,nft_console_auth_service,nft_console_identity TO CURRENT_USER WITH INHERIT FALSE');t.after(()=>db.close());
  const one={wallet:'0x'+'11'.repeat(20),chainId:1,role:'owner'},two={wallet:'0x'+'22'.repeat(20),chainId:1,role:'owner'};
  const repository=new ReleaseRepository({pool:new Pool(db),knownRoles:()=>new Map([[one.wallet,'owner'],[two.wallet,'owner']])}),store=new PublicationWorkbenchStore(repository),p=plan();
  const row=await store.create(one,p);assert.equal(row.files.length,2);assert.equal((await store.create(one,p)).id,row.id);await assert.rejects(store.create(one,{...p,title:'changed'}),e=>e.code==='PUBLICATION_CHANGED');await assert.rejects(store.get(two,row.id),e=>e.code==='PUBLIC_WORK_NOT_FOUND');assert.equal((await store.list(two)).items.length,0);
  const attempt=await Promise.allSettled([store.issue(one,row.id,'image',false),store.issue(one,row.id,'image',false)]);assert.equal(attempt.filter(r=>r.status==='fulfilled').length,1);assert.equal(attempt.filter(r=>r.status==='rejected').length,1);await assert.rejects(store.issue(one,row.id,'image',true),e=>e.code==='UNCERTAIN_UPLOAD_REQUIRES_REVIEW');
  await assert.rejects(store.metadata(one,row.id),e=>e.code==='PUBLIC_FILES_NOT_VERIFIED');
  // Only the HTTP verifier may call verified after readback. This test exercises SQL state transitions.
  for(const kind of ['image','rights']){await store.candidate(one,row.id,kind,uri+'/'+kind);await store.verified(one,row.id,kind,uri+'/'+kind);}
  await assert.rejects(store.candidate(one,row.id,'image',uri+'/changed'),e=>e.code==='PUBLICATION_CHANGED');
  const prepared=await store.metadata(one,row.id);assert.equal(prepared.files.length,3);assert.equal((await store.metadata(one,row.id)).metadataJson,prepared.metadataJson);await assert.rejects(store.bundle(one,row.id),e=>e.code==='METADATA_NOT_VERIFIED');
  await store.candidate(one,row.id,'metadata',uri+'/metadata');await store.verified(one,row.id,'metadata',uri+'/metadata');const bundle=await store.bundle(one,row.id);assert.equal(bundle.works[0].work.tokenId,'1');assert.equal(bundle.works[0].metadataJson,prepared.metadataJson);assert.equal(bundle.works[0].files.files.length,3);
  await assert.rejects(store.tx(one,row.id,(client,account)=>client.query("UPDATE nft_console.public_upload_slots SET verified_uri=$3 WHERE account_id=$1 AND work_id=$2 AND kind='image'",[account,row.id,uri+'/changed'])));
  await assert.rejects(store.tx(one,row.id,(client,account)=>client.query("UPDATE nft_console.public_workbench SET metadata_json='changed' WHERE account_id=$1 AND id=$2",[account,row.id])));
});

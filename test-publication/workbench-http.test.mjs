import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {migrate} from '../scripts/migrate.mjs';
import {migrateAuth} from '../scripts/migrate-auth.mjs';
import {ReleaseRepository} from '../console/data/releases.mjs';
import {installPublicationWorkbench} from '../console/publication/workbench-http.mjs';
import {sha} from '../console/publication/workbench-model.mjs';
import {rawCid} from '../test-ui/publication-fixture.mjs';
class Pool{constructor(db){this.db=db;this.queue=Promise.resolve();}async connect(){const previous=this.queue;let release;this.queue=new Promise(resolve=>{release=resolve;});await previous;return{query:(...args)=>this.db.query(...args),release};}}
test('HTTP publication verifies the exact received bytes, recovers without duplicate publishing and binds metadata',async t=>{
  const db=new PGlite();await db.waitReady;await migrate(db);await migrateAuth(db);await db.query('GRANT nft_console_api,nft_console_auth_service,nft_console_identity TO CURRENT_USER WITH INHERIT FALSE');
  const actor={wallet:'0x'+'ab'.repeat(20),chainId:31337,role:'owner'},other={wallet:'0x'+'cd'.repeat(20),chainId:31337,role:'owner'};
  const repository=new ReleaseRepository({pool:new Pool(db),knownRoles:()=>new Map([[actor.wallet,'owner'],[other.wallet,'owner']])});
  const image=Buffer.from('Synthetic original artwork'),rights=Buffer.from('Synthetic exact rights'),objects=new Map([[rawCid(image),image],[rawCid(rights),rights]]);let authorizations=0,reads=0,corrupt=false;
  const app=express();app.use(express.json({limit:'64kb'}));
  const requireAction=action=>{assert.equal(action,'publish');return(req,res,next)=>{if(req.get('X-Synthetic-Role')==='viewer')return res.sendStatus(403);req.actor=req.get('X-Synthetic-Role')==='other'?other:actor;next();};};
  installPublicationWorkbench(app,requireAction,{repository,jwt:'not-a-real-jwt',authorize:async(file,{issuedAt})=>{authorizations++;assert.ok(issuedAt);return{url:'https://uploads.pinata.cloud/v3/files?synthetic=only',expiresAt:new Date(Date.now()+300000).toISOString()};},contentOptions:{fetchImpl:async url=>{reads++;assert.ok(url.startsWith('https://gateway.pinata.cloud/ipfs/'));const bytes=objects.get(url.split('/').at(-1));return bytes?new Response(corrupt?Buffer.alloc(bytes.length,0):bytes,{status:200}):new Response('',{status:404});}}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await db.close();});
  const base='http://127.0.0.1:'+server.address().port+'/api/publication/works';
  async function post(path,body,role='owner'){return fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Synthetic-Role':role},body:JSON.stringify(body)});}
  const p={version:1,id:randomUUID(),tokenId:'1',title:'Synthetic',description:'No real upload',rightsScope:'token',files:[{kind:'image',name:'art.png',mime:'image/png',byteLength:image.length,sha256:sha(image)},{kind:'rights',name:'terms.md',mime:'text/markdown',byteLength:rights.length,sha256:sha(rights)}],publicDisclosureConfirmed:true};
  assert.equal((await post('',p,'viewer')).status,403);assert.equal((await post('',{...p,privateKey:'rejected'})).status,409);assert.equal(authorizations,0);assert.equal(reads,0);
  assert.equal((await post('',p)).status,200);assert.equal((await fetch(base+'/'+p.id,{headers:{'X-Synthetic-Role':'other'}})).status,404);
  assert.equal((await post('/'+p.id+'/files/image/authorize',{publicDisclosureConfirmed:false,repeatMayDuplicateUpload:false})).status,409);assert.equal(authorizations,0);
  const auth=await post('/'+p.id+'/files/image/authorize',{publicDisclosureConfirmed:true,repeatMayDuplicateUpload:false});assert.equal(auth.status,200);assert.equal(authorizations,1);assert.doesNotMatch(await auth.text(),/not-a-real-jwt/);
  assert.equal((await post('/'+p.id+'/files/image/authorize',{publicDisclosureConfirmed:true,repeatMayDuplicateUpload:false})).status,409);assert.equal(authorizations,1);
  corrupt=true;const bad=await post('/'+p.id+'/files/image/verify',{cid:rawCid(image)});assert.equal(bad.status,409);assert.equal((await bad.json()).code,'DIGEST_MISMATCH');const pending=await(await fetch(base+'/'+p.id)).json();assert.equal(pending.files.find(f=>f.kind==='image').verifiedUri,null);assert.equal(pending.files.find(f=>f.kind==='image').candidateUri,'ipfs://'+rawCid(image));assert.equal((await fetch(base+'/'+p.id+'/bundle')).status,409);
  corrupt=false;assert.equal((await post('/'+p.id+'/files/image/verify',{cid:rawCid(image)})).status,200);assert.equal(authorizations,1);
  assert.equal((await post('/'+p.id+'/files/rights/verify',{cid:rawCid(rights)})).status,200);const prepared=await(await post('/'+p.id+'/metadata',{})).json();const metadata=Buffer.from(prepared.metadataJson);objects.set(rawCid(metadata),metadata);
  assert.equal((await post('/'+p.id+'/files/metadata/verify',{cid:rawCid(metadata)})).status,200);const bundle=await(await fetch(base+'/'+p.id+'/bundle')).json();assert.equal(bundle.works[0].metadataJson,metadata.toString());assert.equal(bundle.works[0].work.mediaHash,'0x'+sha(image));assert.equal(bundle.works[0].work.rightsHash,'0x'+sha(rights));assert.equal(bundle.works[0].work.metadataURI,'ipfs://'+rawCid(metadata));assert.equal(authorizations,1);assert.equal((await post('/'+p.id+'/files/image/verify',{cid:'https://evil.invalid/file'})).status,409);
});

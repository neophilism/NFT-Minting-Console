import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {Wallet} from 'ethers';
import {randomBytes} from 'node:crypto';
import {migrate} from '../scripts/migrate.mjs';
import {migrateAuth} from '../scripts/migrate-auth.mjs';
import {InstallationStore,setupDigest} from '../console/setup/store.mjs';
import {installSetupRoutes,authorizeSetupCode} from '../console/setup/http.mjs';
import {createRuntime} from '../console/runtime.mjs';
class Pool {
  constructor(db){this.db=db;this.tail=Promise.resolve();}
  async connect(){const previous=this.tail;let unlock;this.tail=new Promise(resolve=>{unlock=resolve;});await previous;return {query:(...args)=>this.db.query(...args),release:()=>unlock()};}
  async end(){}
}
const code=randomBytes(32).toString('hex'),digest=setupDigest(code);
test('setup code matching is strict, independent of wallet seeds and fails closed',()=>{
  assert.doesNotThrow(()=>authorizeSetupCode(code,code));
  for(const input of [null,{},'','a'.repeat(63),'a'.repeat(65),code.toUpperCase(),'0'.repeat(64)])assert.throws(()=>authorizeSetupCode(input,code));
});
test('browser installation uses actual SQL, one-use bound signatures, durable one-winner claims and restricted privileges',async t=>{
  const db=new PGlite();await db.waitReady;await migrate(db);await migrateAuth(db);const pool=new Pool(db);t.after(()=>db.close());
  await db.query('GRANT nft_console_auth_service TO CURRENT_USER WITH INHERIT FALSE');
  const signer=Wallet.createRandom(),other=Wallet.createRandom(),chainId=31337;
  const origin='http://127.0.0.1:4150',store=new InstallationStore({pool,origin,chainId});
  await t.test('database time and fixed-purpose challenge; incorrect cookie cannot consume it',async()=>{
    const binding=randomBytes(32).toString('hex'),challenge=await store.issue(signer.address,setupDigest(binding),digest);
    assert.match(challenge.message,/Register this wallet as the first NFT Console administrator/);
    assert.match(challenge.message,/This is not a transaction/);
    await assert.rejects(store.consume(challenge.challengeId,setupDigest('wrong'),digest),e=>e.code==='SETUP_CHALLENGE_EXPIRED');
    const [a,b]=await Promise.allSettled([store.consume(challenge.challengeId,setupDigest(binding),digest),store.consume(challenge.challengeId,setupDigest(binding),digest)]);
    assert.equal([a,b].filter(r=>r.status==='fulfilled').length,1);
  });
  await t.test('rotating code invalidates outstanding registration proofs',async()=>{
    const binding=randomBytes(32).toString('hex'),challenge=await store.issue(signer.address,setupDigest(binding),digest);
    await assert.rejects(store.consume(challenge.challengeId,setupDigest(binding),setupDigest('new')),e=>e.code==='SETUP_CHALLENGE_EXPIRED');
  });
  await t.test('expired setup challenges cannot register an administrator',async()=>{
    const binding=randomBytes(32).toString('hex'),challenge=await store.issue(signer.address,setupDigest(binding),digest);
    await db.query("UPDATE nft_console_auth.installation_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[challenge.challengeId]);
    await assert.rejects(store.consume(challenge.challengeId,setupDigest(binding),digest),e=>e.code==='SETUP_CHALLENGE_EXPIRED');
  });
  await t.test('challenge capacity persists across instances',async()=>{
    const bounded=new InstallationStore({pool,origin:origin+'/bounded',chainId});
    for(let i=0;i<16;i++)await bounded.issue(signer.address,setupDigest(String(i)),digest);
    await assert.rejects(new InstallationStore({pool,origin:origin+'/bounded',chainId}).issue(signer.address,digest,digest),e=>e.code==='SETUP_BUSY');
  });
  const app=express(),provider={getNetwork:async()=>({chainId:31337n}),getCode:async()=> '0x'};
  let activated=0;installSetupRoutes(app,{store,provider,origin,chainId,setupCode:code,onClaimed:async()=>{activated++;return true;}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const post=(route,body,extra={})=>fetch(base+'/api/setup/'+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
  let challenge,cookie;
  await t.test('wrong code/origin/type never issues a challenge or exposes a secret',async()=>{
    assert.equal((await post('challenge',{setupCode:'0'.repeat(64),wallet:signer.address,chainId})).status,403);
    assert.equal((await post('challenge',{setupCode:code,wallet:signer.address,chainId},{Origin:'https://attacker.invalid'})).status,403);
    assert.equal((await post('challenge',{setupCode:code,wallet:signer.address,chainId},{'Content-Type':'text/plain'})).status,415);
    assert.equal((await post('challenge',{setupCode:code,wallet:signer.address,chainId:1})).status,409);
    assert.equal(await store.owner(),null);
  });
  await t.test('incorrect signature consumes the nonce but cannot claim',async()=>{
    const response=await post('challenge',{setupCode:code,wallet:signer.address,chainId});challenge=await response.json();cookie=response.headers.get('set-cookie').split(';')[0];
    const signature=await other.signMessage(challenge.message);
    assert.equal((await post('claim',{setupCode:code,challengeId:challenge.challengeId,signature},{Cookie:cookie})).status,401);
    assert.equal((await post('claim',{setupCode:code,challengeId:challenge.challengeId,signature:await signer.signMessage(challenge.message)},{Cookie:cookie})).status,401);
    assert.equal(await store.owner(),null);
  });
  await t.test('real EOA proof registers without any transaction request and survives store recreation',async()=>{
    const response=await post('challenge',{setupCode:code,wallet:signer.address,chainId});assert.equal(response.status,200);challenge=await response.json();cookie=response.headers.get('set-cookie').split(';')[0];
    const answer=await post('claim',{setupCode:code,challengeId:challenge.challengeId,signature:await signer.signMessage(challenge.message)},{Cookie:cookie});assert.equal(answer.status,200);assert.deepEqual(await answer.json(),{registered:true,runtimeReady:true,transactionSent:false});assert.equal(activated,1);assert.equal(await new InstallationStore({pool,origin,chainId}).owner(),signer.address);
    assert.equal((await post('challenge',{setupCode:code,wallet:other.address,chainId})).status,409);
    await assert.rejects(new InstallationStore({pool,origin,chainId:1}).owner(),e=>e.code==='INSTALLATION_NETWORK_MISMATCH');
  });
  await t.test('claim race has one winner and cannot be replaced after code rotation',async()=>{
    const raceOrigin='https://race.example',a=new InstallationStore({pool,origin:raceOrigin,chainId}),b=new InstallationStore({pool,origin:raceOrigin,chainId});
    const outcomes=await Promise.allSettled([a.claim(signer.address,digest),b.claim(other.address,digest)]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);const winner=await a.owner();await assert.rejects(b.claim(other.address,setupDigest('rotated')),e=>e.code==='SETUP_ALREADY_COMPLETE');assert.equal(await b.owner(),winner);
  });
  await t.test('runtime auth-service role may not rewrite or delete the stored administrator',async()=>{
    const result=await store.transaction(client=>client.query("SELECT has_table_privilege(current_user,'nft_console_auth.installations','UPDATE') AS can_update, has_table_privilege(current_user,'nft_console_auth.installations','DELETE') AS can_delete"));assert.deepEqual(result.rows[0],{can_update:false,can_delete:false});
  });
  await t.test('runtime dispatcher preserves durable claim without needing its old setup code',async()=>{
    let created=0;
    const runtime=await createRuntime({env:{NODE_ENV:'test',NFT_SETUP_ENABLED:'1',CHAIN_ID:'31337',PUBLIC_ORIGIN:origin,RPC_URL:'http://127.0.0.1:9999',DATABASE_URL:'postgres://test@127.0.0.1/test'},testDependencies:{pool,store,provider,createApp:({env})=>{created++;assert.equal(env.ADMIN_WALLETS,signer.address);const target=express();target.locals.ready=Promise.resolve();target.locals.close=async()=>{};target.get('/api/config',(_req,res)=>res.json({signedInConfigured:true}));return target;}}});
    await runtime.locals.ready;assert.equal(created,1);await runtime.locals.close();
  });
});
test('production cannot inject test dependencies',async()=>{await assert.rejects(createRuntime({env:{NODE_ENV:'production'},testDependencies:{}}),/test-only/);});

import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {GuardedDatabasePool,databaseOptions} from '../console/data/pool.mjs';
import {InstallationStore,setupDigest} from '../console/setup/store.mjs';
const url=process.env.TEST_DATABASE_URL_UNPOOLED;
if(!url||process.env.NFT_TEST_DISPOSABLE_DATABASE!=='yes'||new URL(url).pathname!=='/nft_console_ci'||!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw new Error('Use only the disposable local native PostgreSQL fixture.');
test('native installation claims have one winner across independent restricted connections',async t=>{
  const admin=new pg.Client(databaseOptions(url));await admin.connect();
  const name='nft_setup_ci_runtime',password=randomBytes(32).toString('hex'),runtime=new URL(url);runtime.username=name;runtime.password=password;
  await admin.query(`CREATE ROLE ${name} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
  await admin.query(`GRANT nft_console_api,nft_console_auth_service,nft_console_identity TO ${name} WITH ADMIN FALSE,INHERIT FALSE,SET TRUE`);
  const aPool=new GuardedDatabasePool(new pg.Pool(databaseOptions(runtime.href))),bPool=new GuardedDatabasePool(new pg.Pool(databaseOptions(runtime.href)));
  t.after(async()=>{await aPool.end();await bPool.end();await admin.end();});
  const origin='https://native-installation.example',chainId=1,a=new InstallationStore({pool:aPool,origin,chainId}),b=new InstallationStore({pool:bPool,origin,chainId});
  const one='0x'+'31'.repeat(20),two='0x'+'42'.repeat(20),key=setupDigest(randomBytes(32)),binding=setupDigest(randomBytes(32));
  assert.equal(await a.owner(),null);
  const challenge=await a.issue(one,binding,key);
  const consumed=await Promise.allSettled([a.consume(challenge.challengeId,binding,key),b.consume(challenge.challengeId,binding,key)]);
  assert.equal(consumed.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(consumed.filter(x=>x.status==='rejected'&&x.reason.code==='SETUP_CHALLENGE_EXPIRED').length,1);
  const claims=await Promise.allSettled([a.claim(one,key),b.claim(two,key)]);
  assert.equal(claims.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(claims.filter(x=>x.status==='rejected'&&x.reason.code==='SETUP_ALREADY_COMPLETE').length,1);
  const owner=await a.owner();assert.ok([one,two].includes(owner.toLowerCase()));assert.equal(await b.owner(),owner);
  await assert.rejects(b.claim(two,setupDigest('rotated')),e=>e.code==='SETUP_ALREADY_COMPLETE');
  await assert.rejects(new InstallationStore({pool:bPool,origin,chainId:11155111}).owner(),e=>e.code==='INSTALLATION_NETWORK_MISMATCH');
  assert.equal(await new InstallationStore({pool:aPool,origin,chainId}).owner(),owner);
  const client=await aPool.connect();
  try{
    await client.query('BEGIN');await client.query('SET LOCAL ROLE nft_console_auth_service');
    await assert.rejects(client.query('DELETE FROM nft_console_auth.installations WHERE id=$1',[a.id]),e=>e.code==='42501');await client.query('ROLLBACK');
    await client.query('BEGIN');await client.query('SET LOCAL ROLE nft_console_auth_service');
    await assert.rejects(client.query('UPDATE nft_console_auth.installations SET admin_wallet=$2 WHERE id=$1',[a.id,two]),e=>e.code==='42501');await client.query('ROLLBACK');
  }finally{client.release();}
  assert.equal(await b.owner(),owner);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {launchConfigurationReport,inspectLaunchDatabase} from '../console/launch/doctor.mjs';
import {launchFeeBudget} from '../console/launch/fees.mjs';
import {migrate} from '../scripts/migrate.mjs';
import {migrateAuth} from '../scripts/migrate-auth.mjs';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const wallet='0x'+'11'.repeat(20),request={version:1,wallet,collection:{name:'Synthetic',symbol:'SYN',seriesSize:'2',royaltyBps:'500',owner:wallet,minter:wallet,royaltyRecipient:wallet}};
const env={NODE_ENV:'production',CHAIN_ID:'11155111',PUBLIC_ORIGIN:'https://console.example',ADMIN_WALLETS:wallet,DATABASE_URL:'postgres://runtime:do-not-print-this-secret@db.example/neondb',RPC_URL:'https://rpc.example/secret-rpc-token',NFT_PUBLIC_LAUNCH:'1',PINATA_JWT:'secret-pinning-token'};
test('launch configuration report redacts secrets and never promotes offline checks to live readiness',()=>{
  const report=launchConfigurationReport(env,request);
  assert.equal(report.configurationValid,true);assert.equal(report.readyForDeploymentReview,false);assert.equal(report.transactionSent,false);
  assert.equal(report.pinningCredentialConfigured,true);assert.equal(report.pinningCredentialVerified,false);
  const text=JSON.stringify(report);for(const secret of ['do-not-print-this-secret','secret-rpc-token','secret-pinning-token'])assert.equal(text.includes(secret),false);
  for(const patch of [{DATABASE_URL_UNPOOLED:'postgres://migration-secret'},{NODE_ENV:'development'},{PUBLIC_ORIGIN:'https://console.example/path'},{RPC_URL:'http://remote.example'},{ADMIN_WALLETS:''},{CHAIN_ID:'1'}])assert.equal(launchConfigurationReport({...env,...patch},request).configurationValid,false);
  assert.equal(launchConfigurationReport({...env,CHAIN_ID:'1',NFT_MAINNET_ACK:'ethereum-mainnet-real-fees'},request).configurationValid,true);
  assert.equal(launchConfigurationReport(env,{...request,collection:{...request.collection,minter:'0x'+'22'.repeat(20)}}).configurationValid,false);
  assert.equal(launchConfigurationReport(env,{...request,privateKey:'never-accepted'}).configurationValid,false);
});
test('shared fee budget rounds upward, reports only the shortfall and enforces wallet policy',()=>{
  const budget=launchFeeBudget(21001n,1000000000n,25000000000000n);
  assert.equal(budget.gasLimit,'25202');assert.equal(budget.maximumCostWei,'25202000000000');assert.equal(budget.additionalWei,'202000000000');assert.equal(budget.funded,false);assert.equal(budget.withinLimits,true);
  assert.equal(launchFeeBudget(21000n,1n,1000000n).additionalWei,'0');
  for(const [gas,price] of [[0n,1n],[10000001n,1n],[21000n,0n],[21000n,1000000000001n],[1000000n,100000000000n]])assert.equal(launchFeeBudget(gas,price,0n).withinLimits,false);
  assert.throws(()=>launchFeeBudget(1n,1n,-1n));
});
test('actual offline command checks the public request without connecting to configured services or revealing credentials',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'nft-doctor-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const file=path.join(directory,'public-request.json');await writeFile(file,JSON.stringify(request));
  const run=()=>spawnSync(process.execPath,['scripts/launch-doctor.mjs',file],{env:{...process.env,...env,DATABASE_URL_UNPOOLED:''},encoding:'utf8',timeout:5000});
  const checked=run();assert.equal(checked.status,0,checked.stderr);const report=JSON.parse(checked.stdout);
  assert.equal(report.configurationValid,true);assert.equal(report.readyForDeploymentReview,false);assert.equal(report.checks.at(-1).status,'not-checked');assert.equal(report.database,undefined);
  for(const secret of ['do-not-print-this-secret','secret-rpc-token','secret-pinning-token'])assert.equal((checked.stdout+checked.stderr).includes(secret),false);
  await writeFile(file,'{"privateKey":"never-print-this-input"');const failed=run();assert.equal(failed.status,1);assert.equal((failed.stdout+failed.stderr).includes('never-print-this-input'),false);
});
test('doctor verifies an actual restricted PostgreSQL login using read-only statements, and rejects privileged credentials and disabled RLS',async t=>{
  const db=new PGlite();await db.waitReady;t.after(()=>db.close());await migrate(db);await migrateAuth(db);
  await assert.rejects(inspectLaunchDatabase(db));
  await db.exec('CREATE ROLE doctor_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; GRANT nft_console_api,nft_console_auth_service,nft_console_identity TO doctor_runtime WITH ADMIN FALSE,INHERIT FALSE,SET TRUE;');
  await db.exec('SET SESSION AUTHORIZATION doctor_runtime');
  const queries=[],client={query:async(...args)=>{queries.push(args[0]);return db.query(...args);}};
  const checked=await inspectLaunchDatabase(client);assert.equal(checked.mutationPerformed,false);assert.equal(checked.restrictedRoleVerified,true);assert.equal(checked.migrationChecksumsVerified,false);
  assert.equal(queries[0],'BEGIN READ ONLY');assert.equal(queries.at(-1),'ROLLBACK');
  assert.equal(queries.some(sql=>/^(INSERT|UPDATE|DELETE|CREATE|ALTER|GRANT|REVOKE)\b/i.test(sql)),false);
  // PGlite retains a changed session authorization as its RESET baseline.
  // Explicitly restore this disposable fixture's original administrator.
  await db.exec('SET SESSION AUTHORIZATION postgres; ALTER TABLE nft_console.launch_journal NO FORCE ROW LEVEL SECURITY; SET SESSION AUTHORIZATION doctor_runtime;');
  await assert.rejects(inspectLaunchDatabase(client));assert.equal(queries.at(-1),'ROLLBACK');
});

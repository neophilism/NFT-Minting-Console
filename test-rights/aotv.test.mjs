import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const read=async f=>readFile(new URL('../'+f,import.meta.url));
const p='releases/androids-of-the-vine/token-001/';
const md=b=>b.toString('utf8');
const section=(t,start,end)=>t.slice(t.indexOf(start),t.indexOf(end,t.indexOf(start)));
test('byte-exact former contract rights and metadata are archival and unchanged',async()=>{
  const historic=await read('reference/androids-of-the-vine/ANDROID_OF_THE_VINE_TOKEN_001_RIGHTS_FINAL.md');
  const metadata=await read('reference/androids-of-the-vine/token-001.metadata.template.json');
  assert.equal(createHash('sha256').update(historic).digest('hex'),'0ddcfae9f5fc2d2e059ed12e7a33ea5815e00a64e70930485602bc73f3f374c9');
  assert.equal(createHash('sha256').update(metadata).digest('hex'),'96f2cac4483679c2e1df2d0124126f41f605471eb7a1b9d1b961c00ede8b4219');
});
test('Section 4 investment priority was replaced; Section 5 and the artwork license were preserved',async()=>{
  const original=md(await read('reference/androids-of-the-vine/ANDROID_OF_THE_VINE_TOKEN_001_RIGHTS_FINAL.md'));
  const draft=md(await read(p+'RIGHTS_AGREEMENT_V2_DRAFT.md'));
  assert.match(draft,/## 4\. Fixed Creator.s Companion Portfolio/);
  assert.doesNotMatch(draft,/Priority Investment Consideration|will consider timely indications of interest|initial group of prospective investors/i);
  assert.match(draft,/no right to invest/i);assert.match(draft,/one-time benefit/i);
  assert.equal(section(original,'## 5. Collector-Only Allocation','## 6. Authentication'),section(draft,'## 5. Collector-Only Allocation','## 6. Authentication'));
  assert.equal(section(original,'## 1. Non-Exclusive Commercial License','## 2. Transfer'),section(draft,'## 1. Non-Exclusive Commercial License','## 2. Transfer'));
  assert.match(draft,/## 11\. No Future Managerial Undertaking[\s\S]*one-time delivery/);
});
test('Schedule A has exactly two provisional, non-investment entries with no withdrawn codebase',async()=>{
  const schedule=md(await read(p+'SCHEDULE_A_TEMPLATE.md'));
  const items=[...schedule.matchAll(/^\| \*\*(\d+)\. ([^|]*?)\*\* \|/gm)].map(match=>({index:Number(match[1]),title:match[2].trim()}));
  assert.deepEqual(items,[
    {index:1,title:'Unsealed Records Music Playlist'},
    {index:2,title:'Live Debate Engine — source-code snapshot'},
  ]);
  assert.doesNotMatch(schedule,/Music Analyzer/i);
  assert.match(schedule,/WORKING TEMPLATE/);
  assert.match(schedule,/not\*\* the fixed deliverable/);
  assert.match(schedule,/TO BE COMPLETED/);assert.match(schedule,/SHA-256/);
  assert.match(schedule,/no additional commercial\/IP rights/i);
});
test('pending metadata never reuses the historical rights digest or claims ready-to-mint status',async()=>{
  const old=JSON.parse(md(await read('reference/androids-of-the-vine/token-001.metadata.template.json')));
  const latest=JSON.parse(md(await read(p+'token-001.metadata.pending.json')));
  assert.equal(latest.properties.media_sha256,old.properties.media_sha256);
  assert.equal(latest.properties.poster_sha256,old.properties.poster_sha256);
  assert.notEqual(latest.properties.rights_sha256,old.properties.rights_sha256);
  assert.equal(latest.release_status,'DO_NOT_MINT_OR_PUBLISH');
  assert.ok(!/^[a-f0-9]{64}$/.test(latest.properties.rights_sha256));
});
test('release preflight fails closed on the working draft and provisional metadata',()=>{
  const result=spawnSync(process.execPath,['scripts/check-aotv-rights-release.mjs',p+'RIGHTS_AGREEMENT_V2_DRAFT.md',p+'token-001.metadata.pending.json'],{encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/AOTV RIGHTS PREFLIGHT BLOCKED/);
});

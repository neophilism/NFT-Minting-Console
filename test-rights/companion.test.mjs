import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {planCompanionCollection,renderCompanionSchedule,renderCompanionExport} from '../console/companion/portfolio.mjs';
const projects=()=>Array.from({length:40},(_,i)=>({id:'PROJECT-'+String(i+1).padStart(2,'0'),title:'Creative work '+String(i+1),materials:[]}));
test('opt-out is a genuine no-benefits no-obligations mode',()=>{
  const result=planCompanionCollection({enabled:false,projects:null,enabledTokenIds:[]});
  assert.equal(result.enabled,false);
  assert.equal(result.assignments.length,0);
  assert.equal(renderCompanionSchedule(result,1),null);
  assert.deepEqual(renderCompanionExport(result).tokens,[]);
});
test('40 projects paired into 40 unique tokens, two placements each',()=>{
  const plan=planCompanionCollection({enabled:true,projects:projects()});
  assert.equal(plan.assignments.length,40);
  assert.equal(plan.balanced,true);
  assert.equal(plan.allMaterialsDefined,false);
  const keys=plan.assignments.map(a=>[...a.projects.map(p=>p.id)].sort().join(':'));
  assert.equal(new Set(keys).size,40);
  assert.ok(Object.values(plan.frequencies).every(n=>n===2));
  assert.deepEqual(plan.assignments[0].projects.map(p=>p.id),['PROJECT-01','PROJECT-02']);
  assert.deepEqual(plan.assignments[39].projects.map(p=>p.id),['PROJECT-40','PROJECT-01']);
  for(const [i,a] of plan.assignments.entries()) {
    assert.equal(a.tokenId,i+1);assert.equal(a.projects.length,2);
    const schedule=renderCompanionSchedule(plan,i+1);
    assert.match(schedule,new RegExp('Token #'+String(i+1).padStart(3,'0')));
    assert.equal((schedule.match(/^## Project /gm)||[]).length,2);
    assert.match(schedule,/DRAFT ONLY/);
    assert.doesNotMatch(schedule,/Music Analyzer|Priority Investment Consideration/);
  }
  const exported=renderCompanionExport(plan);
  assert.equal(exported.tokens.length,40);assert.equal(exported.notReadyForMint,true);
});
test('per-NFT optional eligibility allows a subset but never falsely asserts global balance',()=>{
  const plan=planCompanionCollection({enabled:true,projects:projects(),enabledTokenIds:[1,17,40]});
  assert.equal(plan.assignments.length,3);
  assert.equal(plan.balanced,false);
  assert.equal(renderCompanionSchedule(plan,2),null);
  assert.ok(plan.enabledTokenIds.includes(17));
  assert.equal(Object.values(plan.frequencies).reduce((a,b)=>a+b,0),6);
});
test('one project can appear twice but never twice in the same token',()=>{
  const plan=planCompanionCollection({enabled:true,projects:projects()});
  assert.ok(plan.assignments.every(x=>x.projects[0].id!==x.projects[1].id));
});
test('invalid catalogs, duplicate or out of range token IDs are rejected',()=>{
  for(const x of [
    {enabled:true,projects:projects().slice(1)},
    {enabled:true,projects:[...projects().slice(0,39),projects()[0]]},
    {enabled:true,projects:projects(),enabledTokenIds:[1,1]},
    {enabled:true,projects:projects(),enabledTokenIds:[0]},
    {enabled:true,projects:projects(),enabledTokenIds:[41]},
    {enabled:true,projects:projects(),enabledTokenIds:['1']},
  ]) assert.throws(()=>planCompanionCollection(x));
});
test('catalog rejects unrelated financial metadata, accessors and markup injection',()=>{
  const first=projects();
  first[0].investment='special early rights';
  assert.throws(()=>planCompanionCollection({enabled:true,projects:first}));
  const evil=projects();evil[1]={...evil[1],title:'<script>alert(1)</script>'};
  assert.throws(()=>planCompanionCollection({enabled:true,projects:evil}));
  const getter=projects();Object.defineProperty(getter[0],'title',{enumerable:true,get(){throw new Error('leak');}});
  assert.throws(()=>planCompanionCollection({enabled:true,projects:getter}),/property/);
});
test('fixed files require valid checksums and explicit licenses and delivery methods',()=>{
  const list=projects();
  list[0].materials=[{name:'introduction.mp4',sha256:'a'.repeat(64),delivery:'fixed archived file',license:'personal viewing only'}];
  const p=planCompanionCollection({enabled:true,projects:list});
  assert.match(renderCompanionSchedule(p,1),/introduction\\.mp4/);
  assert.match(renderCompanionSchedule(p,1),/a{64}/);
  list[0].materials[0].sha256='MISSING';
  assert.throws(()=>planCompanionCollection({enabled:true,projects:list}));
});
test('provisional repository catalog is disabled by default, not silently an offering',async()=>{
  const c=JSON.parse(await readFile(new URL('../releases/androids-of-the-vine/companion/PROJECT_CATALOG_TEMPLATE.json',import.meta.url)));
  assert.equal(c.enabled,false);
  assert.equal(c.projects.length,40);
  assert.equal(c.projects[0].title,'Unsealed Records Music Playlist');
  assert.equal(c.projects[1].title,'Live Debate Engine');
  assert.ok(c.projects.slice(2).every(x=>x.title.startsWith('TO_BE_SELECTED_')));
  assert.equal(planCompanionCollection(c).assignments.length,0);
});

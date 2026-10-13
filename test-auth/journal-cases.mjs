import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {MintJournal,exactObject,journalHash} from '../console/operations/journal.mjs';
const hash=()=> '0x'+randomBytes(32).toString('hex');
const input=()=>({intentId:hash(),collection:'0x'+'ab'.repeat(20),runtimeCodeHash:hash()});
const errorCode=code=>error=>error.code===code;
export async function journalCases(t,repo,actor,other) {
  const journal=new MintJournal(repo),second=new MintJournal(repo);
  let first;
  await t.test('journal creation is idempotent and stores no draft payload',async()=>{
    const body=input(); first=await journal.create(actor,body);
    assert.equal(first.created,true);assert.equal(first.state,'prepared');assert.equal(first.revision,'1');
    assert.equal((await second.create(actor,body)).created,false);
    await assert.rejects(journal.create(actor,{...body,collection:'0x'+'ac'.repeat(20)}),errorCode('operation_conflict'));
    for(const key of ['works','calldata','privateKey','title','ciphertext','status','state','accountId'])
      await assert.rejects(journal.create(actor,{...body,[key]:'private-do-not-echo'}),error=>error.code==='invalid_operation'&&!error.message.includes('private-do-not-echo'));
    for(const bad of [null,[],{...body,intentId:hash().toUpperCase()},{...body,collection:'0x'+'00'.repeat(20)}])
      await assert.rejects(journal.create(actor,bad),errorCode('invalid_operation'));
  });
  await t.test('two nodes cannot reserve the same wallet operation',async()=>{
    const results=await Promise.allSettled([journal.claim(actor,first.intentId,{expectedRevision:'1'}),second.claim(actor,first.intentId,{expectedRevision:'1'})]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='operation_conflict').length,1);
    const saved=await second.get(actor,first.intentId);assert.equal(saved.state,'wallet_pending');assert.ok(saved.attemptId);
    assert.equal(saved.revision,'2');
    // Repeating a lost claim response must not issue a second permission to send.
    await assert.rejects(second.claim(actor,first.intentId,{expectedRevision:'1'}),errorCode('operation_conflict'));
  });
  await t.test('an unknown wallet outcome cannot be reset or cancelled into a resend',async()=>{
    let saved=await journal.get(actor,first.intentId);
    saved=await journal.walletOutcome(actor,first.intentId,{expectedRevision:saved.revision,attemptId:saved.attemptId,outcome:'unknown'});
    assert.equal(saved.state,'attention');assert.equal(saved.lastCode,'OUTCOME_UNKNOWN');
    await assert.rejects(journal.claim(actor,first.intentId,{expectedRevision:saved.revision}),errorCode('operation_conflict'));
    await assert.rejects(journal.cancel(actor,first.intentId,{expectedRevision:saved.revision}),errorCode('operation_conflict'));
    await assert.rejects(journal.walletOutcome(actor,first.intentId,{expectedRevision:saved.revision,attemptId:saved.attemptId,outcome:'rejected'}),errorCode('operation_conflict'));
  });
  await t.test('explicit wallet rejection permits a fresh claim, not stale replay',async()=>{
    const value=await journal.create(actor,input());const claimed=await journal.claim(actor,value.intentId,{expectedRevision:value.revision});
    const outcome={expectedRevision:claimed.revision,attemptId:claimed.attemptId,outcome:'rejected'};
    const rejected=await journal.walletOutcome(actor,value.intentId,outcome);assert.equal(rejected.state,'prepared');assert.equal(rejected.attemptId,null);
    const retry=await journal.claim(actor,value.intentId,{expectedRevision:rejected.revision});assert.notEqual(retry.attemptId,claimed.attemptId);
    await assert.rejects(journal.walletOutcome(actor,value.intentId,outcome),errorCode('operation_conflict'));
    await assert.rejects(journal.walletOutcome(actor,value.intentId,{...outcome,expectedRevision:retry.revision}),errorCode('operation_conflict'));
  });
  await t.test('recorded transaction survives repository recreation and cannot silently change',async()=>{
    const transactionHash=hash();const saved=await journal.attach(actor,first.intentId,{transactionHash});
    assert.equal(saved.state,'submitted');assert.equal(saved.transactionHash,transactionHash);
    assert.equal((await second.attach(actor,first.intentId,{transactionHash})).revision,saved.revision);
    assert.equal((await new MintJournal(repo).get(actor,first.intentId)).transactionHash,transactionHash);
    await assert.rejects(second.attach(actor,first.intentId,{transactionHash:hash()}),errorCode('operation_conflict'));
  });
  await t.test('stale reconciliation cannot replace a newer observation and reorgs remove verified status',async()=>{
    let value=await journal.get(actor,first.intentId);const revision=value.revision;
    value=await journal.observe(actor,first.intentId,revision,{state:'verified',block:1,blockHash:hash(),confirmations:2,code:null});
    assert.equal(value.state,'verified');assert.equal(value.listingVerified,false);
    await assert.rejects(second.observe(actor,first.intentId,revision,{state:'submitted',block:null,blockHash:null,confirmations:0,code:'PENDING_OR_UNKNOWN'}),errorCode('operation_conflict'));
    value=await journal.observe(actor,first.intentId,value.revision,{state:'attention',block:null,blockHash:null,confirmations:0,code:'REORG_OR_BLOCK_MISMATCH'});
    assert.equal(value.state,'attention');assert.equal(value.observedBlock,null);
    assert.equal(value.observedBlockHash,null);assert.equal(value.confirmations,0);
  });
  await t.test('other wallets and chains cannot discover operations or audit events',async()=>{
    for(const candidate of [other,{...actor,chainId:actor.chainId===1?11155111:1}]){
      await assert.rejects(journal.get(candidate,first.intentId),errorCode('operation_not_found'));
      await assert.rejects(journal.events(candidate,first.intentId),errorCode('operation_not_found'));
      assert.deepEqual((await journal.list(candidate)).items,[]);
    }
  });
  await t.test('audit history is immutable through the application role',async()=>{
    const events=(await journal.events(actor,first.intentId)).events;
    assert.equal(events.at(-1).state,'prepared');assert.ok(events.some(e=>e.state==='wallet_pending'));assert.equal(events[0].state,'attention');
    for(const query of ['DELETE FROM nft_console_auth.mint_events','UPDATE nft_console_auth.mint_events SET state=\'verified\'',
      'DELETE FROM nft_console.mint_journal',"UPDATE nft_console.mint_journal SET collection='0x"+'ac'.repeat(20)+"'",
      "INSERT INTO nft_console_auth.mint_events(account_id,intent_id,revision,state) VALUES(nft_console.current_account_id(),'"+first.intentId+"',99,'verified')"]){
      await assert.rejects(repo.transaction(actor,null,client=>client.query(query)),errorCode('42501'));
    }
    await assert.rejects(repo.transaction(actor,null,client=>client.query("UPDATE nft_console.mint_journal SET revision=revision+2 WHERE intent_id=$1",[first.intentId])),/invalid revision/);
  });
  await t.test('cancel is terminal and never clears an ambiguous in-flight operation',async()=>{
    const value=await journal.create(actor,input());const result=await journal.cancel(actor,value.intentId,{expectedRevision:value.revision});
    assert.equal(result.state,'cancelled');
    await assert.rejects(journal.claim(actor,value.intentId,{expectedRevision:result.revision}),errorCode('operation_conflict'));
    await assert.rejects(journal.attach(actor,value.intentId,{transactionHash:hash()}),errorCode('operation_conflict'));
  });
  await t.test('pagination is stable, bounded and owner-scoped',async()=>{
    const all=await journal.list(actor),page=await journal.list(actor,{limit:2});assert.equal(page.items.length,2);
    assert.ok(page.nextCursor);const next=await journal.list(actor,{after:page.nextCursor,limit:2});
    assert.deepEqual([...page.items,...next.items].map(x=>x.intentId),all.items.slice(0,4).map(x=>x.intentId));
    for(const options of [{limit:0},{limit:101},{limit:0.5},{after:'bad'}])await assert.rejects(journal.list(actor,options));
  });
  await t.test('strict request and observation boundaries reject accessors and impossible evidence',async()=>{
    let accessed=false;const value=input();Object.defineProperty(value,'intentId',{get(){accessed=true;return hash();},enumerable:true});
    assert.throws(()=>exactObject(value,['intentId','collection','runtimeCodeHash']));assert.equal(accessed,false);
    assert.throws(()=>journalHash('0x'+'0'.repeat(64)));
    await assert.rejects(journal.observe(actor,first.intentId,'1',{state:'verified',block:null,blockHash:null,confirmations:0,code:null}),errorCode('invalid_operation'));
    await assert.rejects(journal.claim({...actor,role:'viewer'},first.intentId,{expectedRevision:'1'}),errorCode('forbidden'));
    await assert.rejects(journal.create({...actor,role:'editor'},input()),errorCode('forbidden'));
  });
}

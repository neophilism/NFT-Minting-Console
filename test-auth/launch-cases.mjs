import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {LaunchJournal} from '../console/launch/journal.mjs';
const hash=()=> '0x'+randomBytes(32).toString('hex');
const code=value=>error=>error.code===value;
export async function launchCases(t,repo,actor,other){
  const journal=new LaunchJournal(repo),second=new LaunchJournal(repo);
  const plan=()=>({version:1,kind:'deploy',intentId:hash(),chainId:actor.chainId,from:actor.wallet,to:null,data:'0x1234',value:'0x0',nonce:0,
    expected:{collection:'0x'+'ab'.repeat(20),runtimeCodeHash:hash()}});
  let first,next;
  await t.test('public launch plans survive recreation; unrelated wallets and chains cannot read them',async()=>{
    const p=plan();first=await journal.create(actor,p);assert.deepEqual(first.plan,p);
    assert.equal((await second.create(actor,p)).created,false);
    for(const otherActor of [other,{...actor,chainId:actor.chainId===1?11155111:1}]){
      assert.deepEqual((await journal.list(otherActor)).items,[]);
      await assert.rejects(journal.get(otherActor,first.intentId),code('operation_not_found'));
    }
    await assert.rejects(journal.create({...actor,role:'editor'},p),code('forbidden'));
  });
  await t.test('one wallet reservation prevents a different deployment from being signed in another tab',async()=>{
    first=await journal.claim(actor,first.intentId,{expectedRevision:first.revision});
    next=await journal.create(actor,plan());
    await assert.rejects(second.claim(actor,next.intentId,{expectedRevision:next.revision}),code('wallet_busy'));
    first=await journal.walletOutcome(actor,first.intentId,{expectedRevision:first.revision,attemptId:first.attemptId,outcome:'unknown'});
    await assert.rejects(second.claim(actor,next.intentId,{expectedRevision:next.revision}),code('wallet_busy'));
    await assert.rejects(journal.cancel(actor,first.intentId,{expectedRevision:first.revision}),code('operation_conflict'));
  });
  await t.test('receipt verification unlocks next operation and explicit wallet rejection permits safe retry',async()=>{
    first=await journal.attach(actor,first.intentId,{transactionHash:hash()});
    first=await journal.observe(actor,first.intentId,first.revision,{state:'verified',block:2,blockHash:hash(),confirmations:2,code:null});
    next=await second.claim(actor,next.intentId,{expectedRevision:next.revision});
    next=await second.walletOutcome(actor,next.intentId,{expectedRevision:next.revision,attemptId:next.attemptId,outcome:'rejected'});
    assert.equal(next.state,'prepared');const claim=await journal.claim(actor,next.intentId,{expectedRevision:next.revision});
    assert.equal(claim.state,'wallet_pending');
    await assert.rejects(journal.walletOutcome(actor,next.intentId,{expectedRevision:next.revision,attemptId:claim.attemptId,outcome:'rejected'}),code('operation_conflict'));
  });
  await t.test('finalized nonce recovery retains the original hash and an immutable proof, then releases a different fresh plan',async()=>{
    // Finish the preceding fixture's still-pending wallet attempt first.
    next=await journal.get(actor,next.intentId);
    next=await journal.walletOutcome(actor,next.intentId,{expectedRevision:next.revision,attemptId:next.attemptId,outcome:'rejected'});
    const p=plan();let row=await journal.create(actor,p);
    row=await journal.claim(actor,row.intentId,{expectedRevision:row.revision});
    const originalHash=hash();row=await journal.attach(actor,row.intentId,{transactionHash:originalHash});
    const proof={version:1,kind:'finalized-self-cancellation',chainId:actor.chainId,wallet:actor.wallet,nonce:p.nonce,
      transactionHash:hash(),blockNumber:3,blockHash:hash(),finalizedBlockNumber:12,finalizedBlockHash:hash(),confirmations:10,
      originalActionVerified:false,transactionSent:false};
    await assert.rejects(journal.resolveNonce(actor,row.intentId,'1',proof),code('operation_conflict'));
    await assert.rejects(journal.resolveNonce({...actor,role:'editor'},row.intentId,row.revision,proof),code('forbidden'));
    row=await journal.resolveNonce(actor,row.intentId,row.revision,proof);
    assert.equal(row.transactionHash,originalHash);assert.equal(row.lastCode,'NONCE_CANCELLED');assert.deepEqual(row.nonceResolution,proof);
    const recreated=await second.get(actor,row.intentId);assert.deepEqual(recreated.nonceResolution,proof);
    assert.deepEqual((await second.create(actor,p)).nonceResolution,proof);
    await assert.rejects(second.attach(actor,row.intentId,{transactionHash:hash()}),code('operation_conflict'));
    await assert.rejects(second.observe(actor,row.intentId,row.revision,{state:'verified',block:3,blockHash:hash(),confirmations:2,code:null}),code('operation_conflict'));
    await assert.rejects(second.resolveNonce(actor,row.intentId,row.revision,proof),code('operation_conflict'));
    const fresh=await journal.create(actor,{...plan(),nonce:1});
    let claimed=await second.claim(actor,fresh.intentId,{expectedRevision:fresh.revision});assert.equal(claimed.state,'wallet_pending');
    claimed=await second.walletOutcome(actor,fresh.intentId,{expectedRevision:claimed.revision,attemptId:claimed.attemptId,outcome:'unknown'});
    const unknownProof={...proof,nonce:1,transactionHash:hash()};
    const resolvedUnknown=await journal.resolveNonce(actor,fresh.intentId,claimed.revision,unknownProof);
    assert.equal(resolvedUnknown.transactionHash,null);assert.deepEqual(resolvedUnknown.nonceResolution,unknownProof);
    for(const sql of ['UPDATE nft_console.launch_nonce_resolutions SET proof=proof','DELETE FROM nft_console.launch_nonce_resolutions'])
      await assert.rejects(repo.transaction(actor,null,c=>c.query(sql)),code('42501'));
    assert.equal((await repo.transaction(other,null,c=>c.query('SELECT * FROM nft_console.launch_nonce_resolutions'))).rows.length,0);
  });
  await t.test('public plan identity and append-only audit history are protected by SQL privileges',async()=>{
    for(const sql of ["UPDATE nft_console.launch_journal SET public_plan='{}'::jsonb",'DELETE FROM nft_console.launch_journal',
      'DELETE FROM nft_console_auth.launch_events',"UPDATE nft_console_auth.launch_events SET state='verified'"])
      await assert.rejects(repo.transaction(actor,null,c=>c.query(sql)),code('42501'));
    assert.ok((await journal.events(actor,first.intentId)).events.length>=4);
  });
}

import { randomUUID } from 'node:crypto';
import { getAddress, ZeroAddress } from 'ethers';

export class JournalError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
const fail = (status, code, message) => { throw new JournalError(status, code, message); };
const invalid = () => fail(400, 'invalid_operation', 'Invalid transaction journal request.');
const conflict = () => fail(409, 'operation_conflict', 'The operation changed or is already reserved. Reload it; do not send another transaction.');
export function exactObject(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== keys.length) invalid();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid();
  }
  return value;
}
export function journalHash(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || /^0x0+$/.test(value)) invalid();
  return value;
}
const revision = value => {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) >= (1n << 63n)-1n) invalid();
  return value;
};
const uuid = value => { if (typeof value !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value)) invalid(); return value; };
const address = value => { try { const a=getAddress(value); if(a===ZeroAddress)invalid(); return a.toLowerCase(); } catch { invalid(); } };
const owner = actor => { if (actor?.role !== 'owner') fail(403,'forbidden','An authorized owner wallet is required.'); };
const fields = row => ({ intentId:row.intent_id, chainId:Number(row.chain_id), collection:row.collection,
  runtimeCodeHash:row.runtime_code_hash, state:row.state, revision:String(row.revision), attemptId:row.attempt_id,
  transactionHash:row.transaction_hash, observedBlock:row.observed_block===null?null:Number(row.observed_block),
  observedBlockHash:row.observed_block_hash, confirmations:row.confirmations, lastCode:row.last_code,
  createdAt:row.created_at, updatedAt:row.updated_at, listingVerified:false, plan:row.public_plan });
/** Reuses the existing authenticated account/chain transaction boundary. Only explicitly public transaction plans are stored. */
export class LaunchJournal {
  constructor(repository) { if(typeof repository?.transaction!=='function')throw new Error('Authenticated transaction repository required.'); this.repository=repository; }
  async checkSchema() {
    const client=await this.repository.pool.connect();let begun=false,broken;
    try {
      await client.query('BEGIN');begun=true;await client.query('SET LOCAL ROLE nft_console_api');
      await client.query('SELECT intent_id,state,revision FROM nft_console.launch_journal LIMIT 0');
      await client.query('SELECT revision FROM nft_console_auth.launch_events LIMIT 0');
      await client.query('COMMIT');begun=false;
    } catch(error) {if(begun){try{await client.query('ROLLBACK');}catch(failure){broken=failure;}}throw error;}
    finally {client.release(broken);}
  }
  async withRow(actor,id,fn) {
    journalHash(id);
    return this.repository.transaction(actor,null,async(client,accountId)=>{
      const result=await client.query('SELECT * FROM nft_console.launch_journal WHERE account_id=$1 AND intent_id=$2 FOR UPDATE',[accountId,id]);
      if(!result.rows[0])fail(404,'operation_not_found','Transaction operation not found.');
      return fn(client,result.rows[0]);
    });
  }
  /** Receives only an independently prepared public plan, never raw user-provided transaction JSON. */
  async create(actor,plan) {
    owner(actor);const id=journalHash(plan.intentId),collection=address(plan.expected.collection),hash=journalHash(plan.expected.runtimeCodeHash);
    if(plan.from.toLowerCase()!==actor.wallet||plan.chainId!==actor.chainId||!['deploy','mint'].includes(plan.kind))invalid();
    const encoded=JSON.stringify(plan);if(Buffer.byteLength(encoded)>196608)invalid();
    return this.repository.transaction(actor,null,async(client,accountId)=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,82312))',[accountId]);
      const previous=await client.query('SELECT * FROM nft_console.launch_journal WHERE account_id=$1 AND intent_id=$2',[accountId,id]);
      if(previous.rows[0]) {
        const row=previous.rows[0];
        if(row.collection!==collection||row.runtime_code_hash!==hash)conflict();
        return {...fields(row),created:false};
      }
      const count=await client.query('SELECT count(*)::integer AS n FROM nft_console.launch_journal WHERE account_id=$1',[accountId]);
      if(count.rows[0].n>=1000)fail(429,'journal_capacity','The launch journal has reached its account limit.');
      const result=await client.query('INSERT INTO nft_console.launch_journal(account_id,intent_id,chain_id,collection,runtime_code_hash,public_plan) VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING *',[accountId,id,actor.chainId,collection,hash,encoded]);
      return {...fields(result.rows[0]),created:true};
    });
  }
  async list(actor,{after,limit=50}={}) {
    if(after!==undefined)journalHash(after);
    if(!Number.isInteger(limit)||limit<1||limit>100)invalid();
    return this.repository.transaction(actor,null,async(client,accountId)=>{
      const result=await client.query('SELECT * FROM nft_console.launch_journal WHERE account_id=$1 AND ($2::text IS NULL OR intent_id>$2) ORDER BY intent_id LIMIT $3',[accountId,after||null,limit+1]);
      const items=result.rows.slice(0,limit).map(fields);
      return {items,nextCursor:result.rows.length>limit?items.at(-1).intentId:null};
    });
  }
  async get(actor,id) { return this.withRow(actor,id,async(_client,row)=>fields(row)); }
  async change(client,row,{state,attemptId=row.attempt_id,transactionHash=row.transaction_hash,block=null,blockHash=null,confirmations=0,code=null}) {
    const result=await client.query(`UPDATE nft_console.launch_journal SET state=$3,revision=revision+1,attempt_id=$4,
      transaction_hash=$5,observed_block=$6,observed_block_hash=$7,confirmations=$8,last_code=$9,updated_at=clock_timestamp()
      WHERE account_id=$1 AND intent_id=$2 RETURNING *`,[row.account_id,row.intent_id,state,attemptId,transactionHash,block,blockHash,confirmations,code]);
    return fields(result.rows[0]);
  }
  async claim(actor,id,value) {
    owner(actor);exactObject(value,['expectedRevision']);revision(value.expectedRevision);
    return this.withRow(actor,id,async(client,row)=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,82312))',[row.account_id]);
      const active=await client.query("SELECT intent_id FROM nft_console.launch_journal WHERE account_id=$1 AND intent_id<>$2 AND state IN ('wallet_pending','submitted','attention') AND NOT(state='attention' AND last_code='TRANSACTION_REVERTED' AND observed_block IS NOT NULL AND confirmations>=2) LIMIT 1",[row.account_id,id]);
      if(active.rows.length)fail(409,'wallet_busy','Recover or verify the previous wallet operation before starting another.');
      if(String(row.revision)!==value.expectedRevision||row.state!=='prepared')conflict();
      return this.change(client,row,{state:'wallet_pending',attemptId:randomUUID()});
    });
  }
  async walletOutcome(actor,id,value) {
    owner(actor);exactObject(value,['expectedRevision','attemptId','outcome']);revision(value.expectedRevision);uuid(value.attemptId);
    if(!['rejected','unknown'].includes(value.outcome))invalid();
    return this.withRow(actor,id,async(client,row)=>{
      if(String(row.revision)!==value.expectedRevision||row.state!=='wallet_pending'||row.attempt_id!==value.attemptId)conflict();
      return this.change(client,row,value.outcome==='rejected'?{state:'prepared',attemptId:null,code:'USER_REJECTED'}:{state:'attention',code:'OUTCOME_UNKNOWN'});
    });
  }
  async attach(actor,id,value) {
    owner(actor);exactObject(value,['transactionHash']);const hash=journalHash(value.transactionHash);
    return this.withRow(actor,id,async(client,row)=>{
      if(row.transaction_hash===hash)return fields(row);
      if(row.transaction_hash||row.state==='cancelled')conflict();
      return this.change(client,row,{state:'submitted',transactionHash:hash,code:'NOT_YET_VERIFIED'});
    });
  }
  async cancel(actor,id,value) {
    owner(actor);exactObject(value,['expectedRevision']);revision(value.expectedRevision);
    return this.withRow(actor,id,async(client,row)=>{
      if(String(row.revision)!==value.expectedRevision||row.state!=='prepared')conflict();
      return this.change(client,row,{state:'cancelled'});
    });
  }
  /** Called only by the server verifier, never from a request-supplied observation. */
  async observe(actor,id,expectedRevision,observation) {
    owner(actor);revision(expectedRevision);
    exactObject(observation,['state','block','blockHash','confirmations','code']);
    if(!['verified','submitted','attention'].includes(observation.state)||
       !Number.isSafeInteger(observation.confirmations)||observation.confirmations<0||observation.confirmations>2147483647||
       (observation.block!==null&&(!Number.isSafeInteger(observation.block)||observation.block<0))||
       (observation.code!==null&&(typeof observation.code!=='string'||!/^[A-Z_]{1,64}$/.test(observation.code))))invalid();
    if(observation.blockHash!==null)journalHash(observation.blockHash);
    if(observation.state==='verified'&&(observation.block===null||observation.blockHash===null||observation.confirmations<1||observation.code!==null))invalid();
    return this.withRow(actor,id,async(client,row)=>{
      if(String(row.revision)!==expectedRevision||!row.transaction_hash||row.state==='cancelled')conflict();
      return this.change(client,row,observation);
    });
  }
  async events(actor,id) {
    return this.withRow(actor,id,async(client,row)=>{
      const result=await client.query('SELECT revision::text,state,attempt_id,transaction_hash,last_code,occurred_at FROM nft_console_auth.launch_events WHERE account_id=$1 AND intent_id=$2 ORDER BY revision DESC LIMIT 100',[row.account_id,row.intent_id]);
      return {events:result.rows};
    });
  }
}

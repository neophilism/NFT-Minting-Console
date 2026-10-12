import { createHash } from 'node:crypto';
const hash = value => createHash('sha256').update(value).digest('hex');
const HANDLE = /^[a-f0-9]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const integer = value => Number.isSafeInteger(value) && value > 0;
const defaultError = (status,code) => Object.assign(new Error(`Authentication storage: ${code}`),{status,code});
export function authRealm(origin,chainId,roles) {
  const url = new URL(origin);
  if(url.origin !== origin || !['https:','http:'].includes(url.protocol) || ![1,11155111,31337].includes(chainId)) throw new Error('Invalid authentication realm.');
  if(!(roles instanceof Map) || ![...roles.values()].includes('owner') || [...roles].some(([wallet,role]) => !ADDRESS.test(wallet) || /^0x0{40}$/.test(wallet) || !['owner','editor','viewer'].includes(role))) throw new Error('Normalized wallet roles with at least one owner are required.');
  return {realmId:hash(JSON.stringify([origin,chainId])),policyDigest:hash(JSON.stringify([...roles].sort(([a],[b]) => a<b ? -1 : a>b ? 1 : 0)))};
}
/** One checked-out client and a transaction-local role per operation. A realm
 * row lock serializes nonce consumption, capacity and rate limits across nodes.
 * Raw cookie handles are never persisted. This is NOT draft encryption. */
export class PostgresAuthStore {
  constructor({pool,origin,chainId,roles,limit=10000,errorFactory=defaultError}) {
    if(!pool || typeof pool.connect !== 'function' || !integer(limit) || limit>100000) throw new Error('A checked-out pool and bounded capacity are required.');
    Object.assign(this,{pool,origin,chainId,limit,errorFactory,durable:true},authRealm(origin,chainId,roles));
  }
  invalid() {throw this.errorFactory(400,'invalid_request');}
  handle(value) {if(typeof value !== 'string' || !HANDLE.test(value)) this.invalid(); return value;}
  async transaction(operation) {
    const client=await this.pool.connect(); let begun=false,broken;
    try {
      await client.query('BEGIN'); begun=true;
      await client.query('SET LOCAL statement_timeout = 10000');
      await client.query('SET LOCAL lock_timeout = 5000');
      await client.query('SET LOCAL ROLE nft_console_auth_service');
      await client.query('INSERT INTO nft_console_auth.realms(id,origin,chain_id,policy_digest) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[this.realmId,this.origin,this.chainId,this.policyDigest]);
      const realm=await client.query('SELECT policy_digest FROM nft_console_auth.realms WHERE id=$1 FOR UPDATE',[this.realmId]);
      if(realm.rows[0]?.policy_digest !== this.policyDigest) throw this.errorFactory(503,'unavailable');
      const clock=await client.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS now_ms');
      const now=Number(clock.rows[0]?.now_ms); if(!integer(now)) throw this.errorFactory(503,'unavailable');
      const result=await operation(client,now); await client.query('COMMIT'); begun=false; return result;
    } catch(error) {
      if(begun) {try {await client.query('ROLLBACK');} catch(failure) {broken=failure;}}
      throw error;
    } finally {client.release(broken);}
  }
  async prune(client,now) {
    await client.query('DELETE FROM nft_console_auth.challenges WHERE realm_id=$1 AND expires_ms<=$2',[this.realmId,now]);
    await client.query('DELETE FROM nft_console_auth.sessions WHERE realm_id=$1 AND (expires_ms<=$2 OR idle_expires_ms<=$2)',[this.realmId,now]);
    await client.query('DELETE FROM nft_console_auth.rate_limits WHERE realm_id=$1 AND expires_ms<=$2',[this.realmId,now]);
  }
  async capacity(client,table) {
    if(!['challenges','sessions','rate_limits'].includes(table)) this.invalid();
    const result=await client.query(`SELECT count(*)::integer AS count FROM nft_console_auth.${table} WHERE realm_id=$1`,[this.realmId]);
    if(result.rows[0].count>=this.limit) throw this.errorFactory(503,'capacity');
  }
  async sweep() {return this.transaction((client,now)=>this.prune(client,now));}
  async limitRequest(key,maximum,interval=60000) {
    if(typeof key !== 'string' || key.length>256 || !integer(maximum) || maximum>10000 || !integer(interval) || interval>3600000) this.invalid();
    return this.transaction(async(client,now)=>{
      await this.prune(client,now); const id=hash(key);
      const current=await client.query('SELECT count,expires_ms FROM nft_console_auth.rate_limits WHERE realm_id=$1 AND id=$2',[this.realmId,id]);
      if(!current.rows.length) {
        await this.capacity(client,'rate_limits');
        await client.query('INSERT INTO nft_console_auth.rate_limits(realm_id,id,count,expires_ms) VALUES($1,$2,1,$3)',[this.realmId,id,now+interval]);
      } else {
        if(current.rows[0].count>=maximum) throw this.errorFactory(429,'rate_limited');
        await client.query('UPDATE nft_console_auth.rate_limits SET count=count+1 WHERE realm_id=$1 AND id=$2',[this.realmId,id]);
      }
    });
  }
  record(record,session) {
    if(!record || !ADDRESS.test(record.wallet) || /^0x0{40}$/.test(record.wallet) || record.chainId!==this.chainId || record.origin!==this.origin || !integer(record.expiresAt)) this.invalid();
    if(session) {
      if(!['eoa','contract'].includes(record.kind) || !integer(record.idleExpiresAt) || record.idleExpiresAt>record.expiresAt) this.invalid();
      if(record.kind==='contract' && (typeof record.message!=='string' || record.message.length>4096 || typeof record.signature!=='string' || record.signature.length>32770 || !/^0x(?:[a-fA-F0-9]{2})*$/.test(record.signature))) this.invalid();
      return {wallet:record.wallet,chainId:record.chainId,origin:record.origin,kind:record.kind,expiresAt:record.expiresAt,idleExpiresAt:record.idleExpiresAt,...(record.kind==='contract'?{message:record.message,signature:record.signature}:{})};
    }
    if(typeof record.message!=='string' || record.message.length>4096 || !integer(record.issuedAt) || !integer(record.challengeExpiresAt) || record.challengeExpiresAt<=record.issuedAt || record.challengeExpiresAt-record.issuedAt>300000 || record.expiresAt<=record.issuedAt || record.expiresAt-record.issuedAt>28800000) this.invalid();
    return {wallet:record.wallet,chainId:record.chainId,origin:record.origin,message:record.message,issuedAt:record.issuedAt,expiresAt:record.expiresAt,challengeExpiresAt:record.challengeExpiresAt,bindingHash:this.handle(record.bindingHash)};
  }
  async putChallenge(id,input) {
    this.handle(id); const record=this.record(input,false);
    return this.transaction(async(client,now)=>{
      if(record.issuedAt>now+30000 || record.challengeExpiresAt<=now) throw this.errorFactory(401,'invalid_challenge');
      await this.prune(client,now); await this.capacity(client,'challenges');
      await client.query('INSERT INTO nft_console_auth.challenges(realm_id,id,binding_hash,expires_ms,record) VALUES($1,$2,$3,$4,$5::jsonb)',[this.realmId,id,record.bindingHash,record.challengeExpiresAt,JSON.stringify(record)]);
    });
  }
  async consumeChallenge(id,bindingHash) {
    this.handle(id); this.handle(bindingHash);
    return this.transaction(async(client,now)=>{
      const result=await client.query('DELETE FROM nft_console_auth.challenges WHERE realm_id=$1 AND id=$2 AND binding_hash=$3 AND expires_ms>$4 RETURNING record',[this.realmId,id,bindingHash,now]);
      return result.rows[0]?.record || null;
    });
  }
  async putSession(id,input) {
    this.handle(id); const record=this.record(input,true);
    return this.transaction(async(client,now)=>{
      if(record.expiresAt<=now || record.idleExpiresAt<=now || record.expiresAt>now+28800000 || record.idleExpiresAt>now+1800000) throw this.errorFactory(401,'session_required');
      await this.prune(client,now); await this.capacity(client,'sessions');
      await client.query('INSERT INTO nft_console_auth.sessions(realm_id,id,expires_ms,idle_expires_ms,record) VALUES($1,$2,$3,$4,$5::jsonb)',[this.realmId,id,record.expiresAt,record.idleExpiresAt,JSON.stringify(record)]);
    });
  }
  async getSession(id) {
    this.handle(id);
    return this.transaction(async(client,now)=>{
      const result=await client.query('SELECT record,expires_ms,idle_expires_ms FROM nft_console_auth.sessions WHERE realm_id=$1 AND id=$2 AND expires_ms>$3 AND idle_expires_ms>$3',[this.realmId,id,now]);
      const row=result.rows[0]; return row?{...row.record,expiresAt:Number(row.expires_ms),idleExpiresAt:Number(row.idle_expires_ms)}:null;
    });
  }
  async touchSession(id,idleExpiresAt) {
    this.handle(id); if(!integer(idleExpiresAt)) this.invalid();
    return this.transaction(async(client,now)=>{
      const result=await client.query('UPDATE nft_console_auth.sessions SET idle_expires_ms=least(expires_ms,greatest(idle_expires_ms,$3::bigint)) WHERE realm_id=$1 AND id=$2 AND expires_ms>$4 AND idle_expires_ms>$4 RETURNING id',[this.realmId,id,Math.min(idleExpiresAt,now+1800000),now]);
      return result.rows.length===1; // Never INSERT/UPSERT: logout is final.
    });
  }
  async deleteSession(id) {this.handle(id); return this.transaction(client=>client.query('DELETE FROM nft_console_auth.sessions WHERE realm_id=$1 AND id=$2',[this.realmId,id]));}
}

import {createHash,randomBytes} from 'node:crypto';
import {getAddress} from 'ethers';
import {setupMessage} from './message.mjs';
export const setupDigest=value=>createHash('sha256').update(value).digest('hex');
export class SetupError extends Error {
  constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
export class InstallationStore {
  constructor({pool,origin,chainId}){Object.assign(this,{pool,origin,chainId,id:setupDigest('nft-console:installation:v1:'+origin)});}
  async transaction(fn){
    const client=await this.pool.connect();let broken;
    try{await client.query('BEGIN');await client.query('SET LOCAL statement_timeout=10000');await client.query('SET LOCAL lock_timeout=5000');await client.query('SET LOCAL ROLE nft_console_auth_service');const result=await fn(client);await client.query('COMMIT');return result;}
    catch(error){try{await client.query('ROLLBACK');}catch(cause){broken=cause;}throw error;}
    finally{client.release(broken);}
  }
  async owner(){return this.transaction(async client=>{
    const result=await client.query('SELECT origin,chain_id,admin_wallet FROM nft_console_auth.installations WHERE id=$1',[this.id]);
    const row=result.rows[0];if(!row)return null;
    if(row.origin!==this.origin||Number(row.chain_id)!==this.chainId)throw new SetupError('INSTALLATION_NETWORK_MISMATCH');
    return getAddress(row.admin_wallet);
  });}
  async issue(wallet,bindingHash,keyDigest){return this.transaction(async client=>{
    // Serializes bounded challenge issuance across all instances of this installation.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[this.id]);
    if((await client.query('SELECT 1 FROM nft_console_auth.installations WHERE id=$1',[this.id])).rows.length)throw new SetupError('SETUP_ALREADY_COMPLETE');
    await client.query('DELETE FROM nft_console_auth.installation_challenges WHERE expires_at<=clock_timestamp()');
    const count=await client.query('SELECT count(*)::integer AS count FROM nft_console_auth.installation_challenges WHERE installation_id=$1',[this.id]);
    if(count.rows[0].count>=16)throw new SetupError('SETUP_BUSY',429);
    const clock=await client.query("SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS now_ms");
    const now=Number(clock.rows[0].now_ms),nonce=randomBytes(32).toString('hex'),issuedAt=new Date(now).toISOString(),expiresAt=new Date(now+300000).toISOString();
    const message=setupMessage({origin:this.origin,wallet:getAddress(wallet),chainId:this.chainId,nonce,issuedAt,expiresAt});
    await client.query('INSERT INTO nft_console_auth.installation_challenges(installation_id,id,binding_hash,key_digest,wallet,message,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[this.id,nonce,bindingHash,keyDigest,wallet.toLowerCase(),message,expiresAt]);
    return {version:1,challengeId:nonce,message,issuedAt,expiresAt};
  });}
  async consume(id,bindingHash,keyDigest){return this.transaction(async client=>{
    const result=await client.query('DELETE FROM nft_console_auth.installation_challenges WHERE installation_id=$1 AND id=$2 AND binding_hash=$3 AND key_digest=$4 AND expires_at>clock_timestamp() RETURNING wallet,message',[this.id,id,bindingHash,keyDigest]);
    if(!result.rows[0])throw new SetupError('SETUP_CHALLENGE_EXPIRED',401);return result.rows[0];
  });}
  async claim(wallet,keyDigest){return this.transaction(async client=>{
    const result=await client.query('INSERT INTO nft_console_auth.installations(id,origin,chain_id,admin_wallet,setup_key_digest) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id',[this.id,this.origin,this.chainId,wallet.toLowerCase(),keyDigest]);
    if(!result.rows.length)throw new SetupError('SETUP_ALREADY_COMPLETE');
    await client.query('DELETE FROM nft_console_auth.installation_challenges WHERE installation_id=$1',[this.id]);return true;
  });}
}

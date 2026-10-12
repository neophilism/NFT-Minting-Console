import { randomUUID } from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ADDRESS=/^0x[0-9a-f]{40}$/;
const MAX_REVISION=(1n<<63n)-1n;
export class ReleaseError extends Error {constructor(status,code,message){super(message);Object.assign(this,{status,code});}}
const invalid=()=>{throw new ReleaseError(400,'invalid_release','Invalid release request.');};
const forbidden=()=>{throw new ReleaseError(403,'forbidden','Release-owner permission is required.');};
const missing=()=>{throw new ReleaseError(404,'release_not_found','Release not found or not accessible.');};
const conflict=()=>{throw new ReleaseError(409,'release_conflict','The release changed. Reload before saving.');};
function uuid(value){if(typeof value!=='string' || !UUID.test(value))invalid();return value.toLowerCase();}
function revision(value){if(typeof value!=='string' || !/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value)>=MAX_REVISION)invalid();return value;}
export function readEnvelope(value,update=false){
  const fields=update?['ciphertext','nonce','expectedRevision']:['id','ciphertext','nonce'];
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length!==fields.length || fields.some(k=>!Object.hasOwn(value,k)))invalid();
  const decode=(data,min,max)=>{
    if(typeof data!=='string' || data.length>Math.ceil(max/3)*4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))invalid();
    const bytes=Buffer.from(data,'base64');if(bytes.length<min || bytes.length>max || bytes.toString('base64')!==data)invalid();return bytes;
  };
  return {...(update?{expectedRevision:revision(value.expectedRevision)}:{id:uuid(value.id)}),ciphertext:decode(value.ciphertext,16,32768),nonce:decode(value.nonce,12,12)};
}
function actorContext(actor){if(!actor || !ADDRESS.test(actor.wallet) || /^0x0{40}$/.test(actor.wallet) || !['owner','editor','viewer'].includes(actor.role) || ![1,11155111,31337].includes(actor.chainId))forbidden();}
const serialize=row=>({id:row.id,ownerAccountId:row.owner_account_id,state:row.state,revision:String(row.revision),ciphertext:Buffer.from(row.workspace_ciphertext).toString('base64'),nonce:Buffer.from(row.workspace_nonce).toString('base64'),createdAt:row.created_at,updatedAt:row.updated_at});
/** Actor comes from authenticated middleware, NEVER request JSON. Opaque bytes
 * are not proof of encryption; the client encryption gate remains separate. */
export class ReleaseRepository {
  constructor({pool,knownRoles}){if(!pool || typeof pool.connect!=='function' || typeof knownRoles!=='function')throw new Error('Pool and authoritative role lookup required.');Object.assign(this,{pool,knownRoles});}
  async transaction(actor,releaseId,operation,target){
    actorContext(actor);if(this.knownRoles().get(actor.wallet)!==actor.role)forbidden();
    if(target && (!ADDRESS.test(target.wallet) || (target.create && !this.knownRoles().has(target.wallet))))forbidden();
    const client=await this.pool.connect();let begun=false,broken;
    try{
      await client.query('BEGIN');begun=true;await client.query('SET LOCAL statement_timeout = 10000');await client.query('SET LOCAL lock_timeout = 5000');
      await client.query('SET LOCAL ROLE nft_console_identity');
      const identity=async(wallet,create=true)=>{
        if(create)await client.query('INSERT INTO nft_console.accounts(id,wallet,chain_id) VALUES($1,$2,$3) ON CONFLICT(wallet,chain_id) DO NOTHING',[randomUUID(),wallet,actor.chainId]);
        const found=await client.query('SELECT id FROM nft_console.accounts WHERE wallet=$1 AND chain_id=$2',[wallet,actor.chainId]);return found.rows[0]?.id || null;
      };
      const accountId=await identity(actor.wallet),targetId=target?await identity(target.wallet,target.create):null;
      if(!accountId)throw new ReleaseError(503,'identity_unavailable','Account binding unavailable.');
      await client.query('SET LOCAL ROLE nft_console_api');
      await client.query("SELECT set_config('nft_console.account_id',$1,true),set_config('nft_console.chain_id',$2,true),set_config('nft_console.console_role',$3,true)",[accountId,String(actor.chainId),actor.role]);
      if(releaseId)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,91723))',[uuid(releaseId)]);
      const result=await operation(client,accountId,targetId);await client.query('COMMIT');begun=false;return result;
    }catch(error){if(begun){try{await client.query('ROLLBACK');}catch(failure){broken=failure;}}throw error;}finally{client.release(broken);}
  }
  async allowed(client,id,operation){const result=await client.query('SELECT nft_console.release_access($1,$2) AS allowed',[id,operation]);if(result.rows[0]?.allowed!==true)missing();}
  async list(actor,{after,limit=50}={}){
    if(!Number.isInteger(limit)||limit<1||limit>100)invalid();if(after!==undefined)uuid(after);
    return this.transaction(actor,null,async client=>{const result=await client.query('SELECT id,state,revision::text,created_at,updated_at FROM nft_console.releases WHERE ($1::uuid IS NULL OR id>$1::uuid) ORDER BY id LIMIT $2',[after||null,limit+1]);const items=result.rows.slice(0,limit);return {items,nextCursor:result.rows.length>limit?items.at(-1).id:null};});
  }
  async get(actor,id){id=uuid(id);return this.transaction(actor,id,async client=>{await this.allowed(client,id,'read');const result=await client.query('SELECT * FROM nft_console.releases WHERE id=$1',[id]);if(!result.rows[0])missing();return serialize(result.rows[0]);});}
  async create(actor,value){
    actorContext(actor);if(actor.role!=='owner')forbidden();const data=readEnvelope(value);
    return this.transaction(actor,data.id,async(client,accountId)=>{
      const result=await client.query('INSERT INTO nft_console.releases(id,owner_account_id,workspace_ciphertext,workspace_nonce) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING RETURNING *',[data.id,accountId,data.ciphertext,data.nonce]);
      if(result.rows[0])return {...serialize(result.rows[0]),created:true};
      const current=await client.query('SELECT * FROM nft_console.releases WHERE id=$1',[data.id]);const row=current.rows[0];
      if(!row || row.owner_account_id!==accountId || !Buffer.from(row.workspace_ciphertext).equals(data.ciphertext) || !Buffer.from(row.workspace_nonce).equals(data.nonce))conflict();
      return {...serialize(row),created:false};
    });
  }
  async update(actor,id,value){
    id=uuid(id);const data=readEnvelope(value,true);
    return this.transaction(actor,id,async client=>{
      await this.allowed(client,id,'edit');const current=await client.query('SELECT * FROM nft_console.releases WHERE id=$1',[id]);const row=current.rows[0];if(!row)missing();
      const equal=Buffer.from(row.workspace_ciphertext).equals(data.ciphertext)&&Buffer.from(row.workspace_nonce).equals(data.nonce);
      const expected=BigInt(data.expectedRevision),actual=BigInt(row.revision);if(equal&&(actual===expected||actual===expected+1n))return {...serialize(row),changed:false};if(actual!==expected)conflict();
      const result=await client.query('UPDATE nft_console.releases SET workspace_ciphertext=$2,workspace_nonce=$3,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND revision=$4 RETURNING *',[id,data.ciphertext,data.nonce,data.expectedRevision]);if(!result.rows[0])conflict();return {...serialize(result.rows[0]),changed:true};
    });
  }
  async permission(actor,id,wallet,permission){
    actorContext(actor);if(actor.role!=='owner')forbidden();id=uuid(id);if(typeof wallet!=='string')invalid();wallet=wallet.toLowerCase();
    if(!ADDRESS.test(wallet)||/^0x0{40}$/.test(wallet)||wallet===actor.wallet||![null,'viewer','editor'].includes(permission))invalid();
    return this.transaction(actor,id,async(client,_accountId,targetId)=>{
      await this.allowed(client,id,'owner');
      if(permission===null){if(targetId)await client.query('DELETE FROM nft_console.release_permissions WHERE release_id=$1 AND account_id=$2',[id,targetId]);}
      else{if(!targetId)forbidden();await client.query('INSERT INTO nft_console.release_permissions(id,release_id,account_id,permission) VALUES($1,$2,$3,$4) ON CONFLICT(release_id,account_id) DO UPDATE SET permission=EXCLUDED.permission',[randomUUID(),id,targetId,permission]);}
      return {releaseId:id,wallet,permission};
    },{wallet,create:permission!==null});
  }
  async permissionHistory(actor,id){id=uuid(id);return this.transaction(actor,id,async client=>{await this.allowed(client,id,'owner');const result=await client.query('SELECT id,actor_account_id,grantee_account_id,old_permission,new_permission,occurred_at FROM nft_console_auth.permission_events WHERE release_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 100',[id]);return {events:result.rows};});}
}

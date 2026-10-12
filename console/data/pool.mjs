const REQUIRED=['nft_console_api','nft_console_auth_service','nft_console_identity'];
const FLAGS=['rolsuper','rolcreatedb','rolcreaterole','rolinherit','rolreplication','rolbypassrls'];
const fail=()=>{throw new Error('DATABASE_URL requires the dedicated restricted runtime login, never the migration owner.');};
export function validateRuntimeIdentity(identity,memberships) {
  if(!identity || identity.role!==identity.login || identity.rolcanlogin!==true || FLAGS.some(key=>identity[key]!==false) || identity.schema_access!==false || identity.owns_objects!==false) fail();
  if(!Array.isArray(memberships) || memberships.length!==REQUIRED.length) fail();
  const names=memberships.map(row=>row.rolname).sort(); if(names.some((name,index)=>name!==REQUIRED[index])) fail();
  for(const row of memberships) if(row.rolcanlogin!==false || row.admin_option!==false || row.inherit_option!==false || row.set_option!==true || row.depth!==1 || FLAGS.some(key=>row[key]!==false)) fail();
}
export async function verifyRuntimeConnection(client) {
  const identity=await client.query(`SELECT current_user AS role,session_user AS login,r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolinherit,r.rolreplication,r.rolbypassrls,
    (has_schema_privilege(current_user,'nft_console','USAGE') OR has_schema_privilege(current_user,'nft_console','CREATE') OR has_schema_privilege(current_user,'nft_console_auth','USAGE') OR has_schema_privilege(current_user,'nft_console_auth','CREATE')) AS schema_access,
    (EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relowner=r.oid AND n.nspname IN('nft_console','nft_console_auth')) OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proowner=r.oid AND n.nspname IN('nft_console','nft_console_auth')) OR EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspowner=r.oid AND n.nspname IN('nft_console','nft_console_auth'))) AS owns_objects
    FROM pg_roles r WHERE r.rolname=session_user`);
  const memberships=await client.query(`WITH RECURSIVE membership AS (
    SELECT m.roleid,m.admin_option,m.inherit_option,m.set_option,1 AS depth,ARRAY[m.member,m.roleid] AS path FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=session_user
    UNION ALL SELECT m.roleid,m.admin_option,m.inherit_option,m.set_option,p.depth+1,p.path||m.roleid FROM pg_auth_members m JOIN membership p ON p.roleid=m.member WHERE NOT m.roleid=ANY(p.path))
    SELECT r.rolname,r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolinherit,r.rolreplication,r.rolbypassrls,m.admin_option,m.inherit_option,m.set_option,m.depth FROM membership m JOIN pg_roles r ON r.oid=m.roleid ORDER BY r.rolname`);
  validateRuntimeIdentity(identity.rows[0],memberships.rows);
}
export function databaseOptions(connectionString) {
  let url; try {url=new URL(connectionString);} catch {throw new Error('Invalid database connection configuration.');}
  if(!['postgres:','postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.pathname || url.pathname==='/') throw new Error('Invalid database connection configuration.');
  const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(!loopback && url.searchParams.get('sslmode')==='disable') throw new Error('Remote database connections require verified TLS.');
  // URL SSL switches must not override certificate-verifying runtime policy.
  for(const key of ['sslmode','ssl','sslcert','sslkey','sslrootcert','uselibpqcompat']) url.searchParams.delete(key);
  return {connectionString:url.toString(),ssl:loopback?false:{rejectUnauthorized:true},enableChannelBinding:!loopback,max:5,connectionTimeoutMillis:8000,idleTimeoutMillis:30000,allowExitOnIdle:true};
}
export class GuardedDatabasePool {
  constructor(pool) {this.pool=pool;}
  async connect() {const client=await this.pool.connect();try {await verifyRuntimeConnection(client);return client;} catch(error){client.release(error);throw error;}}
  async end() {await this.pool.end();}
}

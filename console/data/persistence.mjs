import pg from 'pg';
import { AuthError } from '../auth/core.mjs';
import { PostgresAuthStore } from '../auth/postgres.mjs';
import { ReleaseRepository } from './releases.mjs';
import { MintJournal } from '../operations/journal.mjs';
import { GuardedDatabasePool,databaseOptions } from './pool.mjs';

/** Optional durable backend. No network fallback, automatic migrations or
 * privileged credential injection. All callers must await ready before traffic. */
export function createPersistence({env,origin,chainId,roles}) {
  if(env.DATABASE_URL_UNPOOLED) throw new Error('Remove migration credentials from the application environment.');
  if(!env.DATABASE_URL) return null;
  const raw=new pg.Pool(databaseOptions(env.DATABASE_URL));
  raw.on('error',()=>console.error(JSON.stringify({event:'database.idle-connection-failed'})));
  const pool=new GuardedDatabasePool(raw);
  let store;
  try {store=new PostgresAuthStore({pool,origin,chainId,roles,errorFactory:(status,code)=>new AuthError(status,code)});}
  catch(error) {void raw.end();throw error;}
  const repository=new ReleaseRepository({pool,knownRoles:()=>roles});
  const journal=new MintJournal(repository);
  const ready=store.sweep().then(()=>journal.checkSchema()); ready.catch(()=>{});
  let sweeping=null,closing=null;
  const timer=setInterval(()=>{
    if(sweeping) return;
    sweeping=ready.then(()=>store.sweep()).catch(()=>console.error(JSON.stringify({event:'auth.expiry-cleanup-failed'}))).finally(()=>{sweeping=null;});
  },60000);timer.unref();
  return {store,repository,journal,ready,close(){
    if(!closing) closing=(async()=>{clearInterval(timer);await ready.catch(()=>{});if(sweeping)await sweeping;await pool.end();})();
    return closing;
  }};
}

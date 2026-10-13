/**
 * Disposable CI PostgreSQL readiness gate. No production credentials or implicit fallback.
 * Fail before migrations if a test-only database is not reachable.
 */
import pg from 'pg';
const url=process.env.TEST_DATABASE_URL_UNPOOLED;
if (process.env.NFT_TEST_DISPOSABLE_DATABASE!=='yes' ||
    typeof url!=='string' ||
    !/^postgresql:\/\/postgres:disposable-(?:browser-)?ci-only@127\.0\.0\.1:5432\/nft_console_ci$/.test(url)) {
  throw new Error('Only a local, disposable CircleCI PostgreSQL database is permitted.');
}
let connected=false;
for(let attempt=0;attempt<45;attempt++){
  const client=new pg.Client({connectionString:url,connectionTimeoutMillis:1000});
  try{
    await client.connect();
    const result=await client.query('SELECT current_database() AS name');
    if(result.rows[0]?.name!=='nft_console_ci')throw new Error('Unexpected database');
    connected=true;
    await client.end();
    break;
  }catch{
    await client.end().catch(()=>{});
    if(attempt!==44)await new Promise(resolve=>setTimeout(resolve,1000));
  }
}
if(!connected)throw new Error('Disposable PostgreSQL did not become healthy within 45 seconds.');
console.log('Disposable PostgreSQL is ready.');

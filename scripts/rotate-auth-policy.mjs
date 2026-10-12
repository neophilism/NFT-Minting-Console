import 'dotenv/config';
import pg from 'pg';
import {rolesFromEnvironment} from '../console/auth/core.mjs';
import {rotateAuthPolicy} from '../console/auth/rotation.mjs';
import {databaseOptions} from '../console/data/pool.mjs';
const args=process.argv.slice(2);
if(args.some(value=>value!=='--apply'&&!/^--expected-policy=[a-f0-9]{64}$/.test(value))||args.filter(x=>x==='--apply').length>1||args.filter(x=>x.startsWith('--expected-policy=')).length>1)throw new Error('Use --apply --expected-policy=<inspected digest>, or omit flags for preview.');
const url=process.env.DATABASE_URL_UNPOOLED;
if(!url||new URL(url).hostname.includes('-pooler'))throw new Error('Policy administration requires a separate direct DATABASE_URL_UNPOOLED.');
const client=new pg.Client(databaseOptions(url));await client.connect();
try {
  const result=await rotateAuthPolicy(client,{origin:process.env.PUBLIC_ORIGIN,chainId:Number(process.env.CHAIN_ID),roles:rolesFromEnvironment(process.env),apply:args.includes('--apply'),expectedPolicyDigest:args.find(x=>x.startsWith('--expected-policy='))?.split('=')[1]});
  console.log(JSON.stringify(result));
}finally{await client.end();}

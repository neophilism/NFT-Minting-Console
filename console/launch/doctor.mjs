import {getAddress,formatEther} from 'ethers';
import {rolesFromEnvironment,canonicalOrigin} from '../auth/core.mjs';
import {databaseOptions,verifyRuntimeConnection} from '../data/pool.mjs';
import {publicLaunchMode} from './mode.mjs';
import {collectionConfig,exact,address,prepareCollectionDeployment,simulateDeployment,anchor,canonical} from './contracts.mjs';
import {launchFeeBudget} from './fees.mjs';

const result=(id,ok,message)=>({id,status:ok?'pass':'fail',message});
/** Never return raw environment values, URLs, errors, database rows or credentials. */
export function launchConfigurationReport(env,request){
  const checks=[];let roles,chainId;
  function check(id,fn,message){try{if(!fn())throw new Error();checks.push(result(id,true,message));}catch{checks.push(result(id,false,message));}}
  check('production-mode',()=>env.NODE_ENV==='production','NODE_ENV must be production for this real-launch check.');
  check('supported-chain',()=>[1,11155111].includes(chainId=Number(env.CHAIN_ID)),'Choose Ethereum mainnet or Sepolia explicitly.');
  check('exact-origin',()=>Boolean(canonicalOrigin(env.PUBLIC_ORIGIN,true)),'PUBLIC_ORIGIN must be an exact HTTPS origin.');
  check('owner-allowlist',()=>{roles=rolesFromEnvironment(env);return [...roles.values()].includes('owner');},'Configure at least one valid owner wallet without conflicting roles.');
  check('runtime-database',()=>Boolean(databaseOptions(env.DATABASE_URL)),'DATABASE_URL must select a dedicated restricted runtime login over verified TLS.');
  check('separate-migration-secret',()=>!env.DATABASE_URL_UNPOOLED,'Keep migration credentials out of the application environment.');
  check('public-launch-scope',()=>publicLaunchMode(env,chainId,env.PUBLIC_ORIGIN,roles),'Enable NFT_PUBLIC_LAUNCH=1 with HTTPS RPC; mainnet also requires its explicit real-fee acknowledgement.');
  check('collection-request',()=>{
    exact(request,['version','wallet','collection']);if(request.version!==1)return false;
    address(request.wallet);collectionConfig(request.collection);return true;
  },'Supply the reviewed public wallet and exact collection constructor configuration.');
  if(checks.at(-1).status==='pass'){
    check('deployment-wallet-role',()=>roles.get(request.wallet.toLowerCase())==='owner','The deployment wallet must have the console owner role.');
    check('minter-wallet-role',()=>roles.get(request.collection.minter.toLowerCase())==='owner','The configured minter needs the console owner role for this mint flow.');
  }
  return {version:1,readOnly:true,configurationValid:checks.every(x=>x.status==='pass'),readyForDeploymentReview:false,
    transactionSent:false,mintingVerified:false,listingVerified:false,pinningCredentialConfigured:Boolean(env.PINATA_JWT),pinningCredentialVerified:false,checks};
}

/** A dedicated fresh runtime connection; all statements are read-only or local transaction settings. */
export async function inspectLaunchDatabase(client){
  await client.query('BEGIN READ ONLY');
  try{
    await client.query("SET LOCAL statement_timeout='8000ms'");
    await verifyRuntimeConnection(client);
    const policies=await client.query(`SELECT n.nspname AS schema,c.relname AS name,c.relrowsecurity AS rls,c.relforcerowsecurity AS forced
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE (n.nspname='nft_console' AND c.relname IN('releases','mint_journal','launch_journal','launch_nonce_resolutions'))
         OR (n.nspname='nft_console_auth' AND c.relname='launch_events')`);
    if(policies.rows.length!==5||policies.rows.some(row=>row.rls!==true||row.forced!==true))throw new Error('schema');
    await client.query('SET LOCAL ROLE nft_console_api');
    await client.query('SELECT intent_id,state,revision,public_plan FROM nft_console.launch_journal LIMIT 0');
    await client.query('SELECT revision,state FROM nft_console_auth.launch_events LIMIT 0');
    await client.query('SELECT proof FROM nft_console.launch_nonce_resolutions LIMIT 0');
    const permissions=await client.query(`SELECT
      has_table_privilege(current_user,'nft_console.launch_journal','DELETE') AS delete_journal,
      has_table_privilege(current_user,'nft_console_auth.launch_events','INSERT,UPDATE,DELETE') AS change_events,
      has_column_privilege(current_user,'nft_console.launch_journal','public_plan','UPDATE') AS change_plan,
      has_table_privilege(current_user,'nft_console.launch_nonce_resolutions','UPDATE,DELETE') AS change_resolution`);
    if(Object.values(permissions.rows[0]||{}).length!==4||Object.values(permissions.rows[0]).some(Boolean))throw new Error('permissions');
    const visibility=await client.query('SELECT count(*)::text AS n FROM nft_console.launch_journal');
    if(visibility.rows[0]?.n!=='0')throw new Error('unbound rows');
    if((await client.query('SELECT count(*)::text AS n FROM nft_console.launch_nonce_resolutions')).rows[0]?.n!=='0')throw new Error('unbound recovery rows');
    return {restrictedRoleVerified:true,launchSchemaVerified:true,forcedRlsVerified:true,unboundVisibilityVerified:true,mutationPerformed:false,migrationChecksumsVerified:false};
  }finally{await client.query('ROLLBACK');}
}

/** RPC inspection only: no signer, raw transaction, upload, approval, journal reservation or broadcast. */
export async function inspectDeploymentFunding(provider,artifact,request,chainId){
  const wallet=address(request.wallet),config=collectionConfig(request.collection);
  const observed=await anchor(provider,chainId);
  if(await provider.getCode(config.minter,observed.number)!=='0x')throw new Error('Direct EOA minter required.');
  const nonce=await provider.getTransactionCount(wallet,'pending');
  const plan=prepareCollectionDeployment(artifact,config,{chainId,requester:wallet,nonce});
  const simulation=await simulateDeployment(provider,plan);
  const [balance,priceHex]=await Promise.all([provider.getBalance(wallet,'pending'),provider.send('eth_gasPrice',[])]);
  if(typeof priceHex!=='string'||!/^0x[0-9a-f]{1,64}$/i.test(priceHex))throw new Error('Invalid RPC fee.');
  const budget=launchFeeBudget(BigInt(simulation.gas),BigInt(priceHex),balance);
  await canonical(provider,chainId,observed);
  return {wallet:getAddress(wallet),chainId,nonce,predictedCollection:plan.expected.collection,blockNumber:simulation.blockNumber,blockHash:simulation.blockHash,
    constructorSimulated:true,...budget,maximumCostEth:formatEther(budget.maximumCostWei),additionalEth:formatEther(budget.additionalWei),
    deploymentOnly:true,mintGasIncluded:false,estimateIsTimeSensitive:true,transactionSent:false};
}

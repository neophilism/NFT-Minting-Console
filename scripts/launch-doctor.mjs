import 'dotenv/config';
import {readFile} from 'node:fs/promises';
import {ethers} from 'ethers';
import pg from 'pg';
import {launchConfigurationReport,inspectLaunchDatabase,inspectDeploymentFunding} from '../console/launch/doctor.mjs';
import {databaseOptions} from '../console/data/pool.mjs';
import {loadCollectionArtifact} from '../console/launch/artifacts.mjs';

try{
  const [file,network,...extra]=process.argv.slice(2);
  if(!file||extra.length||(network!==undefined&&network!=='--network'))throw new Error();
  const bytes=await readFile(file);if(bytes.length>8192)throw new Error();
  const request=JSON.parse(bytes.toString('utf8')),report=launchConfigurationReport(process.env,request);
  if(network==='--network'&&report.configurationValid){
    const client=new pg.Client(databaseOptions(process.env.DATABASE_URL));
    client.on('error',()=>{}); // Query/connect failures are reported only as redacted check results.
    const rpcRequest=new ethers.FetchRequest(process.env.RPC_URL);rpcRequest.timeout=8000;
    const provider=new ethers.JsonRpcProvider(rpcRequest,undefined,{batchMaxCount:1,cacheTimeout:-1});
    try{
      try{await client.connect();report.database=await inspectLaunchDatabase(client);report.checks.push({id:'live-database',status:'pass',message:'Restricted runtime role and public launch schema verified with read-only SQL.'});}
      catch{report.checks.push({id:'live-database',status:'fail',message:'Runtime database verification failed. Check restricted role provisioning, migrations and network access.'});}
      try{
        report.deployment=await inspectDeploymentFunding(provider,loadCollectionArtifact(),request,Number(process.env.CHAIN_ID));
        report.checks.push({id:'deployment-simulation',status:'pass',message:'Exact constructor output and canonical chain observation verified.'});
        report.checks.push({id:'fee-policy',status:report.deployment.withinLimits?'pass':'fail',message:'Deployment estimate must fit the same gas/fee limits as wallet review.'});
        report.checks.push({id:'deployment-balance',status:report.deployment.funded?'pass':'fail',message:'The signing wallet must cover the displayed deployment fee cap. Mint gas is additional.'});
      }catch{report.checks.push({id:'deployment-simulation',status:'fail',message:'RPC or exact constructor simulation failed. Check chain, direct EOA wallets, nonce, artifact build and RPC access.'});}
      report.readyForDeploymentReview=report.checks.every(check=>check.status==='pass');
    }finally{provider.destroy();await client.end().catch(()=>{});}
  }else report.checks.push({id:'live-database-and-rpc',status:'not-checked',message:'Use --network only after local configuration checks pass. No live state was verified.'});
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(report.checks.some(check=>check.status==='fail'))process.exitCode=1;
}catch{
  process.stderr.write('Launch check could not read the public request. Usage: npm run launch:doctor -- launch-request.json [--network]\nNo transaction, upload or migration was requested.\n');process.exitCode=1;
}

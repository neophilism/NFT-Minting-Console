import 'dotenv/config';
import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {ethers} from 'ethers';
import {inspectCombinedBudget,budgetErrorCode} from '../console/launch/budget.mjs';
import {loadCollectionArtifact} from '../console/launch/artifacts.mjs';
import {verifyReviewedWorks} from '../console/launch/public-content.mjs';
import {exact,stop,address,collectionConfig} from '../console/launch/contracts.mjs';
async function publicJson(file,maximum){
  const selected=await lstat(file);if(!selected.isFile()||selected.isSymbolicLink()||selected.size>maximum)stop('INVALID_PUBLIC_INPUT');
  const handle=await open(file,constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW);
  try{
    const stat=await handle.stat();if(!stat.isFile()||stat.size>maximum||stat.ino!==selected.ino||stat.dev!==selected.dev)stop('PUBLIC_INPUT_CHANGED');
    const buffer=Buffer.alloc(maximum+1);let size=0;
    while(size<buffer.length){const result=await handle.read(buffer,size,buffer.length-size,null);if(!result.bytesRead)break;size+=result.bytesRead;}
    if(size>maximum||size!==stat.size)stop('PUBLIC_INPUT_CHANGED');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size)));
  }finally{await handle.close();}
}
let provider;
try{
  const [requestFile,bundleFile,...extra]=process.argv.slice(2);
  if(!requestFile||!bundleFile||extra.length)stop('INVALID_PUBLIC_INPUT');
  const chainId=Number(process.env.CHAIN_ID),url=new URL(process.env.RPC_URL);
  if(![1,11155111].includes(chainId)||url.protocol!=='https:'||url.username||url.password)stop('RPC_CONFIGURATION_REQUIRED');
  const request=await publicJson(requestFile,8192),bundle=await publicJson(bundleFile,1572864);
  exact(request,['version','wallet','collection']);if(request.version!==1)stop('INVALID_PUBLIC_INPUT');address(request.wallet);collectionConfig(request.collection);
  exact(bundle,['version','works']);if(bundle.version!==1)stop('INVALID_PUBLIC_INPUT');
  const works=await verifyReviewedWorks(bundle.works);
  const rpc=new ethers.FetchRequest(url.toString());rpc.timeout=20000;
  provider=new ethers.JsonRpcProvider(rpc,undefined,{batchMaxCount:1,cacheTimeout:-1});
  const report=await inspectCombinedBudget(provider,loadCollectionArtifact(),request,works,chainId);
  report.publicFilesVerified=true;report.readyForFundingReview=report.feeCapsWithinLimits&&report.validatorContractPresent;
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(!report.readyForFundingReview)process.exitCode=1;
}catch(error){
  process.stderr.write('Combined funding estimate stopped: '+budgetErrorCode(error)+'. No upload, signature or public-chain transaction was requested.\n');
  process.stderr.write('Usage: npm run launch:budget -- launch-request.json public-mint-bundle.json\nRequires HTTPS RPC_URL, explicit CHAIN_ID and eth_simulateV1 with maxUsedGas. Run launch:doctor for application readiness separately.\n');process.exitCode=1;
}finally{provider?.destroy();}

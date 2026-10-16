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
    totalInputBytes+=stat.size;if(totalInputBytes>8*1024*1024)stop('PUBLIC_INPUT_LIMIT');
    const buffer=Buffer.alloc(maximum+1);let size=0;
    while(size<buffer.length){const result=await handle.read(buffer,size,buffer.length-size,null);if(!result.bytesRead)break;size+=result.bytesRead;}
    if(size>maximum||size!==stat.size)stop('PUBLIC_INPUT_CHANGED');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size)));
  }finally{await handle.close();}
}
let provider,totalInputBytes=0;
try{
  const [requestFile,...bundleFiles]=process.argv.slice(2);
  if(!requestFile||bundleFiles.length<1||bundleFiles.length>500)stop('INVALID_PUBLIC_INPUT');
  const chainId=Number(process.env.CHAIN_ID),url=new URL(process.env.RPC_URL);
  if(![1,11155111].includes(chainId)||url.protocol!=='https:'||url.username||url.password)stop('RPC_CONFIGURATION_REQUIRED');
  const request=await publicJson(requestFile,8192);
  exact(request,['version','wallet','collection']);if(request.version!==1)stop('INVALID_PUBLIC_INPUT');address(request.wallet);collectionConfig(request.collection);
  const works=[];
  for(const file of bundleFiles){
    const bundle=await publicJson(file,1572864);exact(bundle,['version','works']);if(bundle.version!==1)stop('INVALID_PUBLIC_INPUT');
    works.push(...await verifyReviewedWorks(bundle.works));
    if(works.length>500)stop('INVALID_BATCH');
  }
  const rpc=new ethers.FetchRequest(url.toString());rpc.timeout=20000;
  provider=new ethers.JsonRpcProvider(rpc,undefined,{batchMaxCount:1,cacheTimeout:-1});
  const report=await inspectCombinedBudget(provider,loadCollectionArtifact(),request,works,chainId);
  report.publicFilesVerified=true;report.readyForFundingReview=report.feeCapsWithinLimits&&report.validatorContractPresent;
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(!report.readyForFundingReview)process.exitCode=1;
}catch(error){
  process.stderr.write('Combined funding estimate stopped: '+budgetErrorCode(error)+'. No upload, signature or public-chain transaction was requested.\n');
  process.stderr.write('Usage: npm run launch:budget -- launch-request.json public-mint-bundle.json [additional-public-bundles.json ...]\nRequires HTTPS RPC_URL, explicit CHAIN_ID and eth_simulateV1 with maxUsedGas. Run launch:doctor for application readiness separately.\n');process.exitCode=1;
}finally{provider?.destroy();}

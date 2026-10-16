import express from 'express';
import {createHash} from 'node:crypto';
import {inspectCombinedBudget,budgetErrorCode} from './budget.mjs';
import {exact,stop,collectionConfig,verifyDeploymentReceipt} from './contracts.mjs';
import {reviewedWork} from './public-content.mjs';
import {prepareMintWorks} from '../chain/mint.mjs';
import {PublicReadbackError,verifyPublicFiles} from '../publication/readback.mjs';
export const QUOTE_TTL_MS=120000,QUOTE_INPUT_BYTES=8*1024*1024;
/** Validate the entire request before any IPFS or RPC work. */
export function quoteInput(body){
  if(!body||!['new','existing'].includes(body.mode))stop('INVALID_QUOTE_INPUT');
  exact(body,['version','mode','config','deploymentIntentId','works','publicDisclosureConfirmed']);
  if(body.version!==1||body.publicDisclosureConfirmed!==true)stop('PUBLIC_CONSENT_REQUIRED');
  if(body.mode==='new'){collectionConfig(body.config);if(body.deploymentIntentId!==null)stop('INVALID_QUOTE_INPUT');}
  else if(body.config!==null||typeof body.deploymentIntentId!=='string'||!/^0x[0-9a-f]{64}$/i.test(body.deploymentIntentId))stop('INVALID_QUOTE_INPUT');
  if(!Array.isArray(body.works)||body.works.length<1||body.works.length>500)stop('INVALID_BATCH');
  if(Buffer.byteLength(JSON.stringify(body))>QUOTE_INPUT_BYTES)stop('PUBLIC_INPUT_LIMIT');
  const reviewed=body.works.map(reviewedWork),works=[];
  for(let i=0;i<reviewed.length;i+=10)works.push(...prepareMintWorks(reviewed.slice(i,i+10).map(row=>row.work)).works);
  if(new Set(works.map(w=>w.tokenId)).size!==works.length)stop('DUPLICATE_TOKEN_ID');
  const files=new Map();for(const row of reviewed)for(const file of row.manifest.files){const old=files.get(file.uri);if(old&&(old.sha256!==file.sha256||old.byteLength!==file.byteLength))stop('PUBLIC_COMMITMENT_MISMATCH');files.set(file.uri,file);}
  return {works,files:[...files.values()],inputDigest:createHash('sha256').update(JSON.stringify(body)).digest('hex')};
}
/** No journal mutation, key custody, upload, or transaction broadcast. */
export async function createCostQuote({body,actor,journal,provider,artifact,chainId,contentOptions,signal}){
  const validated=quoteInput(body),check=()=>{if(signal?.aborted)stop('QUOTE_CANCELLED');};check();
  let existing=null,config=body.config;
  if(body.mode==='existing'){
    const row=await journal.get(actor,body.deploymentIntentId);
    if(row.plan.kind!=='deploy'||row.state!=='verified'||!row.transactionHash)stop('DEPLOYMENT_REQUIRED');
    await verifyDeploymentReceipt(provider,row.plan,row.transactionHash);existing=row.plan;config=row.plan.expected.config;
  }
  for(const file of validated.files){check();await verifyPublicFiles({version:1,publicDisclosureConfirmed:true,files:[file]},{...contentOptions,signal});}
  check();const report=await inspectCombinedBudget(provider,artifact,{version:1,wallet:actor.wallet,collection:config},validated.works,chainId,{existing,signal});check();
  const quotedAt=new Date(),expiresAt=new Date(quotedAt.getTime()+QUOTE_TTL_MS);
  return {...report,publicFilesVerified:true,readyForFundingReview:report.feeCapsWithinLimits&&report.validatorContractPresent,
    quoteId:validated.inputDigest,quotedAt:quotedAt.toISOString(),expiresAt:expiresAt.toISOString(),exactFinalCost:false,
    contractPaymentWei:'0',otherServiceCostsKnown:false};
}
export function installCostQuoteRoutes(app,requireAction,dependencies){
  const active=new Set();
  app.post('/api/launch/quote',requireAction('deploy'),express.json({limit:'8mb',strict:true}),async(req,res)=>{
    if(!dependencies.enabled)return res.status(409).json({code:'public_launch_disabled',error:'Public launch setup is required before estimating costs.'});
    if(!/^application\/json(?:\s*;|$)/i.test(req.get('Content-Type')||''))return res.status(415).json({code:'JSON_REQUIRED',error:'Use a JSON request.'});
    const key=req.actor.chainId+':'+req.actor.wallet;
    if(active.size>=2||active.has(key))return res.status(429).json({code:'QUOTE_BUSY',error:'A cost estimate is already running. Retry after it finishes.'});
    active.add(key);const controller=new AbortController(),abort=()=>controller.abort();
    const timer=setTimeout(abort,285000);res.once('close',abort);req.once('aborted',abort);
    try{const report=await createCostQuote({...dependencies,body:req.body,actor:req.actor,signal:controller.signal});if(!controller.signal.aborted)res.json(report);}
    catch(error){if(!res.destroyed){const code=error instanceof PublicReadbackError?error.code:budgetErrorCode(error);res.status(409).json({code,error:'Total cost estimate unavailable: '+code+'. No transaction was prepared or sent.'});}}
    finally{clearTimeout(timer);res.removeListener('close',abort);req.removeListener('aborted',abort);active.delete(key);}
  });
}

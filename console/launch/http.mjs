import { Contract } from 'ethers';
import { LaunchError, exact, stop, prepareCollectionDeployment, simulateDeployment, verifyDeploymentReceipt, verifyCollection, mintActionId, verifyFailedTransaction } from './contracts.mjs';
import { JournalError } from './journal.mjs';
import { verifyReviewedWorks } from './public-content.mjs';
import { prepareMintPlan, simulateMintBatch, verifyMintReceipt, MintCheckError } from '../chain/mint.mjs';
import { PublicReadbackError } from '../publication/readback.mjs';

export function installLaunchRoutes(app,requireAction,{journal,provider,artifact,enabled,chainId,contentOptions}){
  const wrap=fn=>async(req,res)=>{
    try{
      if(!enabled) return res.status(409).json({code:'public_launch_disabled',error:'Public launch is not configured.'});
      if(req.method==='POST'&&!/^application\/json(?:\s*;|$)/i.test(req.get('Content-Type')||''))return res.status(415).json({error:'Use a JSON request.'});
      await fn(req,res);
    }catch(e){
      const code=e instanceof LaunchError||e instanceof MintCheckError||e instanceof PublicReadbackError?e.code:e instanceof JournalError?e.code:'LAUNCH_UNAVAILABLE';
      res.status(e instanceof JournalError?e.status:409).json({code,error:e instanceof JournalError?e.message:'Launch verification stopped: '+code+'. Inspect the saved operation before signing again.'});
    }
  };
  app.get('/api/launch/operations',requireAction('read'),wrap(async(req,res)=>{
    if(Object.keys(req.query).some(k=>k!=='after')||(req.query.after!==undefined&&typeof req.query.after!=='string'))stop('INVALID_INPUT');res.json(await journal.list(req.actor,{limit:10,after:req.query.after}));
  }));
  app.get('/api/launch/operations/:id',requireAction('read'),wrap(async(req,res)=>res.json(await journal.get(req.actor,req.params.id))));
  app.post('/api/launch/deploy',requireAction('deploy'),wrap(async(req,res)=>{
    exact(req.body,['config','publicDisclosureConfirmed']);if(req.body.publicDisclosureConfirmed!==true)stop('PUBLIC_CONSENT_REQUIRED');
    const nonce=await provider.getTransactionCount(req.actor.wallet,'pending');
    const plan=prepareCollectionDeployment(artifact,req.body.config,{chainId,requester:req.actor.wallet,nonce});
    await simulateDeployment(provider,plan);res.json(await journal.create(req.actor,plan));
  }));
  app.post('/api/launch/mint',requireAction('mint'),wrap(async(req,res)=>{
    exact(req.body,['deploymentIntentId','works','publicDisclosureConfirmed']);if(req.body.publicDisclosureConfirmed!==true)stop('PUBLIC_CONSENT_REQUIRED');
    const deployed=await journal.get(req.actor,req.body.deploymentIntentId);
    if(deployed.plan.kind!=='deploy'||!deployed.transactionHash)stop('DEPLOYMENT_REQUIRED');
    // Reverify rather than trusting a saved green status or caller-supplied code hash.
    await verifyDeploymentReceipt(provider,deployed.plan,deployed.transactionHash);
    await verifyCollection(provider,deployed.plan.expected,chainId);
    const works=await verifyReviewedWorks(req.body.works,contentOptions);
    const batch=prepareMintPlan({chainId,collection:deployed.plan.expected.collection,minter:req.actor.wallet,runtimeCodeHash:deployed.runtimeCodeHash,works}).batches[0];
    await simulateMintBatch(provider,batch);
    const c=new Contract(batch.collection,['function getTransferValidator() view returns(address)'],provider);
    const validator=await c.getTransferValidator();if(await provider.getCode(validator)==='0x')stop('VALIDATOR_NOT_DEPLOYED');
    const nonce=await provider.getTransactionCount(req.actor.wallet,'pending');
    const plan={version:1,kind:'mint',intentId:mintActionId(batch.id,nonce),chainId,from:batch.minter,to:batch.collection,data:batch.data,value:'0x0',nonce,
      expected:deployed.plan.expected,batch,publicFilesVerifiedAt:new Date().toISOString(),validator,validatorPolicyVerified:false};
    res.json(await journal.create(req.actor,plan));
  }));
  app.post('/api/launch/operations/:id/check',requireAction('deploy'),wrap(async(req,res)=>{
    exact(req.body,[]);const row=await journal.get(req.actor,req.params.id);
    if(row.state!=='prepared')stop('OPERATION_NOT_PREPARED');
    if(row.plan.kind==='deploy')await simulateDeployment(provider,row.plan);
    else {await verifyCollection(provider,row.plan.expected,chainId);await simulateMintBatch(provider,row.plan.batch);}
    if(await provider.getTransactionCount(req.actor.wallet,'pending')!==row.plan.nonce)stop('NONCE_CHANGED');
    res.json({intentId:row.intentId,checked:true});
  }));
  for(const [route,method] of [['claim','claim'],['wallet-outcome','walletOutcome'],['transaction','attach'],['cancel','cancel']]){
    app.post(`/api/launch/operations/:id/${route}`,requireAction('deploy'),wrap(async(req,res)=>res.json(await journal[method](req.actor,req.params.id,req.body))));
  }
  app.post('/api/launch/operations/:id/reconcile',requireAction('deploy'),wrap(async(req,res)=>{
    exact(req.body,[]);const row=await journal.get(req.actor,req.params.id);if(!row.transactionHash)stop('TRANSACTION_REQUIRED');
    let observation;
    try{
      const e=row.plan.kind==='deploy'?await verifyDeploymentReceipt(provider,row.plan,row.transactionHash):await verifyMintReceipt(provider,row.plan.batch,row.transactionHash);
      observation={state:'verified',block:e.blockNumber,blockHash:e.blockHash,confirmations:Math.min(e.confirmations,2147483647),code:null};
    }catch(e){const code=e instanceof LaunchError||e instanceof MintCheckError?e.code:'RPC_VERIFICATION_UNAVAILABLE';
      if(code==='TRANSACTION_REVERTED'){
        try{const failed=await verifyFailedTransaction(provider,row.plan,row.transactionHash);observation={state:'attention',block:failed.blockNumber,blockHash:failed.blockHash,confirmations:failed.confirmations,code};}
        catch{observation={state:'attention',block:null,blockHash:null,confirmations:0,code:'FAILED_RECEIPT_UNVERIFIED'};}
      }else observation={state:['PENDING_OR_UNKNOWN','INSUFFICIENT_CONFIRMATIONS'].includes(code)?'submitted':'attention',block:null,blockHash:null,confirmations:0,code};
    }
    res.json(await journal.observe(req.actor,row.intentId,row.revision,observation));
  }));
}

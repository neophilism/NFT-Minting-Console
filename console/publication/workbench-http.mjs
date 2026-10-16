import {PublicationWorkbenchStore} from './workbench-store.mjs';
import {WorkbenchError,exact,descriptor} from './workbench-model.mjs';
import {authorizePublicUpload} from './signed-upload.mjs';
import {publicIpfsUri} from './ipfs-uri.mjs';
import {verifyPublicFiles,PublicReadbackError} from './readback.mjs';
export function installPublicationWorkbench(app,requireAction,{repository,jwt,contentOptions={},authorize=authorizePublicUpload}){
  const store=new PublicationWorkbenchStore(repository),running=new Set();
  const wrap=fn=>async(req,res)=>{
    const key=req.actor.wallet+':'+req.actor.chainId;
    if(req.method==='POST'&&!/^application\/json(?:\s*;|$)/i.test(req.get('Content-Type')||''))return res.status(415).json({error:'Use a JSON publication request.'});
    if(req.method==='POST'&&(running.has(key)||running.size>=2))return res.status(429).json({code:'PUBLICATION_BUSY',error:'A publication action is already running. Wait for its result before retrying.'});
    const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,280000);res.once('close',abort);if(req.method==='POST')running.add(key);
    try{await fn(req,res,controller.signal);}
    catch(error){const known=error instanceof WorkbenchError||error instanceof PublicReadbackError;const code=known?error.code:'PUBLICATION_UNAVAILABLE';if(!res.destroyed)res.status(error instanceof WorkbenchError?error.status:409).json({code,error:'Publication stopped: '+code+'. Saved public file commitments are retained; no mint was requested.'});}
    finally{clearTimeout(timer);res.removeListener('close',abort);if(req.method==='POST')running.delete(key);}
  };
  app.get('/api/publication/works',requireAction('publish'),wrap(async(req,res)=>{if(Object.keys(req.query).some(k=>k!=='after')||(req.query.after!==undefined&&typeof req.query.after!=='string'))throw new WorkbenchError('INVALID_PUBLICATION_INPUT');res.json(await store.list(req.actor,req.query.after??null));}));
  app.post('/api/publication/works',requireAction('publish'),wrap(async(req,res)=>res.json(await store.create(req.actor,req.body))));
  app.get('/api/publication/works/:id',requireAction('publish'),wrap(async(req,res)=>res.json(await store.get(req.actor,req.params.id))));
  app.post('/api/publication/works/:id/metadata',requireAction('publish'),wrap(async(req,res)=>{exact(req.body,[]);res.json(await store.metadata(req.actor,req.params.id));}));
  app.get('/api/publication/works/:id/bundle',requireAction('publish'),wrap(async(req,res)=>res.json(await store.bundle(req.actor,req.params.id))));
  app.post('/api/publication/works/:id/files/:kind/authorize',requireAction('publish'),wrap(async(req,res,signal)=>{
    exact(req.body,['publicDisclosureConfirmed','repeatMayDuplicateUpload']);if(req.body.publicDisclosureConfirmed!==true||typeof req.body.repeatMayDuplicateUpload!=='boolean')throw new WorkbenchError('PUBLIC_CONSENT_REQUIRED');
    // Commit the attempt before asking Pinata. A lost response is not permission to retry invisibly.
    const file=await store.issue(req.actor,req.params.id,req.params.kind,req.body.repeatMayDuplicateUpload);
    const capability=await authorize(descriptor({kind:file.kind,name:file.name,mime:file.mime,byteLength:file.byteLength,sha256:file.sha256}),{jwt,signal,issuedAt:file.issuedAt,...(contentOptions.fetchImpl?{fetchImpl:contentOptions.fetchImpl}:{})});
    if(!signal.aborted)res.json({...capability,kind:file.kind,sha256:file.sha256,byteLength:file.byteLength,publicOnly:true,attempt:file.attempts});
  }));
  app.post('/api/publication/works/:id/files/:kind/verify',requireAction('publish'),wrap(async(req,res,signal)=>{
    exact(req.body,['cid']);if(typeof req.body.cid!=='string'||req.body.cid.length>100)throw new WorkbenchError('INVALID_PUBLIC_CID');let uri;try{uri=publicIpfsUri('ipfs://'+req.body.cid);if(uri.slice(7).includes('/'))throw new Error();}catch{throw new WorkbenchError('INVALID_PUBLIC_CID');}
    const file=await store.candidate(req.actor,req.params.id,req.params.kind,uri);
    await verifyPublicFiles({version:1,publicDisclosureConfirmed:true,files:[{kind:file.kind,uri,sha256:file.sha256,byteLength:file.byteLength}]},{...contentOptions,signal});
    if(signal.aborted)throw new WorkbenchError('PUBLICATION_CANCELLED');res.json(await store.verified(req.actor,req.params.id,req.params.kind,uri));
  }));
  return store;
}

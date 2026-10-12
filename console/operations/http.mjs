import { JournalError, exactObject } from './journal.mjs';
import { reconcileJournal } from './reconcile.mjs';
export function installJournalRoutes(app,requireAction,journal,provider) {
  const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){const known=error instanceof JournalError;res.status(known?error.status:503).json({code:known?error.code:'journal_unavailable',error:known?error.message:'Transaction journal is unavailable. Do not resend a wallet transaction.'});}};
  const json=req=>{if(!/^application\/json(?:\s*;|$)/i.test(req.get('Content-Type')||''))throw new JournalError(415,'json_required','Use a JSON request.');};
  app.get('/api/mint-operations',requireAction('read'),wrap(async(req,res)=>{
    if(Reflect.ownKeys(req.query).some(key=>!['after','limit'].includes(key)))throw new JournalError(400,'invalid_page','Invalid journal page.');
    const limit=req.query.limit;
    if(limit!==undefined&&(typeof limit!=='string'||!/^[1-9][0-9]{0,2}$/.test(limit)))throw new JournalError(400,'invalid_page','Invalid journal page.');
    res.json(await journal.list(req.actor,{after:req.query.after,limit:limit===undefined?50:Number(limit)}));
  }));
  app.post('/api/mint-operations',requireAction('deploy'),wrap(async(req,res)=>{json(req);const result=await journal.create(req.actor,req.body);res.status(result.created?201:200).json(result);}));
  app.get('/api/mint-operations/:id',requireAction('read'),wrap(async(req,res)=>res.json(await journal.get(req.actor,req.params.id))));
  app.get('/api/mint-operations/:id/events',requireAction('read'),wrap(async(req,res)=>res.json(await journal.events(req.actor,req.params.id))));
  for(const [route,method] of [['claim','claim'],['wallet-outcome','walletOutcome'],['transaction','attach'],['cancel','cancel']]) {
    app.post(`/api/mint-operations/:id/${route}`,requireAction('deploy'),wrap(async(req,res)=>{json(req);res.json(await journal[method](req.actor,req.params.id,req.body));}));
  }
  app.post('/api/mint-operations/:id/reconcile',requireAction('deploy'),wrap(async(req,res)=>{
    json(req);exactObject(req.body,[]);res.json(await reconcileJournal(journal,req.actor,req.params.id,provider));
  }));
}

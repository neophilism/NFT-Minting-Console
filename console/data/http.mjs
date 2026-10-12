import { ReleaseError } from './releases.mjs';
export function installReleaseRoutes(app,requireAction,repository){
  const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){const known=error instanceof ReleaseError;res.status(known?error.status:503).json({code:known?error.code:'storage_unavailable',error:known?error.message:'Release storage is temporarily unavailable.'});}};
  const json=req=>{if(!/^application\/json(?:\s*;|$)/i.test(req.get('Content-Type')||''))throw new ReleaseError(415,'json_required','Use a JSON request.');};
  app.get('/api/releases',requireAction('read'),wrap(async(req,res)=>{const value=req.query.limit;if(value!==undefined&&(typeof value!=='string'||!/^[1-9][0-9]{0,2}$/.test(value)))throw new ReleaseError(400,'invalid_limit','Invalid page size.');res.json(await repository.list(req.actor,{after:req.query.after,limit:value===undefined?50:Number(value)}));}));
  app.post('/api/releases',requireAction('publish'),wrap(async(req,res)=>{json(req);const result=await repository.create(req.actor,req.body);res.status(result.created?201:200).json(result);}));
  app.get('/api/releases/:releaseId',requireAction('read'),wrap(async(req,res)=>res.json(await repository.get(req.actor,req.params.releaseId))));
  app.put('/api/releases/:releaseId',requireAction('edit'),wrap(async(req,res)=>{json(req);res.json(await repository.update(req.actor,req.params.releaseId,req.body));}));
  app.put('/api/releases/:releaseId/permissions/:wallet',requireAction('permissions'),wrap(async(req,res)=>{json(req);if(!req.body||Array.isArray(req.body)||Object.keys(req.body).length!==1||!Object.hasOwn(req.body,'permission'))throw new ReleaseError(400,'invalid_permission','Supply only the permission field.');res.json(await repository.permission(req.actor,req.params.releaseId,req.params.wallet,req.body.permission));}));
  app.delete('/api/releases/:releaseId/permissions/:wallet',requireAction('permissions'),wrap(async(req,res)=>res.json(await repository.permission(req.actor,req.params.releaseId,req.params.wallet,null))));
  app.get('/api/releases/:releaseId/permission-events',requireAction('permissions'),wrap(async(req,res)=>res.json(await repository.permissionHistory(req.actor,req.params.releaseId))));
}

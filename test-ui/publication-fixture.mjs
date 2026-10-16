// This process-local, no-public-upload fixture accepts exact browser multipart bytes.
// It models the Pinata API only; real-provider credentials are never loaded.
import express from 'express';
import multer from 'multer';
import {createHash,randomBytes} from 'node:crypto';
const capabilities=new Map(),content=new Map();
export function rawCid(bytes){
  const raw=Buffer.concat([Buffer.from([1,0x55,0x12,0x20]),createHash('sha256').update(bytes).digest()]);
  const alphabet='abcdefghijklmnopqrstuvwxyz234567';let bits=0,buffer=0,text='b';
  for(const byte of raw){buffer=(buffer<<8)|byte;bits+=8;while(bits>=5){bits-=5;text+=alphabet[(buffer>>>bits)&31];}}
  if(bits)text+=alphabet[(buffer<<(5-bits))&31];return text;
}
export async function fixturePublicationFetch(url,options={}){
  if(url==='https://uploads.pinata.cloud/v3/files/sign'){
    if(options.method!=='POST'||options.headers?.Authorization!=='Bearer synthetic-browser-publication-only')throw new Error('Wrong synthetic publication authorization.');
    const input=JSON.parse(options.body),id=randomBytes(16).toString('hex');
    if(input.network!=='public'||input.expires!==300||input.max_file_size>2*1024*1024||!Array.isArray(input.allow_mime_types)||input.allow_mime_types.length!==1)throw new Error('Unexpected synthetic upload scope.');
    capabilities.set(id,{...input,expiresAt:Date.now()+300000});
    return new Response(JSON.stringify({data:'https://uploads.pinata.cloud/v3/files?fixture='+id}),{status:200,headers:{'Content-Type':'application/json'}});
  }
  const prefix='https://gateway.pinata.cloud/ipfs/';
  const bytes=url.startsWith(prefix)?content.get(url.slice(prefix.length)):null;
  return bytes?new Response(bytes,{status:200,headers:{'Content-Length':String(bytes.length)}}):new Response('',{status:404});
}
export async function startPublicationFixture(){
  const app=express();const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1,fields:2,parts:3}});
  app.post('/upload',(req,res,next)=>{if(req.get('X-NFT-Test')!=='disposable-publication-only')return res.sendStatus(403);next();},upload.single('file'),(req,res)=>{
    const capability=capabilities.get(req.query.fixture),file=req.file;
    if(!capability||capability.expiresAt<Date.now()||!file||file.size!==capability.max_file_size||file.originalname!==capability.filename||file.mimetype!==capability.allow_mime_types[0]||req.body.network!=='public'||req.body.cid_version!=='v1')return res.status(400).json({error:'Synthetic upload refused'});
    capabilities.delete(req.query.fixture);const cid=rawCid(file.buffer);content.set(cid,file.buffer);res.json({data:{cid,size:file.size,network:'public'}});
  });
  app.use((e,req,res,next)=>{void e;void req;void next;res.status(400).json({error:'Synthetic fixture rejected request'});});
  const server=app.listen(4177,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  return async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));capabilities.clear();content.clear();};
}

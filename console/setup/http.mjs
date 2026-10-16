import express from 'express';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {getAddress,verifyMessage} from 'ethers';
import {cookieValue} from '../auth/http.mjs';
import {SetupError,setupDigest} from './store.mjs';
const HANDLE=/^[a-f0-9]{64}$/;
const messages={SETUP_CODE_REQUIRED:'Enter the installation setup code from your hosting Environment settings.',SETUP_ALREADY_COMPLETE:'This installation already has an administrator. Reload and sign in.',SETUP_CHALLENGE_EXPIRED:'This setup request expired or was already used. Start again.',INVALID_SETUP_REQUEST:'The setup request could not be accepted.',SETUP_SIGNATURE_MISMATCH:'The signature does not match this administrator registration.',WRONG_SETUP_NETWORK:'Switch the wallet to the network shown by this installation.',SETUP_EOA_REQUIRED:'Use a directly controlled Ethereum account for this first-mint administrator.',SETUP_BUSY:'Setup is busy. Wait a minute and retry.',RPC_SETUP_FAILED:'The configured blockchain connection could not be verified. Check RPC_URL and CHAIN_ID in the hosting environment.'};
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k)))throw new SetupError('INVALID_SETUP_REQUEST',400);}
export function authorizeSetupCode(actual,expected){
  if(typeof expected!=='string'||!HANDLE.test(expected)||typeof actual!=='string'||!HANDLE.test(actual)||!timingSafeEqual(Buffer.from(setupDigest(actual),'hex'),Buffer.from(setupDigest(expected),'hex')))throw new SetupError('SETUP_CODE_REQUIRED',403);
}
export function installSetupRoutes(app,{store,provider,origin,chainId,setupCode,onClaimed=async()=>true}){
  const cookie='nft_setup_binding_v1',cookieOptions={httpOnly:true,secure:origin.startsWith('https:'),sameSite:'strict',path:'/api/setup'};
  let period=0,requests=0;
  const boundary=(req,res,next)=>{
    try{
      if(req.get('Origin')!==origin||(req.get('Sec-Fetch-Site')&&!['same-origin','none'].includes(req.get('Sec-Fetch-Site'))))throw new SetupError('INVALID_SETUP_REQUEST',403);
      if(!/^application\/json(?:\s*;|$)/i.test(req.get('Content-Type')||''))throw new SetupError('INVALID_SETUP_REQUEST',415);
      next();
    }catch(e){failure(e,res);}
  };
  function failure(error,res){const known=error instanceof SetupError;if(known&&error.status===429)res.setHeader('Retry-After','60');return res.status(known?error.status:503).json({code:known?error.code:'SETUP_UNAVAILABLE',error:known?(messages[error.code]||'Setup is not available for this installation.'):'Setup is temporarily unavailable. No wallet transaction was sent.'});}
  const wrap=fn=>async(req,res)=>{try{authorizeSetupCode(req.body?.setupCode,setupCode);const now=Date.now();if(now-period>60000){period=now;requests=0;}if(++requests>30)throw new SetupError('SETUP_BUSY',429);if(await store.owner())throw new SetupError('SETUP_ALREADY_COMPLETE');await fn(req,res);}catch(e){failure(e,res);}};
  async function walletCheck(wallet){
    if(typeof wallet!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(wallet)||/^0x0{40}$/i.test(wallet))throw new SetupError('INVALID_SETUP_REQUEST',400);
    try{getAddress(wallet);}catch{throw new SetupError('INVALID_SETUP_REQUEST',400);}
    let network,code;try{network=await provider.getNetwork();code=await provider.getCode(wallet);}catch{throw new SetupError('RPC_SETUP_FAILED',503);}
    if(network.chainId!==BigInt(chainId))throw new SetupError('WRONG_SETUP_NETWORK');if(code!=='0x')throw new SetupError('SETUP_EOA_REQUIRED');
  }
  app.post('/api/setup/challenge',boundary,express.json({limit:'8kb',strict:true}),wrap(async(req,res)=>{
    exact(req.body,['setupCode','wallet','chainId']);if(req.body.chainId!==chainId)throw new SetupError('WRONG_SETUP_NETWORK');await walletCheck(req.body.wallet);
    const binding=randomBytes(32).toString('hex'),value=await store.issue(getAddress(req.body.wallet),setupDigest(binding),setupDigest(setupCode));
    res.cookie(cookie,binding,{...cookieOptions,maxAge:300000});res.json(value);
  }));
  app.post('/api/setup/claim',boundary,express.json({limit:'8kb',strict:true}),wrap(async(req,res)=>{
    exact(req.body,['setupCode','challengeId','signature']);const {challengeId,signature}=req.body;
    const binding=cookieValue(req.headers.cookie,cookie);if(typeof challengeId!=='string'||!HANDLE.test(challengeId)||typeof binding!=='string'||!HANDLE.test(binding)||typeof signature!=='string'||!/^0x[0-9a-fA-F]{130}$/.test(signature))throw new SetupError('INVALID_SETUP_REQUEST',400);
    const record=await store.consume(challengeId,setupDigest(binding),setupDigest(setupCode));let recovered;
    try{recovered=verifyMessage(record.message,signature);}catch{throw new SetupError('SETUP_SIGNATURE_MISMATCH',401);}
    if(recovered.toLowerCase()!==record.wallet)throw new SetupError('SETUP_SIGNATURE_MISMATCH',401);
    await walletCheck(recovered);await store.claim(recovered,setupDigest(setupCode));res.clearCookie(cookie,cookieOptions);
    const runtimeReady=await onClaimed().catch(()=>false);res.json({registered:true,runtimeReady:runtimeReady===true,transactionSent:false});
  }));
}

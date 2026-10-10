import "dotenv/config";
import express from "express";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {ethers} from "ethers";
const app=express();
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const publicDir=path.join(root,"console/public");
const upload=multer({dest:path.join(os.tmpdir(),"nft-console-uploads"),limits:{fileSize:1024*1024*1024,files:12}});
const pending=new Map(),sessions=new Map();
app.disable("x-powered-by");app.use(express.json({limit:"1mb"}));
app.use((_req,res,next)=>{res.setHeader("Cache-Control","no-store");res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");next();});
app.use(express.static(publicDir));app.use("/vendor",express.static(path.join(root,"node_modules/ethers/dist")));
const allowed=new Set((process.env.ADMIN_WALLETS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean));
const nonce=()=>crypto.randomBytes(24).toString("hex");
const cookie=(req,name)=>req.headers.cookie?.split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="))?.slice(name.length+1);
function trustedOrigin(req){const origin=req.get("origin");return !origin||origin===`${req.protocol}://${req.get("host")}`||origin===(process.env.PUBLIC_ORIGIN||"");}
function required(req,res,next){const token=cookie(req,"nft_session"),s=sessions.get(token);if(!s||s.expires<Date.now())return res.status(401).json({error:"Connect an authorized wallet and sign in."});if(!trustedOrigin(req))return res.status(403).json({error:"Invalid request origin"});if(req.get("X-CSRF-Token")!==s.csrf)return res.status(403).json({error:"Invalid session token"});req.admin=s.wallet;next();}
app.get("/api/config",(_req,res)=>res.json({chainId:Number(process.env.CHAIN_ID||1),chainSlug:process.env.CHAIN_SLUG||"ethereum",pinningReady:Boolean(process.env.PINATA_JWT),loginConfigured:allowed.size>0,validator:process.env.TRANSFER_VALIDATOR_ADDRESS||"0x721C008fdff27BF06E7E123956E2Fe03B63342e3",signedZone:process.env.OPENSEA_SIGNED_ZONE||"0x000056f7000000ece9003ca63978907a00ffd100"}));
app.get("/api/health",(_req,res)=>res.json({ok:true}));
app.post("/api/auth/challenge",(req,res)=>{const wallet=String(req.body?.wallet||"").toLowerCase();if(!ethers.isAddress(wallet)||!allowed.has(wallet))return res.status(403).json({error:"Wallet is not on the admin allowlist"});const value=nonce();const message=`NFT Console sign-in\nWallet: ${wallet}\nNonce: ${value}\nHost: ${req.get("host")}`;pending.set(wallet,{message,expires:Date.now()+5*60_000});res.json({message});});
app.post("/api/auth/verify",(req,res)=>{const wallet=String(req.body?.wallet||"").toLowerCase(),v=pending.get(wallet);pending.delete(wallet);if(!v||v.expires<Date.now()||!allowed.has(wallet))return res.status(401).json({error:"Sign-in challenge expired"});try{if(ethers.verifyMessage(v.message,String(req.body?.signature||"")).toLowerCase()!==wallet)throw Error("Invalid signature");}catch{return res.status(401).json({error:"Invalid signature"});}const token=nonce(),csrf=nonce();sessions.set(token,{wallet,csrf,expires:Date.now()+8*3600_000});res.cookie("nft_session",token,{httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV==="production",maxAge:8*3600_000,path:"/"});res.json({wallet,csrf});});
app.get("/api/artifact",(_req,res)=>{const p=path.join(root,"artifacts/contracts/NFTCollection.sol/NFTCollection.json");try{const a=JSON.parse(fs.readFileSync(p,"utf8"));res.json({abi:a.abi,bytecode:a.bytecode});}catch{res.status(503).json({error:"Contract build missing; run npm run compile"});}});
const shaFile=async p=>await new Promise((resolve,reject)=>{const h=crypto.createHash("sha256"),s=fs.createReadStream(p);s.on("data",c=>h.update(c));s.on("end",()=>resolve(h.digest("hex")));s.on("error",reject);});
const shaText=s=>crypto.createHash("sha256").update(s).digest("hex");
async function pin(filePath,name){if(!process.env.PINATA_JWT)throw Error("PINATA_JWT not configured");const form=new FormData();form.append("file",fs.createReadStream(filePath),{filename:name});form.append("pinataOptions",JSON.stringify({cidVersion:1}));const r=await axios.post("https://api.pinata.cloud/pinning/pinFileToIPFS",form,{headers:{...form.getHeaders(),Authorization:`Bearer ${process.env.PINATA_JWT}`},maxBodyLength:Infinity,timeout:600000});if(!r.data?.IpfsHash)throw Error("Pinata did not return CID");return "ipfs://"+r.data.IpfsHash;}
async function pinJSON(value,name){const r=await axios.post("https://api.pinata.cloud/pinning/pinJSONToIPFS",{pinataOptions:{cidVersion:1},pinataMetadata:{name},pinataContent:value},{headers:{Authorization:`Bearer ${process.env.PINATA_JWT}`},timeout:60000});if(!r.data?.IpfsHash)throw Error("Pinata did not return CID");return "ipfs://"+r.data.IpfsHash;}
function sanitize(s,max=300){return String(s||"").replace(/[\u0000-\u001f]/g,"").trim().slice(0,max);}
function validInt(s,min,max){const n=Number(s);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error("Invalid token ID or supply");return n;}
app.post("/api/prepare",required,upload.fields([{name:"media",maxCount:10},{name:"poster",maxCount:10}]),async(req,res)=>{const files=[...Object.values(req.files||{}).flat()],temps=files.map(f=>f.path);try{
const name=sanitize(req.body.collection,120),symbol=sanitize(req.body.symbol,32),description=sanitize(req.body.description,4000);
const supply=validInt(req.body.supply,1,1000000),startingId=validInt(req.body.startingId,1,supply);
const count=validInt(req.body.editions,1,10);if(!name||!symbol)throw Error("Collection name and symbol required");
const media=req.files?.media||[],posters=req.files?.poster||[];if(media.length<1)throw Error("Add at least one media file");if(media.length>10)throw Error("Maximum 10 media files per preparation");if(media.length!==1&&media.length!==count)throw Error("Use one media file for all editions, or upload one file per edition");
if(startingId+count-1>supply)throw Error("Token IDs exceed maximum supply");
const rights=sanitize(req.body.rightsText,100000);if(!rights)throw Error("Upload or enter explicit rights text; no rights are assumed");
const rightsPath=path.join(os.tmpdir(),`nft-rights-${nonce()}.txt`);await fsp.writeFile(rightsPath,rights);temps.push(rightsPath);
const rightsHash=shaText(rights),rightsURI=await pin(rightsPath,"rights.txt");
const mediaCache=new Map(),posterCache=new Map(),works=[];
for(let i=0;i<count;i++){const m=media.length===1?media[0]:media[i],tokenId=startingId+i,title=sanitize(req.body.title||m.originalname,160)+(count>1?` #${i+1}`:"");if(!title)throw Error("Every work needs a title");
if(!mediaCache.has(m.path))mediaCache.set(m.path,{sha:await shaFile(m.path),uri:await pin(m.path,m.originalname)});const data=mediaCache.get(m.path);
const poster=posters.length===1?posters[0]:posters[i];let imageURI;if(poster){if(!poster.mimetype.startsWith("image/"))throw Error("Display image must be an image file");if(!posterCache.has(poster.path))posterCache.set(poster.path,await pin(poster.path,poster.originalname));imageURI=posterCache.get(poster.path);}else if(m.mimetype.startsWith("image/")){imageURI=data.uri;}else throw Error("Video/audio/other files require an uploaded display image");
const metadata={name:title,description,image:imageURI,attributes:[{trait_type:"Collection",value:name},{trait_type:"Token ID",value:tokenId}],properties:{media_sha256:data.sha,rights_uri:rightsURI,rights_sha256:rightsHash}};if(!m.mimetype.startsWith("image/"))metadata.animation_url=data.uri;
const metadataURI=await pinJSON(metadata,`${symbol}-${tokenId}.json`);
works.push({tokenId,title,metadataURI,mediaHash:"0x"+data.sha,rightsURI,rightsHash:"0x"+rightsHash,metadata});}
res.json({collection:name,symbol,supply,rightsURI,rightsSHA256:rightsHash,works});
}catch(e){res.status(400).json({error:e.message});}finally{await Promise.allSettled(temps.map(p=>fsp.rm(p,{force:true})));}});
app.get("/api/preflight",async(req,res)=>{try{const addr=String(req.query.address||""),ids=String(req.query.ids||"").split(",").map(Number);if(!ethers.isAddress(addr)||!ids.length||ids.some(x=>!Number.isSafeInteger(x)||x<=0))throw Error("Invalid contract or IDs");if(!process.env.RPC_URL)throw Error("RPC_URL not configured");const provider=new ethers.JsonRpcProvider(process.env.RPC_URL),code=await provider.getCode(addr);if(code==="0x")throw Error("No collection code found");const abi=["function SERIES_SIZE() view returns(uint256)","function totalMinted() view returns(uint256)","function mintingClosed() view returns(bool)","function getTransferValidator() view returns(address)","function ownerOf(uint256) view returns(address)","function MINTER() view returns(address)","function CREATOR_ROYALTY_BPS() view returns(uint96)"];const c=new ethers.Contract(addr,abi,provider);const size=Number(await c.SERIES_SIZE());const vacant=[];for(const id of ids){if(id>size){vacant.push(false);continue;}try{await c.ownerOf(id);vacant.push(false);}catch{vacant.push(true);}}const chain=Number((await provider.getNetwork()).chainId);res.json({ok:vacant.every(Boolean)&&!(await c.mintingClosed())&&chain===Number(process.env.CHAIN_ID||1),vacant,supply:size,chainId:chain,minter:await c.MINTER(),royaltyBps:Number(await c.CREATOR_ROYALTY_BPS()),validator:await c.getTransferValidator()});}catch(e){res.status(400).json({error:e.message});}});
app.get("/api/opensea-url",(req,res)=>{const addr=String(req.query.contract||""),id=String(req.query.id||"");if(!ethers.isAddress(addr)||!/^[1-9][0-9]*$/.test(id))return res.status(400).json({error:"Invalid NFT"});res.json({url:`https://opensea.io/assets/${process.env.CHAIN_SLUG||"ethereum"}/${addr}/${id}`});});
app.listen(Number(process.env.PORT||3000),()=>console.log("NFT Console server listening"));

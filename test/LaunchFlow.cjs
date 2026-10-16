const {expect}=require('chai');
const {ethers}=require('hardhat');
const express=require('express');
const {PGlite}=require('@electric-sql/pglite');
const {once}=require('node:events');
const {createHash}=require('node:crypto');
describe('Public launch HTTP, durable journal and real EVM',function(){
  this.timeout(30000);
  let db,server,base,actor,journal,signer,collection,provider,content;
  const cid='bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq';
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  async function post(path,body){const r=await fetch(base+'/api/launch'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
  before(async()=>{
    [signer]=await ethers.getSigners();actor={wallet:signer.address.toLowerCase(),role:'owner',chainId:31337};provider=ethers.provider;
    db=new PGlite();await db.waitReady;
    await (await import('../scripts/migrate.mjs')).migrate(db);await (await import('../scripts/migrate-auth.mjs')).migrateAuth(db);
    await db.query('GRANT nft_console_api,nft_console_auth_service,nft_console_identity TO CURRENT_USER WITH INHERIT FALSE');
    let tail=Promise.resolve();const pool={async connect(){const old=tail;let unlock;tail=new Promise(r=>{unlock=r;});await old;return {query:(...args)=>db.query(...args),release:()=>unlock()};}};
    const repo=new (await import('../console/data/releases.mjs')).ReleaseRepository({pool,knownRoles:()=>new Map([[actor.wallet,'owner']])});
    journal=new (await import('../console/launch/journal.mjs')).LaunchJournal(repo);
    await journal.checkSchema();content=new Map();
    const app=express();app.use(express.json({limit:'1mb'}));
    (await import('../console/launch/http.mjs')).installLaunchRoutes(app,()=> (req,_res,next)=>{req.actor=actor;next();},{journal,provider,artifact:(await import('../console/launch/artifacts.mjs')).loadCollectionArtifact(),enabled:true,chainId:31337,
      contentOptions:{fetchImpl:async url=>{const bytes=content.get(url.split('/ipfs/')[1]);return bytes?new Response(bytes,{status:200}):new Response('',{status:404});}}});
    server=app.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;
  });
  after(async()=>{server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));await db?.close();});
  it('requires explicit public consent and rejects arbitrary transaction fields',async()=>{
    expect((await post('/deploy',{config:{},publicDisclosureConfirmed:false})).body.code).eq('PUBLIC_CONSENT_REQUIRED');
    expect((await post('/deploy',{config:{},publicDisclosureConfirmed:true,privateKey:'secret'})).body.code).eq('INVALID_INPUT');
  });
  let deployed;
  it('prepares, reserves, deploys, recovers and independently verifies exact constructor transaction',async()=>{
    const config={name:'Public workflow',symbol:'PW',seriesSize:'87',royaltyBps:'600',owner:signer.address,minter:signer.address,royaltyRecipient:signer.address};
    const result=await post('/deploy',{config,publicDisclosureConfirmed:true});expect(result.status).eq(200);deployed=result.body;
    expect(deployed.state).eq('prepared');collection=deployed.collection;
    expect((await post('/operations/'+deployed.intentId+'/check',{})).body.checked).eq(true);
    const claimed=await post('/operations/'+deployed.intentId+'/claim',{expectedRevision:deployed.revision});expect(claimed.body.state).eq('wallet_pending');
    expect((await post('/operations/'+deployed.intentId+'/claim',{expectedRevision:deployed.revision})).status).eq(409);
    const tx=await signer.sendTransaction({data:deployed.plan.data,nonce:deployed.plan.nonce});await tx.wait();await provider.send('evm_mine');
    expect((await post('/operations/'+deployed.intentId+'/transaction',{transactionHash:tx.hash})).body.state).eq('submitted');
    deployed=(await post('/operations/'+deployed.intentId+'/reconcile',{})).body;expect(deployed.state).eq('verified');expect(deployed.listingVerified).eq(false);
    // Local synthetic validator, never substituted into mainnet configuration.
    const v=await (await ethers.getContractFactory('TestTransferValidator')).deploy();await v.waitForDeployment();
    await (await (await ethers.getContractAt('NFTCollection',collection)).setTransferValidator(await v.getAddress())).wait();
  });
  function inputs(){
    const image=Buffer.from('synthetic public artwork'),rights=Buffer.from('synthetic public rights');
    const imageURI='ipfs://'+cid+'/image.png',rightsURI='ipfs://'+cid+'/rights.md';
    const metadata={name:'Public work',description:'Synthetic end-to-end fixture',image:imageURI,attributes:[],properties:{media_sha256:sha(image),rights_uri:rightsURI,rights_sha256:sha(rights),rights_scope:'token'}};
    const metadataJson=JSON.stringify(metadata,null,2)+'\n',metadataURI='ipfs://'+cid+'/metadata.json';
    const files=[{kind:'image',uri:imageURI,sha256:sha(image),byteLength:image.length},{kind:'rights',uri:rightsURI,sha256:sha(rights),byteLength:rights.length},{kind:'metadata',uri:metadataURI,sha256:sha(metadataJson),byteLength:Buffer.byteLength(metadataJson)}];
    content.set(cid+'/image.png',image);content.set(cid+'/rights.md',rights);content.set(cid+'/metadata.json',Buffer.from(metadataJson));
    return {work:{tokenId:'87',title:'Public work',metadataURI,mediaHash:'0x'+sha(image),rightsURI,rightsHash:'0x'+sha(rights)},files:{version:1,publicDisclosureConfirmed:true,files},metadataJson};
  }
  it('refuses swapped metadata/rights and unavailable or modified IPFS bytes',async()=>{
    const body=inputs();
    expect((await post('/mint',{deploymentIntentId:deployed.intentId,works:[{...body,work:{...body.work,rightsHash:'0x'+'cc'.repeat(32)}}],publicDisclosureConfirmed:true})).body.code).eq('PUBLIC_COMMITMENT_MISMATCH');
    content.set(cid+'/image.png',Buffer.from('different artwork'));
    expect((await post('/mint',{deploymentIntentId:deployed.intentId,works:[body],publicDisclosureConfirmed:true})).status).eq(409);
  });
  it('mints only exact verified public bytes, verifies receipt/immutables and prevents token 88 in an 87-token collection',async()=>{
    const work=inputs(),result=await post('/mint',{deploymentIntentId:deployed.intentId,works:[work],publicDisclosureConfirmed:true});
    expect(result.status).eq(200);const op=result.body;
    expect(op.plan.publicFilesVerifiedAt).a('string');expect(op.plan.validatorPolicyVerified).eq(false);
    expect((await post('/operations/'+op.intentId+'/check',{})).body.checked).eq(true);
    expect((await post('/operations/'+op.intentId+'/claim',{expectedRevision:op.revision})).body.state).eq('wallet_pending');
    const tx=await signer.sendTransaction({to:op.plan.to,data:op.plan.data,nonce:op.plan.nonce,value:0});await tx.wait();await provider.send('evm_mine');
    await post('/operations/'+op.intentId+'/transaction',{transactionHash:tx.hash});
    const verified=await post('/operations/'+op.intentId+'/reconcile',{});expect(verified.body.state).eq('verified');expect(verified.body.listingVerified).eq(false);
    const c=await ethers.getContractAt('NFTCollection',collection);expect(await c.ownerOf(87)).eq(signer.address);expect(await c.mediaSHA256(87)).eq(work.work.mediaHash);
    expect((await post('/mint',{deploymentIntentId:deployed.intentId,works:[work],publicDisclosureConfirmed:true})).status).eq(409);
    work.work.tokenId='88';expect((await post('/mint',{deploymentIntentId:deployed.intentId,works:[work],publicDisclosureConfirmed:true})).body.code).eq('MINT_STATE_MISMATCH');
  });
});

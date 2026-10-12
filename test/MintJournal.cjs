const assert=require('node:assert/strict');
const {ethers,network}=require('hardhat');
let PGlite,migrate,migrateAuth,ReleaseRepository,MintJournal,reconcileJournal,recoverMintBatch,prepareMintPlan;
const URI='ipfs://bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq';
const hash=char=>'0x'+char.repeat(64);
function proxy(overrides){return new Proxy(ethers.provider,{get(target,key){if(Object.hasOwn(overrides,key))return overrides[key];const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});}
describe('Persistent journal with actual mint transactions',function(){
  this.timeout(45000);let db,repo,journal,actor,batch,signer,operation;
  before(async()=>{
    ({PGlite}=await import('@electric-sql/pglite'));
    ({migrate}=await import('../scripts/migrate.mjs'));({migrateAuth}=await import('../scripts/migrate-auth.mjs'));
    ({ReleaseRepository}=await import('../console/data/releases.mjs'));({MintJournal}=await import('../console/operations/journal.mjs'));
    ({reconcileJournal,recoverMintBatch}=await import('../console/operations/reconcile.mjs'));({prepareMintPlan}=await import('../console/chain/mint.mjs'));
    db=new PGlite();await db.waitReady;await migrate(db);await migrateAuth(db);
    await db.query('GRANT nft_console_api,nft_console_auth_service,nft_console_identity TO CURRENT_USER WITH INHERIT FALSE');
    [signer]=await ethers.getSigners();actor={wallet:signer.address.toLowerCase(),chainId:31337,role:'owner'};
    const roles=new Map([[actor.wallet,'owner']]);
    repo=new ReleaseRepository({pool:{connect:async()=>({query:(...args)=>db.query(...args),release(){}})},knownRoles:()=>roles});journal=new MintJournal(repo);
    const collection=await (await ethers.getContractFactory('NFTCollection')).deploy('Journal fixture','JRN',3,600,signer.address,signer.address,signer.address);await collection.waitForDeployment();
    batch=prepareMintPlan({chainId:31337,collection:await collection.getAddress(),minter:signer.address,runtimeCodeHash:ethers.keccak256(await ethers.provider.getCode(await collection.getAddress())),
      works:[{tokenId:'1',title:'Exact public test bytes',metadataURI:URI+'/1.json',mediaHash:hash('a'),rightsURI:URI+'/rights.md',rightsHash:hash('b')}]}).batches[0];
    operation=await journal.create(actor,{intentId:batch.id,collection:batch.collection,runtimeCodeHash:batch.runtimeCodeHash});
  });
  after(async()=>{await db?.close();});
  let tx;
  it('claims before the wallet sends and records its actual transaction hash',async()=>{
    operation=await journal.claim(actor,batch.id,{expectedRevision:operation.revision});assert.equal(operation.state,'wallet_pending');
    tx=await signer.sendTransaction({to:batch.collection,data:batch.data});await tx.wait();
    operation=await journal.attach(actor,batch.id,{transactionHash:tx.hash});assert.equal(operation.state,'submitted');
  });
  it('recovers exact immutable fields from public transaction data without a stored draft',async()=>{
    const observed=await ethers.provider.getTransaction(tx.hash);const recovered=recoverMintBatch(operation,actor,observed);
    assert.deepEqual(recovered,batch);
    const columns=(await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='nft_console' AND table_name='mint_journal'")).rows.map(x=>x.column_name);
    for(const privateField of ['works','title','data','calldata','rights_uri','media_hash'])assert.ok(!columns.includes(privateField));
    const saved=(await db.query('SELECT row_to_json(j)::text AS data FROM nft_console.mint_journal j')).rows[0].data;
    assert.ok(!saved.includes('Exact public test bytes'));assert.ok(!saved.includes('ipfs://'));
  });
  it('waits for confirmations then stores a verified block-scoped observation',async()=>{
    operation=await reconcileJournal(journal,actor,batch.id,ethers.provider);
    assert.equal(operation.state,'submitted');assert.equal(operation.lastCode,'INSUFFICIENT_CONFIRMATIONS');
    await network.provider.send('evm_mine');
    operation=await reconcileJournal(new MintJournal(repo),actor,batch.id,ethers.provider);
    assert.equal(operation.state,'verified');assert.equal(operation.transactionHash,tx.hash);assert.equal(operation.confirmations,2);assert.equal(operation.listingVerified,false);
  });
  it('a missing transaction or RPC outage removes current verified status without rebroadcast',async()=>{
    operation=await reconcileJournal(journal,actor,batch.id,proxy({getTransaction:async()=>null}));assert.equal(operation.state,'submitted');assert.equal(operation.lastCode,'PENDING_OR_UNKNOWN');
    operation=await reconcileJournal(journal,actor,batch.id,undefined);assert.equal(operation.state,'attention');assert.equal(operation.lastCode,'RPC_VERIFICATION_UNAVAILABLE');
    assert.equal(operation.observedBlock,null);assert.equal(operation.confirmations,0);
    operation=await reconcileJournal(journal,actor,batch.id,ethers.provider);assert.equal(operation.state,'verified');
  });
  it('mismatched chain, transaction or forged intent is never counted as a mint',async()=>{
    const observed=await ethers.provider.getTransaction(tx.hash);
    for(const patch of [{from:'0x'+'11'.repeat(20)},{to:'0x'+'11'.repeat(20)},{value:1n},{type:4},{data:'0x1234'}]){
      const value=await reconcileJournal(journal,actor,batch.id,proxy({getTransaction:async()=>({...observed,...patch})}));assert.equal(value.state,'attention');assert.equal(value.lastCode,'TRANSACTION_MISMATCH');
    }
    operation=await reconcileJournal(journal,actor,batch.id,proxy({getNetwork:async()=>({chainId:1n})}));assert.equal(operation.state,'attention');assert.equal(operation.lastCode,'CHAIN_MISMATCH');
    assert.throws(()=>recoverMintBatch({...operation,intentId:hash('c')},actor,observed),error=>error.code==='INTENT_MISMATCH');
  });
  it('reorganization observed during checks invalidates the journal evidence',async()=>{
    let calls=0;const provider=proxy({getBlock:async tag=>{const block=await ethers.provider.getBlock(tag);return ++calls>1?{...block,hash:hash('c'),transactions:[tx.hash]}:block;}});
    operation=await reconcileJournal(journal,actor,batch.id,provider);assert.equal(operation.state,'attention');assert.equal(operation.lastCode,'REORG_OR_BLOCK_MISMATCH');
    assert.equal(operation.transactionHash,tx.hash);assert.equal(operation.listingVerified,false);
  });
});

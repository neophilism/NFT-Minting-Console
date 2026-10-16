import {WorkbenchError,publicWork,workId,metadataFor,bundleFor} from './workbench-model.mjs';
const missing=()=>{throw new WorkbenchError('PUBLIC_WORK_NOT_FOUND',404);};
const conflict=()=>{throw new WorkbenchError('PUBLICATION_CHANGED');};
const slot=row=>({...row.descriptor,attempts:row.attempts,issuedAt:row.issued_at,candidateUri:row.candidate_uri,verifiedUri:row.verified_uri});
export class PublicationWorkbenchStore {
  constructor(repository){this.repository=repository;}
  tx(actor,id,fn){if(actor.role!=='owner')throw new WorkbenchError('OWNER_REQUIRED',403);return this.repository.transaction(actor,id,fn);}
  async getRows(client,account,id){
    const result=await client.query('SELECT * FROM nft_console.public_workbench WHERE account_id=$1 AND id=$2',[account,id]);if(!result.rows[0])missing();
    const files=await client.query('SELECT * FROM nft_console.public_upload_slots WHERE account_id=$1 AND work_id=$2 ORDER BY kind',[account,id]);
    const row=result.rows[0];return {id:row.id,plan:row.public_plan,metadataJson:row.metadata_json,files:files.rows.map(slot),createdAt:row.created_at};
  }
  async create(actor,body){const plan=publicWork(body);return this.tx(actor,plan.id,async(client,account)=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,117313))',[account]);
    const exists=await client.query('SELECT id FROM nft_console.public_workbench WHERE account_id=$1 AND id=$2',[account,plan.id]);
    if(!exists.rows.length){const count=await client.query('SELECT count(*)::integer AS n FROM nft_console.public_workbench WHERE account_id=$1',[account]);if(count.rows[0].n>=1000)throw new WorkbenchError('PUBLIC_WORK_CAPACITY');}
    await client.query('INSERT INTO nft_console.public_workbench(account_id,id,chain_id,public_plan) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[account,plan.id,actor.chainId,plan]);
    const current=await client.query('SELECT public_plan FROM nft_console.public_workbench WHERE account_id=$1 AND id=$2',[account,plan.id]);if(JSON.stringify(publicWork(current.rows[0].public_plan))!==JSON.stringify(plan))conflict();
    for(const file of plan.files)await client.query('INSERT INTO nft_console.public_upload_slots(account_id,work_id,kind,descriptor) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[account,plan.id,file.kind,file]);
    return this.getRows(client,account,plan.id);
  });}
  async get(actor,id){id=workId(id);return this.tx(actor,id,(client,account)=>this.getRows(client,account,id));}
  async list(actor,after=null){if(after!==null)workId(after);return this.tx(actor,null,async(client,account)=>{
    const result=await client.query('SELECT id,public_plan,created_at FROM nft_console.public_workbench WHERE account_id=$1 AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT 51',[account,after]);
    const rows=result.rows.slice(0,50);return {items:rows.map(row=>({id:row.id,title:row.public_plan.title,tokenId:row.public_plan.tokenId,createdAt:row.created_at})),nextCursor:result.rows.length>50?rows.at(-1).id:null};
  });}
  async issue(actor,id,kind,retry){id=workId(id);return this.tx(actor,id,async(client,account)=>{
    const row=await this.getRows(client,account,id),file=row.files.find(f=>f.kind===kind);if(!file)missing();if(file.verifiedUri)throw new WorkbenchError('FILE_ALREADY_VERIFIED');
    const result=await client.query("UPDATE nft_console.public_upload_slots SET attempts=attempts+1,issued_at=clock_timestamp() WHERE account_id=$1 AND work_id=$2 AND kind=$3 AND verified_uri IS NULL AND attempts<20 AND (attempts=0 OR ($4::boolean AND issued_at<clock_timestamp()-interval '5 minutes')) RETURNING *",[account,id,kind,retry===true]);
    if(!result.rows[0])throw new WorkbenchError('UNCERTAIN_UPLOAD_REQUIRES_REVIEW');return slot(result.rows[0]);
  });}
  async candidate(actor,id,kind,uri){id=workId(id);return this.tx(actor,id,async(client,account)=>{
    const row=await this.getRows(client,account,id),file=row.files.find(f=>f.kind===kind);if(!file)missing();if(file.verifiedUri){if(file.verifiedUri!==uri)conflict();return file;}
    await client.query('UPDATE nft_console.public_upload_slots SET candidate_uri=$4 WHERE account_id=$1 AND work_id=$2 AND kind=$3',[account,id,kind,uri]);return {...file,candidateUri:uri};
  });}
  async verified(actor,id,kind,uri){id=workId(id);return this.tx(actor,id,async(client,account)=>{
    const updated=await client.query('UPDATE nft_console.public_upload_slots SET verified_uri=$4 WHERE account_id=$1 AND work_id=$2 AND kind=$3 AND candidate_uri=$4 AND verified_uri IS NULL RETURNING kind',[account,id,kind,uri]);
    if(!updated.rows.length){const row=await this.getRows(client,account,id);if(row.files.find(f=>f.kind===kind)?.verifiedUri!==uri)conflict();}
    return this.getRows(client,account,id);
  });}
  async metadata(actor,id){id=workId(id);return this.tx(actor,id,async(client,account)=>{
    const row=await this.getRows(client,account,id),prepared=metadataFor(row.plan,row.files);
    if(row.metadataJson!==null&&row.metadataJson!==prepared.text)conflict();
    await client.query('UPDATE nft_console.public_workbench SET metadata_json=$3 WHERE account_id=$1 AND id=$2 AND metadata_json IS NULL',[account,id,prepared.text]);
    await client.query('INSERT INTO nft_console.public_upload_slots(account_id,work_id,kind,descriptor) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[account,id,'metadata',prepared.file]);
    return this.getRows(client,account,id);
  });}
  async bundle(actor,id){const row=await this.get(actor,id);return bundleFor(row.plan,row.files,row.metadataJson);}
}

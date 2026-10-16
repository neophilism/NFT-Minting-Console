export async function checkPublicationSchema(repository){
  const client=await repository.pool.connect();let broken;
  try{await client.query('BEGIN');await client.query('SET LOCAL ROLE nft_console_api');await client.query('SELECT public_plan,metadata_json FROM nft_console.public_workbench LIMIT 0');await client.query('SELECT descriptor,attempts,issued_at,candidate_uri,verified_uri FROM nft_console.public_upload_slots LIMIT 0');await client.query('COMMIT');}
  catch(error){try{await client.query('ROLLBACK');}catch(cause){broken=cause;}throw error;}
  finally{client.release(broken);}
}

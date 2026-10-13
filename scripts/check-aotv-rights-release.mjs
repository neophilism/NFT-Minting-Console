import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const archived='0ddcfae9f5fc2d2e059ed12e7a33ea5815e00a64e70930485602bc73f3f374c9';
function fatal(message){console.error('AOTV RIGHTS PREFLIGHT BLOCKED: '+message);process.exitCode=1;}
if(process.argv.length!==4){fatal('Provide exactly <final-consolidated-rights-file> <final-metadata-json>.');}
else {
  try {
    const [rightsFile,metadataFile]=process.argv.slice(2).map(p=>path.resolve(p));
    const rights=await readFile(rightsFile),meta=JSON.parse(await readFile(metadataFile,'utf8'));
    const text=rights.toString('utf8');
    if(rights.length<1000||/WORKING DRAFT|NOT FOR SALE OR MINTING|TO BE COMPLETED|PENDING|REPLACE_WITH|INCOMPLETE_DRAFT|Priority Investment Consideration/i.test(text))fatal('Rights are not complete and legally signed off.');
    if(!/## 4\. Fixed Creator.s Companion Portfolio/.test(text)||!/## 5\. Collector-Only Allocation/.test(text)||
       !/Schedule A\b/.test(text)||!/Unsealed Records Music Playlist/.test(text))fatal('The complete signed-off Schedule A must be included within the rights artifact.');
    const digest=createHash('sha256').update(rights).digest('hex');
    if(digest===archived)fatal('The historical investor-priority document is not the revised rights artifact.');
    if(meta.release_status==='DO_NOT_MINT_OR_PUBLISH'||meta.properties?.companion_portfolio_schedule_status==='INCOMPLETE_DRAFT')fatal('Metadata remains a non-publishable template.');
    if(meta.properties?.rights_sha256!==digest||!/^[a-f0-9]{64}$/.test(digest))fatal('Exact SHA-256 of consolidated rights does not match the metadata.');
    const ipfsUri=value=>typeof value==='string'&&/^ipfs:\/\/[a-zA-Z0-9]{20,}(?:\/[a-zA-Z0-9._~!    if(!/^ipfs'()+,;=:@%-]+)*$/.test(value)&&!value.includes('REPLACE_WITH');
    if(!ipfsUri(meta.properties?.rights_uri))fatal('Provide the verified published final rights URI.');
    if(!ipfsUri(meta.image)||!ipfsUri(meta.animation_url))fatal('Actual media and poster CIDs must be finalized.');
    if(process.exitCode!==1)console.log('AOTV rights/metadata byte-match preflight passed. Still requires legal approval, schedule delivery verification, IPFS byte retrieval and mint/product gates. SHA-256='+digest);
  }catch{fatal('Files missing or invalid; do not mint.');}
}

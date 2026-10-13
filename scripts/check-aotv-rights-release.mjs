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
    if(!/## 4\. Optional Fixed Creator.s Companion Portfolio/.test(text)||!/## 5\. Collector-Only Allocation/.test(text))fatal('Expected optional fixed portfolio terms and separate collector terms.');
    const tokenMatch=text.match(/^\*\*Series token ID:\*\*\s*(\d+)\s*$/m);
    const tokenId=tokenMatch?Number(tokenMatch[1]):null;
    if(!Number.isInteger(tokenId)||tokenId<1||tokenId>40)fatal('Exact AOTV token ID must appear in rights.');
    const scheduleMatch=text.match(/^# Schedule A — Androids Of The Vine, Token #(\d{3})\s*$/m);
    const optedOut=/^\*\*Companion Portfolio:\*\* Not included for this token\.\s*$/m.test(text);
    if(Boolean(scheduleMatch)===optedOut)fatal('Choose exactly one: a final token-specific Schedule A or an explicit no-portfolio statement.');
    if(scheduleMatch) {
      const matches=[...text.matchAll(/^## Project (\d+): (.+)$/gm)];
      if(Number(scheduleMatch[1])!==tokenId || matches.length!==2 ||
         matches[0]?.[1]!=='1'||matches[1]?.[1]!=='2'||matches[0]?.[2]===matches[1]?.[2])
        fatal('Each opted-in token needs its own complete, distinct two-project Schedule A.');
    }
    const metadataId=meta.attributes?.find(a=>a?.trait_type==='Series Token ID')?.value;
    if(metadataId!==undefined&&Number(metadataId)!==tokenId)fatal('Metadata and final rights disagree about token ID.');
    const digest=createHash('sha256').update(rights).digest('hex');
    if(digest===archived)fatal('The historical investor-priority document is not the revised rights artifact.');
    if(meta.release_status==='DO_NOT_MINT_OR_PUBLISH'||meta.properties?.companion_portfolio_schedule_status==='INCOMPLETE_DRAFT')fatal('Metadata remains a non-publishable template.');
    if(meta.properties?.rights_sha256!==digest||!/^[a-f0-9]{64}$/.test(digest))fatal('Exact SHA-256 of consolidated rights does not match the metadata.');
    const ipfsUri=value=>typeof value==='string'&&/^ipfs:\/\/[a-zA-Z0-9]{20,}(?:\/[a-zA-Z0-9._~!$&'()+,;=:@%-]+)*$/.test(value)&&!value.includes('REPLACE_WITH');
    if(!ipfsUri(meta.properties?.rights_uri))fatal('Provide the verified published final rights URI.');
    if(!ipfsUri(meta.image)||!ipfsUri(meta.animation_url))fatal('Actual media and poster CIDs must be finalized.');
    if(process.exitCode!==1)console.log('AOTV rights/metadata byte-match preflight passed. Still requires legal approval, schedule delivery verification, IPFS byte retrieval and mint/product gates. SHA-256='+digest);
  }catch{fatal('Files missing or invalid; do not mint.');}
}

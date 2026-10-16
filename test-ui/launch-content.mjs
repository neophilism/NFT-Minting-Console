import {createHash} from 'node:crypto';
const cid='bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const artwork=Buffer.from('Synthetic browser public artwork'),rights=Buffer.from('Synthetic browser public rights');
const metadata={name:'Browser public work',description:'Synthetic browser acceptance only',image:'ipfs://'+cid+'/image.png',attributes:[],properties:{media_sha256:sha(artwork),rights_uri:'ipfs://'+cid+'/rights.md',rights_sha256:sha(rights),rights_scope:'token'}};
const metadataJson=JSON.stringify(metadata,null,2)+'\n';
const entries=[['image','image.png',artwork],['rights','rights.md',rights],['metadata','metadata.json',Buffer.from(metadataJson)]];
export const publicBrowserBundle={version:1,works:[{work:{tokenId:'87',title:metadata.name,metadataURI:'ipfs://'+cid+'/metadata.json',mediaHash:'0x'+sha(artwork),rightsURI:metadata.properties.rights_uri,rightsHash:'0x'+sha(rights)},files:{version:1,publicDisclosureConfirmed:true,files:entries.map(([kind,name,bytes])=>({kind,uri:'ipfs://'+cid+'/'+name,sha256:sha(bytes),byteLength:bytes.length}))},metadataJson}]};
export const publicBrowserFetch=async url=>{const entry=entries.find(([,name])=>url==='https://gateway.pinata.cloud/ipfs/'+cid+'/'+name);return entry?new Response(entry[2],{status:200}):new Response('',{status:404});};

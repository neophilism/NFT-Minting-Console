import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {describeFile,publicRow,publicHistory,uploadWithCapability} from '../console/ui/src/publication-client.ts';
import type {PublicWorkRow} from '../console/ui/src/publication-client.ts';
import {publicBrowserBundle} from './launch-content.mjs';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',at='2026-10-16T20:00:00.000Z';
const uri='ipfs://'+publicBrowserBundle.works[0]!.files.files[0]!.uri.slice(7).split('/')[0];
const sum=(value:string)=>createHash('sha256').update(value).digest('hex');
function fixture():PublicWorkRow{
  const files=[{kind:'image' as const,name:'poster.png',mime:'image/png',byteLength:3,sha256:sum('png')},{kind:'rights' as const,name:'rights.md',mime:'text/markdown',byteLength:6,sha256:sum('rights')}];
  return {id,plan:{version:1,id,tokenId:'1',title:'Public work',description:'Final public description',rightsScope:'token',files,publicDisclosureConfirmed:true},metadataJson:null,files:files.map(f=>({...f,attempts:0,issuedAt:null,candidateUri:null,verifiedUri:null})),createdAt:at};
}
test('saved work is copied and bound to the requested identity and exact original descriptors',()=>{
  const original=fixture(),value=publicRow(original,id);assert.deepEqual(value,original);assert.notEqual(value,original);assert.notEqual(value.plan.files,original.plan.files);assert.throws(()=>publicRow(original,other));
  for(const patch of [{name:'other.png'},{mime:'video/mp4'},{byteLength:4},{sha256:sum('other')}]){const changed=fixture();Object.assign(changed.files[0]!,patch);assert.throws(()=>publicRow(changed));}
});
test('malformed public plans, unknown fields and missing or duplicate kinds fail closed',()=>{
  for(const value of [null,[],{}, {...fixture(),privateKey:'never accepted'}, {...fixture(),id:'../../work'},{...fixture(),createdAt:'bad'}])assert.throws(()=>publicRow(value));
  for(const patch of [{version:2},{id:other},{tokenId:'0'},{tokenId:(1n<<256n).toString()},{title:''},{description:4},{rightsScope:'private'},{publicDisclosureConfirmed:false},{files:[]},{files:[fixture().plan.files[0],fixture().plan.files[0]]}])assert.throws(()=>publicRow({...fixture(),plan:{...fixture().plan,...patch}}));
  for(const patch of [{kind:'__proto__'},{kind:'metadata'},{name:'../image.png'},{name:'image\n.png'},{attempts:-1},{attempts:21},{attempts:1,issuedAt:null},{attempts:0,issuedAt:at},{candidateUri:'https://example.com/file'},{verifiedUri:uri,candidateUri:null}]){const changed=fixture();Object.assign(changed.files[0]!,patch);assert.throws(()=>publicRow(changed));}
});
test('existing CID verification may succeed without issuing an upload and known attempt timestamps remain valid',()=>{
  const value=fixture();value.files[0]!.candidateUri=uri;value.files[0]!.verifiedUri=uri;value.files[1]!.attempts=1;value.files[1]!.issuedAt=at;assert.equal(publicRow(value).files[0]!.verifiedUri,uri);
});
test('generated metadata must match its exact saved SHA-256 and byte length',()=>{
  const value=fixture(),text='{"name":"Public work"}\n';value.metadataJson=text;value.files.push({kind:'metadata',name:'token-1.json',mime:'application/json',byteLength:Buffer.byteLength(text),sha256:sum(text),attempts:0,issuedAt:null,candidateUri:null,verifiedUri:null});assert.equal(publicRow(value).metadataJson,text);
  value.metadataJson+=' ';assert.throws(()=>publicRow(value));
});
test('public history accepts bounded unique IDs and only a last-item cursor',()=>{
  const item={id,title:'Public work',tokenId:'1',createdAt:at};assert.deepEqual(publicHistory({items:[item],nextCursor:id}),{items:[item],nextCursor:id});for(const value of [{items:[item],nextCursor:other},{items:[item,item],nextCursor:null},{items:[],nextCursor:id},{items:[{...item,id:'bad'}],nextCursor:null},{items:Array(51).fill(item),nextCursor:null}])assert.throws(()=>publicHistory(value));
});
test('streamed file description preserves exact bytes and rejects cancelled review',async()=>{
  const file=new File(['png'],'poster.png',{type:'image/png'});const result=await describeFile('image',file);assert.equal(result.sha256,sum('png'));assert.equal(result.byteLength,3);
  const c=new AbortController();c.abort();await assert.rejects(describeFile('image',file,c.signal));await assert.rejects(describeFile('image',new File(['x'],'bad.exe')));await assert.rejects(describeFile('image',new File([],'empty.png')));
});
test('unapproved destinations, expired capabilities and mismatched files never start an upload',async()=>{
  const file=new File(['png'],'poster.png',{type:'image/png'}),expected=fixture().files[0]!,signal=new AbortController().signal;
  const cap={url:'https://uploads.pinata.cloud/v3/files?signature=synthetic',expiresAt:new Date(Date.now()+240000).toISOString(),kind:'image',sha256:expected.sha256,byteLength:3,publicOnly:true};
  let calls=0;const previous=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw new Error('Unexpected network call');};
  try{for(const patch of [{url:'https://evil.example/v3/files?x=1'},{url:'https://uploads.pinata.cloud/v3/files'},{url:'https://uploads.pinata.cloud/v3/files?x=1#secret'},{publicOnly:false},{kind:'rights'},{sha256:sum('other')},{expiresAt:new Date(Date.now()-1).toISOString()}])await assert.rejects(uploadWithCapability({...cap,...patch},expected,file,signal));await assert.rejects(uploadWithCapability(cap,expected,new File(['different'],'poster.png'),signal));assert.equal(calls,0);}finally{globalThis.fetch=previous;}
});

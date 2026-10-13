import {openAsBlob} from 'node:fs';
import {lstat} from 'node:fs/promises';
import {basename} from 'node:path';
import {publishReviewedFile,PublicUploadError,PUBLIC_UPLOAD_TYPES} from '../console/publication/pinata-public.mjs';
// Operator-only tool. No private keys, implicit uploads, or server-side draft handling.
try{
  const [kind,path,sha256,ack,...extra]=process.argv.slice(2);
  if(!Object.hasOwn(PUBLIC_UPLOAD_TYPES,kind)||!path||!sha256||
     ack!=='--public-disclosure-confirmed'||extra.length)throw Error('usage');
  const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||info.size<1||
     info.size>PUBLIC_UPLOAD_TYPES[kind].max)throw Error('invalid file');
  const filename=basename(path),blob=await openAsBlob(path);
  const result=await publishReviewedFile({kind,name:filename,blob,sha256,
    acknowledgePublic:true,jwt:process.env.PINATA_JWT});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(e){
  process.stderr.write((e instanceof PublicUploadError?e.message:'Invalid arguments or file.')+'\n');
  if(e instanceof PublicUploadError&&e.cid)
    process.stderr.write('Upload may exist at public CID '+e.cid+'. Independently verify the file; never blindly retry an uncertain POST.\n');
  process.stderr.write('Usage: npm run public:pin -- <metadata|rights|image|media> <file> <reviewed-sha256> --public-disclosure-confirmed\n');
  process.exitCode=1;
}

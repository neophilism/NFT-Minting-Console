import {inspectRelease,publishRelease} from '../console/launch/bundle.mjs';
import {LaunchError} from '../console/launch/contracts.mjs';
import {PublicUploadError} from '../console/publication/pinata-public.mjs';
try{
  const [command,file,digest,output,ack,...extra]=process.argv.slice(2);
  if(command==='inspect'&&file&&digest===undefined){
    const result=await inspectRelease(file);process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }else if(command==='publish'&&file&&digest&&output&&ack==='--public-disclosure-confirmed'&&!extra.length){
    process.stdout.write(JSON.stringify(await publishRelease(file,digest,output,{jwt:process.env.PINATA_JWT}),null,2)+'\n');
  }else throw new Error('usage');
}catch(e){
  process.stderr.write(e instanceof LaunchError||e instanceof PublicUploadError?e.message+'\n':'Release preparation failed. Check the local files and arguments.\n');
  if(e instanceof PublicUploadError&&e.cid)process.stderr.write('Upload may already be public at ipfs://'+e.cid+'. Keep the publication checkpoint and reconcile; do not repeat the upload.\n');
  process.stderr.write('Usage: npm run release:inspect -- release.json\nThen: npm run release:publish -- release.json <review-sha256> <mint-bundle.json> --public-disclosure-confirmed\n');process.exitCode=1;
}

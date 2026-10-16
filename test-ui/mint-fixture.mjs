import http from 'node:http';
import {once} from 'node:events';
import {Transaction,ContractFactory,keccak256,Interface,AbiCoder} from 'ethers';
import {readFile} from 'node:fs/promises';
import {prepareMintPlan} from '../console/chain/mint.mjs';
import {testWallets} from './fixtures.mjs';
const URI='ipfs://bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq';
/** Test-only loopback bridge. Accepts externally signed exact fixture mints, never generic wallet/debug RPC. */
export async function startMintFixture(hre){
  if(process.env.NFT_UI_FIXTURE!=='1'||process.env.NFT_TEST_DISPOSABLE_DATABASE!=='yes'||hre.network.name!=='hardhat'||hre.network.config.forking||
    BigInt(await hre.network.provider.send('eth_chainId'))!==31337n)throw new Error('Disposable browser mint fixture only.');
  const artifact=JSON.parse(await readFile(new URL('../artifacts/contracts/NFTCollection.sol/NFTCollection.json',import.meta.url),'utf8'));
  const signers=await hre.ethers.getSigners(),contexts=new Map();
  for(const index of [0,3]){
    const signer=signers[index];if(signer.address!==testWallets[index].address)throw new Error('Only the known disposable signers are permitted.');
    const collection=await new ContractFactory(artifact.abi,artifact.bytecode,signer).deploy('Synthetic UI '+index,'TUI',1000,600,signer.address,signer.address,signer.address);await collection.waitForDeployment();
    contexts.set(index,{address:await collection.getAddress(),codeHash:keccak256(await hre.ethers.provider.getCode(await collection.getAddress())),next:1});
  }
  const iface=new Interface(artifact.abi),publicCollections=new Set();
  const validatorArtifact=JSON.parse(await readFile(new URL('../artifacts/contracts/test/TestTransferValidator.sol/TestTransferValidator.json',import.meta.url),'utf8'));
  await hre.network.provider.send('hardhat_setCode',['0x721C008fdff27BF06E7E123956E2Fe03B63342e3',validatorArtifact.deployedBytecode]);
  const allowed=new Set(),reads=new Set(['eth_chainId','eth_blockNumber','eth_getCode','eth_call','eth_getBlockByNumber','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getTransactionCount','eth_estimateGas','eth_gasPrice','eth_getBalance']);
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.method!=='POST'||req.headers.origin||req.headers['x-nft-test']!=='disposable-local-only'||req.headers['content-type']!=='application/json')throw new Error('Denied');
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>262144)throw new Error('Too large');chunks.push(chunk);}
      const {method,params=[]}=JSON.parse(Buffer.concat(chunks).toString('utf8'));let result;
      if(method==='fixture_manifest'){
        if(params.length!==1||![0,3].includes(params[0]))throw new Error('Unsupported fixture');
        const index=params[0],context=contexts.get(index),id=context.next++;
        if(id>1000)throw new Error('Fixture capacity');
        const input={chainId:31337,collection:context.address,minter:testWallets[index].address,runtimeCodeHash:context.codeHash,
          works:[{tokenId:String(id),title:'Synthetic browser work '+index+'/'+id,metadataURI:URI+'/'+index+'/'+id+'.json',mediaHash:'0x'+'ab'.repeat(32),rightsURI:URI+'/rights.md',rightsHash:'0x'+'cd'.repeat(32)}]};
        const batch=prepareMintPlan(input).batches[0];allowed.add(batch.minter.toLowerCase()+':'+batch.collection.toLowerCase()+':'+batch.data);result=input;
      }else if(method==='eth_sendRawTransaction'){
        if(params.length!==1||typeof params[0]!=='string'||params[0].length>262144)throw new Error('Invalid signed fixture');
        const tx=Transaction.from(params[0]);
        const publicSigner=[testWallets[4].address.toLowerCase(),testWallets[5].address.toLowerCase()].includes(tx.from?.toLowerCase());
        const uploadSigner=[testWallets[6].address.toLowerCase(),testWallets[7].address.toLowerCase()].includes(tx.from?.toLowerCase());
        let publicAllowed=publicSigner&&tx.to===tx.from&&tx.data==='0x'&&tx.gasLimit===21000n;
        if(publicSigner&&tx.to===null&&tx.data.startsWith(artifact.bytecode)){
          const args=AbiCoder.defaultAbiCoder().decode(['string','string','uint256','uint96','address','address','address'],'0x'+tx.data.slice(artifact.bytecode.length));
          publicAllowed=args[0].startsWith('Browser public launch')&&args[1]==='BPL'&&args[2]===87n&&args[3]===600n&&args[4]===tx.from&&args[5]===tx.from&&args[6]===tx.from;
        }else if(publicSigner&&publicCollections.has(tx.to?.toLowerCase())){
          const parsed=iface.parseTransaction({data:tx.data});const work=parsed?.args[0]?.[0];
          publicAllowed=parsed?.name==='mintWorksBatch'&&parsed.args[0].length===1&&work?.tokenId===87n&&work?.title==='Browser public work';
        }
        if(uploadSigner&&tx.to===null&&tx.data.startsWith(artifact.bytecode)){
          const args=AbiCoder.defaultAbiCoder().decode(['string','string','uint256','uint96','address','address','address'],'0x'+tx.data.slice(artifact.bytecode.length));
          publicAllowed=args[0]==='Browser upload integration'&&args[1]==='UPLOAD'&&args[2]===100n&&args[3]===600n&&args[4]===tx.from&&args[5]===tx.from&&args[6]===tx.from;
        }else if(uploadSigner&&publicCollections.has(tx.to?.toLowerCase())){
          const parsed=iface.parseTransaction({data:tx.data}),work=parsed?.args[0]?.[0];publicAllowed=parsed?.name==='mintWorksBatch'&&parsed.args[0].length===1&&work?.tokenId===61n&&['Browser uploaded work desktop','Browser uploaded work mobile'].includes(work?.title);
        }
        if(!tx.signature||tx.chainId!==31337n||tx.type!==0||tx.value!==0n||tx.gasLimit>12000000n||!tx.gasPrice||tx.gasPrice>1000000000000n||
          (!allowed.has(tx.from?.toLowerCase()+':'+tx.to?.toLowerCase()+':'+tx.data)&&!publicAllowed))throw new Error('Only exact issued fixture mints are accepted.');
        result=await hre.network.provider.send(method,params);await hre.network.provider.send('evm_mine');
        if(publicAllowed&&tx.to===null){const receipt=await hre.ethers.provider.getTransactionReceipt(result);if(receipt?.contractAddress)publicCollections.add(receipt.contractAddress.toLowerCase());}
      }else if(reads.has(method))result=await hre.network.provider.send(method,params);
      else throw new Error('Unsupported fixture method');
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({result}));
    }catch{res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Disposable fixture request rejected.'}));}
  });
  server.listen(4174,'127.0.0.1');await once(server,'listening');
  return async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));};
}

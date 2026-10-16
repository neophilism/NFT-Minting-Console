import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import {AbiCoder,ContractFactory, Interface, Transaction, keccak256 } from 'ethers';
import { prepareMintPlan } from '../console/chain/mint.mjs';
import { testWallets } from './fixtures.mjs';
export async function startMintFixture(hre) {
  if(hre.network.name!=='hardhat'||hre.network.config.forking||process.env.NFT_UI_FIXTURE!=='1')throw new Error('Disposable browser mint fixture only.');
  if(Number(await hre.network.provider.send('eth_chainId'))!==31337)throw new Error('Wrong local chain.');
  const artifact=JSON.parse(await readFile(new URL('../artifacts/contracts/NFTCollection.sol/NFTCollection.json',import.meta.url),'utf8'));
  const [deployer]=await hre.ethers.getSigners(), minter=testWallets[3].address;
  await hre.network.provider.send('hardhat_setCode',['0x721c008fdff27bf06e7e123956e2fe03b63342e3','0x00']);
  const contract=await new ContractFactory(artifact.abi,artifact.bytecode,deployer).deploy('Browser test collection','BTC',100,600,minter,minter,minter);
  await contract.waitForDeployment(); const collection=await contract.getAddress(),runtimeCodeHash=keccak256(await hre.ethers.provider.getCode(collection));
  const iface=new Interface(artifact.abi);
  const publicCollections=new Set();
  const reads=new Set(['eth_chainId','eth_blockNumber','eth_getCode','eth_call','eth_getBalance','eth_getTransactionCount','eth_estimateGas','eth_gasPrice','eth_getBlockByNumber','eth_getTransactionByHash','eth_getTransactionReceipt']);
  const server=http.createServer(async(req,res)=>{
    try {
      if(req.method!=='POST'||req.headers['x-nft-test']!=='disposable-local-only')throw new Error('Rejected fixture request');
      const chunks=[];let n=0;for await(const c of req){n+=c.length;if(n>65536)throw new Error('Too large');chunks.push(c);}const {method,params=[]}=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      let result;
      if(method==='fixture_plan') {
        const id=params[0];if(!Number.isSafeInteger(id)||id<1||id>20)throw new Error('Bad fixture token');
        const works=[{tokenId:String(id),title:`Browser synthetic token ${id}`,metadataURI:`ipfs://synthetic-browser/${id}.json`,mediaHash:'0x'+'11'.repeat(32),rightsURI:'ipfs://synthetic-rights',rightsHash:'0x'+'22'.repeat(32)}];
        result={manifest:{version:1,chainId:31337,collection,minter,runtimeCodeHash,works},plan:prepareMintPlan({chainId:31337,collection,minter,runtimeCodeHash,works})};
      } else if(method==='eth_sendRawTransaction') {
        const tx=Transaction.from(params[0]);
        const publicSigner=[testWallets[4].address.toLowerCase(),testWallets[5].address.toLowerCase()].includes(tx.from?.toLowerCase());
        const uploadSigner=[testWallets[6].address.toLowerCase(),testWallets[7].address.toLowerCase()].includes(tx.from?.toLowerCase());
        let publicAllowed=false;
        if(publicSigner&&tx.to===null&&tx.data.startsWith(artifact.bytecode)){
          const args=AbiCoder.defaultAbiCoder().decode(['string','string','uint256','uint96','address','address','address'],'0x'+tx.data.slice(artifact.bytecode.length));
          publicAllowed=args[0].startsWith('Browser public launch ')&&args[1]==='BPL'&&args[2]===87n&&args[3]===600n&&args[4]===tx.from&&args[5]===tx.from&&args[6]===tx.from;
        }else if(publicSigner&&publicCollections.has(tx.to?.toLowerCase())){
          const parsed=iface.parseTransaction({data:tx.data});publicAllowed=parsed?.name==='mintWorksBatch'&&parsed.args[0].length===1&&parsed.args[0][0].tokenId===87n;
        }else if(publicSigner&&tx.to?.toLowerCase()===tx.from?.toLowerCase()&&tx.data==='0x'&&tx.gasLimit===21000n){publicAllowed=true;}
        if(uploadSigner&&tx.to===null&&tx.data.startsWith(artifact.bytecode)){
          const args=AbiCoder.defaultAbiCoder().decode(['string','string','uint256','uint96','address','address','address'],'0x'+tx.data.slice(artifact.bytecode.length));
          publicAllowed=args[0]==='Browser upload integration'&&args[1]==='UPLOAD'&&args[2]===100n&&args[3]===600n&&args[4]===tx.from&&args[5]===tx.from&&args[6]===tx.from;
        }else if(uploadSigner&&publicCollections.has(tx.to?.toLowerCase())){
          const parsed=iface.parseTransaction({data:tx.data}),work=parsed?.args[0]?.[0];publicAllowed=parsed?.name==='mintWorksBatch'&&parsed.args[0].length===1&&work?.tokenId===61n&&['Browser uploaded work desktop','Browser uploaded work mobile'].includes(work?.title);
        }
        if(!tx.signature||tx.chainId!==31337n||tx.value!==0n||tx.type!==0||(!publicAllowed&&(tx.from?.toLowerCase()!==minter.toLowerCase()||tx.to?.toLowerCase()!==collection.toLowerCase())))throw new Error('Only an explicit disposable signer/collection action is allowed');
        if(!publicAllowed){const parsed=iface.parseTransaction({data:tx.data});if(parsed?.name!=='mintWorksBatch'||parsed.args[0].length!==1||parsed.args[0][0].tokenId<1n||parsed.args[0][0].tokenId>20n)throw new Error('Only synthetic mint calls are allowed');}
        result=await hre.network.provider.send(method,params);await hre.network.provider.send('evm_mine');await hre.network.provider.send('evm_mine');
        if(publicAllowed&&tx.to===null){const receipt=await hre.ethers.provider.getTransactionReceipt(result);if(receipt?.contractAddress)publicCollections.add(receipt.contractAddress.toLowerCase());}
      } else if(method==='eth_getBlockByNumber'&&params[0]==='finalized') {result=await hre.network.provider.send(method,['latest',params[1]||false]);
      } else if(reads.has(method)) result=await hre.network.provider.send(method,params);
      else throw new Error('Unsupported fixture operation');
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({result}));
    } catch {res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Disposable local mint fixture rejected request'}));}
  });
  server.listen(4174,'127.0.0.1');await once(server,'listening');
  return async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));};
}

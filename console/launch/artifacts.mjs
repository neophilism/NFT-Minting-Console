import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
/** Exact compiler metadata maps immutable AST IDs to names; an unknown immutable fails closed. */
export function loadCollectionArtifact(){
  const directory=path.join(root,'artifacts/contracts/NFTCollection.sol');
  const artifact=JSON.parse(readFileSync(path.join(directory,'NFTCollection.json'),'utf8'));
  const debug=JSON.parse(readFileSync(path.join(directory,'NFTCollection.dbg.json'),'utf8'));
  const build=JSON.parse(readFileSync(path.resolve(directory,debug.buildInfo),'utf8'));
  if(build.solcVersion!=='0.8.24'||build.input.settings.optimizer.enabled!==true||build.input.settings.optimizer.runs!==200)throw new Error('Reviewed Solidity toolchain required.');
  const compiled=build.output.contracts['contracts/NFTCollection.sol'].NFTCollection;
  if('0x'+compiled.evm.bytecode.object!==artifact.bytecode||'0x'+compiled.evm.deployedBytecode.object!==artifact.deployedBytecode)throw new Error('Contract artifact/build-info mismatch.');
  const ids=compiled.evm.deployedBytecode.immutableReferences,immutables={};
  function visit(node){
    if(!node||typeof node!=='object')return;
    if(ids[node.id]){
      if(node.nodeType!=='VariableDeclaration'||node.mutability!=='immutable'||Object.hasOwn(immutables,node.name))throw new Error('Unexpected immutable definition.');
      immutables[node.name]=ids[node.id];
    }
    Object.values(node).forEach(visit);
  }
  Object.values(build.output.sources).forEach(x=>visit(x.ast));
  return Object.freeze({abi:artifact.abi,bytecode:artifact.bytecode,deployedBytecode:artifact.deployedBytecode,immutables});
}

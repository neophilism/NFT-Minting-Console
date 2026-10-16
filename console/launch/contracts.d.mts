export interface CollectionConfig {name:string;symbol:string;seriesSize:string;royaltyBps:string;owner:string;minter:string;royaltyRecipient:string}
export interface CollectionExpected {collection:string;config:CollectionConfig;runtimeCodeHash:string}
export interface CollectionArtifact {abi:readonly unknown[];bytecode:string;deployedBytecode:string;immutables:Record<string,{start:number;length:number}[]>}
export interface DeployPlan {version:1;kind:'deploy';intentId:string;chainId:number;from:string;to:null;data:string;value:'0x0';nonce:number;expected:CollectionExpected;runtime:string}
export class LaunchError extends Error {code:string}
export function prepareCollectionDeployment(artifact:CollectionArtifact,input:CollectionConfig,context:{chainId:number;requester:string;nonce:number}):DeployPlan;
export function simulateDeployment(provider:unknown,plan:DeployPlan):Promise<{blockNumber:number;blockHash:string;gas:string;bytecodeSimulated:true}>;
export function verifyCollection(provider:unknown,expected:CollectionExpected,chainId:number,blockTag?:number|string):Promise<unknown>;
export function verifyDeploymentReceipt(provider:unknown,plan:DeployPlan,hash:string,options?:{minConfirmations?:number}):Promise<unknown>;

export function mintActionId(batchId:string,nonce:number):string;

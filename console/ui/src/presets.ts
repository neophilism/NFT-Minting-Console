import {getAddress} from 'ethers/address';
import {decimalUnits} from './model.ts';
import type {Plan} from './model.ts';
import type {CollectionConfig} from '../../launch/contracts.mjs';

export const PRESET_LIMIT=50, PRESET_BYTES=131072;
export interface PresetValue {config:CollectionConfig;listingPriceEth:string|null}
export interface Preset extends PresetValue {version:1;id:string;label:string;chainId:number;createdAt:string}
const fields=['name','symbol','seriesSize','royaltyBps','owner','minter','royaltyRecipient'] as const;
const zero='0x0000000000000000000000000000000000000000';
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Expected a configuration object.');return v as Record<string,unknown>;}
function exact(v:Record<string,unknown>,keys:readonly string[]){if(Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))throw new Error('Unexpected configuration fields. Presets cannot include credentials, rights, files or transactions.');}
function text(v:unknown,max:number){if(typeof v!=='string'||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw new Error('Invalid configuration text.');return v;}
function network(chainId:number){if(![1,11155111,31337].includes(chainId))throw new Error('Unsupported preset network.');}
export function validatePresetValue(value:unknown):PresetValue{
  const v=object(value);exact(v,['config','listingPriceEth']);const raw=object(v.config);exact(raw,fields);
  const config={} as CollectionConfig;for(const key of fields)config[key]=text(raw[key],key==='name'?120:100);
  config.name=config.name.trim();if(!config.name||!/^[A-Za-z0-9_-]{1,16}$/.test(config.symbol))throw new Error('Enter a collection name and a symbol of 1 to 16 letters, numbers, dashes or underscores.');
  if(!/^[1-9][0-9]{0,77}$/.test(config.seriesSize)||BigInt(config.seriesSize)>2n**256n-1n)throw new Error('Enter a positive whole-number maximum supply.');
  if(!/^(0|[1-9][0-9]{0,4})$/.test(config.royaltyBps)||BigInt(config.royaltyBps)>10000n)throw new Error('Royalty must be from 0 to 10000 basis points.');
  for(const key of ['owner','minter','royaltyRecipient'] as const){try{config[key]=getAddress(config[key]);if(config[key]===zero)throw new Error();}catch{throw new Error('Enter valid, nonzero owner, minter and royalty wallet addresses.');}}
  let listingPriceEth:string|null=null;if(v.listingPriceEth!==null){listingPriceEth=text(v.listingPriceEth,100);const price=decimalUnits(listingPriceEth,18);if(price===null||price<=0n||price>2n**256n-1n)throw new Error('Listing preference must be a positive ETH amount or omitted.');}
  return {config,listingPriceEth};
}
export function parsePreset(value:unknown,chainId:number):Preset{
  network(chainId);const v=object(value);exact(v,['version','id','label','chainId','createdAt','config','listingPriceEth']);
  if(v.version!==1||v.chainId!==chainId)throw new Error('This preset version or network does not match this workspace. No settings were loaded.');
  const id=text(v.id,36),label=text(v.label,80).trim(),createdAt=text(v.createdAt,40);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)||!label||!Number.isFinite(Date.parse(createdAt)))throw new Error('Invalid preset identity or date.');
  return {version:1,id,label,chainId,createdAt,...validatePresetValue({config:v.config,listingPriceEth:v.listingPriceEth})};
}
export function importPreset(json:string,chainId:number):Preset{if(new TextEncoder().encode(json).length>PRESET_BYTES)throw new Error('Choose a preset JSON file no larger than 128 KiB.');return parsePreset(JSON.parse(json),chainId);}
export function createPreset(value:PresetValue,label:string,chainId:number):Preset{return parsePreset({version:1,id:crypto.randomUUID(),label,chainId,createdAt:new Date().toISOString(),...validatePresetValue(value)},chainId);}
export function presetKey(wallet:string,chainId:number){network(chainId);return `nft-console:public-presets:v1:${getAddress(wallet).toLowerCase()}:${chainId}`;}
export function readPresets(storage:Pick<Storage,'getItem'>,key:string,chainId:number):Preset[]{const raw=storage.getItem(key);if(raw===null)return [];if(raw.length>PRESET_BYTES)throw new Error('Saved preset storage is too large.');const list:unknown=JSON.parse(raw);if(!Array.isArray(list)||list.length>PRESET_LIMIT)throw new Error('Invalid saved preset library.');const rows=list.map(x=>parsePreset(x,chainId));if(new Set(rows.map(x=>x.id)).size!==rows.length)throw new Error('Duplicate preset identities.');return rows;}
export function writePresets(storage:Pick<Storage,'setItem'>,key:string,chainId:number,rows:Preset[]){if(rows.length>PRESET_LIMIT)throw new Error('A browser library holds up to 50 presets. Export and remove an older preset first.');const clean=rows.map(x=>parsePreset(x,chainId));const json=JSON.stringify(clean);if(json.length>PRESET_BYTES)throw new Error('Preset library is full.');storage.setItem(key,json);}
export function planPreset(plan:Plan):PresetValue{return {config:{name:plan.name,symbol:plan.symbol,seriesSize:plan.supply,royaltyBps:decimalUnits(plan.royalty,2)?.toString()??'',owner:plan.owner,minter:plan.minter,royaltyRecipient:plan.recipient},listingPriceEth:plan.price||null};}
export function presetPlan(value:PresetValue):Plan{const v=validatePresetValue(value),bps=BigInt(v.config.royaltyBps);return {name:v.config.name,symbol:v.config.symbol,supply:v.config.seriesSize,royalty:`${bps/100n}.${(bps%100n).toString().padStart(2,'0')}`,price:v.listingPriceEth??'',owner:v.config.owner,minter:v.config.minter,recipient:v.config.royaltyRecipient};}

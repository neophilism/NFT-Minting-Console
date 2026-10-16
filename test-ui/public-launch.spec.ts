import {test,expect} from '@playwright/test';
import {getBytes} from 'ethers';
import AxeBuilder from '@axe-core/playwright';
import {testWallets} from './fixtures.mjs';
import {publicBrowserBundle} from './launch-content.mjs';
declare global {interface Window {__launchRpc(method:string,params:unknown[]):Promise<unknown>;__launchSign(data:string):Promise<string>;__launchWrites:number;}}
async function rpc(method:string,params:unknown[]=[]){const r=await fetch('http://127.0.0.1:4174',{method:'POST',headers:{'Content-Type':'application/json','X-NFT-Test':'disposable-local-only'},body:JSON.stringify({method,params})});if(!r.ok)throw new Error('Rejected disposable fixture');return (await r.json()).result;}
test('public launch deploys and mints with wallet review, durable reload and exact byte verification',async({page},info)=>{
  let unknownNext=false;
  const signer=testWallets[info.project.name==='mobile'?5:4]!;
  await page.exposeFunction('__launchSign',(data:string)=>signer.signMessage(getBytes(data)));
  await page.exposeFunction('__launchRpc',async(method:string,params:unknown[])=>{
    if(method!=='eth_sendTransaction')return rpc(method,params);
    if(unknownNext){unknownNext=false;throw new Error('Synthetic unknown wallet result before broadcast');}
    const tx=params[0] as Record<string,string>;if(tx.from?.toLowerCase()!==signer.address.toLowerCase())throw new Error('Wrong synthetic signer');
    return rpc('eth_sendRawTransaction',[await signer.signTransaction({type:0,chainId:31337,from:signer.address,...(tx.to?{to:tx.to}:{}),data:tx.data,nonce:Number(BigInt(tx.nonce!)),gasLimit:BigInt(tx.gas!),gasPrice:BigInt(tx.gasPrice!),value:BigInt(tx.value!)})]);
  });
  await page.addInitScript(address=>{window.__launchWrites=0;window.ethereum={async request({method,params}){
    if(method==='eth_accounts'||method==='eth_requestAccounts')return [address];if(method==='eth_chainId')return '0x7a69';if(method==='personal_sign')return window.__launchSign((params as string[])[0]!);
    if(method==='eth_sendTransaction')window.__launchWrites++;return window.__launchRpc(method,params as unknown[]||[]);
  },on(){},removeListener(){}};},signer.address);
  await page.goto('/#/launch');await page.locator('.topbar').getByRole('button',{name:'Connect wallet',exact:true}).click();await page.getByRole('button',{name:'Browser wallet',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByLabel('Collection name',{exact:true}).fill('Browser public launch '+info.project.name);await page.getByLabel('Symbol',{exact:true}).fill('BPL');await page.getByLabel('Maximum number of NFTs',{exact:true}).fill('87');
  await page.getByRole('checkbox',{name:/approve storing them as public launch data/}).check();await page.getByRole('button',{name:'Prepare collection deployment',exact:true}).click();
  await page.getByRole('button',{name:'Simulate and review network fee',exact:true}).click();await expect(page.getByRole('heading',{name:/Maximum fee:/})).toBeVisible();expect(await page.evaluate(()=>window.__launchWrites)).toBe(0);
  await page.getByRole('checkbox',{name:/approve these exact public settings/}).check();await page.getByRole('button',{name:'Sign collection deployment',exact:true}).click();await expect(page.getByRole('button',{name:'Verify on chain',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Verify on chain',exact:true}).click();await expect(page.getByRole('button',{name:'Use this collection for minting',exact:true})).toBeVisible();expect(await page.evaluate(()=>window.__launchWrites)).toBe(1);
  await page.reload();await page.locator('.transaction-row').getByRole('button',{name:'Open',exact:true}).first().click();await page.getByRole('button',{name:'Use this collection for minting',exact:true}).click();
  await page.getByLabel('Public mint bundle',{exact:true}).setInputFiles({name:'public-bundle.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(publicBrowserBundle))});
  await page.getByRole('checkbox',{name:/approve checking their public IPFS bytes/}).check();await page.getByRole('button',{name:'Verify public files and prepare mint',exact:true}).click();
  await page.getByRole('button',{name:'Simulate and review network fee',exact:true}).click();await expect(page.getByRole('heading',{name:/Maximum fee:/})).toBeVisible();
  await page.getByRole('checkbox',{name:/approve these exact public settings/}).check();await page.getByRole('button',{name:'Sign mint transaction',exact:true}).click();await page.getByRole('button',{name:'Verify on chain',exact:true}).click();
  await expect(page.getByText(/Your mint receipt and immutable token fields are verified/)).toBeVisible();expect(await page.evaluate(()=>window.__launchWrites)).toBe(1); // reload reset; only the mint was signed
  await expect(page.getByText(/Token IDs: 87/)).toBeVisible();
  await page.getByLabel('Collection name',{exact:true}).fill('Browser public launch recovery '+info.project.name);
  await page.getByLabel('Symbol',{exact:true}).fill('BPL');await page.getByLabel('Maximum number of NFTs',{exact:true}).fill('87');
  await page.getByRole('checkbox',{name:/approve storing them as public launch data/}).check();
  await page.getByRole('button',{name:'Prepare collection deployment',exact:true}).click();
  await page.getByRole('button',{name:'Simulate and review network fee',exact:true}).click();
  await page.getByRole('checkbox',{name:/approve these exact public settings/}).check();
  const cancelledNonce=Number(BigInt(await rpc('eth_getTransactionCount',[signer.address,'pending'])));
  unknownNext=true;await page.getByRole('button',{name:'Sign collection deployment',exact:true}).click();
  await expect(page.getByText(/The wallet outcome is unknown/)).toBeVisible();
  const cancellation=await rpc('eth_sendRawTransaction',[await signer.signTransaction({type:0,chainId:31337,to:signer.address,
    nonce:cancelledNonce,gasLimit:21000n,gasPrice:BigInt(await rpc('eth_gasPrice')),value:0n,data:'0x'})]);
  await page.getByText('Recover a finalized wallet cancellation',{exact:true}).click();
  await page.getByLabel('Existing cancellation transaction hash',{exact:true}).fill(cancellation);
  const beforeResolution=await page.evaluate(()=>window.__launchWrites);
  await page.getByRole('button',{name:'Verify cancellation and resolve nonce',exact:true}).click();
  await expect(page.getByText(/The matching wallet cancellation finalized/)).toBeVisible();
  expect(await page.evaluate(()=>window.__launchWrites)).toBe(beforeResolution);
  await expect(page.getByRole('button',{name:'Prepare collection deployment',exact:true})).toBeEnabled();
  await page.reload();
  await page.locator('.transaction-row').filter({hasText:'Browser public launch recovery '+info.project.name}).getByRole('button',{name:'Open',exact:true}).click();
  await expect(page.getByText(/The matching wallet cancellation finalized/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Verify cancellation and resolve nonce',exact:true})).toHaveCount(0);
  const checks=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();expect(checks.violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/${info.project.name}-public-launch.png`,fullPage:true});
});

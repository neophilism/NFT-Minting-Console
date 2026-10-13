import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {getBytes} from 'ethers';
import {testWallets,ORIGIN} from './fixtures.mjs';
import {prepareMintPlan} from '../console/chain/mint.mjs';
// Separate known fixture wallets per viewport avoid nonce interference without hiding concurrency tests.
test.describe.configure({mode:'serial'});
async function rpc(method:string,params:unknown[]=[]):Promise<unknown>{
  const response=await fetch('http://127.0.0.1:4174',{method:'POST',headers:{'Content-Type':'application/json','X-NFT-Test':'disposable-local-only'},body:JSON.stringify({method,params})});
  if(!response.ok)throw new Error('Local signed fixture request failed.');return (await response.json()).result;
}
declare global {interface Window {
  __mintRpc(method:string,params:unknown[]):Promise<unknown>;
  __mintSign(data:string):Promise<string>;
  __mintWallet:{calls:string[];mode:string;lastHash:string;changeChain(chain:string):void};
}}
async function setup(page:Page,mobile:boolean,mode='success'){
  const index=mobile?3:0,signer=testWallets[index]!;
  const manifest=await rpc('fixture_manifest',[index]);
  const batch=prepareMintPlan(manifest).batches[0]!;
  await page.exposeFunction('__mintSign',(data:string)=>signer.signMessage(getBytes(data)));
  await page.exposeFunction('__mintRpc',async(method:string,params:unknown[])=>{
    if(method!=='eth_sendTransaction')return rpc(method,params);
    const value=params[0] as Record<string,string>;
    if(value.from?.toLowerCase()!==signer.address.toLowerCase())throw new Error('Unexpected fixture sender');
    const raw=await signer.signTransaction({to:value.to,data:value.data,value:BigInt(value.value!),nonce:Number(BigInt(value.nonce!)),gasLimit:BigInt(value.gas!),gasPrice:BigInt(value.gasPrice!),chainId:BigInt(value.chainId!),type:0});
    return rpc('eth_sendRawTransaction',[raw]);
  });
  await page.addInitScript(({address,mode})=>{
    let chain='0x7a69';const listeners=new Map<string,Set<(...args:unknown[])=>void>>();
    window.__mintWallet={calls:[],mode,lastHash:'',changeChain(value){chain=value;for(const fn of listeners.get('chainChanged')||[])fn(value);}};
    window.ethereum={async request({method,params}){
      window.__mintWallet.calls.push(method);
      if(method==='eth_accounts'||method==='eth_requestAccounts')return [address];
      if(method==='eth_chainId')return chain;
      if(method==='personal_sign')return window.__mintSign((params as string[])[0]!);
      if(method==='eth_sendTransaction'){
        if(window.__mintWallet.mode==='reject')throw Object.assign(new Error('Fixture user declined'),{code:4001});
        const hash=await window.__mintRpc(method,params as unknown[]);window.__mintWallet.lastHash=String(hash);
        if(window.__mintWallet.mode==='lost-wallet-response')throw Object.assign(new Error('Fixture response lost'),{code:4900});
        return hash;
      }
      return window.__mintRpc(method,params as unknown[]||[]);
    },on(event,fn){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event)!.add(fn);},removeListener(event,fn){listeners.get(event)?.delete(fn);}};
  },{address:signer.address,mode});
  await page.goto('/#/transactions');
  await page.locator('.topbar').getByRole('button',{name:'Connect wallet',exact:true}).click();
  await page.getByRole('button',{name:'Browser wallet',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('heading',{name:'Your mint operations'})).toBeVisible();
  await page.getByLabel('Public test mint manifest',{exact:true}).setInputFiles({name:'synthetic-mint.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(manifest))});
  await expect(page.getByLabel('Batch to review',{exact:true})).toBeVisible();
  return {manifest,batch};
}
async function review(page:Page){
  await page.getByRole('checkbox',{name:/authorize sending them/}).check();
  await page.getByRole('button',{name:'Simulate and estimate fee',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Review the transaction fee'})).toBeVisible();
  await page.getByRole('checkbox',{name:/approve this exact local batch/}).check();
}
async function openOperation(page:Page,id:string){
  const card=page.locator('.transaction-row').filter({has:page.getByText(id,{exact:true})});
  await card.getByRole('button',{name:'Open operation',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Transaction recovery'})).toBeVisible();
}
async function sends(page:Page){return page.evaluate(()=>window.__mintWallet.calls.filter(x=>x==='eth_sendTransaction').length);}
test('browser wallet to real database and local-chain mint survives reload',async({page},info)=>{
  const {batch}=await setup(page,info.project.name==='mobile');
  const writes:string[]=[];page.on('request',request=>{if(request.url().startsWith(ORIGIN+'/api/')&&request.method()!=='GET')writes.push(request.postData()||'');});
  await review(page);expect(await sends(page)).toBe(0);
  await page.getByRole('button',{name:'Sign local mint transaction',exact:true}).click();
  await expect(page.getByTestId('operation-status')).toHaveText('Receipt verified at recorded block');
  expect(await sends(page)).toBe(1);
  expect(writes.some(value=>value.includes(batch.works[0]!.title)||value.includes('ipfs://')||value.includes(batch.data))).toBe(false);
  const hash=await page.evaluate(()=>window.__mintWallet.lastHash);expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  await page.reload();await openOperation(page,batch.id);
  await expect(page.locator('.transaction-detail')).toContainText(hash);
  await page.getByRole('button',{name:'Verify saved receipt',exact:true}).click();
  await expect(page.getByTestId('operation-status')).toHaveText('Receipt verified at recorded block');
  expect(await sends(page)).toBe(0); // new page performed verification, not a repeated wallet send
  const checks=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();expect(checks.violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:`test-results/${info.project.name}-mint-recovery.png`,fullPage:true});
});
test('wallet rejection is recorded without automatic retry or a false successful mint',async({page},info)=>{
  const {batch}=await setup(page,info.project.name==='mobile','reject');await review(page);
  await page.getByRole('button',{name:'Sign local mint transaction',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('You declined the mint request');
  expect(await sends(page)).toBe(1);await openOperation(page,batch.id);
  await expect(page.getByTestId('operation-status')).toHaveText('Ready for review');
});
test('lost wallet response recovers the real transaction without re-minting',async({page},info)=>{
  const {batch}=await setup(page,info.project.name==='mobile','lost-wallet-response');await review(page);
  await page.getByRole('button',{name:'Sign local mint transaction',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('outcome is uncertain');
  const hash=await page.evaluate(()=>window.__mintWallet.lastHash);expect(await sends(page)).toBe(1);
  await openOperation(page,batch.id);await expect(page.getByTestId('operation-status')).toHaveText('Needs attention');
  await page.getByLabel('Transaction hash from wallet history',{exact:true}).fill(hash);
  await page.getByRole('button',{name:'Recover transaction',exact:true}).click();
  await expect(page.getByTestId('operation-status')).toHaveText('Receipt verified at recorded block');expect(await sends(page)).toBe(1);
});
test('lost claim response leaves a reservation and never opens a wallet send',async({page},info)=>{
  const {batch}=await setup(page,info.project.name==='mobile');await review(page);
  await page.route('**/api/mint-operations/*/claim',async route=>{await route.fetch();await route.abort();});
  await page.getByRole('button',{name:'Sign local mint transaction',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();expect(await sends(page)).toBe(0);
  await page.unroute('**/api/mint-operations/*/claim');await page.reload();await openOperation(page,batch.id);
  await expect(page.getByTestId('operation-status')).toHaveText('Wallet outcome not yet recorded');
  await expect(page.getByRole('button',{name:'Cancel unsent operation'})).not.toBeVisible();expect(await sends(page)).toBe(0);
});
test('unsaved wallet hash is shown and can be recovered after storage failure',async({page},info)=>{
  const {batch}=await setup(page,info.project.name==='mobile');await review(page);
  await page.route('**/api/mint-operations/*/transaction',route=>route.abort());
  await page.getByRole('button',{name:'Sign local mint transaction',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('saving its hash was not confirmed');
  const hash=await page.evaluate(()=>window.__mintWallet.lastHash);await expect(page.locator('.recovery-hash')).toContainText(hash);
  await page.unroute('**/api/mint-operations/*/transaction');await openOperation(page,batch.id);
  await page.getByLabel('Transaction hash from wallet history',{exact:true}).fill(hash);
  await page.getByRole('button',{name:'Recover transaction',exact:true}).click();
  await expect(page.getByTestId('operation-status')).toHaveText('Receipt verified at recorded block');expect(await sends(page)).toBe(1);
});
test('wallet network change clears the reviewed transaction before signing',async({page},info)=>{
  await setup(page,info.project.name==='mobile');await review(page);
  await page.evaluate(()=>window.__mintWallet.changeChain('0x1'));
  await expect(page.getByRole('button',{name:'Sign local mint transaction'})).not.toBeVisible();expect(await sends(page)).toBe(0);
});
test('private-field manifests are rejected before simulation or server publication',async({page},info)=>{
  const {manifest}=await setup(page,info.project.name==='mobile');
  await page.getByLabel('Public test mint manifest',{exact:true}).setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...manifest as object,privateKey:'never-submit-this'}))});
  await expect(page.getByRole('alert')).toContainText('manifest is invalid');await expect(page.getByRole('button',{name:'Simulate and estimate fee'})).not.toBeVisible();
  expect(await sends(page)).toBe(0);
});
test('turning off the explicit local capability hides all new signing controls',async({page},info)=>{
  await setup(page,info.project.name==='mobile');
  await page.route('**/api/config',async route=>{const response=await route.fetch();const body=await response.json();body.capabilities.localMint=false;await route.fulfill({response,json:body});});
  await page.reload();await expect(page.getByRole('heading',{name:'Your mint operations'})).toBeVisible();
  await expect(page.getByLabel('Public test mint manifest',{exact:true})).not.toBeVisible();expect(await sends(page)).toBe(0);
});

test('fixture bridge refuses browser-origin requests, arbitrary signing and unissued transfers',async()=>{
  const headers={'Content-Type':'application/json','X-NFT-Test':'disposable-local-only'};
  const denied=async(method:string,params:unknown[]=[],extra:Record<string,string>={})=>{
    const response=await fetch('http://127.0.0.1:4174',{method:'POST',headers:{...headers,...extra},body:JSON.stringify({method,params})});
    expect(response.status).toBe(400);
  };
  await denied('eth_chainId',[],{Origin:ORIGIN});
  await denied('eth_chainId',[],{'X-NFT-Test':'wrong'});
  await denied('eth_sendTransaction',[{}]);await denied('eth_sign',[]);await denied('hardhat_setBalance',[]);
  const raw=await testWallets[0]!.signTransaction({chainId:31337,type:0,to:testWallets[1]!.address,value:0n,gasLimit:21000n,gasPrice:1n,nonce:0});
  await denied('eth_sendRawTransaction',[raw]);
});

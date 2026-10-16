import {test,expect} from '@playwright/test';
import {setupMessage} from '../console/setup/message.mjs';
import {testWallets} from './fixtures.mjs';
declare global {interface Window {__enrollmentRaceMode:string;__enrollmentReads:number;__enrollmentSigns:number;}}
// These cancellation tests model setup responses only. The existing setup.spec.ts
// continues to exercise real HTTP, wallet proof, PostgreSQL and normal sign-in.
for(const phase of ['prepare','before-sign','after-sign'])test(`setup cancels ${phase} after a wallet event inside awaited account read`,async({page})=>{
  const wallet=testWallets[0]!.address,posts:string[]=[];
  await page.addInitScript(address=>{
    window.__enrollmentRaceMode='none';window.__enrollmentReads=0;window.__enrollmentSigns=0;
    const listeners=new Map<string,Set<(...args:unknown[])=>void>>();
    window.ethereum={async request({method}){
      if(method==='eth_requestAccounts')return [address];
      if(method==='eth_accounts'){
        window.__enrollmentReads++;
        const fire=window.__enrollmentRaceMode==='prepare'||window.__enrollmentRaceMode==='before-sign'||(window.__enrollmentRaceMode==='after-sign'&&window.__enrollmentReads===2);
        if(fire){window.__enrollmentRaceMode='none';for(const fn of listeners.get('accountsChanged')||[])fn([address]);}
        return [address];
      }
      if(method==='eth_chainId')return '0x7a69';
      if(method==='personal_sign'){window.__enrollmentSigns++;return '0x'+'11'.repeat(65);}
      throw new Error('No transaction is permitted in the setup fixture.');
    },on(name:string,listener:(...args:unknown[])=>void){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(listener);},removeListener(name:string,listener:(...args:unknown[])=>void){listeners.get(name)?.delete(listener);}};
  },wallet);
  await page.route('**/api/setup/status',route=>route.fulfill({json:{version:1,required:true,chainId:31337,chainName:'Local fixture',databaseVerified:true,codeConfigured:true,runtimeReady:false,fullProductReady:false}}));
  await page.route('**/api/setup/challenge',route=>{posts.push('challenge');const now=Date.now(),issuedAt=new Date(now).toISOString(),expiresAt=new Date(now+300000).toISOString(),challengeId='a'.repeat(64),origin=new URL(route.request().url()).origin;return route.fulfill({json:{version:1,challengeId,issuedAt,expiresAt,message:setupMessage({origin,wallet,chainId:31337,nonce:challengeId,issuedAt,expiresAt})}});});
  await page.route('**/api/setup/claim',route=>{posts.push('claim');return route.fulfill({json:{registered:true,transactionSent:false}});});
  await page.goto('/');await page.getByLabel('Installation setup code',{exact:true}).fill('f'.repeat(64));await page.getByRole('button',{name:'Connect Browser wallet',exact:true}).click();
  if(phase==='prepare'){
    await page.evaluate(()=>{window.__enrollmentRaceMode='prepare';window.__enrollmentReads=0;});
    await page.getByRole('button',{name:'Prepare administrator registration',exact:true}).click();
  }else{
    await page.getByRole('button',{name:'Prepare administrator registration',exact:true}).click();await page.getByRole('checkbox',{name:/I control this installation/}).check();
    await page.evaluate(mode=>{window.__enrollmentRaceMode=mode;window.__enrollmentReads=0;},phase);
    await page.getByRole('button',{name:'Register administrator with wallet signature',exact:true}).click();
  }
  await expect(page.getByRole('alert')).toContainText('wallet or network changed');
  await expect(page.getByText('Preparing administrator registration',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Review the registration message in your wallet',{exact:true})).toHaveCount(0);
  expect(posts).toEqual(phase==='prepare'?[]:['challenge']);
  expect(await page.evaluate(()=>window.__enrollmentSigns)).toBe(phase==='after-sign'?1:0);
  await expect(page.getByRole('heading',{name:'Administrator registered',exact:true})).toHaveCount(0);
});

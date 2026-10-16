import {test,expect} from '@playwright/test';

declare global {interface Window {__walletPrematurelyEnabled:boolean;__watchWalletReadiness:boolean}}

test('Connect wallet stays disabled until this configuration finishes session restoration',async({page})=>{
  let release:()=>void=()=>{},started:()=>void=()=>{};
  const waiting=new Promise<void>(resolve=>{release=resolve;}),requestStarted=new Promise<void>(resolve=>{started=resolve;});
  await page.addInitScript(()=>{
    window.__walletPrematurelyEnabled=false;window.__watchWalletReadiness=true;
    window.ethereum={async request(){throw new Error('This readiness test must not call a wallet.');},on(){},removeListener(){}};
    new MutationObserver(()=>{
      const button=document.querySelector<HTMLButtonElement>('.topbar .wallet-button');
      if(window.__watchWalletReadiness&&button&&!button.disabled)window.__walletPrematurelyEnabled=true;
    }).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
  });
  await page.route('**/api/auth/session',async route=>{started();await waiting;await route.fulfill({status:401,json:{code:'session_required',error:'No saved session in this isolated browser.'}});});
  const writes:string[]=[];page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/'))writes.push(r.url());});
  await page.goto('/#/transactions');await requestStarted;
  await expect(page.locator('.topbar .wallet-button')).toBeDisabled();
  await expect(page.locator('.topbar .wallet-button')).toHaveText('Restoring session');
  expect(await page.evaluate(()=>window.__walletPrematurelyEnabled)).toBe(false);
  await page.evaluate(()=>{window.__watchWalletReadiness=false;});release();
  const connect=page.locator('.topbar').getByRole('button',{name:'Connect wallet',exact:true});
  await expect(connect).toBeEnabled();await connect.click();
  await expect(page.getByRole('dialog',{name:'Connect your wallet'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Browser wallet',exact:true})).toBeVisible();
  expect(writes).toEqual([]);
});

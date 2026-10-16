import {test,expect} from '@playwright/test';
import {getBytes} from 'ethers';
import {testWallets} from './fixtures.mjs';
declare global {interface Window {__raceRelease():void;__raceSign(data:string):Promise<string>;__raceReady:boolean;}}
for(const dismissal of ['button','escape'] as const)test('closing sign-in synchronously invalidates a wallet result in the same event turn: '+dismissal,async({page})=>{
  const signer=testWallets[0]!;
  await page.exposeFunction('__raceSign',(data:string)=>signer.signMessage(getBytes(data)));
  await page.addInitScript(address=>{window.__raceReady=false;window.ethereum={async request({method,params}){if(method==='eth_accounts'||method==='eth_requestAccounts')return[address];if(method==='eth_chainId')return'0x7a69';if(method==='personal_sign'){await new Promise<void>(resolve=>{window.__raceRelease=resolve;window.__raceReady=true;});return window.__raceSign((params as string[])[0]!);}throw new Error('No transactions in sign-in fixture.');},on(){},removeListener(){}};},signer.address);
  let verifications=0;page.on('request',request=>{if(request.url().endsWith('/api/auth/verify'))verifications++;});
  await page.goto('/');await page.locator('.topbar').getByRole('button',{name:'Connect wallet',exact:true}).click();await page.getByRole('button',{name:'Browser wallet',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__raceReady)).toBe(true);
  // The signature resolves in the same JS turn, before a native queued close event.
  await page.evaluate(mode=>{if(mode==='button')(document.querySelector('dialog button[aria-label="Close dialog"]') as HTMLButtonElement).click();else document.querySelector('dialog')!.dispatchEvent(new Event('cancel',{cancelable:true}));window.__raceRelease();},dismissal);
  await expect(page.getByRole('alert')).toContainText(/cancelled|Wallet changed/);await expect(page.getByText('Signed in',{exact:true})).not.toBeVisible();expect(verifications).toBe(0);expect((await page.request.get('/api/auth/session')).status()).toBe(401);
});

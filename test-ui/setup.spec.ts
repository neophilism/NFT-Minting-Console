import {test,expect} from '@playwright/test';
import {getBytes} from 'ethers';
import AxeBuilder from '@axe-core/playwright';
import {testWallets} from './fixtures.mjs';
declare global {interface Window {__setupSign(data:string):Promise<string>;__setupCalls:string[];}}
test('administrator enrolls through actual browser, HTTP and PostgreSQL, then signs in without sharing an address in chat',async({page},info)=>{
  const signer=testWallets[0]!;
  await page.exposeFunction('__setupSign',(data:string)=>signer.signMessage(getBytes(data)));
  await page.addInitScript(address=>{window.__setupCalls=[];window.ethereum={async request({method,params}){window.__setupCalls.push(method);if(method==='eth_accounts'||method==='eth_requestAccounts')return[address];if(method==='eth_chainId')return'0x7a69';if(method==='personal_sign')return window.__setupSign((params as string[])[0]!);throw new Error('Setup must never send a transaction.');},on(){},removeListener(){}};},signer.address);
  const origin=`http://127.0.0.1:${info.project.name==='mobile'?4176:4175}`;
  await page.goto(origin);await expect(page.getByRole('heading',{name:'Make this your NFT workspace',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Prepare administrator registration',exact:true})).toBeDisabled();
  await page.getByLabel('Installation setup code',{exact:true}).fill('0'.repeat(64));
  await page.getByRole('button',{name:'Connect Browser wallet',exact:true}).click();
  await page.getByRole('button',{name:'Prepare administrator registration',exact:true}).click();await expect(page.getByRole('alert')).toContainText('installation setup code');expect(await page.evaluate(()=>window.__setupCalls.filter(m=>m==='personal_sign').length)).toBe(0);
  await page.getByLabel('Installation setup code',{exact:true}).fill('f'.repeat(64));await page.getByRole('button',{name:'Prepare administrator registration',exact:true}).click();
  await expect(page.getByRole('heading',{name:'3. Review and sign the registration',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Register administrator with wallet signature',exact:true})).toBeDisabled();
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  // Clear the synthetic code before screenshot so evidence follows the same privacy rule as production.
  await page.getByLabel('Installation setup code',{exact:true}).fill('');await page.screenshot({path:`test-results/${info.project.name}-administrator-setup.png`,fullPage:true});await page.getByLabel('Installation setup code',{exact:true}).fill('f'.repeat(64));await page.getByRole('button',{name:'Prepare administrator registration',exact:true}).click();
  await page.getByRole('checkbox',{name:/I control this installation/}).check();await page.getByRole('button',{name:'Register administrator with wallet signature',exact:true}).click();await expect(page.getByRole('heading',{name:'Administrator registered',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>JSON.stringify({...localStorage}).includes('f'.repeat(64)))).toBe(false);expect(await page.evaluate(()=>window.__setupCalls.some(m=>m.includes('send')||m.includes('switch')))).toBe(false);
  await page.getByRole('button',{name:'Open my workspace',exact:true}).click();await expect(page.getByRole('heading',{name:'Every collection starts here.',exact:true})).toBeVisible();await page.locator('.topbar').getByRole('button',{name:'Connect wallet',exact:true}).click();await page.getByRole('button',{name:'Browser wallet',exact:true}).click();await expect(page.getByText('Signed in',{exact:true})).toBeVisible();
  const status=await (await page.request.get(origin+'/api/setup/status')).json();expect(status.required).toBe(false);expect(status.fullProductReady).toBe(false);
  const reclaim=await page.request.post(origin+'/api/setup/challenge',{headers:{Origin:origin},data:{setupCode:'f'.repeat(64),wallet:signer.address,chainId:31337}});expect(reclaim.ok()).toBe(false);
});

import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {getBytes} from 'ethers';
import {OWNER,testWallets} from './fixtures.mjs';
declare global {interface Window {__guideSign(data:string):Promise<string>;__guideCalls:string[];}}
async function login(page:Page){
  await page.exposeFunction('__guideSign',(data:string)=>testWallets.find(w=>w.address===OWNER)!.signMessage(getBytes(data)));
  await page.addInitScript(address=>{window.__guideCalls=[];window.ethereum={async request({method,params}){window.__guideCalls.push(method);if(method==='eth_accounts'||method==='eth_requestAccounts')return [address];if(method==='eth_chainId')return '0x7a69';if(method==='personal_sign')return window.__guideSign((params as string[])[0]!);throw new Error('Tutorial fixture refuses wallet transaction: '+method);},on(){},removeListener(){}};},OWNER);
  await page.goto('/');await page.locator('.topbar').getByRole('button',{name:'Connect wallet',exact:true}).click();await page.getByRole('button',{name:'Browser wallet',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.getByText('Signed in',{exact:true})).toBeVisible();
}
async function createForm(page:Page){await page.goto('/#/create');await page.getByLabel('Collection name',{exact:true}).fill('Reusable original');await page.getByLabel('Token symbol',{exact:true}).fill('REUSE');await page.getByLabel('Maximum supply',{exact:true}).fill('8');await page.getByLabel('Creator royalty (%)',{exact:true}).fill('0.29');await page.getByLabel('Initial listing price (ETH)',{exact:true}).fill('0.000000000000000001');}
async function help(page:Page){await page.getByRole('button',{name:'Help & tutorials',exact:true}).click();await expect(page.getByRole('dialog',{name:'Help and guided tutorials'})).toBeVisible();}
test('tutorial catalog, keyboard, accessible guide and resume work without wallet actions',async({page},info)=>{
  const writes:string[]=[];page.on('request',request=>{if(request.url().includes('/api/')&&request.method()!=='GET')writes.push(request.url());});
  await page.goto('/');await help(page);await expect(page.getByRole('button',{name:/^Start /})).toHaveCount(12);
  await page.getByLabel('Search tutorials').fill('administrator');await expect(page.getByRole('button',{name:/^Start /})).toHaveCount(1);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations).toEqual([]);
  await page.getByRole('button',{name:'Start Administrator Setup',exact:true}).click();await expect(page.locator('#tutorial-heading')).toHaveText('Collect public wallet addresses');
  await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page.locator('#tutorial-heading')).toHaveText('Create the blockchain connection');
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/${info.project.name}-guided-tutorial.png`,fullPage:true});
  await page.keyboard.press('Escape');await expect(page.locator('.tutorial-guide')).toHaveCount(0);await page.reload();await help(page);await page.getByRole('button',{name:'Resume last tutorial',exact:true}).click();await expect(page.locator('#tutorial-heading')).toHaveText('Create the blockchain connection');expect(writes).toEqual([]);
});
test('tutorial route changes require consent and declining preserves unsaved work',async({page})=>{
  await login(page);await createForm(page);await help(page);await page.getByRole('button',{name:'Start Administrator Setup',exact:true}).click();
  await expect(page.getByLabel('Collection name',{exact:true})).toHaveValue('Reusable original');
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Open tutorial screen',exact:true}).click();await expect(page.getByLabel('Collection name',{exact:true})).toHaveValue('Reusable original');
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Open tutorial screen',exact:true}).click();await expect(page).toHaveURL(/#\/settings$/);expect(await page.evaluate(()=>window.__guideCalls.some(m=>m.includes('send')||m.includes('switch')))).toBe(false);
});
test('public configurations save, reload, copy, export and generate exact deployment parameters',async({page})=>{
  await login(page);await createForm(page);
  const presets=page.getByRole('region',{name:'Saved configurations'});
  await presets.getByLabel('Configuration name',{exact:true}).fill('Original preset');await presets.getByRole('checkbox').check();await presets.getByRole('button',{name:'Save as new configuration',exact:true}).click();await expect(presets.getByRole('status')).toContainText('Saved a new configuration');
  await page.reload();await expect(page.getByLabel('Collection name',{exact:true})).toHaveValue('');await presets.getByLabel('Saved on this wallet and network').selectOption({label:'Original preset — Reusable original'});page.once('dialog',dialog=>dialog.accept());await presets.getByRole('button',{name:'Load editable copy',exact:true}).click();await expect(page.getByLabel('Creator royalty (%)',{exact:true})).toHaveValue('0.29');
  await page.getByLabel('Collection name',{exact:true}).fill('Independent copy');await presets.getByLabel('Configuration name',{exact:true}).fill('Second preset');await presets.getByRole('checkbox').check();await presets.getByRole('button',{name:'Save as new configuration',exact:true}).click();await expect(presets.locator('select option')).toHaveCount(3);
  const downloaded=page.waitForEvent('download');await presets.getByRole('button',{name:'Export current configuration',exact:true}).click();expect((await downloaded).suggestedFilename()).toBe('nft-configuration.json');
  const stored=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('nft-console:public-presets:')).map(k=>JSON.parse(localStorage.getItem(k)!)));expect(stored[0][1].config.name).toBe('Reusable original');
  await page.goto('/#/launch');await presets.getByLabel('Saved on this wallet and network').selectOption({label:'Second preset — Independent copy'});page.once('dialog',dialog=>dialog.accept());await presets.getByRole('button',{name:'Load editable copy',exact:true}).click();await expect(page.getByLabel('Royalty in basis points (600 = 6%)')).toHaveValue('29');await expect(page.getByRole('checkbox',{name:/approve storing them as public launch data/})).not.toBeChecked();
  await page.getByRole('checkbox',{name:/approve storing them as public launch data/}).check();await page.getByRole('button',{name:'Prepare collection deployment',exact:true}).click();await expect(page.getByRole('heading',{name:'Deploy collection: Independent copy',exact:true})).toBeVisible();await page.getByText('Review exact collection settings',{exact:true}).click();await expect(page.locator('pre.public-json').first()).toContainText('"royaltyBps": "29"');await page.getByRole('button',{name:'Cancel unsent operation',exact:true}).click();expect(await page.evaluate(()=>window.__guideCalls.some(m=>m.includes('send')))).toBe(false);
});
test('wrong-network or credential-bearing preset imports cannot change form fields',async({page})=>{
  await login(page);await createForm(page);const row={version:1,id:'11111111-1111-4111-8111-111111111111',label:'Untrusted',chainId:1,createdAt:'2026-10-16T12:00:00Z',config:{name:'Changed',symbol:'BAD',seriesSize:'2',royaltyBps:'600',owner:OWNER,minter:OWNER,royaltyRecipient:OWNER},listingPriceEth:null};
  await page.getByLabel('Import a configuration JSON').setInputFiles({name:'wrong.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(row))});await expect(page.getByRole('alert')).toContainText('network');await expect(page.getByLabel('Collection name',{exact:true})).toHaveValue('Reusable original');
  await page.getByLabel('Import a configuration JSON').setInputFiles({name:'secret.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...row,chainId:31337,PINATA_JWT:'synthetic-not-a-secret'}))});await expect(page.getByRole('alert')).toContainText('Unexpected configuration fields');await expect(page.getByLabel('Collection name',{exact:true})).toHaveValue('Reusable original');
});

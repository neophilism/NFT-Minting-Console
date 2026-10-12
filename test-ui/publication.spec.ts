import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { getBytes } from 'ethers';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { OWNER, testWallets, ORIGIN } from './fixtures.mjs';

declare global {
  interface Window {
    __finishRights?: () => void;
    __testSign(data: string, address: string): Promise<string>;
    __wallet: { changeAccounts(value: string): void; changeChain(value: string): void; release(): void; signCount: number; calls: string[] };
  }
}
async function installWallet(page: Page, options: { wallet?: string; chain?: string; mode?: string; name?: string } = {}) {
  await page.exposeFunction('__testSign', async (data: string, address: string) => {
    const wallet = testWallets.find(value => value.address.toLowerCase() === address.toLowerCase());
    if (!wallet) throw new Error('Unknown fixture signer.');
    return wallet.signMessage(getBytes(data));
  });
  await page.addInitScript(({ wallet, chain, mode, name }) => {
    let account = wallet, network = chain, finish: (() => void) | undefined;
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    window.__wallet = { signCount: 0, calls: [],
      changeAccounts(value) { account = value; for (const fn of listeners.get('accountsChanged') || []) fn([value]); },
      changeChain(value) { network = value; for (const fn of listeners.get('chainChanged') || []) fn(value); },
      release() { finish?.(); },
    };
    const provider = {
      async request({ method, params }: { method: string; params?: unknown[] | Record<string, unknown> }) {
        window.__wallet.calls.push(method);
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
        if (method === 'eth_chainId') return network;
        if (method === 'personal_sign') {
          window.__wallet.signCount++;
          if (mode === 'reject') throw Object.assign(new Error('Declined'), { code: 4001 });
          if (mode === 'wait') await new Promise<void>(resolve => { finish = resolve; });
          if (!Array.isArray(params) || typeof params[0] !== 'string' || typeof params[1] !== 'string') throw new Error('Unexpected signing payload');
          return window.__testSign(params[0], params[1]);
        }
        throw new Error('Unsupported fixture wallet method: ' + method);
      },
      on(event: string, fn: (...args: unknown[]) => void) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(fn); },
      removeListener(event: string, fn: (...args: unknown[]) => void) { listeners.get(event)?.delete(fn); },
    };
    (window as unknown as { ethereum: typeof provider }).ethereum = provider;
    if (name) window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'test-wallet', name, icon: 'https://do-not-request.invalid/icon.svg', rdns: 'example.fixture' }, provider },
    })));
  }, { wallet: options.wallet || OWNER, chain: options.chain || '0x7a69', mode: options.mode || 'approve', name: options.name || '' });
}
async function openWallet(page: Page) {
  await page.locator('.topbar').getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}
async function login(page: Page) {
  await page.goto('/'); await openWallet(page);
  await page.getByRole('button', { name: 'Browser wallet', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('Signed in', { exact: true })).toBeVisible();
}
async function navigate(page: Page, route: string) { await page.evaluate(value => { location.hash = '#/' + value; }, route); }
async function plan(page: Page) {
  await navigate(page, 'create');
  await page.getByLabel('Collection name', { exact: true }).fill('Independent work');
  await page.getByLabel('Token symbol', { exact: true }).fill('ART');
  await page.getByLabel('Maximum supply', { exact: true }).fill('25');
  await page.getByLabel('Creator royalty (%)', { exact: true }).fill('0.29');
  await page.getByLabel('Initial listing price (ETH)', { exact: true }).fill('0.000000000000000001');
}
const publicUri = 'ipfs://bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq';
const rightsBytes = Buffer.from('\ufeffPublic test rights.\r\nExact bytes.  \n', 'utf8');
const rightsDigest = createHash('sha256').update(rightsBytes).digest('hex');
async function fillPublicPreparation(page: Page) {
  await navigate(page, 'create');
  await page.getByLabel('Rights document', { exact: true }).setInputFiles({ name: 'rights.md', mimeType: 'text/markdown', buffer: rightsBytes });
  await expect(page.getByTestId('rights-digest')).toHaveText(rightsDigest);
  await page.getByLabel('Public token name', { exact: true }).fill('Public preparation fixture');
  await page.getByLabel('Rights scope', { exact: true }).selectOption('token');
  await page.getByLabel('Public image URI', { exact: true }).fill(publicUri);
  await page.getByLabel('Public rights URI', { exact: true }).fill(publicUri + '/rights.md');
  await page.getByLabel('Media SHA-256', { exact: true }).fill('a'.repeat(64));
  await page.getByLabel('Public description', { exact: true }).fill('Public description fixture');
  await page.getByRole('checkbox').check();
}
async function preparePublicMetadata(page: Page) {
  await fillPublicPreparation(page);
  await page.getByRole('button', { name: 'Prepare metadata preview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Metadata prepared locally' })).toBeVisible();
}
test('rights preparation exports exact public bytes without upload or a transaction', async ({ page }, testInfo) => {
  await installWallet(page); await login(page);
  const writes: string[] = [], external: string[] = [];
  page.on('request', request => {
    if (request.method() !== 'GET') writes.push(request.url());
    if (!request.url().startsWith(ORIGIN) && !request.url().startsWith('blob:')) external.push(request.url());
  });
  await preparePublicMetadata(page);
  await expect(page.getByRole('heading', { name: 'Metadata prepared locally' })).toBeFocused();
  const json = await page.getByTestId('public-json').textContent();
  expect(JSON.parse(json!).properties).toMatchObject({ rights_sha256: rightsDigest, rights_scope: 'token' });
  expect(JSON.parse(json!).properties.collector_email).toBeUndefined();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download prepared metadata', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('nft-public-metadata.json');
  const file = await download.path(); expect(file).not.toBeNull();
  expect(await readFile(file!, 'utf8')).toBe(json);
  await expect(page.getByText(createHash('sha256').update(json!).digest('hex'), { exact: true })).toBeVisible();
  expect(writes).toEqual([]); expect(external).toEqual([]);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, signatures: window.__wallet.signCount })))
    .toEqual({ local: 0, session: 0, signatures: 1 });
  expect(await page.evaluate(() => window.__wallet.calls.some(method => /sendTransaction|sendRawTransaction|wallet_sendCalls/.test(method)))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
  await page.locator('.rights-workbench').screenshot({ path: `test-results/${testInfo.project.name}-rights-preparation.png` });
});
test('editing or replacing reviewed rights invalidates the public metadata snapshot', async ({ page }) => {
  await installWallet(page); await login(page); await preparePublicMetadata(page);
  await page.getByLabel('Public token name', { exact: true }).fill('Changed name');
  await expect(page.getByRole('heading', { name: 'Metadata prepared locally' })).not.toBeVisible();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Prepare metadata preview', exact: true })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Prepare metadata preview', exact: true }).click();
  await expect(page.getByTestId('public-json')).toContainText('Changed name');
  const bytes = Buffer.from('Replaced rights\n');
  await page.getByLabel('Rights document', { exact: true }).setInputFiles({ name: 'new.txt', mimeType: 'text/plain', buffer: bytes });
  await expect(page.getByTestId('rights-digest')).toHaveText(createHash('sha256').update(bytes).digest('hex'));
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByTestId('public-json')).not.toBeVisible();
});
test('bad rights types are rejected and PDF bytes are hashed but never rendered', async ({ page }) => {
  await installWallet(page); await login(page); await navigate(page, 'create');
  const input = page.getByLabel('Rights document', { exact: true });
  await input.setInputFiles({ name: 'wrong.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') });
  await expect(page.getByRole('alert')).toContainText('does not have a PDF header');
  await expect(page.getByTestId('rights-digest')).not.toBeVisible();
  await expect(page.getByRole('checkbox')).toBeDisabled();
  const pdf = Buffer.from('%PDF-1.7\nSynthetic non-rendered header fixture.');
  await input.setInputFiles({ name: 'fixture.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.getByTestId('rights-digest')).toHaveText(createHash('sha256').update(pdf).digest('hex'));
  await expect(page.getByRole('alert')).not.toBeVisible();
  expect(await page.locator('iframe,object,embed').count()).toBe(0);
  await expect(page.getByText('Inspect text preview', { exact: true })).not.toBeVisible();
});
test('rights text is rendered literally without fetching attacker markup', async ({ page }) => {
  await installWallet(page); await login(page); await navigate(page, 'create');
  const external: string[] = []; page.on('request', request => { if (request.url().includes('never-request.invalid')) external.push(request.url()); });
  const text = '<img src="https://never-request.invalid/rights" onerror="alert(1)">';
  await page.getByLabel('Rights document', { exact: true }).setInputFiles({ name: 'literal.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await page.getByText('Inspect text preview', { exact: true }).click();
  await expect(page.locator('.rights-summary pre')).toHaveText(text);
  expect(await page.locator('.rights-summary img, .rights-summary script').count()).toBe(0);
  expect(external).toEqual([]);
});
test('clear, navigation and reload remove all rights preparation', async ({ page }) => {
  await installWallet(page); await login(page); await preparePublicMetadata(page);
  await page.getByRole('button', { name: 'Clear preparation', exact: true }).click();
  await expect(page.getByTestId('rights-digest')).not.toBeVisible();
  await expect(page.getByTestId('public-json')).not.toBeVisible();
  await expect(page.getByLabel('Public token name', { exact: true })).toHaveValue('');
  expect(await page.getByLabel('Rights document', { exact: true }).evaluate(element => (element as HTMLInputElement).files?.length)).toBe(0);
  await fillPublicPreparation(page); await navigate(page, 'settings');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Workspace settings'); await navigate(page, 'create');
  await expect(page.getByTestId('rights-digest')).not.toBeVisible();
  await expect(page.getByLabel('Public token name', { exact: true })).toHaveValue('');
  await fillPublicPreparation(page); await page.reload();
  await expect(page.getByLabel('Public token name', { exact: true })).toHaveValue('');
  await expect(page.getByTestId('rights-digest')).not.toBeVisible();
});
test('sign-out immediately removes prepared rights and collection fields', async ({ page }) => {
  await installWallet(page); await login(page); await plan(page); await preparePublicMetadata(page);
  await page.getByRole('button', { name: /0xf39F/ }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByTestId('public-json')).not.toBeVisible();
  await expect(page.getByTestId('rights-digest')).not.toBeVisible();
  await expect(page.getByLabel('Collection name', { exact: true })).not.toBeVisible();
  await expect.poll(async () => (await page.request.get('/api/auth/session')).status()).toBe(401);
  await openWallet(page); await page.getByRole('button', { name: 'Browser wallet', exact: true }).click();
  await expect(page.getByLabel('Collection name', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Public token name', { exact: true })).toHaveValue('');
});
test('a cancelled slow file read cannot overwrite its replacement', async ({ page }) => {
  await installWallet(page); await login(page); await navigate(page, 'create');
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name !== 'slow.md') return original.call(this);
      return new Promise<ArrayBuffer>(resolve => { window.__finishRights = () => resolve(new TextEncoder().encode('Old rights').buffer); });
    };
  });
  const input = page.getByLabel('Rights document', { exact: true });
  await input.setInputFiles({ name: 'slow.md', mimeType: 'text/markdown', buffer: Buffer.from('Old rights') });
  await expect(page.locator('.rights-workbench').getByRole('status')).toContainText('Preparing exact-byte');
  const bytes = Buffer.from('New rights');
  await input.setInputFiles({ name: 'new.md', mimeType: 'text/markdown', buffer: bytes });
  await expect(page.getByTestId('rights-digest')).toHaveText(createHash('sha256').update(bytes).digest('hex'));
  await page.evaluate(() => window.__finishRights?.());
  await expect(page.getByTestId('rights-digest')).toHaveText(createHash('sha256').update(bytes).digest('hex'));
  await expect(page.getByRole('alert')).not.toBeVisible();
});

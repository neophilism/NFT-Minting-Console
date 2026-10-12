import { test, expect } from '@playwright/test';
import { getBytes, hashMessage } from 'ethers';
import { SAFE, OWNER, testWallets } from './fixtures.mjs';

declare global {
  interface Window {
    __safeSign(data: string, address: string): Promise<string>;
    __safeProvider: { methods: string[]; changeAccount(value: string): void };
  }
}
async function installSafe(page: import('@playwright/test').Page, count = 2, outsider = false) {
  await page.exposeFunction('__safeSign', async (data: string, address: string) => {
    if (address.toLowerCase() !== SAFE.toLowerCase()) throw new Error('Unexpected fixture Safe.');
    const signers = outsider ? [testWallets[0], testWallets[3]] : testWallets.slice(0, count);
    const signatures = await Promise.all(signers.map(async signer => {
      if (!signer) throw new Error('Fixture signer is unavailable.');
      return { owner: signer.address.toLowerCase(),
      signature: await signer.signTypedData({ chainId: 31337, verifyingContract: SAFE },
        { SafeMessage: [{ name: 'message', type: 'bytes' }] }, { message: hashMessage(getBytes(data)) }),
      };
    }));
    return '0x' + signatures.sort((a, b) => a.owner.localeCompare(b.owner)).map(x => x.signature.slice(2)).join('');
  });
  await page.addInitScript(({ address }) => {
    let account = address;
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    window.__safeProvider = { methods: [], changeAccount(value) {
      account = value;
      for (const fn of listeners.get('accountsChanged') || []) fn([value]);
    } };
    const provider = {
      async request({ method, params }: { method: string; params?: unknown[] }) {
        window.__safeProvider.methods.push(method);
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
        if (method === 'eth_chainId') return '0x7a69';
        if (method === 'personal_sign' && Array.isArray(params) && typeof params[0] === 'string' && typeof params[1] === 'string') {
          return window.__safeSign(params[0], params[1]);
        }
        throw new Error('Unsupported fixture method.');
      },
      on(event: string, fn: (...args: unknown[]) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(fn);
      },
      removeListener(event: string, fn: (...args: unknown[]) => void) { listeners.get(event)?.delete(fn); },
    };
    (window as unknown as { ethereum: unknown }).ethereum = provider;
    window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'safe-test-provider', name: 'Safe integration fixture' }, provider },
    })));
  }, { address: SAFE });
}
async function start(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.locator('.topbar').getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Safe integration fixture', exact: true }).click();
}
test('actual 2-of-3 Safe signs in through the browser and ERC-1271 HTTP path', async ({ page }) => {
  await installSafe(page); await start(page);
  await expect(page.getByText('Signed in', { exact: true })).toBeVisible();
  const response = await page.request.get('/api/auth/session');
  expect(response.status()).toBe(200);
  expect((await response.json()).wallet).toBe(SAFE.toLowerCase());
  expect(await page.evaluate(() => window.__safeProvider.methods.some(x => /sendTransaction|sendRawTransaction|wallet_sendCalls/.test(x)))).toBe(false);
  await page.reload(); await expect(page.getByText('Signed in', { exact: true })).toBeVisible();
});
test('one Safe owner cannot authenticate a 2-of-3 account through the UI', async ({ page }) => {
  await installSafe(page, 1); await start(page);
  await expect(page.getByRole('alert')).toContainText('signature could not be verified');
  expect((await page.request.get('/api/auth/session')).status()).toBe(401);
  await expect(page.getByText('Signed in', { exact: true })).not.toBeVisible();
});
test('a second unrelated signer does not satisfy the Safe threshold', async ({ page }) => {
  await installSafe(page, 2, true); await start(page);
  await expect(page.getByRole('alert')).toContainText('signature could not be verified');
  expect((await page.request.get('/api/auth/session')).status()).toBe(401);
});
test('switching from a Safe to an owner wallet revokes the Safe session', async ({ page }) => {
  await installSafe(page); await start(page);
  await expect(page.getByText('Signed in', { exact: true })).toBeVisible();
  await page.evaluate(value => window.__safeProvider.changeAccount(value), OWNER);
  await expect(page.getByText('Signed in', { exact: true })).not.toBeVisible();
  await expect.poll(async () => (await page.request.get('/api/auth/session')).status()).toBe(401);
});

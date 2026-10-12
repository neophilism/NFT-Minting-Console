import { test, expect } from '@playwright/test';

// No signature adapter is needed here: these cases exercise dialog keyboard
// behavior only. Actual wallet proofs remain in console.spec.ts and Safe CI.
test('dialog cycles Tab and Shift+Tab and restores its opener', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { ethereum: unknown }).ethereum = {
      async request() { return []; },
      on() {}, removeListener() {},
    };
  });
  await page.goto('/');
  const opener = page.locator('.topbar').getByRole('button', { name: 'Connect wallet', exact: true });
  await opener.click();
  const close = page.getByRole('button', { name: 'Close dialog', exact: true });
  const wallet = page.getByRole('button', { name: 'Browser wallet', exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab'); await expect(wallet).toBeFocused();
  await page.keyboard.press('Tab'); await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(wallet).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(opener).toBeFocused();
});
test('a dialog with no wallet never loses its only actionable focus target', async ({ page }) => {
  await page.goto('/');
  const opener = page.locator('.empty-state').getByRole('button', { name: 'Connect wallet', exact: true });
  await opener.click();
  await expect(page.getByText('No wallet was detected.', { exact: false })).toBeVisible();
  const close = page.getByRole('button', { name: 'Close dialog', exact: true });
  for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key); await expect(close).toBeFocused();
  }
  await close.click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(opener).toBeFocused();
});

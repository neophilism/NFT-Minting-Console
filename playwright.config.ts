import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test-ui', testMatch: '**/*.spec.ts', fullyParallel: true, workers: 2,
  timeout: 30_000, expect: { timeout: 8_000 }, forbidOnly: Boolean(process.env.CI), retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/browser-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {} },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: 'NFT_UI_FIXTURE=1 node test-ui/server.mjs', url: 'http://127.0.0.1:4173/',
    timeout: 30_000, reuseExistingServer: false },
});

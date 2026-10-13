import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

test('actual Chromium WebCrypto and bundled hash implementation round trip and fail closed', async () => {
  const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'crypto-test-page', configureServer(vite) {
      vite.middlewares.use('/crypto-test', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Synthetic attachment test</title>'); });
    } }] });
  let browser;
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage(), remoteRequests = [];
    await page.route('**/*', route => {
      if (!route.request().url().startsWith(origin + '/')) { remoteRequests.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    await page.goto(`${origin}/crypto-test`);
    const result = await page.evaluate(async () => {
      const { prepareAttachment, openAttachment } = await import('/console/crypto/attachments.mjs');
      const data = new Uint8Array(65536 * 2 + 1); data[0] = 97; data[data.length - 1] = 42;
      const prepared = await prepareAttachment(new Blob([data]), { parentMessageId: 'synthetic-browser-parent', filename: 'synthetic.bin', chunkSize: 65536 });
      const chunks = [];
      await prepared.encryptTo((i, bytes) => { chunks[i] = bytes; });
      const opened = await openAttachment(prepared.privateManifest, 'synthetic-browser-parent'), recovered = [];
      const report = await opened.decryptTo(i => chunks[i], (i, bytes) => { recovered[i] = Uint8Array.from(bytes); });
      let tamperRejected = false, reuseRejected = false;
      chunks[0][0] ^= 1;
      try { await opened.decryptChunk(0, chunks[0]); } catch { tamperRejected = true; }
      try { await prepared.encryptTo(() => {}); } catch { reuseRejected = true; }
      const roundtrip = new Uint8Array(await new Blob(recovered).arrayBuffer());
      return { secureContext: globalThis.isSecureContext, sameBytes: roundtrip.length === data.length && roundtrip.every((b, i) => b === data[i]),
        wholeFileVerified: report.wholeFileVerified, chunks: report.chunks, tamperRejected, reuseRejected };
    });
    assert.deepEqual(result, { secureContext: true, sameBytes: true, wholeFileVerified: true, chunks: 3, tamperRejected: true, reuseRejected: true });
    assert.deepEqual(remoteRequests, []);
  } finally { await browser?.close(); await server.close(); }
});

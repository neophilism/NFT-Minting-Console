import { open } from 'node:fs/promises';
import { verifyPublicFiles, PublicReadbackError } from '../console/publication/readback.mjs';

// No publication endpoint, private credentials or signing key is used.
try {
  const [file, gateway = 'pinata', ...extra] = process.argv.slice(2);
  if (!file || extra.length) throw new Error('usage');
  const handle = await open(file, 'r');
  let bytes;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 16384) throw new Error('manifest');
    const buffer = Buffer.alloc(16385);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 16384) throw new Error('manifest');
    bytes = buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const result = await verifyPublicFiles(manifest, { gateway });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  process.stderr.write(error instanceof PublicReadbackError ? error.message + '\n' : 'Usage: npm run public:verify -- <public-manifest.json> [pinata|ipfs|dweb]. Supply a bounded, valid public manifest.\n');
  process.exitCode = 1;
}

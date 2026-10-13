import { createHash } from 'node:crypto';
import { publicIpfsUri } from './ipfs-uri.mjs';

const gateways = Object.freeze({ pinata: 'https://gateway.pinata.cloud/ipfs/', ipfs: 'https://ipfs.io/ipfs/', dweb: 'https://dweb.link/ipfs/' });
const limits = Object.freeze({ metadata: 128 * 1024, rights: 8 * 1024 * 1024, image: 32 * 1024 * 1024, media: 2 * 1024 * 1024 * 1024 });
export class PublicReadbackError extends Error {
  constructor(code) { super('Public file verification failed: ' + code); this.name = 'PublicReadbackError'; this.code = code; }
}
const fail = code => { throw new PublicReadbackError(code); };
function plain(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('INVALID_MANIFEST');
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!keys.includes(key) || !descriptor?.enumerable || !('value' in descriptor)) fail('INVALID_MANIFEST');
  }
}
/** Copy and validate every commitment before making any network request. */
export function publicFileManifest(input) {
  plain(input, ['version', 'publicDisclosureConfirmed', 'files']);
  if (input.version !== 1 || input.publicDisclosureConfirmed !== true || !Array.isArray(input.files) || input.files.length < 1 || input.files.length > 4) fail('INVALID_MANIFEST');
  if (Object.getPrototypeOf(input.files) !== Array.prototype || Reflect.ownKeys(input.files).length !== input.files.length + 1) fail('INVALID_MANIFEST');
  for (let i = 0; i < input.files.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(input.files, String(i));
    if (!descriptor?.enumerable || !('value' in descriptor)) fail('INVALID_MANIFEST');
  }
  const kinds = new Set();
  const files = input.files.map(file => {
    plain(file, ['kind', 'uri', 'sha256', 'byteLength']);
    if (!Object.hasOwn(limits, file.kind) || kinds.has(file.kind)) fail('INVALID_MANIFEST');
    kinds.add(file.kind);
    let uri; try { uri = publicIpfsUri(file.uri); } catch { fail('INVALID_URI'); }
    if (typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256)) fail('INVALID_DIGEST');
    if (!Number.isSafeInteger(file.byteLength) || file.byteLength < 1 || file.byteLength > limits[file.kind]) fail('INVALID_LENGTH');
    return Object.freeze({ kind: file.kind, uri, sha256: file.sha256, byteLength: file.byteLength });
  });
  return Object.freeze(files);
}

/**
 * Read already-public content and compare it to independent reviewed digests.
 * Never uploads, signs, logs response content, buffers entire files or trusts
 * a gateway's ETag/CID header as proof. No CAR/DAG traversal claim is made.
 */
export async function verifyPublicFiles(manifest, { gateway = 'pinata', fetchImpl = globalThis.fetch, timeoutMs = 60000, signal } = {}) {
  const files = publicFileManifest(manifest);
  if (!Object.hasOwn(gateways, gateway) || typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 300000) fail('INVALID_TRANSPORT');
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) fail('CANCELLED');
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs), observations = [];
  let reader;
  try {
    for (const file of files) {
      if (controller.signal.aborted) fail(signal?.aborted ? 'CANCELLED' : 'TIMEOUT');
      const response = await fetchImpl(gateways[gateway] + file.uri.slice(7), {
        method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store',
        headers: { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity' }, signal: controller.signal,
      });
      if (controller.signal.aborted) fail(signal?.aborted ? 'CANCELLED' : 'TIMEOUT');
      if (response.status >= 300 && response.status < 400) fail('REDIRECT_REFUSED');
      if (response.status === 404) fail('NOT_FOUND');
      if (response.status === 429) fail('RATE_LIMITED');
      if (response.status !== 200) fail('HTTP_UNAVAILABLE');
      if (response.headers.get('content-range') !== null) fail('PARTIAL_CONTENT');
      const encoding = response.headers.get('content-encoding');
      if (encoding && encoding.toLowerCase() !== 'identity') fail('CONTENT_ENCODING_REFUSED');
      const length = response.headers.get('content-length');
      if (length !== null && (length.length > 16 || !/^[0-9]+$/.test(length) || BigInt(length) !== BigInt(file.byteLength))) fail('LENGTH_MISMATCH');
      if (!response.body || typeof response.body.getReader !== 'function') fail('NO_BODY');
      reader = response.body.getReader();
      let count = 0; const digest = createHash('sha256');
      for (;;) {
        const next = await reader.read();
        if (controller.signal.aborted) fail(signal?.aborted ? 'CANCELLED' : 'TIMEOUT');
        if (next.done) break;
        if (!(next.value instanceof Uint8Array)) fail('INVALID_BODY');
        count += next.value.byteLength;
        if (count > file.byteLength) fail('LENGTH_MISMATCH');
        digest.update(next.value);
      }
      reader.releaseLock(); reader = undefined;
      if (count !== file.byteLength) fail('LENGTH_MISMATCH');
      if (digest.digest('hex') !== file.sha256) fail('DIGEST_MISMATCH');
      observations.push(Object.freeze({ ...file, bytesVerified: true }));
    }
    return Object.freeze({ version: 1, gateway, files: Object.freeze(observations), bytesVerified: true,
      cidDagVerified: false, durableAvailabilityVerified: false, publicationAuthorized: false,
      mintAuthorized: false, listingVerified: false });
  } catch (error) {
    if (error instanceof PublicReadbackError) throw error;
    if (controller.signal.aborted) fail(signal?.aborted ? 'CANCELLED' : 'TIMEOUT');
    fail('NETWORK_UNAVAILABLE');
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort();
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}

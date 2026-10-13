import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { publicIpfsUri, supportedCid } from '../console/publication/ipfs-uri.mjs';
import { verifyPublicFiles, publicFileManifest, PublicReadbackError } from '../console/publication/readback.mjs';

const uri = 'ipfs://bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq';
const body = Buffer.from('\ufeffReviewed rights.\r\nExact bytes.  \n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const entry = (kind = 'rights', bytes = body) => ({ kind, uri: uri + '/' + kind, sha256: hash(bytes), byteLength: bytes.length });
const manifest = (files = [entry()]) => ({ version: 1, publicDisclosureConfirmed: true, files });
const code = expected => error => error instanceof PublicReadbackError && error.code === expected;
const response = (bytes = body, options = {}) => new Response(bytes, { status: 200, ...options });

test('compares original bytes and uses only fixed gateway GET requests without credentials', async () => {
  const requests = [];
  const result = await verifyPublicFiles(manifest(), { fetchImpl: async (url, options) => {
    requests.push({ url, options }); return response();
  } });
  assert.equal(result.bytesVerified, true);
  assert.equal(result.files[0].sha256, hash(body));
  assert.equal(result.files[0].byteLength, body.length);
  for (const flag of ['cidDagVerified', 'durableAvailabilityVerified', 'publicationAuthorized', 'mintAuthorized', 'listingVerified']) assert.equal(result[flag], false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://gateway.pinata.cloud/ipfs/' + uri.slice(7) + '/rights');
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.redirect, 'manual');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.body, undefined);
  assert.deepEqual(Object.keys(requests[0].options.headers).sort(), ['Accept', 'Accept-Encoding']);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.files) && Object.isFrozen(result.files[0]));
});
test('validates ALL entries and disclosure before making any network request', async () => {
  let calls = 0; const fetchImpl = async () => { calls++; return response(); };
  for (const bad of [{ ...manifest(), publicDisclosureConfirmed: false }, { ...manifest(), secret: 'private' },
    manifest([entry(), { ...entry('metadata'), sha256: 'wrong' }]), manifest([entry(), entry()]),
    manifest([{ ...entry(), byteLength: 8 * 1024 * 1024 + 1 }]), manifest([{ ...entry(), byteLength: 0 }]),
    manifest([{ ...entry(), byteLength: '32' }]), manifest([{ ...entry(), key: 'private' }]), manifest([])]) {
    await assert.rejects(verifyPublicFiles(bad, { fetchImpl }), PublicReadbackError);
  }
  assert.equal(calls, 0);
});
test('does not invoke hostile accessors or accept sparse/nonstandard arrays', () => {
  let called = false;
  const files = [entry()]; Object.defineProperty(files, '0', { enumerable: true, get() { called = true; throw Error('getter'); } });
  assert.throws(() => publicFileManifest(manifest(files)), code('INVALID_MANIFEST'));
  assert.equal(called, false);
  assert.throws(() => publicFileManifest(manifest(new Array(1))), code('INVALID_MANIFEST'));
  assert.throws(() => publicFileManifest(Object.create(manifest())), code('INVALID_MANIFEST'));
});
test('URI handling rejects SSRF, traversal, encoded separators, IPNS and secret query parameters', async () => {
  for (const bad of ['http://127.0.0.1/admin', 'https://evil.test', 'ipns://example.com', uri + '?key=secret',
    uri + '#fragment', uri + '/..', uri + '/%2e%2e', uri + '/a%2fb', uri + '/a%5cb', uri + '/%252e', uri + '/%00', uri + '//x', uri + '/%ed%a0%80']) {
    assert.throws(() => publicIpfsUri(bad));
    await assert.rejects(verifyPublicFiles(manifest([{ ...entry(), uri: bad }]), { fetchImpl() { throw Error('must not fetch'); } }), code('INVALID_URI'));
  }
  assert.equal(publicIpfsUri(uri + '/rights%20final.md'), uri + '/rights%20final.md');
  assert.ok(supportedCid(uri.slice(7)));
  assert.equal(supportedCid('b' + 'a'.repeat(58)), false);
});
test('mutation of the caller manifest after validation cannot change the checked commitment', async () => {
  const input = manifest();
  const result = await verifyPublicFiles(input, { fetchImpl: async () => {
    input.files[0].sha256 = '0'.repeat(64); input.files[0].uri = 'https://evil.test'; return response();
  } });
  assert.equal(result.files[0].sha256, hash(body));
  assert.equal(result.files[0].uri, uri + '/rights');
});
test('whitespace normalization or same-length substitution fails the exact-byte digest', async () => {
  const changed = Buffer.from(body); changed[changed.length - 2] = 33;
  await assert.rejects(verifyPublicFiles(manifest(), { fetchImpl: async () => response(changed) }), code('DIGEST_MISMATCH'));
});
test('short, long, lying length, compressed and partial responses fail closed', async () => {
  for (const [reply, expected] of [
    [response(body.subarray(1)), 'LENGTH_MISMATCH'], [response(Buffer.concat([body, body])), 'LENGTH_MISMATCH'],
    [response(body, { headers: { 'content-length': '999' } }), 'LENGTH_MISMATCH'],
    [response(body, { headers: { 'content-length': 'x' } }), 'LENGTH_MISMATCH'],
    [response(body, { headers: { 'content-encoding': 'gzip' } }), 'CONTENT_ENCODING_REFUSED'],
    [response(body, { headers: { 'content-range': 'bytes 0-31/500' } }), 'PARTIAL_CONTENT'],
    [response(body, { status: 206 }), 'HTTP_UNAVAILABLE'],
  ]) await assert.rejects(verifyPublicFiles(manifest(), { fetchImpl: async () => reply }), code(expected));
});
test('redirect, missing file, rate limit, server error and empty body are not success', async () => {
  for (const [status, expected] of [[302, 'REDIRECT_REFUSED'], [404, 'NOT_FOUND'], [429, 'RATE_LIMITED'], [500, 'HTTP_UNAVAILABLE']]) {
    await assert.rejects(verifyPublicFiles(manifest(), { fetchImpl: async () => response(body, { status }) }), code(expected));
  }
  await assert.rejects(verifyPublicFiles(manifest(), { fetchImpl: async () => new Response(null) }), code('NO_BODY'));
});
test('one bad file prevents a partial successful release report', async () => {
  let calls = 0;
  await assert.rejects(verifyPublicFiles(manifest([entry('rights'), entry('metadata')]), { fetchImpl: async () => {
    return response(++calls === 1 ? body : Buffer.alloc(body.length));
  } }), code('DIGEST_MISMATCH'));
});
test('unknown transports and bounds are rejected before network', async () => {
  for (const options of [{ gateway: 'https://127.0.0.1' }, { gateway: '__proto__' }, { timeoutMs: 0 }, { timeoutMs: 300001 }, { fetchImpl: 'no' }]) {
    await assert.rejects(verifyPublicFiles(manifest(), options), code('INVALID_TRANSPORT'));
  }
});
test('cancelled requests send no data and upstream exceptions are redacted', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(verifyPublicFiles(manifest(), { signal: controller.signal, fetchImpl: () => { throw Error('must not fetch'); } }), code('CANCELLED'));
  await assert.rejects(verifyPublicFiles(manifest(), { fetchImpl: async () => { throw Error('PRIVATE API SECRET'); } }), e => code('NETWORK_UNAVAILABLE')(e) && !e.message.includes('PRIVATE'));
});
test('oversized streams are cancelled instead of read to exhaustion', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(Buffer.alloc(body.length + 1)); }, cancel() { cancelled = true; } });
  await assert.rejects(verifyPublicFiles(manifest(), { fetchImpl: async () => response(stream) }), code('LENGTH_MISMATCH'));
  assert.equal(cancelled, true);
});
test('large media is hashed incrementally with multiple chunks', async () => {
  const chunk = Buffer.alloc(1024 * 1024, 42), digest = createHash('sha256');
  for (let i = 0; i < 64; i++) digest.update(chunk);
  let sent = 0;
  const stream = new ReadableStream({ pull(controller) { if (sent++ < 64) controller.enqueue(chunk); else controller.close(); } }, { highWaterMark: 1 });
  const result = await verifyPublicFiles(manifest([{ kind: 'media', uri, sha256: digest.digest('hex'), byteLength: 64 * chunk.length }]), { fetchImpl: async () => response(stream) });
  assert.equal(result.files[0].byteLength, 64 * 1024 * 1024);
});
test('actual HTTP stream and timeout obey the same hash and cancellation boundary', async t => {
  const server = createServer((req, res) => {
    if (req.url === '/stall') { res.writeHead(200); res.write(body.subarray(0, 1)); return; }
    res.writeHead(200); res.write(body.subarray(0, 5)); res.end(body.subarray(5));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const endpoint = 'http://127.0.0.1:' + server.address().port;
  // The production client still chooses the fixed gateway; ONLY this test adapter
  // maps it to a disposable local server. Arbitrary URLs are never an input.
  const good = await verifyPublicFiles(manifest(), { fetchImpl: (_url, options) => fetch(endpoint, options) });
  assert.equal(good.bytesVerified, true);
  await assert.rejects(verifyPublicFiles(manifest(), { timeoutMs: 30, fetchImpl: (_url, options) => fetch(endpoint + '/stall', options) }), code('TIMEOUT'));
});

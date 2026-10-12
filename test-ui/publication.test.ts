import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { inspectRights, prepareMetadata, validatePublicMetadata, sha256Exact, publicIpfsUri, supportedCid, MAX_RIGHTS_BYTES } from '../console/ui/src/publication.ts';

const CID = 'bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq';
const V0 = 'QmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n';
const URI = `ipfs://${CID}`;
const HASH = 'a'.repeat(64);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const metadata = () => ({ name: 'Independent art #1', description: 'An intentionally public description.', image: URI,
  attributes: [{ trait_type: 'Edition', value: 1 }], properties: {
    media_sha256: HASH, rights_uri: `${URI}/rights.md`, rights_sha256: HASH, rights_scope: 'token',
  } });

test('rights digest preserves original signed-off reference bytes', async () => {
  const bytes = await readFile(new URL('../reference/androids-of-the-vine/ANDROID_OF_THE_VINE_TOKEN_001_RIGHTS_FINAL.md', import.meta.url));
  const result = await inspectRights(new File([new Uint8Array(bytes)], 'rights.md', { type: 'text/markdown' }));
  assert.equal(result.sha256, '0ddcfae9f5fc2d2e059ed12e7a33ea5815e00a64e70930485602bc73f3f374c9');
  assert.equal(result.byteLength, bytes.byteLength);
  assert.ok(Object.isFrozen(result));
});
test('spaces, BOM, CRLF and final newline are not normalized before hashing', async () => {
  const content = '\ufeff  Exact rights\r\n\r\n';
  const bytes = new TextEncoder().encode(content);
  const result = await inspectRights(new File([bytes], 'terms.txt', { type: 'text/plain' }));
  assert.equal(result.sha256, digest(bytes));
  assert.equal(result.preview, content);
  assert.notEqual(result.sha256, digest(new TextEncoder().encode(content.trim())));
});
test('hashing owns its bytes while the digest promise is pending', async () => {
  const bytes = new Uint8Array([1, 2, 3]); const original = digest(bytes);
  const pending = sha256Exact(bytes); bytes.fill(9);
  assert.equal(await pending, original);
});
test('PDF is hashed but its content is not rendered', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.7\n<script>synthetic</script>');
  const result = await inspectRights(new File([bytes], 'terms.pdf', { type: 'application/pdf' }));
  assert.equal(result.sha256, digest(bytes)); assert.equal(result.preview, ''); assert.equal(result.format, 'pdf');
});
test('fake PDF, invalid UTF-8 and binary text fail without conversion', async () => {
  await assert.rejects(inspectRights(new File(['not a PDF'], 'terms.pdf', { type: 'application/pdf' })), /PDF header/);
  await assert.rejects(inspectRights(new File([new Uint8Array([255, 255])], 'terms.txt')), /UTF-8/);
  await assert.rejects(inspectRights(new File(['text\0private'], 'terms.txt')), /binary/);
});
test('unsupported and mismatched rights types are rejected', async () => {
  for (const [name, type] of [['terms.html', 'text/html'], ['terms.txt', 'text/html'], ['terms.pdf', 'text/plain']]) {
    await assert.rejects(inspectRights(new File(['sample'], name!, { type: type! })));
  }
});
test('empty and excessive rights files fail before their bytes are read', async () => {
  for (const size of [0, MAX_RIGHTS_BYTES + 1, Number.NaN, 0.5]) {
    let read = false;
    await assert.rejects(inspectRights({ name: 'terms.txt', type: 'text/plain', size, arrayBuffer: async () => { read = true; return new ArrayBuffer(0); } }));
    assert.equal(read, false);
  }
});
test('reported rights length must match the actual bytes', async () => {
  await assert.rejects(inspectRights({ name: 'terms.txt', type: 'text/plain', size: 10, arrayBuffer: async () => new ArrayBuffer(5) }), /changed/);
});
test('aborted and stale asynchronous file reads never return a review', async () => {
  const before = new AbortController(); before.abort();
  await assert.rejects(inspectRights(new File(['terms'], 'terms.txt'), before.signal), { name: 'AbortError' });
  const during = new AbortController();
  await assert.rejects(inspectRights({ name: 'terms.txt', type: 'text/plain', size: 5,
    arrayBuffer: async () => { during.abort(); return new TextEncoder().encode('terms').buffer; } }, during.signal), { name: 'AbortError' });
});
test('large text has a bounded preview but a full-file digest', async () => {
  const bytes = new TextEncoder().encode('rights '.repeat(4000));
  const result = await inspectRights(new File([bytes], 'terms.txt'));
  assert.equal(result.preview.length, 8192); assert.equal(result.previewTruncated, true);
  assert.equal(result.sha256, digest(bytes));
});
test('CIDv0 and supported CIDv1 encodings pass structural checks', () => {
  assert.equal(supportedCid(CID), true); assert.equal(supportedCid(V0), true);
  assert.equal(publicIpfsUri(`${URI}/folder/rights%20final.md`), `${URI}/folder/rights%20final.md`);
  assert.equal(publicIpfsUri(`ipfs://${V0}`), `ipfs://${V0}`);
});
for (const bad of ['REPLACE_WITH_CID', 'b' + 'a'.repeat(58), CID.toUpperCase(), CID.slice(0, -1), CID.slice(0, -1) + 'r', 'Qm' + '1'.repeat(44)]) {
  test(`rejects unsupported or malformed CID ${bad.slice(0, 10)}`, () => assert.equal(supportedCid(bad), false));
}
for (const suffix of ['/..', '/.', '/%2e%2e/file', '/%252e%252e', '//file', '/file?secret=1', '/file#secret', '/%2Fprivate', '/%5cprivate', '/%00', '/%ff', '/']) {
  test(`rejects unsafe or ambiguous content path ${suffix}`, () => assert.throws(() => publicIpfsUri(URI + suffix)));
}
test('mutable and credential-bearing URLs are not accepted as public content addresses', () => {
  for (const uri of ['https://example.com/file', 'https://secret@example.com/file', 'data:text/html,private', 'javascript:alert(1)', 'ipns://name', `ipfs://user@${CID}`, URI + '\\file']) {
    assert.throws(() => publicIpfsUri(uri));
  }
});
test('metadata includes only its supported public fields with exact rights binding', async () => {
  const preview = await prepareMetadata(metadata(), HASH);
  const bytes = new TextEncoder().encode(preview.json);
  assert.equal(preview.sha256, digest(bytes)); assert.equal(preview.byteLength, bytes.length);
  assert.equal(JSON.parse(preview.json).properties.rights_sha256, HASH);
  assert.equal(preview.json.endsWith('\n'), true); assert.ok(Object.isFrozen(preview));
});
test('prepared output is a snapshot unaffected by subsequent object mutation', async () => {
  const input = metadata(); const pending = prepareMetadata(input, HASH);
  input.name = 'changed'; input.properties.rights_sha256 = 'b'.repeat(64);
  const result = await pending; assert.equal(JSON.parse(result.json).name, 'Independent art #1');
});
test('top-level private collector fields are rejected rather than silently stripped', () => {
  for (const key of ['collector', 'email', 'deviceKey', 'recovery', 'membership', 'private_draft', '__proto__']) {
    const input = metadata(); Object.defineProperty(input, key, { value: 'private-value-never-echo', enumerable: true });
    assert.throws(() => validatePublicMetadata(input, HASH), error => error instanceof Error && !error.message.includes('private-value-never-echo'));
  }
});
test('private fields in properties and traits are rejected', () => {
  assert.throws(() => validatePublicMetadata({ ...metadata(), properties: { ...metadata().properties, collector_email: 'private' } }, HASH));
  assert.throws(() => validatePublicMetadata({ ...metadata(), attributes: [{ trait_type: 'Art', value: 'public', private_contact: 'private' }] }, HASH));
});
test('prototype inheritance, symbols and getter-backed public data are rejected', () => {
  assert.throws(() => validatePublicMetadata(Object.create(metadata()), HASH));
  const symbol = { ...metadata(), [Symbol('hidden')]: 'private' }; assert.throws(() => validatePublicMetadata(symbol, HASH));
  let invoked = false;
  const getter = metadata(); Object.defineProperty(getter, 'name', { get() { invoked = true; return 'private'; }, enumerable: true });
  assert.throws(() => validatePublicMetadata(getter, HASH)); assert.equal(invoked, false);
});
test('sparse, extended and accessor-backed trait arrays fail closed', () => {
  assert.throws(() => validatePublicMetadata({ ...metadata(), attributes: new Array(1) }, HASH));
  const extras = Object.assign([], { private_field: 'secret' });
  assert.throws(() => validatePublicMetadata({ ...metadata(), attributes: extras }, HASH));
  const getters = new Array(1); Object.defineProperty(getters, '0', { get() { throw new Error('must-not-read'); }, enumerable: true });
  assert.throws(() => validatePublicMetadata({ ...metadata(), attributes: getters }, HASH), /public traits/);
});
test('rights mismatch, malformed digests and unspecified scope fail', () => {
  assert.throws(() => validatePublicMetadata(metadata(), 'b'.repeat(64)), /exact rights/);
  for (const props of [{ media_sha256: '0x' + HASH }, { rights_scope: '' }, { rights_sha256: HASH.toUpperCase() }]) {
    assert.throws(() => validatePublicMetadata({ ...metadata(), properties: { ...metadata().properties, ...props } }, HASH));
  }
});
test('video/audio requires an explicit separate poster digest', () => {
  assert.throws(() => validatePublicMetadata({ ...metadata(), animation_url: URI }, HASH), /poster/);
  const result = validatePublicMetadata({ ...metadata(), animation_url: URI,
    properties: { ...metadata().properties, poster_sha256: HASH } }, HASH);
  assert.equal(result.animation_url, URI);
  assert.throws(() => validatePublicMetadata({ ...metadata(), properties: { ...metadata().properties, poster_sha256: HASH } }, HASH), /separate media/);
});
test('traits support bounded public strings and safe numbers', () => {
  const value = { ...metadata(), attributes: [{ trait_type: 'Score', value: 1.5, display_type: 'number', max_value: 10 }] };
  assert.equal(validatePublicMetadata(value, HASH).attributes[0]?.value, 1.5);
  for (const invalid of [NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, {}, null]) {
    assert.throws(() => validatePublicMetadata({ ...metadata(), attributes: [{ trait_type: 'Score', value: invalid }] }, HASH));
  }
  assert.throws(() => validatePublicMetadata({ ...metadata(), attributes: [{ trait_type: 'Score', value: '1', display_type: 'number' }] }, HASH));
});
test('oversized data, control characters and malformed Unicode fail', async () => {
  for (const name of ['', 'x'.repeat(201), 'title\0private', '\ud800']) assert.throws(() => validatePublicMetadata({ ...metadata(), name }, HASH));
  assert.throws(() => validatePublicMetadata({ ...metadata(), attributes: Array.from({ length: 101 }, () => ({ trait_type: 'n', value: 'x' })) }, HASH));
  await assert.rejects(prepareMetadata({ ...metadata(), description: 'x'.repeat(12000),
    attributes: Array.from({ length: 100 }, () => ({ trait_type: 'n'.repeat(120), value: '\\'.repeat(1000) })) }, HASH), /128 KiB/);
});
test('free text remains literal public data, not a claim of automatic personal-data detection', () => {
  const name = '<script>alert("text only")</script>';
  assert.equal(validatePublicMetadata({ ...metadata(), name }, HASH).name, name);
});

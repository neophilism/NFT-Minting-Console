import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReleaseWrappingKey } from '../console/crypto/workspace.mjs';
import { createEncryptedRelease, readEncryptedRelease } from '../console/crypto/draft-api.mjs';
const id = 'f747414c-e7dd-4c17-946c-f330ea7f7e79';
const draft = { name: 'Hidden release title', rights: 'Private rights text' };
test('authenticated transport sees only ciphertext and can return the private draft to the key holder', async () => {
  const wrappingKey = await createReleaseWrappingKey();
  let stored;
  const request = async (path, options) => {
    assert.match(path, /^\/api\/releases/);
    if (options?.method === 'POST') {
      assert.deepEqual(Object.keys(options.body), ['id', 'ciphertext', 'nonce']);
      assert(!JSON.stringify(options.body).includes(draft.name));
      stored = options.body;
      return { ...stored, revision: '1', created: true };
    }
    return { ...stored, revision: '1' };
  };
  assert.deepEqual(await createEncryptedRelease(draft, { id, wrappingKey, request }), { id, revision: '1', created: true });
  assert.deepEqual(await readEncryptedRelease(id, { wrappingKey, request }), { id, revision: '1', draft });
});
test('rejects server substitutions, malformed revisions and unavailable key', async () => {
  const wrappingKey = await createReleaseWrappingKey();
  const response = { id, ciphertext: 'bad', nonce: 'bad', revision: '1' };
  await assert.rejects(createEncryptedRelease(draft, { id, wrappingKey, request: async () => response }));
  await assert.rejects(readEncryptedRelease(id, { wrappingKey, request: async () => ({ ...response, revision: '0' }) }));
  await assert.rejects(readEncryptedRelease(id, { wrappingKey, request: async () => ({ ...response, id: 'other' }) }));
  await assert.rejects(createEncryptedRelease(draft, { id, request: async () => response }));
});

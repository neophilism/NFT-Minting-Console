/** Client boundary for opaque release records. The request function should be
 * the authenticated same-origin API client; it never receives plaintext. */
import { openReleaseDraft, sealReleaseDraft } from './workspace.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = () => { throw new Error('Encrypted release response failed validation.'); };
function transport(request, id, wrappingKey) {
  if (typeof request !== 'function' || typeof id !== 'string' || !UUID.test(id) ||
      !(wrappingKey instanceof CryptoKey)) fail();
}
function record(value, id) {
  if (!value || typeof value !== 'object' || value.id !== id ||
      typeof value.ciphertext !== 'string' || typeof value.nonce !== 'string' ||
      typeof value.revision !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value.revision)) fail();
  return value;
}
export async function createEncryptedRelease(draft, { id, wrappingKey, request } = {}) {
  transport(request, id, wrappingKey);
  const sealed = await sealReleaseDraft(draft, { id, wrappingKey });
  const returned = record(await request('/api/releases', { method: 'POST', body: sealed }), id);
  if (returned.ciphertext !== sealed.ciphertext || returned.nonce !== sealed.nonce) fail();
  return Object.freeze({ id, revision: returned.revision, created: returned.created === true });
}
export async function readEncryptedRelease(id, { wrappingKey, request } = {}) {
  transport(request, id, wrappingKey);
  const returned = record(await request(`/api/releases/${id}`), id);
  const draft = await openReleaseDraft(returned, { expectedId: id, wrappingKey });
  return Object.freeze({ id, revision: returned.revision, draft });
}

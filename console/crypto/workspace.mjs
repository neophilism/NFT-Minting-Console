/** Client-only release envelope. The server receives id, ciphertext and nonce;
 * the wrapping key must come from an independently authorized client key flow. */
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PLAINTEXT = 24 * 1024;
const HEADER_SIZE = 1 + 12 + 48;
const fail = () => { throw new Error('Release draft validation failed.'); };
const random = size => globalThis.crypto.getRandomValues(new Uint8Array(size));
const aad = (domain, id) => encoder.encode(`${domain}\u0000${id}`);
const base64 = bytes => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
function decodeBase64(value, min, max) {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail();
  let binary;
  try { binary = atob(value); } catch { fail(); }
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (bytes.length < min || bytes.length > max || base64(bytes) !== value) fail();
  return bytes;
}
function validateKey(key) {
  if (!(key instanceof CryptoKey) || key.type !== 'secret' || key.extractable ||
      key.algorithm.name !== 'AES-GCM' || key.algorithm.length !== 256 ||
      !key.usages.includes('encrypt') || !key.usages.includes('decrypt')) fail();
}
function validateId(id) { if (typeof id !== 'string' || !UUID.test(id)) fail(); }

/** The caller retains this non-extractable wrapping key on the trusted client.
 * Device authorization, transfer and recovery are separate NFT-11 work. */
export async function createReleaseWrappingKey() {
  return globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealReleaseDraft(draft, { id, wrappingKey } = {}) {
  validateId(id); validateKey(wrappingKey);
  if (!draft || typeof draft !== 'object' || Array.isArray(draft) || Object.getPrototypeOf(draft) !== Object.prototype) fail();
  let plaintext;
  try { plaintext = encoder.encode(JSON.stringify(draft)); } catch { fail(); }
  if (plaintext.length < 2 || plaintext.length > MAX_PLAINTEXT) fail();
  const rawKey = random(32), wrapNonce = random(12), nonce = random(12);
  try {
    const contentKey = await globalThis.crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
    const wrapped = new Uint8Array(await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: wrapNonce, additionalData: aad('NFT-CONSOLE-RELEASE-KEY-v1', id), tagLength: 128 }, wrappingKey, rawKey));
    const encrypted = new Uint8Array(await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: aad('NFT-CONSOLE-RELEASE-DRAFT-v1', id), tagLength: 128 }, contentKey, plaintext));
    const envelope = new Uint8Array(HEADER_SIZE + encrypted.length);
    envelope[0] = 1; envelope.set(wrapNonce, 1); envelope.set(wrapped, 13); envelope.set(encrypted, HEADER_SIZE);
    return Object.freeze({ id, ciphertext: base64(envelope), nonce: base64(nonce) });
  } finally { rawKey.fill(0); plaintext.fill(0); }
}

/** Open only a release fetched under an authenticated session and expected ID.
 * A compromised server can deny or replay data; it cannot decrypt with only
 * this envelope. Callers must compare the server revision separately. */
export async function openReleaseDraft(record, { expectedId, wrappingKey } = {}) {
  validateId(expectedId); validateKey(wrappingKey);
  if (!record || typeof record !== 'object' || record.id !== expectedId) fail();
  const envelope = decodeBase64(record.ciphertext, HEADER_SIZE + 18, 32768);
  const nonce = decodeBase64(record.nonce, 12, 12);
  if (envelope[0] !== 1) fail();
  let rawKey, plaintext;
  try {
    rawKey = new Uint8Array(await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: envelope.slice(1, 13), additionalData: aad('NFT-CONSOLE-RELEASE-KEY-v1', expectedId), tagLength: 128 },
      wrappingKey, envelope.slice(13, HEADER_SIZE)));
    if (rawKey.length !== 32) fail();
    const contentKey = await globalThis.crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
    plaintext = new Uint8Array(await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: aad('NFT-CONSOLE-RELEASE-DRAFT-v1', expectedId), tagLength: 128 },
      contentKey, envelope.slice(HEADER_SIZE)));
    if (plaintext.length > MAX_PLAINTEXT) fail();
    const value = JSON.parse(decoder.decode(plaintext));
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
    return value;
  } catch { fail(); }
  finally { rawKey?.fill(0); plaintext?.fill(0); }
}

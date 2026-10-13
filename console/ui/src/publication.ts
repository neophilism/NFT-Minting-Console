/** Client-only public-data preparation. No network, persistence, signing or E2EE. */
export const MAX_RIGHTS_BYTES = 8 * 1024 * 1024;
export const MAX_METADATA_BYTES = 128 * 1024;
const encoder = new TextEncoder();
const HASH = /^[0-9a-f]{64}$/;
import { publicIpfsUri } from '../../publication/ipfs-uri.mjs';
export { publicIpfsUri, supportedCid } from '../../publication/ipfs-uri.mjs';

export interface RightsDocument {
  readonly name: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly format: 'text' | 'pdf';
  readonly preview: string;
  readonly previewTruncated: boolean;
}
export interface PublicAttribute {
  trait_type: string;
  value: string | number;
  display_type?: 'number' | 'boost_number' | 'boost_percentage' | 'date';
  max_value?: number;
}
export interface PublicMetadata {
  name: string;
  description: string;
  image: string;
  animation_url?: string;
  attributes: PublicAttribute[];
  properties: {
    media_sha256: string;
    poster_sha256?: string;
    rights_uri: string;
    rights_sha256: string;
    rights_scope: 'collection' | 'token';
  };
}
export interface MetadataPreview {
  readonly json: string;
  readonly sha256: string;
  readonly byteLength: number;
}
function invalid(field: string): never { throw new Error(`Check ${field}. Only explicitly supported public fields are allowed.`); }
function plain(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(field);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !keys.includes(key)) invalid(field);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid(field);
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number, field: string, multiline = false, empty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim())) invalid(field);
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if ((code < 32 && !(multiline && [9, 10, 13].includes(code))) || code === 127 ||
        (code >= 0xd800 && code <= 0xdfff)) invalid(field);
  }
  return value;
}
function hash(value: unknown, field: string): string {
  if (typeof value !== 'string' || !HASH.test(value)) invalid(field);
  return value;
}
export async function sha256Exact(bytes: Uint8Array): Promise<string> {
  // Own the bytes across the asynchronous digest so callers cannot change the input in flight.
  const copy = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('File review cancelled.', 'AbortError');
}
export async function inspectRights(file: Pick<File, 'name' | 'type' | 'size' | 'arrayBuffer'>, signal?: AbortSignal): Promise<RightsDocument> {
  cancelled(signal);
  const name = text(file.name, 255, 'the rights filename');
  if (/[\\/]/.test(name) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_RIGHTS_BYTES) {
    throw new Error('Choose a nonempty rights document no larger than 8 MiB.');
  }
  const pdf = /\.pdf$/i.test(name), readable = /\.(txt|md)$/i.test(name);
  if ((!pdf && !readable) || (pdf && !['', 'application/pdf'].includes(file.type)) ||
      (readable && !['', 'text/plain', 'text/markdown'].includes(file.type))) {
    throw new Error('Choose a UTF-8 .txt/.md document or a PDF with a matching file type.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer()); cancelled(signal);
  if (bytes.byteLength !== file.size) throw new Error('The rights document changed while it was being read.');
  let preview = '';
  if (pdf) {
    if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new Error('The selected file does not have a PDF header.');
  } else {
    try { preview = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new Error('The text document must contain valid UTF-8 bytes. No conversion was performed.'); }
    if (preview.includes(String.fromCharCode(0))) throw new Error('The text document contains binary data.');
  }
  const sha256 = await sha256Exact(bytes); cancelled(signal);
  return Object.freeze({ name, byteLength: bytes.byteLength, sha256, format: pdf ? 'pdf' : 'text',
    preview: preview.slice(0, 8192), previewTruncated: preview.length > 8192 });
}
function attribute(value: unknown): PublicAttribute {
  const row = plain(value, ['trait_type', 'value', 'display_type', 'max_value'], 'a public trait');
  const trait_type = text(row.trait_type, 120, 'the trait name');
  const numeric = typeof row.value === 'number';
  if (numeric && (!Number.isFinite(row.value) || Math.abs(row.value as number) > Number.MAX_SAFE_INTEGER)) invalid('the trait value');
  const result: PublicAttribute = { trait_type, value: numeric ? row.value as number : text(row.value, 1000, 'the trait value') };
  if (row.display_type !== undefined) {
    if (!['number', 'boost_number', 'boost_percentage', 'date'].includes(row.display_type as string) || !numeric) invalid('the trait display type');
    result.display_type = row.display_type as PublicAttribute['display_type'];
  }
  if (row.max_value !== undefined) {
    if (!numeric || typeof row.max_value !== 'number' || !Number.isFinite(row.max_value) ||
        Math.abs(row.max_value) > Number.MAX_SAFE_INTEGER || row.max_value < (row.value as number)) invalid('the trait maximum');
    result.max_value = row.max_value;
  }
  return result;
}
/** No collector, contact, eligibility, device or secret fields can be serialized by this schema. */
export function validatePublicMetadata(value: unknown, expectedRightsSha256: string): PublicMetadata {
  const row = plain(value, ['name', 'description', 'image', 'animation_url', 'attributes', 'properties'], 'the public metadata');
  const props = plain(row.properties, ['media_sha256', 'poster_sha256', 'rights_uri', 'rights_sha256', 'rights_scope'], 'the public properties');
  hash(expectedRightsSha256, 'the reviewed rights digest');
  const rightsHash = hash(props.rights_sha256, 'the rights digest');
  if (rightsHash !== expectedRightsSha256) throw new Error('The metadata does not refer to the exact rights document reviewed.');
  if (!['collection', 'token'].includes(props.rights_scope as string)) throw new Error('Choose whether these rights apply to the collection or this token.');
  if (!Array.isArray(row.attributes) || row.attributes.length > 100 ||
      Object.getPrototypeOf(row.attributes) !== Array.prototype || Reflect.ownKeys(row.attributes).length !== row.attributes.length + 1 ||
      Object.getOwnPropertySymbols(row.attributes).length !== 0) invalid('the public traits');
  for (let i = 0; i < row.attributes.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(row.attributes, String(i));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid('the public traits');
  }
  const result: PublicMetadata = {
    name: text(row.name, 200, 'the token name'),
    description: text(row.description, 12000, 'the public description', true, true),
    image: publicIpfsUri(row.image, 'the public image URI'),
    attributes: row.attributes.map(attribute),
    properties: {
      media_sha256: hash(props.media_sha256, 'the media SHA-256'),
      rights_uri: publicIpfsUri(props.rights_uri, 'the public rights URI'),
      rights_sha256: rightsHash,
      rights_scope: props.rights_scope as 'collection' | 'token',
    },
  };
  if (row.animation_url !== undefined) result.animation_url = publicIpfsUri(row.animation_url, 'the public media URI');
  if (props.poster_sha256 !== undefined) result.properties.poster_sha256 = hash(props.poster_sha256, 'the poster SHA-256');
  if (result.animation_url && !result.properties.poster_sha256) throw new Error('Video/audio metadata needs a separate poster SHA-256.');
  if (!result.animation_url && result.properties.poster_sha256) throw new Error('A separate poster digest requires a separate media URI.');
  if (encoder.encode(JSON.stringify(result)).byteLength > MAX_METADATA_BYTES) throw new Error('Public metadata exceeds the 128 KiB preparation limit.');
  return result;
}
export async function prepareMetadata(value: unknown, expectedRightsSha256: string): Promise<MetadataPreview> {
  const metadata = validatePublicMetadata(value, expectedRightsSha256);
  const json = JSON.stringify(metadata, null, 2) + '\n';
  const bytes = encoder.encode(json);
  if (bytes.byteLength > MAX_METADATA_BYTES) throw new Error('Public metadata exceeds the 128 KiB preparation limit.');
  return Object.freeze({ json, sha256: await sha256Exact(bytes), byteLength: bytes.byteLength });
}

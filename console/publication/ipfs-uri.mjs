/** Supported immutable public IPFS paths; never IPNS, URLs or query strings. */
const base58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base32 = 'abcdefghijklmnopqrstuvwxyz234567';
export function supportedCid(cid) {
  if (typeof cid !== 'string') return false;
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid)) {
    let number = 0n;
    for (const char of cid) number = number * 58n + BigInt(base58.indexOf(char));
    const hex = number.toString(16);
    return hex.length === 68 && hex.startsWith('1220');
  }
  if (!/^b[a-z2-7]{58}$/.test(cid)) return false;
  const bytes = []; let buffer = 0, bits = 0;
  for (const char of cid.slice(1)) {
    buffer = (buffer << 5) | base32.indexOf(char); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >>> bits) & 255); buffer &= (1 << bits) - 1; }
  }
  return buffer === 0 && bytes.length === 36 && bytes[0] === 1 &&
    (bytes[1] === 0x55 || bytes[1] === 0x70) && bytes[2] === 0x12 && bytes[3] === 32;
}
export function publicIpfsUri(value, field = 'the public IPFS URI') {
  const invalid = () => { throw new Error(`Check ${field}. Only explicitly supported public fields are allowed.`); };
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('ipfs://') || /[?#\\\s\u0000-\u001f\u007f]/u.test(value)) invalid();
  const [cid = '', ...path] = value.slice(7).split('/');
  if (!supportedCid(cid)) invalid();
  for (const segment of path) {
    if (!segment || !/^(?:[a-zA-Z0-9._~-]|%[0-9a-fA-F]{2})+$/.test(segment)) invalid();
    let decoded;
    try { decoded = decodeURIComponent(segment); } catch { invalid(); }
    if (decoded.length > 255 || decoded === '.' || decoded === '..' || /[/\\?#%\u0000-\u001f\u007f]/u.test(decoded)) invalid();
  }
  return value;
}

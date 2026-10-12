import { useEffect, useRef, useState } from 'react';
import './publication.css';
import { Notice } from './components';
import { inspectRights, prepareMetadata } from './publication';
import type { MetadataPreview, RightsDocument } from './publication';

const empty = () => ({ name: '', description: '', image: '', media: '', mediaHash: '', posterHash: '', rightsUri: '', scope: '' });
export function RightsWorkbench() {
  const [fields, setFields] = useState(empty), [rights, setRights] = useState<RightsDocument | null>(null);
  const [prepared, setPrepared] = useState<MetadataPreview | null>(null), [reviewed, setReviewed] = useState(false);
  const [preparing, setPreparing] = useState(false), [reading, setReading] = useState(false), [error, setError] = useState('');
  const busy = preparing || reading;
  const generation = useRef(0), fileGeneration = useRef(0), input = useRef<HTMLInputElement>(null), controller = useRef<AbortController | null>(null);
  const result = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => { generation.current++; fileGeneration.current++; controller.current?.abort(); }, []);
  useEffect(() => { if (prepared) result.current?.focus(); }, [prepared]);
  function invalidate() { generation.current++; setPrepared(null); setReviewed(false); setError(''); setPreparing(false); }
  function update(name: keyof typeof fields, value: string) { invalidate(); setFields(previous => ({ ...previous, [name]: value })); }
  async function select(file: File | undefined) {
    invalidate(); controller.current?.abort(); setRights(null); fileGeneration.current++; setReading(false);
    if (!file) return;
    const abort = new AbortController(); controller.current = abort;
    const version = fileGeneration.current; setReading(true);
    try { const document = await inspectRights(file, abort.signal); if (version === fileGeneration.current) setRights(document); }
    catch (cause) { if (version === fileGeneration.current) setError(cause instanceof Error ? cause.message : 'The rights document could not be read.'); }
    finally { if (version === fileGeneration.current) setReading(false); }
  }
  async function prepare() {
    if (!rights || !reviewed) { setError('Review the rights document and public-data disclosure before preparing metadata.'); return; }
    const version = generation.current; setPreparing(true); setError(''); setPrepared(null);
    try {
      const preview = await prepareMetadata({ name: fields.name, description: fields.description, image: fields.image,
        ...(fields.media ? { animation_url: fields.media } : {}), attributes: [], properties: {
          media_sha256: fields.mediaHash, ...(fields.posterHash ? { poster_sha256: fields.posterHash } : {}),
          rights_uri: fields.rightsUri, rights_sha256: rights.sha256, rights_scope: fields.scope,
        } }, rights.sha256);
      if (version === generation.current) setPrepared(preview);
    } catch (cause) { if (version === generation.current) setError(cause instanceof Error ? cause.message : 'The metadata could not be prepared.'); }
    finally { if (version === generation.current) setPreparing(false); }
  }
  function clear() {
    invalidate(); controller.current?.abort(); setRights(null); fileGeneration.current++; setReading(false); setFields(empty());
    if (input.current) input.current.value = '';
  }
  function download() {
    if (!prepared || !reviewed) return;
    const url = URL.createObjectURL(new Blob([prepared.json], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'nft-public-metadata.json';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const field = (name: keyof typeof fields, label: string, help: string, maximum = 2048) => <div className="field" key={name}>
    <label htmlFor={`public-${name}`}>{label}</label>
    <input id={`public-${name}`} value={fields[name]} maxLength={maximum} spellCheck={false} autoComplete="off"
      aria-describedby={`public-help-${name}`} onChange={event => update(name, event.target.value)}/>
    <small id={`public-help-${name}`}>{help}</small>
  </div>;
  return <section className="panel rights-workbench" aria-labelledby="rights-workbench-title">
    <div className="section-heading"><div><span className="eyebrow">LOCAL PREPARATION / NO UPLOAD</span><h2 id="rights-workbench-title">Rights &amp; public metadata</h2><p className="muted">Inspect exact rights bytes and prepare a public JSON file. Nothing is published by this tool.</p></div><span className="badge">Not saved</span></div>
    <Notice>Use test or already-public documents while private-workspace acceptance is pending. Files stay in this page's memory; reloading, signing out or leaving this screen clears the preparation. Hosted page code remains a trust boundary.</Notice>
    <div className="field"><label htmlFor="rights-file">Rights document</label><input id="rights-file" ref={input} type="file" accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf" aria-describedby="rights-file-help" onChange={event => void select(event.target.files?.[0])}/><small id="rights-file-help">UTF-8 text, Markdown or PDF, up to 8 MiB. Whitespace, line endings and original bytes are not changed. PDF contents are not rendered or validated here.</small></div>
    {rights && <div className="rights-summary"><dl className="preview-grid"><div><dt>Selected document</dt><dd>{rights.name}</dd></div><div><dt>Exact byte count</dt><dd>{rights.byteLength}</dd></div><div><dt>Rights SHA-256</dt><dd className="mono" data-testid="rights-digest">{rights.sha256}</dd></div></dl>{rights.format === 'text' && <details><summary>Inspect text preview</summary><pre className="public-json">{rights.preview}</pre>{rights.previewTruncated && <p>Preview truncated; the digest covers the entire original file. Review the full document separately.</p>}</details>}</div>}
    <div className="form-grid">
      {field('name', 'Public token name', 'Only the name intentionally shown to collectors.', 200)}
      <div className="field"><label htmlFor="public-scope">Rights scope</label><select id="public-scope" value={fields.scope} onChange={event => update('scope', event.target.value)}><option value="">Choose explicitly</option><option value="collection">Collection-wide terms</option><option value="token">This token's terms</option></select><small>Select the intended scope; this is not legal approval.</small></div>
      {field('image', 'Public image URI', 'An existing ipfs:// image or poster URI. No gateway is contacted.')}
      {field('rightsUri', 'Public rights URI', 'An existing ipfs:// URI for these exact rights. Retrieval is not yet verified.')}
      {field('media', 'Public video/audio URI (optional)', 'Leave empty for an image-only token. Otherwise supply a separate poster digest.')}
      {field('mediaHash', 'Media SHA-256', '64 lowercase hexadecimal characters for the original image, video or audio.', 64)}
      {field('posterHash', 'Poster SHA-256 (optional)', 'Required only when the video/audio URI is supplied.', 64)}
    </div>
    <div className="field"><label htmlFor="public-description">Public description</label><textarea id="public-description" value={fields.description} maxLength={12000} rows={4} onChange={event => update('description', event.target.value)} aria-describedby="public-description-help"/><small id="public-description-help">Free text is not automatically checked for personal information. Do not include collector contacts, private eligibility records, secrets or unapproved benefit promises.</small></div>
    <div className="publication-disclosure"><strong>Public means public.</strong><p>The prepared JSON includes the public name, description, media URIs/digests and rights URI/digest/scope. It contains no collector registry and grants no membership or investment benefits by default. A hash is not a legal opinion, a malware scan or proof that an IPFS URI matches a document.</p><label className="review-checkbox"><input type="checkbox" disabled={!rights || busy} checked={reviewed} onChange={event => { generation.current++; setReviewed(event.target.checked); setPrepared(null); setPreparing(false); }}/><span>I reviewed the complete rights document and the fields intended for public disclosure. They contain no confidential or private collector information.</span></label></div>
    {error && <Notice error>{error}</Notice>}
    {busy && <p role="status">Preparing exact-byte checks locally...</p>}
    <div className="form-actions"><button type="button" className="button secondary" onClick={clear}>Clear preparation</button><button type="button" className="button primary" disabled={busy || !rights || !reviewed} onClick={() => void prepare()}>Prepare metadata preview</button></div>
    {prepared && <div className="prepared-metadata"><h3 ref={result} tabIndex={-1}>Metadata prepared locally</h3><p>Not uploaded, minted or listed. Editing any input invalidates this preview.</p><dl className="preview-grid"><div><dt>Metadata SHA-256</dt><dd className="mono">{prepared.sha256}</dd></div><div><dt>Metadata bytes</dt><dd>{prepared.byteLength}</dd></div></dl><pre className="public-json" data-testid="public-json">{prepared.json}</pre><button type="button" className="button secondary" onClick={download}>Download prepared metadata</button></div>}
  </section>;
}

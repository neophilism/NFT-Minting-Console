import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { releasePage } from './model';
import type { Configuration, ReleasePage, ReleaseSummary, Session } from './model';
import { Icon, Notice, Modal, SignInPrompt } from './components';

export function ReleaseInventory({ current, config, connect, expired }: { current: Session | null; config: Configuration; connect: () => void; expired: () => void }) {
  const [result, setResult] = useState<ReleasePage | null>(null), [loadedFor, setLoadedFor] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [selected, setSelected] = useState<ReleaseSummary | null>(null);
  const token = current?.csrf || '', tokenRef = useRef(token), controller = useRef<AbortController | null>(null);
  tokenRef.current = token;
  const load = useCallback(async (after?: string) => {
    if (!token || !config.capabilities.opaqueReleaseApi) return;
    controller.current?.abort(); const control = new AbortController(); controller.current = control;
    setBusy(true); setError('');
    try {
      const value = releasePage(await api(`/api/releases?limit=24${after ? `&after=${encodeURIComponent(after)}` : ''}`, { signal: control.signal }));
      if (control.signal.aborted || tokenRef.current !== token) return;
      setResult(previous => after && previous ? { items: [...new Map([...previous.items, ...value.items].map(item => [item.id, item])).values()], nextCursor: value.nextCursor } : value);
      setLoadedFor(token);
    } catch (error) {
      if (control.signal.aborted || tokenRef.current !== token) return;
      if (error instanceof ApiError && [401, 403].includes(error.status)) expired();
      else setError(error instanceof Error ? error.message : 'The collection inventory is unavailable.');
    } finally { if (!control.signal.aborted && tokenRef.current === token) setBusy(false); }
  }, [token, config.capabilities.opaqueReleaseApi, expired]);
  useEffect(() => { setResult(null); setSelected(null); void load(); return () => controller.current?.abort(); }, [load]);
  if (!current) return <SignInPrompt connect={connect}/>;
  if (!config.capabilities.opaqueReleaseApi) return <div className="empty-state"><div className="empty-icon"><Icon name="layers"/></div><h2>Your release workspace is not connected</h2><p>A configured database is required to load release records. Private drafting and uploads remain unavailable until client encryption is accepted.</p><a className="button secondary" href="#/settings">View workspace settings <Icon name="arrow"/></a></div>;
  const items = loadedFor === token ? result?.items : undefined;
  return <>
    <div className="section-heading"><h2>Your releases</h2><button className="button subtle" onClick={() => void load()} disabled={busy}><Icon name="refresh"/>Refresh</button></div>
    {error && <Notice error>{error} <button className="text-button" onClick={() => void load()}>Retry</button></Notice>}
    {busy && !items && <p className="loading" role="status">Loading your release records...</p>}
    {!busy && items?.length === 0 && <div className="empty-state"><div className="empty-icon"><Icon name="layers"/></div><h2>A home for every collection</h2><p>No release records were returned for this signed-in account. Explore collection setup while the encrypted workspace is being completed.</p><a href="#/create" className="button primary">Plan a collection <Icon name="plus"/></a></div>}
    {items && items.length > 0 && <>
      <p className="muted inventory-note">{items.length} records loaded. Names and artwork are not loaded by this build. Recorded workflow stages are not verified marketplace listings.</p>
      <div className="collection-grid">{items.map(item => <article className="collection-card" key={item.id}>
        <div className="collection-art"><Icon name="lock"/><span>CONTENT NOT LOADED</span></div>
        <div className="collection-copy"><span className="eyebrow">RELEASE {item.id.slice(0, 8)}</span><h3>Release record</h3><p className="recorded-state">Recorded stage: {item.state.replaceAll('-', ' ')}</p><div className="card-bottom"><span>Revision {item.revision}</span><button className="text-button" onClick={() => setSelected(item)}>View record <Icon name="arrow"/></button></div></div>
      </article>)}</div>
      {result?.nextCursor && <button className="button secondary load-more" disabled={busy} onClick={() => void load(result.nextCursor || undefined)}>{busy ? 'Loading...' : 'Load more releases'}</button>}
    </>}
    {selected && <Modal title="Release record" close={() => setSelected(null)}><Notice>Private content cannot be unlocked in this build. No artwork was downloaded.</Notice><dl className="details"><dt>Release ID</dt><dd className="mono">{selected.id}</dd><dt>Recorded stage</dt><dd>{selected.state}</dd><dt>Revision</dt><dd>{selected.revision}</dd><dt>Last updated</dt><dd>{new Date(selected.updatedAt).toLocaleString()}</dd></dl><p className="muted">This record is not proof of deployment, ownership, an active listing or a completed sale.</p></Modal>}
  </>;
}

import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { readiness } from './model';
import type { Readiness, Session } from './model';
import { Icon, Notice, SignInPrompt } from './components';

export function ReleaseReadiness({ current, connect, expired }: { current: Session | null; connect: () => void; expired: () => void }) {
  const [data, setData] = useState<Readiness | null>(null), [error, setError] = useState(''), [version, setVersion] = useState(0);
  const token = current?.csrf;
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError('');
    if (token) api('/api/launch-readiness', { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setData(readiness(value)); })
      .catch(error => { if (!controller.signal.aborted) { if (error instanceof ApiError && [401, 403].includes(error.status)) expired(); else setError('Release readiness could not be loaded. Retry to get the current state.'); } });
    return () => controller.abort();
  }, [token, version, expired]);
  if (!current) return <SignInPrompt connect={connect}/>;
  return <>
    <div className="readiness-hero"><div><span className="eyebrow">RELEASE CHECKPOINT</span><h2>Review first. Publish deliberately.</h2><p>Private drafting, public publication, minting and marketplace orders are separate steps. This build does not authorize a production release.</p></div><div className="readiness-seal"><Icon name="check"/><span>Production<br/>not enabled</span></div></div>
    <div className="section-heading"><h2>Remaining acceptance gates</h2><button className="button subtle" onClick={() => setVersion(v => v + 1)}><Icon name="refresh"/>Refresh status</button></div>
    {error && <Notice error>{error}</Notice>}
    {!data && !error && <p className="loading" role="status">Loading current release gates...</p>}
    <div className="gate-list">{data?.blockers.map((item, index) => <article className="gate" key={item.id}><span className="gate-number">{String(index + 1).padStart(2, '0')}</span><div><span className="eyebrow">{item.milestones.join(' / ')}</span><h3>{item.id.split('-').map(x => x.charAt(0).toUpperCase() + x.slice(1)).join(' ')}</h3><p>{item.description}</p></div><span className="badge">Not accepted</span></article>)}</div>
    <Notice>Passing automated checks is not an independent audit. An OpenSea token link is not an active listing, and a minted token is not evidence of a sale.</Notice>
  </>;
}

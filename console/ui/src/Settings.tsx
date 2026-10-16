import { useState } from 'react';
import type { Configuration, Session } from './model';
import { Icon } from './components';

export function Settings({ config, current }: { config: Configuration; current: Session | null }) {
  const [copied, setCopied] = useState('');
  async function copyAddress() {
    if (!current) return;
    try { await navigator.clipboard.writeText(current.wallet); setCopied('Wallet address copied.'); }
    catch { setCopied('Copy was not available. Select the displayed public address to copy it.'); }
  }
  return <>
    <section className="panel"><div className="section-heading"><div><span className="eyebrow">WORKSPACE CONFIGURATION</span><h2>Know your environment</h2></div><Icon name="settings"/></div>
      <dl className="settings-list"><div><dt>Target network</dt><dd>{config.chainName} <span className="muted">/ Chain {config.chainId}</span></dd></div><div><dt>Authentication storage</dt><dd>{config.authStore === 'postgresql' ? 'PostgreSQL configured' : 'Development memory only'}</dd></div><div><dt>Authorized wallet login</dt><dd>{config.loginConfigured ? 'Configured' : 'Administrator setup required'}</dd></div><div><dt>Private drafting</dt><dd><span className="badge">Not implemented</span></dd></div><div><dt>Public pinning credentials</dt><dd>{config.pinningConfigured ? 'Configured, publication still gated' : 'Not configured'}</dd></div><div><dt>Public deployment &amp; minting</dt><dd><span className="badge">{config.capabilities.publicLaunch ? 'Configured' : 'Launch setup required'}</span></dd></div><div><dt>Automated marketplace listing</dt><dd><span className="badge">Not enabled</span></dd></div></dl>
    </section>
    <section className="panel"><span className="eyebrow">YOUR SESSION</span><h2>{current ? 'Connected wallet' : 'Not signed in'}</h2>{current ? <><p className="address-full mono">{current.wallet}</p><div className="session-details"><span className="badge">{current.role}</span><button className="text-button" onClick={() => void copyAddress()}>Copy public address</button></div><p role="status" className="muted">{copied}</p><p className="muted">Signing in does not give the console permission to transfer your assets, mint NFTs or sign a marketplace order.</p></> : <p className="muted">Connect an authorized wallet to access release records.</p>}</section>
    <section className="panel muted-panel"><h2>For development and rehearsal</h2><p>The existing local/Sepolia rehearsal tools remain available separately. They are not a production minting shortcut.</p><a className="button secondary" href="/legacy/">Open rehearsal tools <Icon name="arrow"/></a><p className="fine-print">Never enter a seed phrase or private key. Configure provider credentials only through backend secret managers.</p></section>
  </>;
}

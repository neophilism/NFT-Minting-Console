import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { emptyPlan, validatePlan } from './model';
import type { Configuration, Plan, Session } from './model';
import { Icon, Notice, SignInPrompt } from './components';
import { RightsWorkbench } from './RightsWorkbench';
import { CompanionPlanner } from './CompanionPlanner';

const labels: Record<keyof Plan, string> = { name: 'Collection name', symbol: 'Token symbol', supply: 'Maximum supply', royalty: 'Creator royalty (%)', price: 'Initial listing price (ETH)', owner: 'OWNER wallet', minter: 'MINTER wallet', recipient: 'Royalty recipient' };
type PlannerProps = { current: Session | null; config: Configuration; connect: () => void };
export function CollectionPlanner(props: PlannerProps) {
  const identity = `${props.current?.wallet || 'signed-out'}:${props.current?.chainId || 0}:${props.current?.csrf || ''}`;
  return <PlannerContent key={identity} {...props}/>;
}
function PlannerContent({ current, config, connect }: PlannerProps) {
  const [plan, setPlan] = useState<Plan>(() => ({ ...emptyPlan(), owner: current?.wallet || '', minter: current?.wallet || '', recipient: current?.wallet || '' }));
  const [errors, setErrors] = useState<Partial<Record<keyof Plan, string>>>({}), [preview, setPreview] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null), previewRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (Object.keys(errors).length) errorRef.current?.focus(); }, [errors]);
  useEffect(() => { if (preview) previewRef.current?.focus(); }, [preview]);
  useEffect(() => { setPlan({ ...emptyPlan(), owner: current?.wallet || '', minter: current?.wallet || '', recipient: current?.wallet || '' }); setPreview(false); setErrors({}); }, [current?.wallet]);
  if (!current) return <SignInPrompt connect={connect}/>;
  if (current.role !== 'owner') return <Notice>Collection setup is available to an authorized console owner. Your {current.role} account can inspect the release records shared with it.</Notice>;
  function submit(event: FormEvent) { event.preventDefault(); const problems = validatePlan(plan); setErrors(problems); if (!Object.keys(problems).length) setPreview(true); }
  const field = (name: keyof Plan, help: string, placeholder: string, inputMode?: 'decimal' | 'numeric') => <div className="field" key={name}>
    <label htmlFor={`plan-${name}`}>{labels[name]}</label><input id={`plan-${name}`} value={plan[name]} autoComplete="off" spellCheck={false} inputMode={inputMode}
      maxLength={name === 'name' ? 120 : name === 'symbol' ? 16 : 100} placeholder={placeholder} aria-invalid={Boolean(errors[name])} aria-describedby={`help-${name}${errors[name] ? ` error-${name}` : ''}`}
      onChange={event => setPlan(value => ({ ...value, [name]: event.target.value }))}/>
    <small id={`help-${name}`}>{help}</small>{errors[name] && <small className="field-error" id={`error-${name}`}>{errors[name]}</small>}
  </div>;
  return <>
    <Notice><strong>Local setup preview only.</strong> These fields are not saved or uploaded. Do not enter confidential information. Encrypted drafts, media uploads and publication are not yet enabled.</Notice>
    <div className="wizard-strip" aria-label="Release workflow"><span className="active"><b>01</b> Collection setup</span><span><b>02</b> Add your works <Icon name="lock"/></span><span><b>03</b> Review &amp; publish <Icon name="lock"/></span></div>
    {preview ? <section className="panel setup-preview"><div className="section-heading"><div><span className="eyebrow">LOCAL PREVIEW</span><h2 tabIndex={-1} ref={previewRef}>Review {plan.name.trim()}</h2></div><span className="badge">Nothing saved</span></div>
      <dl className="preview-grid">{(Object.keys(labels) as (keyof Plan)[]).map(name => <div key={name}><dt>{labels[name]}</dt><dd className={['owner','minter','recipient'].includes(name) ? 'mono' : ''}>{plan[name]}</dd></div>)}<div><dt>Target network</dt><dd>{config.chainName}</dd></div></dl>
      <Notice>This validates form inputs only, not contract safety, gas cost, ownership or marketplace compatibility. This summary does not publish rights or media, mint tokens, or create marketplace orders.</Notice>
      <div className="form-actions"><button className="button secondary" onClick={() => setPreview(false)}>Back to editing</button><button className="button primary" disabled><Icon name="lock"/>Save private release</button></div><p className="muted">Saving requires the accepted client-encryption workflow. Refreshing or leaving this screen discards the preview.</p>
    </section> : <form onSubmit={submit} className="panel planner" noValidate>
      <div className="section-heading"><div><span className="eyebrow">01 / COLLECTION IDENTITY</span><h2>Make it your collection</h2><p className="muted">Each release has its own name, supply, roles and rights.</p></div><span className="badge">{config.chainName}</span></div>
      {Object.keys(errors).length > 0 && <div className="error-summary" tabIndex={-1} ref={errorRef} role="alert"><strong>Check these fields before continuing.</strong><ul>{(Object.keys(errors) as (keyof Plan)[]).map(name => <li key={name}><a href={`#plan-${name}`} onClick={event => { event.preventDefault(); document.getElementById(`plan-${name}`)?.focus(); }}>{labels[name]}: {errors[name]}</a></li>)}</ul></div>}
      <div className="form-grid">{field('name','The collection name shown to collectors.','Name your collection')}{field('symbol','A short, recognizable token symbol.','e.g. ART')}{field('supply','A fixed maximum number of NFTs in this collection.','Choose a supply','numeric')}{field('royalty','An advertised royalty rate, not a guarantee on every transfer.','Choose a percentage','decimal')}{field('price','A marketplace listing preference, not an on-chain sale price.','Choose an ETH price','decimal')}</div>
      <div className="form-section"><span className="eyebrow">02 / ROLES &amp; PAYMENTS</span><h2>The right wallet for each role</h2><p className="muted">Collection ownership, minting and royalty payments can use separate wallets.</p></div>
      <div className="form-grid wallet-fields">{field('owner','Maintains the collection transfer policy.','0x...')}{field('minter','Mints NFTs to itself; never gives the server a signing key.','0x...')}{field('recipient','Receives the configured creator royalty.','0x...')}</div>
      <div className="form-actions"><p><Icon name="lock"/>No upload, signature or transaction at this step.</p><button className="button primary" type="submit">Review setup <Icon name="arrow"/></button></div>
    </form>}
    <RightsWorkbench key={`${current.wallet}:${current.chainId}:${current.csrf}`}/>
    <CompanionPlanner key={`companion:${current.wallet}:${current.chainId}:${current.csrf}`}/>
  </>;
}

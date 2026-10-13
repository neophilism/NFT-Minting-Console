import {useState} from 'react';
import {planCompanionCollection,renderCompanionExport,renderCompanionSchedule} from '../../companion/portfolio.mjs';
import type {CompanionPlan} from '../../companion/portfolio.mjs';
import {Notice} from './components';

/** Local-only AOTV example. Optional for every token and every independent release. */
const initialTitles=Array.from({length:40},(_,i)=>
  i===0?'Unsealed Records Music Playlist':i===1?'Live Debate Engine':'TO_BE_SELECTED_'+String(i+1).padStart(2,'0')).join('\n');
export function CompanionPlanner() {
  const [enabled,setEnabled]=useState(false);
  const [titles,setTitles]=useState(initialTitles);
  const [tokenSelection,setTokenSelection]=useState('all');
  const [plan,setPlan]=useState<CompanionPlan|null>(null);
  const [token,setToken]=useState(1);
  const [error,setError]=useState('');
  function changed(action:()=>void) {action();setPlan(null);setError('');}
  function preview() {
    setPlan(null);setError('');
    try {
      const lines=titles.split(/\r?\n/).map(line=>line.trim());
      if(lines.length!==40) throw new Error('Enter exactly 40 project names, one per line. Project titles may remain provisional.');
      const projects=lines.map((title,i)=>({id:'PROJECT-'+String(i+1).padStart(2,'0'),title,materials:[]}));
      const ids=tokenSelection.trim().toLowerCase()==='all'?undefined:(()=>{
        if(!/^\d+(?:\s*,\s*\d+)*$/.test(tokenSelection.trim())) throw new Error('Enter "all" or distinct comma-separated token IDs from 1 to 40.');
        return tokenSelection.split(',').map(x=>Number(x.trim()));
      })();
      const result=planCompanionCollection({enabled,projects,enabledTokenIds:ids});
      setPlan(result);
      setToken(result.assignments[0]?.tokenId??1);
    }catch(cause) {setError(cause instanceof Error?cause.message:'Could not prepare companion schedules.');}
  }
  function download() {
    if(!plan?.enabled)return;
    const content=JSON.stringify(renderCompanionExport(plan),null,2)+'\n';
    const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='aotv-companion-40-token-DRAFT.json';
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const schedule=plan?renderCompanionSchedule(plan,token):null;
  return <section className="panel" aria-labelledby="companion-plan-title">
    <div className="section-heading"><div><span className="eyebrow">OPTIONAL / LOCAL DRAFT TOOL</span>
      <h2 id="companion-plan-title">Companion project materials</h2>
      <p className="muted">Select whether this collection includes token-specific project-information packages. No investment rights or ongoing project services are included.</p>
    </div><span className="badge">Not saved</span></div>
    <label className="review-checkbox"><input type="checkbox" data-testid="companion-enable" checked={enabled} onChange={e=>changed(()=>setEnabled(e.target.checked))}/>
      <span>Include a fixed Creator's Companion Portfolio on selected tokens (optional)</span></label>
    {!enabled && <p className="muted" role="status">Off by default. No project information package or delivery obligation is added to the NFT.</p>}
    {enabled && <>
      <Notice>This Androids Of The Vine example plans 40 distinct projects with two per enabled NFT. To have each project appear exactly twice, all 40 tokens must be selected. Enter only publicly shareable project titles; the draft is not a final rights agreement.</Notice>
      <div className="field"><label htmlFor="companion-names">Forty projects, one title per line (in your preferred order)</label>
        <textarea id="companion-names" data-testid="companion-names" rows={8} value={titles} spellCheck={false}
          onChange={e=>changed(()=>setTitles(e.target.value))}/>
        <small>The first two names are provisional examples; replace or reorder all 40 as you choose. Each adjacent pair appears together on one NFT, with the last paired back to the first. No access to repositories is granted by a title.</small></div>
      <div className="field"><label htmlFor="companion-token-ids">Tokens receiving the benefit</label>
        <input id="companion-token-ids" data-testid="companion-token-ids" value={tokenSelection}
          onChange={e=>changed(()=>setTokenSelection(e.target.value))} spellCheck={false} autoComplete="off"/>
        <small>Type “all” for the fully balanced set of 40 or a comma-separated subset (for example, 1,2,3). Other tokens get no companion portfolio.</small></div>
      {error&&<Notice error>{error}</Notice>}
      <div className="form-actions"><button type="button" className="button secondary" onClick={preview}>Preview token-specific Schedule A drafts</button></div>
      {plan && <div className="prepared-metadata">
        <h3>Companion assignment preview</h3>
        <p role="status">{plan.assignments.length} token(s) selected. {plan.balanced?'40 unique two-project pairs; every project appears twice.':'Partial allocation: the two-appearances-per-project target is not met.'} No material packages, licenses, final rights, or publisher verification have been approved.</p>
        {plan.assignments.length>0 && <><div className="field"><label htmlFor="companion-preview-id">Preview a token's Schedule A</label>
          <select id="companion-preview-id" value={token} onChange={e=>setToken(Number(e.target.value))}>
            {plan.assignments.map(a=><option key={a.tokenId} value={a.tokenId}>Token #{String(a.tokenId).padStart(3,'0')}</option>)}
          </select></div>
          <pre className="public-json" role="region" aria-label="Token-specific Schedule A draft" tabIndex={0}>{schedule}</pre>
          <button type="button" className="button secondary" onClick={download}>Download all token assignments and Schedule A drafts</button></>}
      </div>}
    </>}
  </section>;
}

import {useEffect,useRef,useState} from 'react';
import {formatEther} from 'ethers';
import type {MintBatch} from '../../chain/mint.mjs';
import {api,ApiError} from './api';
import type {WalletProvider} from './auth';
import type {Configuration,Session} from './model';
import {Icon,Notice,SignInPrompt} from './components';
import {operation,operationPage,readManifest,statusText,HASH} from './mint-model';
import type {MintOperation} from './mint-model';
import {reviewLocalMint,sendLocalMint,MintFlowError} from './mint-wallet';
import type {MintReview} from './mint-wallet';
import './transactions.css';
interface Props {current:Session|null;config:Configuration;connect:()=>void;expired:()=>void;walletProvider:()=>WalletProvider|null}
export function MintTransactions(props:Props){
  if(!props.current)return <SignInPrompt connect={props.connect}/>;
  if(!props.config.capabilities.mintJournal)return <Notice>The durable transaction journal is not configured. No transaction can be started here.</Notice>;
  return <Transactions key={`${props.current.wallet}:${props.current.chainId}:${props.current.csrf}`} {...props} current={props.current}/>;
}
function Transactions({current,config,expired,walletProvider}:Props&{current:Session}){
  const [items,setItems]=useState<MintOperation[]>([]),[cursor,setCursor]=useState<string|null>(null),[selected,setSelected]=useState<MintOperation|null>(null);
  const [batches,setBatches]=useState<readonly MintBatch[]>([]),[index,setIndex]=useState(0),[review,setReview]=useState<MintReview|null>(null);
  const [disclosure,setDisclosure]=useState(false),[confirmed,setConfirmed]=useState(false),[recovery,setRecovery]=useState(''),[returnedHash,setReturnedHash]=useState('');
  const [busy,setBusy]=useState(''),[error,setError]=useState('');
  const lifetime=useRef(new AbortController()),working=useRef(false),fileEpoch=useRef(0),focus=useRef<HTMLHeadingElement>(null);
  const batch=batches[index];
  const local=config.capabilities.localMint&&current.chainId===31337&&location.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(location.hostname);
  const owner=current.role==='owner';
  useEffect(()=>{const controller=new AbortController();lifetime.current=controller;return()=>{fileEpoch.current++;controller.abort();};},[]);
  const active=()=>!lifetime.current.signal.aborted;
  function failure(cause:unknown){
    if(!active())return;
    if(cause instanceof ApiError&&cause.status===401){expired();return;}
    setError(cause instanceof Error?cause.message:'This operation could not be completed. Inspect the journal and your wallet.');
    if(cause instanceof MintFlowError&&cause.transactionHash)setReturnedHash(cause.transactionHash);
  }
  async function load(after?:string){
    const controller=lifetime.current;
    const page=operationPage(await api('/api/mint-operations?limit=50'+(after?'&after='+encodeURIComponent(after):''),{signal:controller.signal}),current.chainId);
    if(!controller.signal.aborted){setItems(previous=>after?[...previous,...page.items.filter(item=>!previous.some(old=>old.intentId===item.intentId))]:page.items);setCursor(page.nextCursor);}
  }
  useEffect(()=>{const controller=lifetime.current;void load().catch(cause=>{if(!controller.signal.aborted)failure(cause);});},[]);
  useEffect(()=>{if(review)focus.current?.focus();},[review]);
  async function task(label:string,fn:()=>Promise<void>){
    if(working.current)return;working.current=true;setBusy(label);setError('');
    try{await fn();}catch(cause){failure(cause);}finally{working.current=false;if(active())setBusy('');}
  }
  function remember(value:MintOperation){
    if(!active())return;setSelected(value);setItems(previous=>[value,...previous.filter(item=>item.intentId!==value.intentId)]);
  }
  const post=async(path:string,body:unknown)=>operation(await api('/api/mint-operations/'+path,{method:'POST',body,csrf:current.csrf,signal:lifetime.current.signal}),current.chainId);
  async function importFile(file:File|undefined){
    const version=++fileEpoch.current;setBatches([]);setReview(null);setConfirmed(false);setDisclosure(false);setIndex(0);setError('');
    if(!file)return;
    try{
      if(file.size<1||file.size>2*1024*1024)throw new Error('Choose a nonempty JSON mint manifest no larger than 2 MiB.');
      const text=await file.text();if(!active()||version!==fileEpoch.current)return;
      setBatches(readManifest(text,current));
    }catch(cause){if(version===fileEpoch.current)failure(cause);}
  }
  function wallet(){const value=walletProvider();if(!value)throw new MintFlowError('Reconnect the wallet used to sign in before continuing.');return value;}
  async function simulate(){
    if(!local||!owner||!batch||!disclosure)return;
    setReview(null);setConfirmed(false);
    await task('Simulating the exact batch and checking test-wallet fees',async()=>{const result=await reviewLocalMint(wallet(),batch,current,lifetime.current.signal);if(active())setReview(result);});
  }
  async function send(){
    if(!local||!owner||!batch||!review||!confirmed)return;
    await task('Review the exact local mint transaction in your wallet',async()=>{
      const result=await sendLocalMint(wallet(),batch,review,current,lifetime.current.signal,api);remember(result);
      if(active()){setReturnedHash(result.transactionHash||'');setReview(null);setConfirmed(false);}
      const verified=await post(result.intentId+'/reconcile',{});remember(verified);
    });
    if(active())await load().catch(failure);
  }
  async function select(id:string){await task('Loading saved transaction',async()=>{const result=operation(await api('/api/mint-operations/'+id,{signal:lifetime.current.signal}),current.chainId);if(result.intentId!==id)throw new Error('Transaction identity mismatch.');remember(result);setRecovery('');});}
  return <div className="transaction-workspace">
    <Notice>Transaction records are wallet- and network-specific. A verified receipt is evidence at the recorded block, not current ownership, an active sale order or a royalty payment. Mainnet minting and OpenSea listing remain disabled.</Notice>
    {busy&&<p role="status" className="loading"><span className="spinner"/>{busy}</p>}
    {error&&<Notice error>{error}</Notice>}
    {returnedHash&&<div className="panel recovery-hash"><strong>Wallet-returned transaction hash</strong><p className="mono">{returnedHash}</p><p>Keep this hash until the journal confirms it is saved. It is not proof of a successful mint.</p></div>}
    <section className="panel" aria-labelledby="transaction-list-title"><div className="section-heading"><div><span className="eyebrow">DURABLE TRANSACTION HISTORY</span><h2 id="transaction-list-title">Your mint operations</h2></div><button className="button secondary" disabled={Boolean(busy)} onClick={()=>void task('Refreshing saved operations',()=>load())}><Icon name="refresh"/>Refresh journal</button></div>
      {!items.length?<p>No saved mint operations for this wallet and network.</p>:<div className="transaction-list">{items.map(item=><article key={item.intentId} className="transaction-row"><div><span className="badge">{statusText[item.state]}</span><p className="mono">{item.intentId}</p><small>Collection {item.collection}</small></div><button className="button secondary" disabled={Boolean(busy)} onClick={()=>void select(item.intentId)}>Open operation</button></article>)}</div>}
      {cursor&&<button className="button secondary" disabled={Boolean(busy)} onClick={()=>void task('Loading more operations',()=>load(cursor))}>Load more operations</button>}
    </section>
    {selected&&<section className="panel transaction-detail" aria-labelledby="operation-title"><h2 id="operation-title">Transaction recovery</h2><span className="badge" data-testid="operation-status">{statusText[selected.state]}</span><dl className="preview-grid"><div><dt>Intent commitment</dt><dd className="mono">{selected.intentId}</dd></div><div><dt>Collection</dt><dd className="mono">{selected.collection}</dd></div><div><dt>Saved transaction hash</dt><dd className="mono">{selected.transactionHash||'Not yet recorded'}</dd></div><div><dt>Last observation</dt><dd>{selected.updatedAt}</dd></div><div><dt>Recorded block / confirmations</dt><dd>{selected.observedBlock===null?'Not verified':`${selected.observedBlock} / ${selected.confirmations}`}</dd></div><div><dt>Verification result</dt><dd>{selected.lastCode||'No current error recorded'}</dd></div></dl>
      {['wallet_pending','attention'].includes(selected.state)&&!selected.transactionHash&&<Notice>The wallet outcome may be unknown. Inspect wallet activity. Do not start this mint again. Record the matching transaction hash below when it is available.</Notice>}
      {owner&&selected.transactionHash&&<button className="button primary" disabled={Boolean(busy)} onClick={()=>void task('Checking the saved transaction on chain',async()=>remember(await post(selected.intentId+'/reconcile',{})))}>Verify saved receipt</button>}
      {owner&&!selected.transactionHash&&selected.state!=='cancelled'&&<div className="field"><label htmlFor="recovery-transaction">Transaction hash from wallet history</label><input id="recovery-transaction" className="mono" value={recovery} maxLength={66} autoComplete="off" spellCheck={false} onChange={event=>setRecovery(event.target.value)} aria-describedby="recover-help"/><small id="recover-help">Only attach the transaction for this exact operation. The server checks its account, calldata, collection and receipt independently of this input.</small><button className="button secondary" disabled={Boolean(busy)||!HASH.test(recovery)||/^0x0+$/.test(recovery)} onClick={()=>void task('Saving and checking the recovered transaction',async()=>{const saved=await post(selected.intentId+'/transaction',{transactionHash:recovery});remember(saved);remember(await post(selected.intentId+'/reconcile',{}));})}>Recover transaction</button></div>}
      {owner&&selected.state==='prepared'&&<button className="button secondary" disabled={Boolean(busy)} onClick={()=>void task('Cancelling an unsent operation',async()=>remember(await post(selected.intentId+'/cancel',{expectedRevision:selected.revision})))}>Cancel unsent operation</button>}
    </section>}
    {local&&owner?<section className="panel mint-rehearsal" aria-labelledby="mint-rehearsal-title"><span className="eyebrow">DISPOSABLE LOCAL NETWORK / CHAIN 31337</span><h2 id="mint-rehearsal-title">Review and mint a local test batch</h2><Notice>Use synthetic or already-public test inputs and a disposable wallet only. This is not a production publishing flow. Simulation shares exact calldata with the selected wallet provider; signing writes those values to the local chain. No artwork or rights file is uploaded by this screen.</Notice>
      <div className="field"><label htmlFor="mint-manifest">Public test mint manifest</label><input id="mint-manifest" type="file" accept=".json,application/json" disabled={Boolean(busy)} onChange={event=>void importFile(event.target.files?.[0])}/><small>JSON, up to 2 MiB. Collection, minter and reviewed runtime code hash must be supplied. No private keys or draft data.</small></div>
      {batch&&<><div className="field"><label htmlFor="mint-batch">Batch to review</label><select id="mint-batch" value={index} disabled={Boolean(busy)} onChange={event=>{setIndex(Number(event.target.value));setReview(null);setConfirmed(false);setDisclosure(false);}}>{batches.map((value,i)=><option key={value.id} value={i}>Batch {i+1} / {batches.length}: {value.works.length} token(s)</option>)}</select></div>
        <dl className="preview-grid"><div><dt>Collection / destination</dt><dd className="mono">{batch.collection}</dd></div><div><dt>Mint recipient / wallet</dt><dd className="mono">{batch.minter}</dd></div><div><dt>Intent commitment</dt><dd className="mono">{batch.id}</dd></div><div><dt>Value sent to contract</dt><dd>0 ETH (network fee separate)</dd></div></dl>
        <details><summary>Inspect exact immutable token fields</summary><pre className="public-json" role="region" aria-label="Exact mint fields" tabIndex={0}>{JSON.stringify(batch.works,null,2)}</pre></details>
        <label className="review-checkbox"><input type="checkbox" checked={disclosure} disabled={Boolean(busy)} onChange={event=>{setDisclosure(event.target.checked);setReview(null);setConfirmed(false);}}/><span>I reviewed these public test fields and authorize sending them to my local wallet provider for simulation.</span></label>
        <button className="button secondary" disabled={Boolean(busy)||!disclosure} onClick={()=>void simulate()}>Simulate and estimate fee</button>
        {review&&<div className="mint-confirmation"><h3 ref={focus} tabIndex={-1}>Review the transaction fee</h3><dl className="preview-grid"><div><dt>Maximum network fee</dt><dd>{formatEther(review.maximumCost)} test ETH</dd></div><div><dt>Gas limit / gas price</dt><dd>{BigInt(review.gas).toString()} / {BigInt(review.gasPrice).toString()} wei</dd></div><div><dt>Wallet nonce</dt><dd>{BigInt(review.nonce).toString()}</dd></div><div><dt>Simulation block</dt><dd>{review.blockNumber}</dd></div></dl><p>Review expires after two minutes. A simulation is not a promise that a later transaction will succeed. No marketplace approval or order is included.</p><label className="review-checkbox"><input type="checkbox" checked={confirmed} disabled={Boolean(busy)} onChange={event=>setConfirmed(event.target.checked)}/><span>I approve this exact local batch and fee cap. Request one wallet transaction; never retry it automatically.</span></label><button className="button primary" disabled={Boolean(busy)||!confirmed} onClick={()=>void send()}>Sign local mint transaction</button></div>}
      </>}
    </section>:<Notice>New mint transactions are unavailable in this environment. Saved public transaction hashes can still be reconciled when an authorized database and RPC are configured.</Notice>}
  </div>;
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { ErpIntegrationDto, LedgerDto } from '@aeroos/contracts';
import { api, download, post } from '../../lib/api';
import { useUi } from '../../lib/store';
import { Card, ErrorNote, Head, Pill } from '../../components/ui';

export const money = (c: number) => (c / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const who = (s: string | null) => (s ?? '').replace(/^user:/, '');

/** General ledger: trial balance, result by cost centre, journals, manual journal, period close, ERP export. */
export function Ledger() {
  const { entity, period } = useSearch({ from: '/finance/ledger' });
  const navigate = useNavigate({ from: '/finance/ledger' });
  const q = useQuery({ queryKey: ['ledger', entity ?? '', period ?? ''], queryFn: () => api<LedgerDto>(`/finance/ledger?entity=${encodeURIComponent(entity ?? '')}&period=${encodeURIComponent(period ?? '')}`) });
  const l = q.data;
  const toast = useUi(s => s.toast);
  const exportCsv = async () => {
    try {
      await download(`/finance/export?entity=${encodeURIComponent(l!.entityId)}&period=${l!.period}`, `journals-${l!.entityId}-${l!.period}.csv`);
    } catch (e) {
      toast((e as Error).message, 'red');
    }
  };
  return (
    <>
      <Head crumb="Finance & Business / General ledger" title="General Ledger"
        desc="Double-entry ledger in the base currency (USD). Maintenance invoices, credit notes, customer payments and goods receipts post automatically, once per document; finance posts manual journals, closes months in order (a late posting lands in the next open month) and exports journals for the ERP."
        actions={l && <div className="row" style={{ gap: 6 }}>
          <select className="inp" aria-label="Entity" value={l.entityId} onChange={e => navigate({ search: { entity: e.target.value, period: l.period } })}>{l.entities.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <input className="inp" type="month" aria-label="Period" value={l.period} onChange={e => e.target.value && navigate({ search: { entity: l.entityId, period: e.target.value } })} />
          <button className="btn sm" onClick={() => void exportCsv()}>Export CSV</button>
        </div>} />
      <ErrorNote error={q.error} />
      {l && <>
        <Periods l={l} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>
          <Card title={`Trial balance ${l.period}`} meta={l.trialBalance.balanced ? 'balanced' : 'NOT BALANCED'} flush>
            <div className="tbl-wrap"><table className="t">
              <thead><tr><th>Account</th><th style={{ textAlign: 'right' }}>Debit</th><th style={{ textAlign: 'right' }}>Credit</th><th style={{ textAlign: 'right' }}>Balance</th></tr></thead>
              <tbody>
                {l.trialBalance.rows.map(r => <tr key={r.code}><td><span className="mono">{r.code}</span> {r.name}</td><td className="mono" style={{ textAlign: 'right' }}>{money(r.debitCents)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{money(r.creditCents)}</td><td className="mono" style={{ textAlign: 'right' }}>{money(r.balanceCents)}</td></tr>)}
                {l.trialBalance.rows.length === 0 && <tr><td colSpan={4} className="empty">No postings in {l.period}.</td></tr>}
                <tr><td><b>Total</b></td><td className="mono" style={{ textAlign: 'right' }}><b>{money(l.trialBalance.debitCents)}</b></td><td className="mono" style={{ textAlign: 'right' }}><b>{money(l.trialBalance.creditCents)}</b></td><td /></tr>
              </tbody>
            </table></div>
          </Card>
          <Card title="Result by cost centre" flush>
            <div className="tbl-wrap"><table className="t">
              <thead><tr><th>Cost centre</th><th style={{ textAlign: 'right' }}>Revenue</th><th style={{ textAlign: 'right' }}>Expenses</th><th style={{ textAlign: 'right' }}>Result</th></tr></thead>
              <tbody>{l.profitAndLoss.map(r => <tr key={r.costCentre}><td className="mono">{r.costCentre}</td><td className="mono" style={{ textAlign: 'right' }}>{money(r.revenueCents)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{money(r.expenseCents)}</td><td className="mono" style={{ textAlign: 'right' }}>{money(r.resultCents)}</td></tr>)}
                {l.profitAndLoss.length === 0 && <tr><td colSpan={4} className="empty">No revenue or expenses in {l.period}.</td></tr>}</tbody>
            </table></div>
          </Card>
        </div>
        <Card title="Journals" meta={`${l.journals.length}`}>
          {l.journals.map(j => (
            <div key={j.id} className="block" style={{ marginBottom: 10 }}>
              <b className="mono">{j.id}</b> <span className="note">{j.date} · {j.source === 'manual' ? 'manual' : j.source} · {who(j.postedBy)}</span>
              <div>{j.memo}</div>
              <table className="t"><tbody>{j.lines.map((x, i) => <tr key={i}><td className="mono">{x.account}</td><td>{x.accountName}</td><td className="mono">{x.costCentre ?? ''}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{x.debitCents ? money(x.debitCents) : ''}</td><td className="mono" style={{ textAlign: 'right' }}>{x.creditCents ? money(x.creditCents) : ''}</td></tr>)}</tbody></table>
            </div>
          ))}
          {l.journals.length === 0 && <div className="empty">No journals in {l.period}.</div>}
        </Card>
        {l.permissions.post && <ManualJournal l={l} />}
        <ErpIntegration l={l} />
      </>}
    </>
  );
}

function Periods({ l }: { l: LedgerDto }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const close = useMutation({ mutationFn: (period: string) => post<LedgerDto>('/finance/periods/close', { entityId: l.entityId, period }),
    onSuccess: (_r, period) => { toast(`${period} closed`, 'green'); void qc.invalidateQueries({ queryKey: ['ledger'] }); } });
  const current = new Date().toISOString().slice(0, 7);
  return (
    <Card title="Periods">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {l.periods.map(p => (
          <span key={p.period} className="row" style={{ gap: 4, alignItems: 'center' }}>
            <span className="mono">{p.period}</span> <Pill tone={p.status === 'CLOSED' ? '' : 'green'}>{p.status.toLowerCase()}</Pill>
            {p.status === 'OPEN' && p.period < current && l.permissions.close && <button className="btn sm" disabled={close.isPending} onClick={() => close.mutate(p.period)}>Close</button>}
          </span>
        ))}
      </div>
      <ErrorNote error={close.error} />
    </Card>
  );
}

function ManualJournal({ l }: { l: LedgerDto }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const blank = { account: l.accounts[0]?.code ?? '', costCentre: '', debit: '', credit: '' };
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState([blank, { ...blank }]);
  const c = (v: string) => Math.round(Number(v || 0) * 100);
  const d = lines.reduce((s, x) => s + c(x.debit), 0), cr = lines.reduce((s, x) => s + c(x.credit), 0);
  const save = useMutation({
    mutationFn: () => post<LedgerDto>('/finance/journals', { entityId: l.entityId, date, memo, lines: lines.filter(x => c(x.debit) > 0 || c(x.credit) > 0).map(x => ({ account: x.account, costCentre: x.costCentre || null, debitCents: c(x.debit), creditCents: c(x.credit) })) }),
    onSuccess: () => { toast('Journal posted', 'green'); setMemo(''); setLines([blank, { ...blank }]); void qc.invalidateQueries({ queryKey: ['ledger'] }); }
  });
  const set = (i: number, k: keyof typeof blank, v: string) => setLines(lines.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <Card title="Manual journal" meta={`debit ${money(d)} · credit ${money(cr)}${d === cr ? '' : ' — does not balance'}`}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field"><label htmlFor="mj-date">Date</label><input id="mj-date" type="date" className="inp" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div className="field" style={{ flex: 1, minWidth: 240 }}><label htmlFor="mj-memo">Memo</label><input id="mj-memo" className="inp" value={memo} maxLength={300} onChange={e => setMemo(e.target.value)} /></div>
      </div>
      {lines.map((x, i) => (
        <div key={i} className="row" style={{ gap: 6, marginTop: 4 }}>
          <select className="inp" aria-label={`Account ${i + 1}`} value={x.account} onChange={e => set(i, 'account', e.target.value)}>{l.accounts.map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select>
          <select className="inp" aria-label={`Cost centre ${i + 1}`} value={x.costCentre} onChange={e => set(i, 'costCentre', e.target.value)}><option value="">—</option>{l.costCentres.map(cc => <option key={cc.code} value={cc.code}>{cc.code}</option>)}</select>
          <input className="inp" aria-label={`Debit ${i + 1}`} placeholder="debit" type="number" step="0.01" min={0} value={x.debit} onChange={e => set(i, 'debit', e.target.value)} />
          <input className="inp" aria-label={`Credit ${i + 1}`} placeholder="credit" type="number" step="0.01" min={0} value={x.credit} onChange={e => set(i, 'credit', e.target.value)} />
        </div>
      ))}
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <button className="btn sm ghost" onClick={() => setLines([...lines, { ...blank }])}>Add line</button>
        <button className="btn pri" disabled={d === 0 || d !== cr || memo.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>Post journal</button>
      </div>
      <ErrorNote error={save.error} />
    </Card>
  );
}


const parseMap=(text:string)=>Object.fromEntries(text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(line=>{const i=line.indexOf('=');if(i<1)throw new Error(`Mapping must be SOURCE=TARGET: ${line}`);return [line.slice(0,i).trim(),line.slice(i+1).trim()];}));

function ErpIntegration({l}:{l:LedgerDto}){
  const q=useQuery({queryKey:['finance','erp'],queryFn:()=>api<ErpIntegrationDto>('/finance/erp')});const qc=useQueryClient();const toast=useUi(s=>s.toast);
  const [form,setForm]=useState({name:'',format:'CSV_JOURNAL_V1' as 'CSV_JOURNAL_V1'|'JSON_JOURNAL_V1',accountMap:'',costCentreMap:''});
  const [ack,setAck]=useState<Record<string,{reference:string;note:string}>>({});
  const refresh=()=>qc.invalidateQueries({queryKey:['finance','erp']});
  const profile=useMutation({mutationFn:()=>post('/finance/erp/profiles',{entityId:l.entityId,name:form.name,format:form.format,accountMap:parseMap(form.accountMap),costCentreMap:parseMap(form.costCentreMap)}),onSuccess:()=>{setForm(x=>({...x,name:'',accountMap:'',costCentreMap:''}));toast('ERP profile created','green');void refresh();}});
  const state=useMutation({mutationFn:(x:{id:string;active:boolean})=>post(`/finance/erp/profiles/${x.id}/state`,{active:x.active}),onSuccess:()=>void refresh()});
  const generate=useMutation({mutationFn:(profileId:string)=>post('/finance/erp/exports',{profileId,period:l.period}),onSuccess:()=>{toast(`${l.period} ERP export generated`,'green');void refresh();}});
  const acknowledge=useMutation({mutationFn:(x:{id:string;status:'ACKNOWLEDGED'|'REJECTED'})=>post(`/finance/erp/exports/${x.id}/ack`,{status:x.status,reference:ack[x.id]?.reference??'',note:ack[x.id]?.note||undefined}),onSuccess:()=>{toast('ERP reconciliation recorded','green');void refresh();}});
  const data=q.data;const entityProfiles=(data?.profiles??[]).filter(p=>p.entityId===l.entityId);const batches=(data?.batches??[]).filter(b=>b.entityId===l.entityId);
  return <Card title="ERP handoff & reconciliation" meta="Aviation sub-ledger → external ERP">
    <p className="note">Exports are generated only from closed periods, retain their exact content and SHA-256, and require an external acknowledgement or rejection reference. AeroOS remains the aviation operational sub-ledger; the statutory ERP remains authoritative for corporate accounting.</p>
    <ErrorNote error={q.error??profile.error??state.error??generate.error??acknowledge.error}/>
    <div className="stack" style={{gap:7}}>{entityProfiles.map(p=><div className="row block" key={p.id} style={{padding:8}}><Pill tone={p.active?'green':''}>{p.active?'active':'inactive'}</Pill><b style={{flex:1}}>{p.name}</b><span className="note">{p.format.replace('_V1','')}</span>{data?.permissions.integrate&&<><button className="btn sm" disabled={!p.active||generate.isPending} onClick={()=>generate.mutate(p.id)}>Export {l.period}</button><button className="btn sm ghost" onClick={()=>state.mutate({id:p.id,active:!p.active})}>{p.active?'Deactivate':'Activate'}</button></>}</div>)}</div>
    {entityProfiles.length===0&&<div className="empty">No ERP profile for this legal entity.</div>}
    {data?.permissions.integrate&&<details style={{marginTop:10}}><summary className="click"><b>Add ERP profile</b></summary><div className="stack" style={{gap:7,marginTop:8}}><div className="row"><input className="inp" style={{flex:1}} placeholder="Profile name (e.g. SAP production)" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/><select className="inp" value={form.format} onChange={e=>setForm({...form,format:e.target.value as typeof form.format})}><option value="CSV_JOURNAL_V1">CSV journal v1</option><option value="JSON_JOURNAL_V1">JSON journal v1</option></select></div><div className="row" style={{alignItems:'stretch'}}><textarea className="inp" style={{flex:1,minHeight:90}} placeholder={'Optional account map, one per line\n4000=REV_MAINT'} value={form.accountMap} onChange={e=>setForm({...form,accountMap:e.target.value})}/><textarea className="inp" style={{flex:1,minHeight:90}} placeholder={'Optional cost-centre map\nMRO=TECHOPS'} value={form.costCentreMap} onChange={e=>setForm({...form,costCentreMap:e.target.value})}/></div><button className="btn sm" disabled={form.name.trim().length<2||profile.isPending} onClick={()=>profile.mutate()}>Create profile</button></div></details>}
    <h4>Export history</h4><div className="stack" style={{gap:7}}>{batches.map(b=><div key={b.id} className="block" style={{padding:9}}><div className="row"><Pill tone={b.status==='ACKNOWLEDGED'?'green':b.status==='REJECTED'?'red':'amber'}>{b.status.toLowerCase()}</Pill><b>{b.profileName}</b><span className="mono">{b.period}</span><span className="note">{b.journalCount} journals · {money(b.debitCents)} debit</span><button className="btn sm ghost" onClick={()=>void download(`/finance/erp/exports/${b.id}/file`,`erp-${b.entityId}-${b.period}.${b.format.startsWith('CSV')?'csv':'json'}`)}>Download</button></div><div className="note mono">SHA-256 {b.contentSha256}</div>{b.status==='GENERATED'&&data?.permissions.integrate&&<div className="row" style={{marginTop:6,flexWrap:'wrap'}}><input className="inp" placeholder="ERP acknowledgement / job reference" value={ack[b.id]?.reference??''} onChange={e=>setAck(v=>({...v,[b.id]:{reference:e.target.value,note:v[b.id]?.note??''}}))}/><input className="inp" placeholder="Note (optional)" value={ack[b.id]?.note??''} onChange={e=>setAck(v=>({...v,[b.id]:{reference:v[b.id]?.reference??'',note:e.target.value}}))}/><button className="btn sm pri" disabled={(ack[b.id]?.reference??'').trim().length<2} onClick={()=>acknowledge.mutate({id:b.id,status:'ACKNOWLEDGED'})}>Acknowledge</button><button className="btn sm" disabled={(ack[b.id]?.reference??'').trim().length<2} onClick={()=>acknowledge.mutate({id:b.id,status:'REJECTED'})}>Reject</button></div>}{b.status!=='GENERATED'&&<div className="note">{b.acknowledgementRef} · {b.acknowledgementNote??''}</div>}</div>)}</div>{batches.length===0&&<div className="empty">No ERP exports yet.</div>}
  </Card>;
}

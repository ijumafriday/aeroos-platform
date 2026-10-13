import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { ComplianceMatrixDto, ComplianceMatrixRowDto, MasterDataReadinessDto, MasterDataSetDto } from '@aeroos/contracts';
import { api, download, post } from '../../lib/api';
import { Card, ErrorNote, Head, Pill } from '../../components/ui';

const SCOPES = ['PART-CAMO', 'PART-M', 'PART-21', 'PART-145', 'PART-ORO', 'PART-CAT', 'PLATFORM'];
const statusTone: Record<string, string> = { IMPLEMENTED: 'green', SUPPORTED: 'cyan', DATA: 'amber', PROCEDURAL: '' };
const statusWord: Record<string, string> = {
  IMPLEMENTED: 'enforced by the system', SUPPORTED: 'recorded by the system, decided by procedure', DATA: 'needs approved data', PROCEDURAL: 'organisation only'
};

/** Compliance traceability matrix: requirement → exposition section → implementation → evidence (with live counts). */
export function Compliance() {
  const { scope, status } = useSearch({ from: '/quality/compliance' });
  const navigate = useNavigate({ from: '/quality/compliance' });
  const q = useQuery({ queryKey: ['matrix', scope ?? ''], queryFn: () => api<ComplianceMatrixDto>(`/compliance/matrix?scope=${encodeURIComponent(scope ?? '')}`) });
  const exp = useMutation({ mutationFn: () => download(`/compliance/matrix/export?scope=${encodeURIComponent(scope ?? '')}`, 'aeroos-compliance-matrix.csv') });
  const master = useQuery({ queryKey: ['master-data'], queryFn: () => api<MasterDataSetDto[]>('/compliance/master-data') });
  const readiness = useQuery({ queryKey: ['master-data-readiness'], queryFn: () => api<MasterDataReadinessDto>('/compliance/master-data/readiness') });
  const m = q.data;
  const rows = (m?.rows ?? []).filter(r => !status || r.status === status);
  return (
    <>
      <Head crumb="Quality / Compliance Matrix" title="Compliance Traceability Matrix"
        desc="Each regulatory requirement the system touches: the exposition section that covers it, how AeroOS meets it, and the evidence — automated tests, rulepack decisions, access policies, screens, and how often its audit actions were recorded in the last 12 months. The references are checked at every build. The same matrix, with the period's counts, is inside every evidence pack."
        actions={<>
          <select className="inp" aria-label="Regulation" value={scope ?? ''} onChange={e => navigate({ search: { scope: e.target.value || undefined, status } })}>
            <option value="">All regulations</option>{SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn" disabled={exp.isPending} onClick={() => exp.mutate()}>Export CSV</button>
        </>} />
      <ErrorNote error={q.error ?? exp.error} />
      {m && <>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button className={`btn sm ${!status ? 'pri' : 'ghost'}`} onClick={() => navigate({ search: { scope, status: undefined } })}>All {m.rows.length}</button>
          {m.summary.map(s => (
            <button key={s.status} className={`btn sm ${status === s.status ? 'pri' : 'ghost'}`} title={statusWord[s.status]} onClick={() => navigate({ search: { scope, status: s.status } })}>
              <Pill tone={statusTone[s.status]}>{s.status.toLowerCase()}</Pill> {s.count}
            </button>
          ))}
        </div>
        <Card title="Requirements" meta={`${rows.length} · evidence ${m.from.slice(0, 10)} – ${m.to.slice(0, 10)}`} flush>
          <div className="tbl-wrap"><table className="t">
            <thead><tr><th>Id</th><th>Requirement</th><th>Exposition</th><th>Status</th><th>Recorded</th></tr></thead>
            <tbody>{rows.map(r => <Row key={r.id} r={r} />)}</tbody>
          </table></div>
        </Card>
        <MasterDataGovernance rows={master.data ?? []} ready={readiness.data?.ready ?? false} refresh={() => { void master.refetch(); void readiness.refetch(); }} />
        <Card title="Rulepacks">
          {m.rulepacks.map(r => <div key={`${r.authority}${r.version}`}><b>{r.authority}</b> {r.version} <Pill tone={r.status === 'approved' ? 'green' : 'amber'}>{r.status}</Pill></div>)}
          <div className="note">A draft rulepack is refused outside development until a qualified compliance person approves it.</div>
        </Card>
      </>}
    </>
  );
}

function Row({ r }: { r: ComplianceMatrixRowDto }) {
  const [open, setOpen] = useState(false);
  const recorded = r.evidence.auditActions.reduce((n, a) => n + a.count, 0);
  return (
    <>
      <tr className="click" tabIndex={0} onClick={() => setOpen(!open)} onKeyDown={e => e.key === 'Enter' && setOpen(!open)} aria-expanded={open}>
        <td className="mono"><b>{r.id}</b></td>
        <td><b>{r.title}</b><div className="note">{r.reference}</div></td>
        <td className="note">{r.exposition.document} {r.exposition.section}</td>
        <td><Pill tone={statusTone[r.status]}>{r.status.toLowerCase()}</Pill></td>
        <td className="mono">{r.evidence.auditActions.length ? recorded : '—'}</td>
      </tr>
      {open && (
        <tr><td colSpan={5}>
          <p style={{ margin: '4px 0' }}>{r.implementation}</p>
          {r.organisation && <div className="callout amber" style={{ margin: '6px 0' }}>Organisation: {r.organisation}</div>}
          {r.evidence.auditActions.length > 0 && <div className="note">Audit trail: {r.evidence.auditActions.map(a => `${a.action} ×${a.count}${a.last ? ` (last ${a.last.slice(0, 10)})` : ''}`).join(' · ')}</div>}
          {r.evidence.tests.length > 0 && <div className="note">Tests: {r.evidence.tests.map(t => `${t.file} — “${t.name}…”`).join(' · ')}</div>}
          {r.evidence.rules.length > 0 && <div className="note">Rulepack decisions: {r.evidence.rules.join(', ')}</div>}
          {r.evidence.policies.length > 0 && <div className="note">Access policies: {r.evidence.policies.join(', ')}</div>}
          {r.evidence.routes.length > 0 && <div className="note">Screens: {r.evidence.routes.join(', ')}</div>}
        </td></tr>
      )}
    </>
  );
}


function MasterDataGovernance({ rows, ready, refresh }: { rows: MasterDataSetDto[]; ready: boolean; refresh: () => void }) {
  const [reason, setReason] = useState('Operational approval withdrawn by authorised manager');
  const latest0 = [...rows].sort((a,b) => a.key.localeCompare(b.key) || b.revision-a.revision).filter((r,i,a) => i===0 || a[i-1].key!==r.key);
  const [baseKey, setBaseKey] = useState('');
  const [sourceRef, setSourceRef] = useState('');
  const [contentSha256, setContentSha256] = useState('');
  const selected = latest0.find(r => r.key === baseKey) ?? latest0[0];
  const action = useMutation({ mutationFn: ({ id, verb }: { id: string; verb: 'validate'|'approve'|'activate'|'withdraw' }) => post<MasterDataSetDto>(`/compliance/master-data/${id}/${verb}`, verb === 'withdraw' ? { reason } : undefined), onSuccess: refresh });
  const create = useMutation({ mutationFn: () => {
    if (!selected) throw new Error('Choose a dataset');
    return post<MasterDataSetDto>('/compliance/master-data', { key:selected.key, domain:selected.domain, title:selected.title, sourceRef, contentSha256 });
  }, onSuccess: () => { setSourceRef(''); setContentSha256(''); refresh(); } });
  const latest = latest0;
  return <Card title="Regulated master data" meta={ready ? 'production data ready' : 'approval required'} flush>
    <div className={`callout ${ready ? 'green' : 'amber'}`} style={{margin:10}}>{ready ? 'Every required operational dataset has an effective approved revision.' : 'Regulated actions remain fail-closed until the required datasets have an EFFECTIVE revision.'}</div>
    <div className="tbl-wrap"><table className="t"><thead><tr><th>Domain</th><th>Dataset</th><th>Revision</th><th>Source / hash</th><th>Status</th><th>Control</th></tr></thead><tbody>
      {latest.map(r => <tr key={r.id}><td>{r.domain}</td><td><b>{r.title}</b><div className="note mono">{r.key}</div></td><td className="mono">{r.revision}</td><td><div>{r.sourceRef}</div><div className="note mono">sha256 {r.contentSha256.slice(0,12)}…</div></td><td><Pill tone={r.status==='EFFECTIVE'?'green':r.status==='DRAFT'?'amber':'cyan'}>{r.status.toLowerCase()}</Pill></td><td><div className="row" style={{gap:4,flexWrap:'wrap'}}>
        {r.status==='DRAFT' && <button className="btn sm" disabled={action.isPending} onClick={()=>action.mutate({id:r.id,verb:'validate'})}>Validate</button>}
        {r.status==='VALIDATED' && <button className="btn sm" disabled={action.isPending} onClick={()=>action.mutate({id:r.id,verb:'approve'})}>Approve</button>}
        {r.status==='APPROVED' && <button className="btn sm pri" disabled={action.isPending} onClick={()=>action.mutate({id:r.id,verb:'activate'})}>Make effective</button>}
        {r.status==='EFFECTIVE' && <button className="btn sm ghost" disabled={action.isPending} onClick={()=>action.mutate({id:r.id,verb:'withdraw'})}>Withdraw</button>}
      </div></td></tr>)}
    </tbody></table></div>
    <div style={{padding:10}}>
      <h3>New controlled revision</h3>
      <div className="grid2">
        <div className="field"><label>Dataset</label><select className="inp" value={baseKey || selected?.key || ''} onChange={e=>setBaseKey(e.target.value)}>{latest.map(r=><option key={r.key} value={r.key}>{r.title}</option>)}</select></div>
        <div className="field"><label>Approved source reference</label><input className="inp" value={sourceRef} onChange={e=>setSourceRef(e.target.value)} placeholder="Manual / revision / authority reference" /></div>
        <div className="field" style={{gridColumn:'1 / -1'}}><label>Source package SHA-256</label><input className="inp mono" value={contentSha256} onChange={e=>setContentSha256(e.target.value.toLowerCase())} placeholder="64 hexadecimal characters" /></div>
      </div>
      <button className="btn sm" disabled={create.isPending || !selected || sourceRef.trim().length<3 || !/^[0-9a-f]{64}$/.test(contentSha256)} onClick={()=>create.mutate()}>Create draft revision</button>
      <div style={{marginTop:10}}><label className="note" htmlFor="master-withdraw-reason">Withdrawal reason</label><input id="master-withdraw-reason" className="inp" value={reason} onChange={e=>setReason(e.target.value)} /></div>
    </div>
    <ErrorNote error={action.error ?? create.error} />
  </Card>;
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { CorrectiveActionDto, FindingDto, MeDto, QualityAuditDto } from '@aeroos/contracts';
import { api, post } from '../../lib/api';
import { zulu } from '../../lib/format';
import { useUi } from '../../lib/store';
import { Card, DL, Drawer, ErrorNote, Head, Pill } from '../../components/ui';
import { ActionRow, ActionsPanel } from '../shared/CorrectiveActions';

const tone: Record<string, string> = { PLANNED: '', IN_PROGRESS: 'amber', CLOSED: 'green', OPEN: 'amber' };
const levelTone: Record<string, string> = { LEVEL_1: 'red', LEVEL_2: 'amber', OBSERVATION: 'cyan' };
const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');
const who = (s: string) => s.replace(/^user:/, '');

/** Quality audits: plan, raise findings (level 1 / 2 / observation), root cause, corrective actions, closure. */
export function Audits() {
  const { audit, view } = useSearch({ from: '/quality/audits' });
  const navigate = useNavigate({ from: '/quality/audits' });
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') });
  const q = useQuery({ queryKey: ['audits'], queryFn: () => api<QualityAuditDto[]>('/quality/audits') });
  const tracker = useQuery({ queryKey: ['quality-findings'], queryFn: () => api<FindingDto[]>('/quality/findings') });
  const activeView = view === 'tracker' ? 'tracker' : 'audits';
  const canManage = !!me.data?.roles.some(r => r === 'auditor' || r === 'quality_manager');
  const [planning, setPlanning] = useState(false);
  const overdue = (q.data ?? []).flatMap(a => a.findings).filter(f => f.overdue);
  return (
    <>
      <Head crumb="Quality / Compliance monitoring" title="Audits, Findings & Non-Compliance"
        desc="Audits plus the Finding & Non-Compliance Tracker and server-calculated Quality Risk & Finding Classification Engine. The compliance-monitoring programme: audits against the regulation and the exposition, findings by level with due dates (level 1: 7 days, level 2: 90 days), root cause, corrective actions verified by someone other than who did them."
        actions={canManage && <button className="btn pri" onClick={() => setPlanning(true)}>Plan an audit</button>} />
      <div className="tabs" style={{ marginBottom: 12 }}>
        <button className={`tab ${activeView === 'audits' ? 'on' : ''}`} onClick={() => navigate({ search: { view: 'audits', audit: undefined } })}>Audit Programme</button>
        <button className={`tab ${activeView === 'tracker' ? 'on' : ''}`} onClick={() => navigate({ search: { view: 'tracker', audit: undefined } })}>Finding & Non-Compliance Tracker</button>
      </div>
      {overdue.length > 0 && <div className="callout red"><b>Findings past their due date:</b> {overdue.map(f => f.id).join(', ')}</div>}
      {(q.error || tracker.error) && <div className="callout red">{((q.error || tracker.error) as Error).message}</div>}
      {activeView === 'audits' ? <Card title="Audits" meta={`${q.data?.length ?? 0}`} flush>
        <div className="tbl-wrap"><table className="t">
          <thead><tr><th>Audit</th><th>Area · reference</th><th>Date</th><th>Status</th><th>Findings open</th></tr></thead>
          <tbody>
            {(q.data ?? []).map(a => (
              <tr key={a.id} className="click" tabIndex={0} onClick={() => navigate({ search: { audit: a.id } })} onKeyDown={e => e.key === 'Enter' && navigate({ search: { audit: a.id } })}>
                <td><b className="mono">{a.id}</b> {a.title}</td>
                <td className="sub">{a.area} · {a.reference}</td>
                <td className="mono">{a.plannedFor}</td>
                <td><Pill tone={tone[a.status]}>{label(a.status)}</Pill></td>
                <td>{a.findings.filter(f => f.status === 'OPEN').map(f => <Pill key={f.id} tone={levelTone[f.level]}>{f.id}</Pill>)}</td>
              </tr>
            ))}
            {q.data?.length === 0 && <tr><td colSpan={5} className="empty">No audits planned.</td></tr>}
          </tbody>
        </table></div>
      </Card> : <FindingTracker findings={tracker.data ?? []} audits={q.data ?? []} />}
      <AuditDrawer audit={(q.data ?? []).find(a => a.id === audit) ?? null} id={audit ?? null} me={me.data?.username ?? ''} canManage={canManage}
        canVerify={!!me.data?.roles.includes('quality_manager')} onClose={() => navigate({ search: { audit: undefined } })} />
      {planning && <PlanDrawer onClose={() => setPlanning(false)} />}
    </>
  );
}

function AuditDrawer({ audit: a, id, me, canManage, canVerify, onClose }: { audit: QualityAuditDto | null; id: string | null; me: string; canManage: boolean; canVerify: boolean; onClose(): void }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const [f, setF] = useState({ level: 'LEVEL_2', requirement: '', description: '', likelihood: 3, impact: 3, classificationBasis: '', containmentAction: '', recurrence: false });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['audits'] });
  const raise = useMutation({ mutationFn: () => post<QualityAuditDto[]>(`/quality/audits/${id}/findings`, f), onSuccess: () => { toast('Finding raised', 'amber'); setF({ level: 'LEVEL_2', requirement: '', description: '', likelihood: 3, impact: 3, classificationBasis: '', containmentAction: '', recurrence: false }); refresh(); } });
  return (
    <Drawer open={!!id} onClose={onClose} eyebrow={a ? `Audit · ${a.area}` : 'Audit'} title={a ? `${a.id} · ${a.title}` : id ?? ''} tags={a && <Pill tone={tone[a.status]}>{label(a.status)}</Pill>}>
      {a && (
        <>
          <DL items={[['Reference', a.reference], ['Planned for', a.plannedFor], ['Lead auditor', who(a.leadAuditor)], ...(a.closedAt ? [['Closed', zulu(a.closedAt)] as [string, string]] : [])]} />
          {a.findings.map(fd => <FindingCard key={fd.id} f={fd} me={me} canManage={canManage} canVerify={canVerify} onChange={refresh} />)}
          {a.findings.length === 0 && <div className="empty">No findings yet.</div>}
          {canManage && a.status !== 'CLOSED' && (
            <section className="dsec">
              <h3>Raise a finding</h3>
              <div className="form-grid">
                <div className="field"><label htmlFor="f-lvl">Level</label><select id="f-lvl" className="inp" value={f.level} onChange={e => setF(x => ({ ...x, level: e.target.value }))}>
                  <option value="LEVEL_1">Level 1 (7 days)</option><option value="LEVEL_2">Level 2 (90 days)</option><option value="OBSERVATION">Observation</option></select></div>
                <div className="field"><label htmlFor="f-req">Requirement</label><input id="f-req" className="inp mono" placeholder="145.A.40(b)" value={f.requirement} onChange={e => setF(x => ({ ...x, requirement: e.target.value }))} /></div>
                <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="f-desc">Finding</label><textarea id="f-desc" className="inp" rows={3} value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))} /></div>
                <div className="field"><label htmlFor="f-like">Likelihood (1–5)</label><select id="f-like" className="inp" value={f.likelihood} onChange={e => setF(x => ({ ...x, likelihood: Number(e.target.value) }))}>{[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}</select></div>
                <div className="field"><label htmlFor="f-impact">Compliance / quality impact (1–5)</label><select id="f-impact" className="inp" value={f.impact} onChange={e => setF(x => ({ ...x, impact: Number(e.target.value) }))}>{[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}</select></div>
                <div className="field" style={{ gridColumn: 'span 2' }}><label>Risk classification</label><div className="callout"><b>{riskClass(f.likelihood, f.impact)}</b> · score {f.likelihood * f.impact}</div></div>
                <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="f-basis">Classification basis</label><textarea id="f-basis" className="inp" rows={2} placeholder="Why this likelihood and impact apply; include regulatory, process, repeat-finding or product implications." value={f.classificationBasis} onChange={e => setF(x => ({ ...x, classificationBasis: e.target.value }))} /></div>
                <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="f-contain">Immediate containment {['HIGH','CRITICAL'].includes(riskClass(f.likelihood,f.impact)) ? '(required)' : '(if applicable)'}</label><textarea id="f-contain" className="inp" rows={2} value={f.containmentAction} onChange={e => setF(x => ({ ...x, containmentAction: e.target.value }))} /></div>
                <div className="field"><label><input type="checkbox" checked={f.recurrence} onChange={e => setF(x => ({ ...x, recurrence: e.target.checked }))} /> Repeat / recurring finding</label></div>
              </div>
              <div className="row" style={{ marginTop: 8 }}><button className="btn" disabled={raise.isPending} onClick={() => raise.mutate()}>Raise finding</button></div>
              <ErrorNote error={raise.error} />
            </section>
          )}
        </>
      )}
    </Drawer>
  );
}

function FindingCard({ f, me, canManage, canVerify, onChange }: { f: FindingDto; me: string; canManage: boolean; canVerify: boolean; onChange(): void }) {
  const toast = useUi(s => s.toast);
  const [rc, setRc] = useState(f.rootCause ?? '');
  const [riskEdit, setRiskEdit] = useState({ likelihood: f.likelihood ?? 3, impact: f.impact ?? 3, classificationBasis: f.classificationBasis ?? '', containmentAction: f.containmentAction ?? '', recurrence: f.recurrence });
  const classify = useMutation({ mutationFn: () => post(`/quality/findings/${f.id}/classify`, riskEdit), onSuccess: () => { toast(`${f.id} risk classified`, 'cyan'); onChange(); } });
  const saveRc = useMutation({ mutationFn: () => post(`/quality/findings/${f.id}/root-cause`, { rootCause: rc }), onSuccess: () => { toast(`Root cause recorded for ${f.id}`, 'cyan'); onChange(); } });
  const close = useMutation({ mutationFn: () => post(`/quality/findings/${f.id}/close`), onSuccess: () => { toast(`${f.id} closed`, 'green'); onChange(); } });
  return (
    <section className="dsec">
      <h3><span className="mono">{f.id}</span> <Pill tone={levelTone[f.level]}>{label(f.level)}</Pill> <span className="mono note">{f.requirement}</span> <Pill tone={tone[f.status]}>{label(f.status)}</Pill></h3>
      <p style={{ margin: 0 }}>{f.description}</p>
      <div className="row" style={{ marginTop: 6 }}><Pill tone={riskTone(f.riskClass)}>{f.riskClass ?? 'UNCLASSIFIED'}{f.riskScore ? ` · ${f.riskScore}` : ''}</Pill>{f.recurrence && <Pill tone="amber">recurrence</Pill>}</div>
      {f.classificationBasis && <div className="sub">Classification basis: {f.classificationBasis}</div>}
      {f.containmentAction && <div className="sub">Containment: {f.containmentAction}</div>}
      {f.status === 'OPEN' && canManage && <details style={{ marginTop: 6 }}><summary>Classify / reassess quality risk</summary><div className="form-grid" style={{ marginTop: 8 }}><div className="field"><label>Likelihood</label><select className="inp" value={riskEdit.likelihood} onChange={e => setRiskEdit(x => ({ ...x, likelihood: Number(e.target.value) }))}>{[1,2,3,4,5].map(n => <option key={n}>{n}</option>)}</select></div><div className="field"><label>Impact</label><select className="inp" value={riskEdit.impact} onChange={e => setRiskEdit(x => ({ ...x, impact: Number(e.target.value) }))}>{[1,2,3,4,5].map(n => <option key={n}>{n}</option>)}</select></div><div className="field" style={{ gridColumn:'span 2' }}><label>Classification basis</label><textarea className="inp" rows={2} value={riskEdit.classificationBasis} onChange={e => setRiskEdit(x => ({...x,classificationBasis:e.target.value}))}/></div><div className="field" style={{ gridColumn:'span 2' }}><label>Containment</label><textarea className="inp" rows={2} value={riskEdit.containmentAction} onChange={e => setRiskEdit(x => ({...x,containmentAction:e.target.value}))}/></div><label><input type="checkbox" checked={riskEdit.recurrence} onChange={e => setRiskEdit(x => ({...x,recurrence:e.target.checked}))}/> Recurrence</label><div><Pill tone={riskTone(riskClass(riskEdit.likelihood,riskEdit.impact) as FindingDto['riskClass'])}>{riskClass(riskEdit.likelihood,riskEdit.impact)} · {riskEdit.likelihood*riskEdit.impact}</Pill></div></div><button className="btn sm" style={{ marginTop: 6 }} disabled={classify.isPending} onClick={() => classify.mutate()}>Save classification</button></details>}
      <div className="sub">raised {zulu(f.raisedAt)} by {who(f.raisedBy)} · due <span style={f.overdue ? { color: 'var(--red)' } : undefined}>{zulu(f.due)}{f.overdue ? ' (overdue)' : ''}</span>{f.closedBy ? ` · closed by ${who(f.closedBy)}` : ''}</div>
      {f.status === 'OPEN' && canManage ? (
        <div className="row" style={{ marginTop: 6 }}>
          <input className="inp" placeholder="Root cause (why it happened, not what)" value={rc} onChange={e => setRc(e.target.value)} />
          <button className="btn sm" disabled={saveRc.isPending || rc === (f.rootCause ?? '')} onClick={() => saveRc.mutate()}>Save root cause</button>
        </div>
      ) : f.rootCause && <div className="sub">Root cause: {f.rootCause}</div>}
      <div style={{ marginTop: 6 }}>
        <ActionsPanel sourceType="FINDING" sourceId={f.id} actions={f.actions} me={me} canManage={canManage} canVerify={canVerify} open={f.status === 'OPEN'} invalidate={[['audits'], ['actions']]} />
      </div>
      {f.status === 'OPEN' && canManage && <div className="row" style={{ marginTop: 6 }}><button className="btn pri sm" disabled={close.isPending} onClick={() => close.mutate()}>Close finding</button></div>}
      <ErrorNote error={classify.error ?? saveRc.error ?? close.error} />
    </section>
  );
}


function riskClass(likelihood: number, impact: number) {
  const score = likelihood * impact;
  return score >= 20 ? 'CRITICAL' : score >= 12 ? 'HIGH' : score >= 6 ? 'MEDIUM' : 'LOW';
}
const riskTone = (r: FindingDto['riskClass']) => r === 'CRITICAL' ? 'red' : r === 'HIGH' ? 'amber' : r === 'MEDIUM' ? 'cyan' : r === 'LOW' ? 'green' : '';

function FindingTracker({ findings, audits }: { findings: FindingDto[]; audits: QualityAuditDto[] }) {
  const [status, setStatus] = useState<'ALL'|'OPEN'|'CLOSED'>('OPEN');
  const [risk, setRisk] = useState<'ALL'|'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'>('ALL');
  const rows = findings.filter(f => (status === 'ALL' || f.status === status) && (risk === 'ALL' || f.riskClass === risk));
  const auditName = (id: string) => audits.find(a => a.id === id)?.title ?? id;
  const counts = { critical: findings.filter(f => f.status === 'OPEN' && f.riskClass === 'CRITICAL').length, high: findings.filter(f => f.status === 'OPEN' && f.riskClass === 'HIGH').length, overdue: findings.filter(f => f.overdue).length };
  return <>
    <div className="row" style={{ marginBottom: 12 }}><Card title="Critical open"><b>{counts.critical}</b></Card><Card title="High open"><b>{counts.high}</b></Card><Card title="Overdue"><b>{counts.overdue}</b></Card></div>
    <Card title="Finding & Non-Compliance Tracker" meta={`${rows.length} shown`} flush>
      <div className="row" style={{ padding: 10 }}><select className="inp" value={status} onChange={e => setStatus(e.target.value as typeof status)}><option>ALL</option><option>OPEN</option><option>CLOSED</option></select><select className="inp" value={risk} onChange={e => setRisk(e.target.value as typeof risk)}><option>ALL</option><option>CRITICAL</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select></div>
      <div className="tbl-wrap"><table className="t"><thead><tr><th>Finding</th><th>Audit / requirement</th><th>Classification</th><th>Due</th><th>CAPA</th><th>Status</th></tr></thead><tbody>
        {rows.map(f => <tr key={f.id}><td><b className="mono">{f.id}</b><div className="sub">{f.description}</div>{f.recurrence && <Pill tone="amber">repeat</Pill>}</td><td>{auditName(f.auditId)}<div className="sub mono">{f.requirement}</div></td><td><Pill tone={riskTone(f.riskClass)}>{f.riskClass ?? 'UNCLASSIFIED'}{f.riskScore ? ` · ${f.riskScore}` : ''}</Pill><div className="sub">L{f.likelihood ?? '–'} × I{f.impact ?? '–'} · {label(f.level)}</div></td><td className="mono" style={f.overdue ? { color: 'var(--red)' } : undefined}>{zulu(f.due)}</td><td>{f.actions.filter(a => a.status !== 'CANCELLED').length} · {f.actions.filter(a => a.status === 'VERIFIED').length} verified</td><td><Pill tone={tone[f.status]}>{label(f.status)}</Pill></td></tr>)}
        {rows.length === 0 && <tr><td colSpan={6} className="empty">No findings match the selected filters.</td></tr>}
      </tbody></table></div>
    </Card>
  </>;
}

function PlanDrawer({ onClose }: { onClose(): void }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const [f, setF] = useState({ title: '', area: '', reference: '', plannedFor: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10) });
  const plan = useMutation({ mutationFn: () => post<QualityAuditDto[]>('/quality/audits', f), onSuccess: () => { toast('Audit planned', 'cyan'); void qc.invalidateQueries({ queryKey: ['audits'] }); onClose(); } });
  return (
    <Drawer open onClose={onClose} eyebrow="Compliance monitoring" title="Plan an audit">
      <div className="form-grid">
        <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="a-t">Title</label><input id="a-t" className="inp" value={f.title} onChange={e => setF(x => ({ ...x, title: e.target.value }))} /></div>
        <div className="field"><label htmlFor="a-area">Area</label><input id="a-area" className="inp" placeholder="Part-145 line station BGO" value={f.area} onChange={e => setF(x => ({ ...x, area: e.target.value }))} /></div>
        <div className="field"><label htmlFor="a-ref">Reference</label><input id="a-ref" className="inp mono" placeholder="145.A.47, MOE 2.28" value={f.reference} onChange={e => setF(x => ({ ...x, reference: e.target.value }))} /></div>
        <div className="field"><label htmlFor="a-d">Date</label><input id="a-d" type="date" className="inp" value={f.plannedFor} onChange={e => setF(x => ({ ...x, plannedFor: e.target.value }))} /></div>
      </div>
      <div className="row" style={{ marginTop: 10 }}><button className="btn pri" disabled={plan.isPending} onClick={() => plan.mutate()}>Plan</button></div>
      <ErrorNote error={plan.error} />
    </Drawer>
  );
}

/** The signed-in user's corrective actions, and every open action for the quality manager. */
export function Actions() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') });
  const isQm = !!me.data?.roles.includes('quality_manager');
  const mine = useQuery({ queryKey: ['actions', 'mine'], queryFn: () => api<CorrectiveActionDto[]>('/quality/actions?scope=mine') });
  const all = useQuery({ queryKey: ['actions', 'open'], queryFn: () => api<CorrectiveActionDto[]>('/quality/actions?scope=open'), enabled: isQm });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['actions'] });
  const username = me.data?.username ?? '';
  return (
    <>
      <Head crumb="Quality" title="Corrective Actions" desc="Corrective and preventive actions from quality findings. Complete yours with evidence; the quality manager independently verifies effectiveness." />
      <Card title="Assigned to you" meta={`${mine.data?.length ?? 0}`}>
        <div className="stack" style={{ gap: 6 }}>
          {(mine.data ?? []).map(a => <ActionRow key={a.id} a={a} me={username} canVerify={isQm} onChange={refresh} />)}
          {mine.data?.length === 0 && <div className="empty">Nothing assigned to you.</div>}
        </div>
      </Card>
      {isQm && (
        <Card title="All open actions" meta={`${all.data?.length ?? 0}`}>
          <div className="stack" style={{ gap: 6 }}>
            {(all.data ?? []).map(a => <ActionRow key={a.id} a={a} me={username} canVerify onChange={refresh} />)}
            {all.data?.length === 0 && <div className="empty">No open actions.</div>}
          </div>
        </Card>
      )}
    </>
  );
}

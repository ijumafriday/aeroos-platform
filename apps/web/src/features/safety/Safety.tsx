import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { MeDto, OccurrenceCategory, OccurrenceDto, Probability, Severity5 } from '@aeroos/contracts';
import { api, post } from '../../lib/api';
import { zulu } from '../../lib/format';
import { useUi } from '../../lib/store';
import { Card, DL, Drawer, ErrorNote, Head, Pill } from '../../components/ui';
import { ActionsPanel } from '../shared/CorrectiveActions';

const CATS: OccurrenceCategory[] = ['MAINTENANCE', 'TECHNICAL', 'OPERATIONAL', 'GROUND', 'CABIN', 'SECURITY', 'OTHER'];
const tone: Record<string, string> = { REPORTED: 'amber', TRIAGED: 'cyan', UNDER_INVESTIGATION: 'mag', CLOSED: 'green' };
const riskTone: Record<string, string> = { INTOLERABLE: 'red', TOLERABLE: 'amber', ACCEPTABLE: 'green' };
const P: Probability[] = [5, 4, 3, 2, 1];
const S: Severity5[] = ['A', 'B', 'C', 'D', 'E'];
const PNAME: Record<number, string> = { 5: 'Frequent', 4: 'Occasional', 3: 'Remote', 2: 'Improbable', 1: 'Extremely improbable' };
const SNAME: Record<string, string> = { A: 'Catastrophic', B: 'Hazardous', C: 'Major', D: 'Minor', E: 'Negligible' };
const INTOL = new Set(['5A', '5B', '5C', '4A', '4B', '3A']);
const TOL = new Set(['5D', '5E', '4C', '4D', '4E', '3B', '3C', '3D', '2A', '2B', '2C', '1A']);
const cellTone = (k: string) => (INTOL.has(k) ? 'var(--red-bg)' : TOL.has(k) ? 'rgba(245,176,65,.18)' : 'rgba(46,204,113,.15)');
const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');
const localNow = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };

/** ICAO 5×5 risk matrix; click a cell to choose. */
function RiskMatrix({ value, onPick }: { value: { p: Probability; s: Severity5 } | null; onPick?(p: Probability, s: Severity5): void }) {
  return (
    <table className="t" style={{ width: 'auto' }} aria-label="Risk matrix">
      <thead><tr><th>Probability ↓ / Severity →</th>{S.map(s => <th key={s} title={SNAME[s]}>{s} <span className="note">{SNAME[s]}</span></th>)}</tr></thead>
      <tbody>{P.map(p => (
        <tr key={p}><th className="sub">{p} {PNAME[p]}</th>
          {S.map(s => {
            const k = `${p}${s}`, on = value?.p === p && value?.s === s;
            return <td key={k} style={{ background: cellTone(k), textAlign: 'center', cursor: onPick ? 'pointer' : 'default', outline: on ? '2px solid var(--fg, #000)' : undefined }}
              onClick={() => onPick?.(p, s)}><span className="mono">{k}</span></td>;
          })}
        </tr>
      ))}</tbody>
    </table>
  );
}

/** Safety management: anyone reports (optionally confidential); the safety office triages, investigates and closes. */
export function Safety() {
  const { report } = useSearch({ from: '/safety/reports' });
  const navigate = useNavigate({ from: '/safety/reports' });
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') });
  const q = useQuery({ queryKey: ['occurrences'], queryFn: () => api<OccurrenceDto[]>('/safety/occurrences') });
  const [reporting, setReporting] = useState(false);
  const morDue = (q.data ?? []).filter(o => o.morOverdue);
  return (
    <>
      <Head crumb="Safety" title="Safety Reports (SMS)"
        desc="Report anything that did or could affect safety — hazards, errors, near misses. Reports are handled under a just culture; tick confidential and your name is seen only by the safety office. Mandatory occurrences go to the authority within 72 hours (EU 376/2014)."
        actions={<button className="btn pri" onClick={() => setReporting(true)}>Report an occurrence</button>} />
      {morDue.length > 0 && <div className="callout red"><b>Mandatory occurrence report overdue:</b> {morDue.map(o => o.id).join(', ')} — file with the authority now.</div>}
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      <Card title={q.data?.some(o => o.canManage) ? 'All reports' : 'Your reports'} meta={`${q.data?.length ?? 0}`} flush>
        <div className="tbl-wrap"><table className="t">
          <thead><tr><th>Report</th><th>What happened</th><th>Status</th><th>Risk</th><th>MOR</th><th>Actions</th></tr></thead>
          <tbody>
            {(q.data ?? []).map(o => (
              <tr key={o.id} className="click" tabIndex={0} onClick={() => navigate({ search: { report: o.id } })} onKeyDown={e => e.key === 'Enter' && navigate({ search: { report: o.id } })}>
                <td><b className="mono">{o.id}</b><div className="sub">{zulu(o.occurredAt)}{o.station ? ` · ${o.station}` : ''}{o.tail ? ` · ${o.tail}` : ''}</div></td>
                <td>{o.title} <span className="note">{label(o.category)}</span>{o.confidential && <> <Pill>confidential</Pill></>}</td>
                <td><Pill tone={tone[o.status]}>{label(o.status)}</Pill></td>
                <td>{o.risk ? <Pill tone={riskTone[o.risk.tolerability]}>{o.risk.index} {o.risk.tolerability.toLowerCase()}</Pill> : '—'}</td>
                <td>{o.mandatory ? (o.authorityReportedAt ? <Pill tone="green">filed</Pill> : <Pill tone={o.morOverdue ? 'red' : 'amber'}>due {zulu(o.morDeadline!)}</Pill>) : '—'}</td>
                <td className="mono">{o.actions.filter(a => a.status === 'VERIFIED').length}/{o.actions.length}</td>
              </tr>
            ))}
            {q.data?.length === 0 && <tr><td colSpan={6} className="empty">No reports yet.</td></tr>}
          </tbody>
        </table></div>
      </Card>
      <OccurrenceDrawer key={report ?? 'none'} id={report ?? null} me={me.data?.username ?? ''} onClose={() => navigate({ search: { report: undefined } })} />
      {reporting && <ReportDrawer onClose={id => { setReporting(false); if (id) navigate({ search: { report: id } }); }} />}
    </>
  );
}

function OccurrenceDrawer({ id, me, onClose }: { id: string | null; me: string; onClose(): void }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const q = useQuery({ queryKey: ['occurrence', id], queryFn: () => api<OccurrenceDto>(`/safety/occurrences/${id}`), enabled: !!id });
  const o = q.data;
  const [pick, setPick] = useState<{ p: Probability; s: Severity5 } | null>(null);
  const [resid, setResid] = useState<{ p: Probability; s: Severity5 } | null>(null);
  const [mandatory, setMandatory] = useState(false);
  const [investigator, setInvestigator] = useState('');
  const [mor, setMor] = useState({ ref: '', at: localNow() });
  const [findings, setFindings] = useState('');
  useEffect(() => {
    if (!o) return;
    setPick(o.risk ? { p: o.risk.probability, s: o.risk.severity } : null); setMandatory(o.mandatory); setInvestigator(o.investigator ?? ''); setFindings(o.findings ?? '');
    setResid(o.residualRisk ? { p: o.residualRisk.probability, s: o.residualRisk.severity } : null);
    setMor({ ref: '', at: localNow() });
  }, [o?.id, o?.version]);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['occurrences'] }); void qc.invalidateQueries({ queryKey: ['occurrence', id] }); };
  const triage = useMutation({ mutationFn: () => post<OccurrenceDto>(`/safety/occurrences/${id}/triage`, { mandatory, probability: pick!.p, severity: pick!.s, investigator: investigator.trim() || null, version: o!.version }),
    onSuccess: r => { toast(`${r.id} triaged — ${label(r.status)}`, 'cyan'); refresh(); } });
  const fileMor = useMutation({ mutationFn: () => post<OccurrenceDto>(`/safety/occurrences/${id}/mor`, { authorityRef: mor.ref, reportedAt: new Date(mor.at).toISOString() }),
    onSuccess: r => { toast(`${r.id} reported to the authority as ${r.authorityRef}`, 'green'); refresh(); } });
  const close = useMutation({ mutationFn: () => post<OccurrenceDto>(`/safety/occurrences/${id}/close`, { residualProbability: resid!.p, residualSeverity: resid!.s, findings: findings.trim() || null, version: o!.version }),
    onSuccess: r => { toast(`${r.id} closed`, 'green'); refresh(); } });
  return (
    <Drawer open={!!id} onClose={onClose} eyebrow={o ? `Safety report · ${label(o.category)}` : 'Safety report'} title={o ? `${o.id} · ${o.title}` : id ?? ''}
      tags={o && <Pill tone={tone[o.status]}>{label(o.status)}</Pill>}>
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      {o && (
        <>
          <DL items={[
            ['Occurred', `${zulu(o.occurredAt)}${o.station ? ` · ${o.station}` : ''}${o.tail ? ` · ${o.tail}` : ''}${o.flightNo ? ` · ${o.flightNo}` : ''}`],
            ['Reported', `${zulu(o.reportedAt)} · ${o.reportedBy ?? 'confidential reporter'}`],
            ['Risk', o.risk ? `${o.risk.index} — ${o.risk.tolerability.toLowerCase()} (${PNAME[o.risk.probability].toLowerCase()} · ${SNAME[o.risk.severity].toLowerCase()})` : 'not assessed'],
            ['Mandatory report', o.mandatory ? (o.authorityReportedAt ? `filed ${zulu(o.authorityReportedAt)} · ${o.authorityRef}` : `due by ${zulu(o.morDeadline!)}`) : 'no'],
            ['Investigator', o.investigator ?? '—'],
            ...(o.residualRisk ? [['Residual risk', `${o.residualRisk.index} — ${o.residualRisk.tolerability.toLowerCase()}`] as [string, string]] : [])
          ]} />
          <section className="dsec"><h3>What happened</h3><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{o.description}</p></section>

          {o.canManage && (o.status === 'REPORTED' || o.status === 'TRIAGED') && (
            <section className="dsec">
              <h3>Triage and risk</h3>
              <RiskMatrix value={pick} onPick={(p, s) => setPick({ p, s })} />
              <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={mandatory} onChange={e => setMandatory(e.target.checked)} /> Mandatory occurrence (report to the authority in 72 h)</label>
                <input className="inp mono" style={{ maxWidth: 200 }} placeholder="Investigator (username)" value={investigator} onChange={e => setInvestigator(e.target.value)} />
                <button className="btn pri" disabled={!pick || triage.isPending} onClick={() => triage.mutate()}>Record triage</button>
              </div>
              <div className="note">A tolerable or intolerable risk needs an investigation.</div>
              <ErrorNote error={triage.error} />
            </section>
          )}
          {o.canManage && o.mandatory && !o.authorityReportedAt && o.status !== 'CLOSED' && (
            <section className="dsec">
              <h3>Report to the authority</h3>
              <div className="row"><input className="inp mono" placeholder="Authority reference" value={mor.ref} onChange={e => setMor(x => ({ ...x, ref: e.target.value }))} />
                <input type="datetime-local" className="inp" value={mor.at} onChange={e => setMor(x => ({ ...x, at: e.target.value }))} />
                <button className="btn" disabled={fileMor.isPending} onClick={() => fileMor.mutate()}>Record filing</button></div>
              <ErrorNote error={fileMor.error} />
            </section>
          )}
          <section className="dsec">
            <h3>Corrective actions</h3>
            <ActionsPanel sourceType="OCCURRENCE" sourceId={o.id} actions={o.actions} me={me} canManage={o.canManage} canVerify={o.canManage} open={o.status !== 'CLOSED'} invalidate={[['occurrence', o.id], ['occurrences'], ['actions']]} />
          </section>
          {o.canManage && o.status !== 'CLOSED' && o.status !== 'REPORTED' && (
            <section className="dsec">
              <h3>Close</h3>
              <textarea className="inp" rows={3} placeholder="Investigation findings: what happened, why, and what changes" value={findings} onChange={e => setFindings(e.target.value)} />
              <div className="note" style={{ margin: '6px 0' }}>Residual risk after the actions:</div>
              <RiskMatrix value={resid} onPick={(p, s) => setResid({ p, s })} />
              <div className="row" style={{ marginTop: 8 }}><button className="btn pri" disabled={!resid || close.isPending} onClick={() => close.mutate()}>Close the report</button></div>
              <ErrorNote error={close.error} />
            </section>
          )}
          {o.findings && o.status === 'CLOSED' && <section className="dsec"><h3>Findings</h3><p style={{ margin: 0 }}>{o.findings}</p></section>}
        </>
      )}
    </Drawer>
  );
}

function ReportDrawer({ onClose }: { onClose(id?: string): void }) {
  const toast = useUi(s => s.toast);
  const qc = useQueryClient();
  const [f, setF] = useState({ occurredAt: localNow(), station: '', tail: '', flightNo: '', category: 'MAINTENANCE' as OccurrenceCategory, title: '', description: '', confidential: false });
  const set = (k: keyof typeof f, v: unknown) => setF(x => ({ ...x, [k]: v }));
  const send = useMutation({
    mutationFn: () => post<OccurrenceDto>('/safety/occurrences', { ...f, occurredAt: new Date(f.occurredAt).toISOString(), station: f.station || null, tail: f.tail || null, flightNo: f.flightNo || null }),
    onSuccess: o => { toast(`${o.id} reported — thank you`, 'green'); void qc.invalidateQueries({ queryKey: ['occurrences'] }); onClose(o.id); }
  });
  return (
    <Drawer open onClose={() => onClose()} eyebrow="Safety management" title="Report an occurrence">
      <div className="form-grid">
        <div className="field"><label htmlFor="o-when">When</label><input id="o-when" type="datetime-local" className="inp" value={f.occurredAt} onChange={e => set('occurredAt', e.target.value)} /></div>
        <div className="field"><label htmlFor="o-cat">Category</label><select id="o-cat" className="inp" value={f.category} onChange={e => set('category', e.target.value)}>{CATS.map(c => <option key={c} value={c}>{label(c)}</option>)}</select></div>
        <div className="field"><label htmlFor="o-stn">Station (ICAO)</label><input id="o-stn" className="inp mono" maxLength={4} value={f.station} onChange={e => set('station', e.target.value.toUpperCase())} /></div>
        <div className="field"><label htmlFor="o-tail">Aircraft</label><input id="o-tail" className="inp mono" value={f.tail} onChange={e => set('tail', e.target.value.toUpperCase())} /></div>
        <div className="field"><label htmlFor="o-flt">Flight</label><input id="o-flt" className="inp mono" value={f.flightNo} onChange={e => set('flightNo', e.target.value.toUpperCase())} /></div>
        <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="o-title">Title</label><input id="o-title" className="inp" value={f.title} onChange={e => set('title', e.target.value)} /></div>
        <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="o-desc">What happened</label><textarea id="o-desc" className="inp" rows={5} value={f.description} onChange={e => set('description', e.target.value)} /></div>
        <label className="row" style={{ gap: 4, gridColumn: 'span 2' }}><input type="checkbox" checked={f.confidential} onChange={e => set('confidential', e.target.checked)} /> Confidential — only the safety office sees my name</label>
      </div>
      <div className="row" style={{ marginTop: 10 }}><button className="btn pri" disabled={send.isPending} onClick={() => send.mutate()}>Submit report</button></div>
      <ErrorNote error={send.error} />
    </Drawer>
  );
}

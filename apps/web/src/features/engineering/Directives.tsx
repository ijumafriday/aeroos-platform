import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { DirectiveDecision, DirectiveDto, FleetTailDto, MeDto } from '@aeroos/contracts';
import { api, post } from '../../lib/api';
import { zulu } from '../../lib/format';
import { useUi } from '../../lib/store';
import { Attachments } from '../../components/Attachments';
import { Card, DL, Drawer, ErrorNote, Head, Pill } from '../../components/ui';

const tone: Record<string, string> = { RECEIVED: 'amber', EVALUATED: 'cyan', DEFERRED: 'mag', NOT_APPLICABLE_PENDING: 'amber', INCORPORATED: 'green', NOT_APPLICABLE: '', REJECTED: 'red', SUPERSEDED: '' };
const label = (s: string) => (s === 'NOT_APPLICABLE_PENDING' ? 'not applicable — awaiting 2nd signature' : s.toLowerCase().replace(/_/g, ' '));
const who = (s: string | null) => (s ?? '').replace(/^user:/, '');
const interval = (i: DirectiveDto['interval']) => [i.fh && `${i.fh} FH`, i.fc && `${i.fc} FC`, i.days && `${i.days} days`].filter(Boolean).join(' / ') || '—';
const due = (d: DirectiveDto) => (d.daysToEffective > 0 ? `effective in ${d.daysToEffective} d` : d.daysToEffective === 0 ? 'effective today' : `effective since ${d.effective}`);

/** AD / SB intake: received → evaluated per aircraft → incorporated into the maintenance programme (second person). */
export function Directives() {
  const { directive } = useSearch({ from: '/camo/directives' });
  const navigate = useNavigate({ from: '/camo/directives' });
  const [scope, setScope] = useState<'open' | 'closed' | 'all'>('open');
  const [adding, setAdding] = useState(false);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') });
  const q = useQuery({ queryKey: ['directives', scope], queryFn: () => api<DirectiveDto[]>(`/camo/directives?scope=${scope}`) });
  const canEdit = !!me.data?.roles.some(r => r === 'camo_engineer' || r === 'camo_manager');
  return (
    <>
      <Head crumb="CAMO / Engineering" title="AD / SB & Engineering Orders"
        desc="Airworthiness directives and service bulletins: applicability per aircraft by type and MSN, an engineering decision, and incorporation into the maintenance programme by a second person. An applicable AD cannot be deferred or rejected."
        actions={canEdit && <button className="btn pri" onClick={() => setAdding(true)}>Record AD / SB</button>} />
      <div className="row" style={{ marginBottom: 10 }}>
        {(['open', 'closed', 'all'] as const).map(s => <button key={s} className={`btn sm ${scope === s ? 'pri' : 'ghost'}`} onClick={() => setScope(s)}>{s}</button>)}
      </div>
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      <Card title="Directives" meta={`${q.data?.length ?? 0}`} flush>
        <div className="tbl-wrap">
          <table className="t">
            <thead><tr><th>Reference</th><th>Title</th><th>Status</th><th>Aircraft affected</th><th>Effective</th><th>Compliance</th></tr></thead>
            <tbody>
              {(q.data ?? []).map(d => (
                <tr key={d.id} className="click" tabIndex={0} onClick={() => navigate({ search: { directive: d.id } })} onKeyDown={e => e.key === 'Enter' && navigate({ search: { directive: d.id } })}>
                  <td><Pill tone={d.kind === 'AD' ? 'red' : 'cyan'}>{d.kind}</Pill> <b className="mono">{d.ref}{d.revision ? ` R${d.revision}` : ''}</b></td>
                  <td>{d.title} <span className="note">ATA {d.ata}</span></td>
                  <td><Pill tone={tone[d.status]}>{label(d.status)}</Pill></td>
                  <td className="mono">{d.affected ? d.tails.filter(t => t.applicable).map(t => t.tail).join(', ') : '—'}</td>
                  <td className="mono" style={d.status === 'RECEIVED' && d.kind === 'AD' && d.daysToEffective <= 14 ? { color: 'var(--red)' } : undefined}>{due(d)}</td>
                  <td className="mono">{interval(d.interval)}{d.repetitive ? ' rep.' : ''}</td>
                </tr>
              ))}
              {q.data?.length === 0 && <tr><td colSpan={6} className="empty">Nothing {scope === 'open' ? 'waiting for evaluation' : 'here'}.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      <DirectiveDrawer id={directive ?? null} canEdit={canEdit} me={me.data?.username ?? ''} onClose={() => navigate({ search: { directive: undefined } })} />
      {adding && <ReceiveDrawer onClose={id => { setAdding(false); if (id) navigate({ search: { directive: id } }); }} />}
    </>
  );
}

function DirectiveDrawer({ id, canEdit, me, onClose }: { id: string | null; canEdit: boolean; me: string; onClose(): void }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const q = useQuery({ queryKey: ['directive', id], queryFn: () => api<DirectiveDto>(`/camo/directives/${id}`), enabled: !!id });
  const d = q.data;
  const [decision, setDecision] = useState<DirectiveDecision>('COMPLY');
  const [reason, setReason] = useState('');
  const [overrides, setOverrides] = useState<Record<string, { applicable: boolean; reason: string }>>({});
  useEffect(() => {
    if (!d) return;
    setDecision(d.kind === 'AD' ? (d.affected ? 'COMPLY' : 'NOT_APPLICABLE') : (d.affected ? 'EMBODY' : 'NOT_APPLICABLE'));
    setReason('');
    // Start from the overrides already recorded: a re-evaluation keeps them unless they are unticked.
    setOverrides(Object.fromEntries(d.tails.filter(t => t.overridden && t.type).map(t => [t.tail, { applicable: t.applicable, reason: t.reason }])));
  }, [d?.id, d?.version]);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['directives'] }); void qc.invalidateQueries({ queryKey: ['directive', id] }); };
  const evaluate = useMutation({
    mutationFn: () => post<DirectiveDto>(`/camo/directives/${id}/evaluate`, {
      decision, reason: reason.trim() || null, version: d!.version,
      overrides: Object.keys(overrides).map(tail => ({ tail, applicable: overrides[tail].applicable, reason: overrides[tail].reason }))
    }),
    onSuccess: r => { toast(`${r.ref} evaluated — ${label(r.status)}`, 'cyan'); refresh(); }
  });
  const confirmNa = useMutation({
    mutationFn: () => post<DirectiveDto>(`/camo/directives/${id}/confirm-not-applicable`, { version: d!.version }),
    onSuccess: r => { toast(`${r.ref} confirmed not applicable`, 'cyan'); refresh(); }
  });
  const incorporate = useMutation({
    mutationFn: () => post<DirectiveDto>(`/camo/directives/${id}/incorporate`, { version: d!.version }),
    onSuccess: r => { toast(`${r.ref} is now on the due list (${r.requirementId})`, 'green'); refresh(); void qc.invalidateQueries({ queryKey: ['programme'] }); }
  });
  const open = d && ['RECEIVED', 'EVALUATED', 'DEFERRED', 'NOT_APPLICABLE_PENDING'].includes(d.status);
  const evaluatedByMe = !!me && d?.evaluatedBy === `user:${me}`;
  const decisions: DirectiveDecision[] = d?.kind === 'AD' ? ['COMPLY', 'NOT_APPLICABLE'] : ['EMBODY', 'DEFER', 'REJECT', 'NOT_APPLICABLE'];
  return (
    <Drawer open={!!id} onClose={onClose} eyebrow={d ? `${d.kind === 'AD' ? 'Airworthiness directive' : 'Service bulletin'} · ${d.authority} · ATA ${d.ata}` : 'Directive'}
      title={d ? `${d.ref}${d.revision ? ` R${d.revision}` : ''}` : id ?? ''} tags={d && <Pill tone={tone[d.status]}>{label(d.status)}</Pill>}>
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      {d && (
        <>
          <h3 style={{ margin: 0, font: '700 20px var(--f-disp)' }}>{d.title}</h3>
          <DL items={[
            ['Effective', `${d.effective} (${due(d)})`], ['Types', d.types.join(', ')],
            ['MSN ranges', d.msnRanges ? d.msnRanges.map(r => `${r.from}–${r.to}`).join(', ') : 'all'],
            ['Compliance', `${interval(d.interval)}${d.repetitive ? ', repetitive' : ', one-time'} · ${d.estimatedHours} h`],
            ['Received', `${zulu(d.receivedAt)} · ${who(d.receivedBy)}`],
            ...(d.evaluatedBy ? [['Evaluated', `${zulu(d.evaluatedAt!)} · ${who(d.evaluatedBy)} · ${d.decision ? label(d.decision) : ''}${d.decisionReason ? ` — ${d.decisionReason}` : ''}`] as [string, string]] : []),
            ...(d.confirmedBy ? [['Confirmed', `${zulu(d.confirmedAt!)} · ${who(d.confirmedBy)}`] as [string, string]] : []),
            ...(d.incorporatedBy ? [['Incorporated', `${zulu(d.incorporatedAt!)} · ${who(d.incorporatedBy)} · ${d.requirementId}`] as [string, string]] : [])
          ]} />
          <section className="dsec"><h3>Required action</h3><p style={{ margin: 0 }}>{d.action}</p>
            {d.steps.length > 0 && <ol className="sub">{d.steps.map(s => <li key={s}>{s}</li>)}</ol>}</section>

          <section className="dsec">
            <h3>Applicability by aircraft</h3>
            <div className="tbl-wrap"><table className="t">
              <thead><tr><th>Aircraft</th><th>Type · MSN</th><th>Applies</th><th>Why</th>{open && canEdit && <th>Override</th>}</tr></thead>
              <tbody>{d.tails.filter(t => t.applicable || d.types.includes(t.type)).map(t => {
                const o = overrides[t.tail];
                const auto = t.overridden ? !t.applicable : t.applicable; // the published applicability
                const applies = o ? o.applicable : auto;
                return (
                  <tr key={t.tail}>
                    <td className="mono">{t.tail}</td><td className="mono">{t.type} · {t.msn}</td>
                    <td><Pill tone={applies ? 'red' : ''}>{applies ? 'yes' : 'no'}</Pill>{o && <span className="note"> overridden</span>}</td>
                    <td className="sub">{t.reason}</td>
                    {open && canEdit && <td>
                      <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={!!o} onChange={e => setOverrides(x => { const n = { ...x }; if (e.target.checked) n[t.tail] = { applicable: !auto, reason: '' }; else delete n[t.tail]; return n; })} /> override: {auto ? 'not applicable' : 'applicable'}</label>
                      {o && <input className="inp" placeholder="Reason, e.g. mod embodied at production" value={o.reason} onChange={e => setOverrides(x => ({ ...x, [t.tail]: { ...o, reason: e.target.value } }))} />}
                    </td>}
                  </tr>
                );
              })}</tbody>
            </table></div>
            <div className="note">Aircraft of other types are not affected and not listed.</div>
          </section>

          {open && canEdit && (
            <section className="dsec">
              <h3>Engineering decision</h3>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {decisions.map(x => <label key={x} className="row" style={{ gap: 4 }}><input type="radio" name="dec" checked={decision === x} onChange={() => setDecision(x)} /> {label(x)}</label>)}
              </div>
              {decision !== 'COMPLY' && decision !== 'EMBODY' && (
                <textarea className="inp" rows={3} style={{ marginTop: 8 }} placeholder={decision === 'NOT_APPLICABLE' ? 'Why it does not apply' : 'Engineering justification'} value={reason} onChange={e => setReason(e.target.value)} />
              )}
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn" disabled={evaluate.isPending} onClick={() => evaluate.mutate()}>Record evaluation</button>
                {d.status === 'NOT_APPLICABLE_PENDING' && (
                  <button className="btn pri" disabled={confirmNa.isPending || evaluatedByMe} onClick={() => confirmNa.mutate()}>Confirm not applicable (second signature)</button>
                )}
                {d.status === 'EVALUATED' && (
                  <button className="btn pri" disabled={incorporate.isPending || evaluatedByMe} onClick={() => incorporate.mutate()}
                    title={evaluatedByMe ? 'A different person must incorporate it' : ''}>Incorporate into the maintenance programme</button>
                )}
              </div>
              {(d.status === 'EVALUATED' || d.status === 'NOT_APPLICABLE_PENDING') && evaluatedByMe && <div className="note">You evaluated it; another CAMO engineer or the CAMO manager gives the second signature (four-eyes).</div>}
              <ErrorNote error={evaluate.error ?? incorporate.error ?? confirmNa.error} />
            </section>
          )}
          {d.requirementId && <div className="callout green">On the due list as <b className="mono">{d.requirementId}</b> for {d.tails.filter(t => t.applicable).map(t => t.tail).join(', ')}. <Link to="/camo/programme" search={{ tail: undefined, ref: undefined }}>Open the due list</Link></div>}

          <section className="dsec"><h3>Documents</h3><Attachments ownerType="directive" ownerId={d.id} canAttach={canEdit} /></section>
        </>
      )}
    </Drawer>
  );
}

function ReceiveDrawer({ onClose }: { onClose(id?: string): void }) {
  const toast = useUi(s => s.toast);
  const qc = useQueryClient();
  const fleet = useQuery({ queryKey: ['fleet'], queryFn: () => api<FleetTailDto[]>('/camo/fleet') });
  const types = [...new Set((fleet.data ?? []).map(f => f.type))];
  const [f, setF] = useState({ kind: 'AD' as 'AD' | 'SB', ref: '', revision: '', authority: 'EASA', title: '', ata: '', types: [] as string[], msn: '', effective: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), action: '', fh: '', fc: '', days: '', repetitive: false, hours: '2' });
  const set = (k: keyof typeof f, v: unknown) => setF(x => ({ ...x, [k]: v }));
  const num = (s: string) => (s.trim() ? Number(s) : undefined);
  const save = useMutation({
    mutationFn: () => post<DirectiveDto>('/camo/directives', {
      kind: f.kind, ref: f.ref, revision: f.revision, authority: f.authority, title: f.title, ata: f.ata, types: f.types,
      msnRanges: f.msn.trim() ? f.msn.split(',').map(s => s.trim()).filter(Boolean).map(s => { const [from, to] = s.split(/\s*[-–]\s*/); return { from, to: to ?? from }; }) : null,
      effective: f.effective, action: f.action, interval: { fh: num(f.fh), fc: num(f.fc), days: num(f.days) }, repetitive: f.repetitive, estimatedHours: Number(f.hours) || 1, steps: [], supersedes: null
    }),
    onSuccess: d => { toast(`${d.ref} recorded — ${d.affected} aircraft affected`, 'amber'); void qc.invalidateQueries({ queryKey: ['directives'] }); onClose(d.id); }
  });
  return (
    <Drawer open onClose={() => onClose()} eyebrow="CAMO / Engineering" title="Record an AD or SB">
      <div className="form-grid">
        <div className="field"><label htmlFor="d-kind">Kind</label><select id="d-kind" className="inp" value={f.kind} onChange={e => set('kind', e.target.value)}><option value="AD">Airworthiness directive</option><option value="SB">Service bulletin</option></select></div>
        <div className="field"><label htmlFor="d-ref">Reference</label><input id="d-ref" className="inp mono" placeholder="EASA AD 2026-0230" value={f.ref} onChange={e => set('ref', e.target.value)} /></div>
        <div className="field"><label htmlFor="d-rev">Revision</label><input id="d-rev" className="inp mono" value={f.revision} onChange={e => set('revision', e.target.value)} /></div>
        <div className="field"><label htmlFor="d-auth">Issued by</label><input id="d-auth" className="inp" value={f.authority} onChange={e => set('authority', e.target.value)} /></div>
        <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="d-title">Title</label><input id="d-title" className="inp" value={f.title} onChange={e => set('title', e.target.value)} /></div>
        <div className="field"><label htmlFor="d-ata">ATA</label><input id="d-ata" className="inp mono" maxLength={2} value={f.ata} onChange={e => set('ata', e.target.value.replace(/\D/g, ''))} /></div>
        <div className="field"><label htmlFor="d-eff">Effective</label><input id="d-eff" type="date" className="inp" value={f.effective} onChange={e => set('effective', e.target.value)} /></div>
        <div className="field" style={{ gridColumn: 'span 2' }}><label>Aircraft types</label>
          <div className="row" style={{ flexWrap: 'wrap' }}>{types.map(t => <label key={t} className="row" style={{ gap: 4 }}><input type="checkbox" checked={f.types.includes(t)} onChange={e => set('types', e.target.checked ? [...f.types, t] : f.types.filter(x => x !== t))} /> {t}</label>)}</div></div>
        <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="d-msn">MSN ranges (blank = all)</label><input id="d-msn" className="inp mono" placeholder="38800-38872, 41001-41500" value={f.msn} onChange={e => set('msn', e.target.value)} /></div>
        <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="d-act">Required action</label><textarea id="d-act" className="inp" rows={3} value={f.action} onChange={e => set('action', e.target.value)} /></div>
        <div className="field"><label htmlFor="d-fh">Within FH</label><input id="d-fh" className="inp mono" inputMode="decimal" value={f.fh} onChange={e => set('fh', e.target.value)} /></div>
        <div className="field"><label htmlFor="d-fc">Within FC</label><input id="d-fc" className="inp mono" inputMode="numeric" value={f.fc} onChange={e => set('fc', e.target.value)} /></div>
        <div className="field"><label htmlFor="d-days">Within days</label><input id="d-days" className="inp mono" inputMode="numeric" value={f.days} onChange={e => set('days', e.target.value)} /></div>
        <div className="field"><label htmlFor="d-h">Est. hours</label><input id="d-h" className="inp mono" value={f.hours} onChange={e => set('hours', e.target.value)} /></div>
        <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={f.repetitive} onChange={e => set('repetitive', e.target.checked)} /> Repetitive</label>
      </div>
      <div className="row" style={{ marginTop: 10 }}><button className="btn pri" disabled={save.isPending} onClick={() => save.mutate()}>Record</button></div>
      <ErrorNote error={save.error} />
    </Drawer>
  );
}

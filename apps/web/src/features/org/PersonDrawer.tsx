import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuditEntryDto, AuthorisationDto, FleetTailDto, PersonnelDetailDto, TrainingCourse } from '@aeroos/contracts';
import { Attachments } from '../../components/Attachments';
import { api, post } from '../../lib/api';
import { openDocument } from '../../lib/documents';
import { short, zulu } from '../../lib/format';
import { useNow, useUi } from '../../lib/store';
import { DL, Dialog, Drawer, ErrorNote, Pill } from '../../components/ui';
import { authTone, expiryTone, inDays } from './status';

type Detail = PersonnelDetailDto & { audit: AuditEntryDto[] };
const day = (iso: string) => iso.slice(0, 10);
const COURSES: [TrainingCourse, string][] = [
  ['CONTINUATION', 'Continuation training'], ['HUMAN_FACTORS', 'Human factors'], ['TYPE', 'Type training'],
  ['FUEL_TANK_SAFETY', 'Fuel tank safety'], ['EWIS', 'EWIS']
];

export function PersonDrawer({ id, onClose }: { id: string | null; onClose(): void }) {
  const qc = useQueryClient();
  const now = useNow();
  const q = useQuery({ queryKey: ['personnel', 'detail', id], queryFn: () => api<Detail>(`/org/personnel/${id}`), enabled: !!id });
  const [dialog, setDialog] = useState<null | { kind: 'issue' } | { kind: 'training' } | { kind: 'status'; action: 'suspend' | 'reinstate' | 'revoke'; auth: AuthorisationDto }>(null);
  const [docError, setDocError] = useState<unknown>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['personnel'] });
  const d = q.data;
  const manage = d?.permissions.manage ?? false;
  const live = d?.authorisations.find(a => a.status === 'ACTIVE' || a.status === 'SUSPENDED');

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      eyebrow={d ? `Personnel file · ${d.id}` : 'Personnel file'}
      title={d?.name ?? id ?? ''}
      tags={d && <>
        {d.licenceNo && <Pill tone="cyan">{d.licenceNo}</Pill>}
        {d.currency && <Pill tone={d.currency.current ? 'green' : 'red'}>{d.currency.current ? 'current' : 'not current'}</Pill>}
        {live && <Pill tone={authTone(live.status)}>{live.reference} · {live.status}</Pill>}
      </>}
    >
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      {d && (
        <>
          {d.currency && (
            <div className={`callout ${d.currency.current ? 'green' : 'red'}`}>
              <b>{d.currency.current ? 'Current — may exercise certification privileges' : 'Not current — certification will be refused'}</b>
              <div className="sub">
                {d.currency.current
                  ? `Continuation training due ${day(d.currency.trainingDue!)} · ${d.currency.experienceMonthsLast24} months of maintenance experience in the last 24`
                  : d.currency.reason}
              </div>
              <div className="note mono">{d.currency.rule} · {d.currency.basis}</div>
            </div>
          )}

          <section className="dsec">
            <h3>Licences (Part-66)</h3>
            {d.licences.length === 0 && <p className="note">No licence on file.</p>}
            <div className="stack">
              {d.licences.map(l => (
                <div key={l.id} className="auth-card">
                  <div className="row between">
                    <b>{l.authority} {l.category}</b>
                    <Pill tone={expiryTone(l.validUntil, now) || 'green'}>{Date.parse(l.validUntil) <= now ? 'expired' : `valid to ${day(l.validUntil)}`}</Pill>
                  </div>
                  <div className="note">Type ratings: {l.typeRatings.join(', ') || '—'}</div>
                  {manage
                    ? <Attachments ownerType="licence" ownerId={l.id} canAttach />
                    : l.documentId && <button className="btn sm" onClick={() => openDocument(l.documentId!).catch(setDocError)}>Open licence scan</button>}
                </div>
              ))}
            </div>
          </section>

          <section className="dsec">
            <div className="row between"><h3 style={{ margin: 0 }}>Company authorisation</h3>
              {manage && !live && <button className="btn sm pri" onClick={() => setDialog({ kind: 'issue' })}>Issue authorisation</button>}
            </div>
            {d.authorisations.length === 0 && <p className="note">No company authorisation.</p>}
            <div className="stack">
              {d.authorisations.map(a => (
                <div key={a.id} className={`auth-card ${a.status === 'ACTIVE' ? 'live' : a.status === 'SUSPENDED' ? 'susp' : ''}`}>
                  <div className="row between">
                    <span className="row" style={{ gap: 8 }}><b className="mono">{a.reference}</b><Pill tone={authTone(a.status)}>{a.status}</Pill></span>
                    {(a.status === 'ACTIVE' || a.status === 'SUSPENDED') && <Pill tone={expiryTone(a.validUntil, now)}>{inDays(a.validUntil, now)}</Pill>}
                  </div>
                  <DL items={[['Aircraft types', a.aircraftTypes.join(', ')], ['Valid', `${day(a.issuedAt)} → ${day(a.validUntil)}`], ['Scope checked by', a.issueRule]]} />
                  <div className="hist">
                    {a.history.map((h, i) => <span key={i}>{zulu(h.at)} · {h.action.toLowerCase()} by {h.by.replace(/^user:/, '')}{h.reason ? ` — ${h.reason}` : ''}</span>)}
                  </div>
                  {manage && (a.status === 'ACTIVE' || a.status === 'SUSPENDED') && (
                    <div className="row">
                      {a.status === 'ACTIVE' && <button className="btn sm warn" onClick={() => setDialog({ kind: 'status', action: 'suspend', auth: a })}>Suspend</button>}
                      {a.status === 'SUSPENDED' && <button className="btn sm" onClick={() => setDialog({ kind: 'status', action: 'reinstate', auth: a })}>Reinstate</button>}
                      <button className="btn sm danger" onClick={() => setDialog({ kind: 'status', action: 'revoke', auth: a })}>Revoke</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="dsec">
            <div className="row between"><h3 style={{ margin: 0 }}>Training</h3>
              {manage && <button className="btn sm" onClick={() => setDialog({ kind: 'training' })}>Record training</button>}
            </div>
            {d.training.length === 0 && <p className="note">No training records.</p>}
            <div className="stack">
              {d.training.map(t => (
                <div key={t.id} className="auth-card">
                  <div className="row between"><b>{t.title}</b><span className="note mono">{day(t.completedAt)}</span></div>
                  <div className="note">{COURSES.find(c => c[0] === t.course)?.[1]} · recorded by {t.recordedBy.replace(/^user:/, '')}</div>
                  {manage
                    ? <Attachments ownerType="training_record" ownerId={t.id} canAttach />
                    : t.documentId && <button className="btn sm" onClick={() => openDocument(t.documentId!).catch(setDocError)}>Open certificate</button>}
                </div>
              ))}
            </div>
            <ErrorNote error={docError} />
          </section>

          <section className="dsec">
            <h3>Audit trail <span className="note mono">chain: org</span></h3>
            <div className="timeline">
              {d.audit.map(a => (
                <div key={a.seq} className="tl">
                  <i />
                  <div>
                    <b>{a.action}</b> <span className="note">{zulu(a.at)} · {a.actor}</span>
                    {a.rule && <div className="note mono">{a.rule}</div>}
                    <div className="h">#{a.seq} {short(a.hash)}</div>
                  </div>
                </div>
              ))}
              {d.audit.length === 0 && <p className="note">No changes recorded through AeroOS yet.</p>}
            </div>
          </section>

          {dialog?.kind === 'issue' && <IssueDialog person={d} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void refresh(); }} />}
          {dialog?.kind === 'training' && <TrainingDialog person={d} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void refresh(); }} />}
          {dialog?.kind === 'status' && <StatusDialog action={dialog.action} auth={dialog.auth} name={d.name} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void refresh(); }} />}
        </>
      )}
    </Drawer>
  );
}

function IssueDialog({ person, onClose, onDone }: { person: Detail; onClose(): void; onDone(): void }) {
  const toast = useUi(s => s.toast);
  const fleet = useQuery({ queryKey: ['fleet'], queryFn: () => api<FleetTailDto[]>('/camo/fleet'), retry: false });
  const rated = [...new Set(person.licences.flatMap(l => l.typeRatings))];
  const types = [...new Set([...rated, ...(fleet.data ?? []).map(f => f.type)])].sort();
  const [reference, setReference] = useState('C-AUTH 145-');
  const [selected, setSelected] = useState<string[]>(rated);
  const [validUntil, setValidUntil] = useState(() => new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10));
  const m = useMutation({
    mutationFn: () => post<AuthorisationDto>(`/org/personnel/${person.id}/authorisations`, { reference, aircraftTypes: selected, validUntil: `${validUntil}T23:59:59Z` }),
    onSuccess: a => { toast(`${a.reference} issued to ${person.name}`, 'green'); onDone(); }
  });
  return (
    <Dialog title={`Issue authorisation — ${person.name}`} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn pri" disabled={m.isPending || reference.trim().length < 3 || selected.length === 0} onClick={() => m.mutate()}>{m.isPending ? 'Issuing…' : 'Issue'}</button>
    </>}>
      <div className="field"><label htmlFor="ia-ref">Reference</label><input id="ia-ref" className="inp mono" value={reference} onChange={e => setReference(e.target.value)} /></div>
      <div className="field">
        <label>Aircraft types</label>
        <div className="row">
          {types.map(t => (
            <label key={t} className="row" style={{ gap: 4 }}>
              <input type="checkbox" checked={selected.includes(t)} onChange={e => setSelected(s => e.target.checked ? [...s, t] : s.filter(x => x !== t))} />
              <span>{t}{rated.includes(t) ? '' : ' (no type rating)'}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="field"><label htmlFor="ia-until">Valid until</label><input id="ia-until" type="date" className="inp" value={validUntil} onChange={e => setValidUntil(e.target.value)} /></div>
      <p className="note">The rulepack checks the scope against the holder's Part-66 licence and type ratings when you issue it.</p>
      <ErrorNote error={m.error} />
    </Dialog>
  );
}

function TrainingDialog({ person, onClose, onDone }: { person: Detail; onClose(): void; onDone(): void }) {
  const toast = useUi(s => s.toast);
  const [course, setCourse] = useState<TrainingCourse>('CONTINUATION');
  const [title, setTitle] = useState(`Continuation training ${new Date().getUTCFullYear()}`);
  const [completedAt, setCompletedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const m = useMutation({
    mutationFn: () => post(`/org/personnel/${person.id}/training`, { course, title, completedAt: `${completedAt}T12:00:00Z` }),
    onSuccess: () => { toast(`Training recorded for ${person.name}`, 'green'); onDone(); }
  });
  return (
    <Dialog title={`Record training — ${person.name}`} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn pri" disabled={m.isPending || title.trim().length < 3} onClick={() => m.mutate()}>{m.isPending ? 'Saving…' : 'Record'}</button>
    </>}>
      <div className="field"><label htmlFor="tr-c">Course</label>
        <select id="tr-c" className="inp" value={course} onChange={e => setCourse(e.target.value as TrainingCourse)}>
          {COURSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor="tr-t">Title</label><input id="tr-t" className="inp" value={title} onChange={e => setTitle(e.target.value)} /></div>
      <div className="field"><label htmlFor="tr-d">Completed on</label><input id="tr-d" type="date" className="inp" value={completedAt} onChange={e => setCompletedAt(e.target.value)} /></div>
      <p className="note">Continuation training and human factors restart the 24-month currency cycle. Attach the certificate after saving.</p>
      <ErrorNote error={m.error} />
    </Dialog>
  );
}

function StatusDialog({ action, auth, name, onClose, onDone }: { action: 'suspend' | 'reinstate' | 'revoke'; auth: AuthorisationDto; name: string; onClose(): void; onDone(): void }) {
  const toast = useUi(s => s.toast);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => post<AuthorisationDto>(`/org/authorisations/${auth.id}/${action}`, { reason }),
    onSuccess: a => { toast(`${a.reference} ${a.status.toLowerCase()}`, action === 'reinstate' ? 'green' : 'red'); onDone(); }
  });
  const verb = action[0].toUpperCase() + action.slice(1);
  return (
    <Dialog title={`${verb} ${auth.reference}`} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className={`btn ${action === 'reinstate' ? 'pri' : 'danger'}`} disabled={m.isPending || reason.trim().length < 5} onClick={() => m.mutate()}>{m.isPending ? 'Saving…' : verb}</button>
    </>}>
      {action !== 'reinstate' && <div className="callout red">{name} will be refused at the next signature attempt{action === 'revoke' ? '. Revocation is final — a new authorisation would have to be issued.' : ' until reinstated.'}</div>}
      <div className="field"><label htmlFor="st-r">Reason (part of the quality record)</label>
        <textarea id="st-r" className="inp" value={reason} onChange={e => setReason(e.target.value)} placeholder={action === 'suspend' ? 'e.g. Audit finding QA-2026-114 — pending investigation' : ''} />
      </div>
      <ErrorNote error={m.error} />
    </Dialog>
  );
}

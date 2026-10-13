import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { ControlledDocumentDetailDto, ControlledDocumentDto, DocumentDto, MeDto } from '@aeroos/contracts';
import { api, post } from '../../lib/api';
import { short, zulu } from '../../lib/format';
import { useUi } from '../../lib/store';
import { Attachments } from '../../components/Attachments';
import { Card, DL, Drawer, ErrorNote, Head, Pill } from '../../components/ui';

const tone: Record<string, string> = { DRAFT: 'amber', APPROVED: 'cyan', EFFECTIVE: 'green', SUPERSEDED: '' };
const ROLES = ['certifying_staff', 'camo_engineer', 'camo_manager', 'quality_manager', 'safety_manager', 'storekeeper', 'occ_controller', 'auditor'] as const;
const who = (s: string | null) => (s ?? '').replace(/^user:/, '');
const today = () => new Date().toISOString().slice(0, 10);

/** Document & manual control: expositions, manuals and procedures; revisions approved by a second person; read-and-acknowledge. */
export function Documents() {
  const { doc } = useSearch({ from: '/org/documents' });
  const navigate = useNavigate({ from: '/org/documents' });
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') });
  const q = useQuery({ queryKey: ['controlled-docs'], queryFn: () => api<ControlledDocumentDto[]>('/org/documents') });
  const canManage = !!me.data?.roles.some(r => r === 'quality_manager' || r === 'camo_manager');
  const [creating, setCreating] = useState(false);
  const toRead = (q.data ?? []).filter(d => d.mustRead);
  return (
    <>
      <Head crumb="Organization / Quality" title="Document & Manual Control"
        desc="The exposition, manuals and procedures the organisation works to. A revision is approved by someone other than its author, becomes effective on its date, and everyone it is distributed to reads and acknowledges it."
        actions={canManage && <button className="btn pri" onClick={() => setCreating(true)}>New controlled document</button>} />
      {toRead.length > 0 && <div className="callout amber"><b>{toRead.length} revision{toRead.length === 1 ? '' : 's'} to read and acknowledge:</b> {toRead.map(d => `${d.code} rev ${d.effective?.revision}`).join(', ')}</div>}
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      <Card title="Controlled documents" meta={`${q.data?.length ?? 0}`} flush>
        <div className="tbl-wrap"><table className="t">
          <thead><tr><th>Document</th><th>Effective revision</th><th>Pending</th><th>Distributed to</th><th>Acknowledged</th><th>You</th></tr></thead>
          <tbody>
            {(q.data ?? []).map(d => (
              <tr key={d.id} className="click" tabIndex={0} onClick={() => navigate({ search: { doc: d.id } })} onKeyDown={e => e.key === 'Enter' && navigate({ search: { doc: d.id } })}>
                <td><b className="mono">{d.code}</b> {d.title} <span className="note">{d.category.toLowerCase()}</span></td>
                <td className="mono">{d.effective ? `rev ${d.effective.revision} · ${d.effective.effectiveFrom}` : '—'}</td>
                <td>{d.pending ? <Pill tone={tone[d.pending.status]}>rev {d.pending.revision} {d.pending.status.toLowerCase()}{d.pending.effectiveFrom ? ` · ${d.pending.effectiveFrom}` : ''}</Pill> : '—'}</td>
                <td className="sub">{d.audience.map(a => a.replace('_', ' ')).join(', ')}</td>
                <td className="mono">{d.readCount}</td>
                <td>{d.mustRead ? <Pill tone="amber">to read</Pill> : d.effective && d.audience.some(a => me.data?.roles.includes(a)) ? <Pill tone="green">read</Pill> : ''}</td>
              </tr>
            ))}
            {q.data?.length === 0 && <tr><td colSpan={6} className="empty">No controlled documents yet.</td></tr>}
          </tbody>
        </table></div>
      </Card>
      <DocDrawer id={doc ?? null} canManage={canManage} me={me.data?.username ?? ''} onClose={() => navigate({ search: { doc: undefined } })} />
      {creating && <CreateDrawer onClose={id => { setCreating(false); if (id) navigate({ search: { doc: id } }); }} />}
    </>
  );
}

function DocDrawer({ id, canManage, me, onClose }: { id: string | null; canManage: boolean; me: string; onClose(): void }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const q = useQuery({ queryKey: ['controlled-doc', id], queryFn: () => api<ControlledDocumentDetailDto>(`/org/documents/${id}`), enabled: !!id });
  const [summary, setSummary] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['controlled-docs'] }); void qc.invalidateQueries({ queryKey: ['controlled-doc', id] }); };
  const draft = useMutation({ mutationFn: () => post<ControlledDocumentDetailDto>(`/org/documents/${id}/revisions`, { summary }), onSuccess: d => { setSummary(''); toast(`${d.code} revision ${d.pending?.revision} drafted — attach the file`, 'cyan'); refresh(); } });
  const approve = useMutation({ mutationFn: ({ rev, sha256 }: { rev: number; sha256: string }) => post<ControlledDocumentDetailDto>(`/org/documents/${id}/revisions/${rev}/approve`, { effectiveFrom, sha256 }), onSuccess: d => { toast(`${d.code} revision approved, effective ${effectiveFrom}`, 'green'); refresh(); } });
  const ack = useMutation({ mutationFn: (rev: number) => post<ControlledDocumentDetailDto>(`/org/documents/${id}/revisions/${rev}/acknowledge`), onSuccess: d => { toast(`${d.code} revision ${d.effective?.revision} acknowledged`, 'green'); refresh(); } });
  const open = useMutation({
    mutationFn: (documentId: string) => api<{ url: string; document: DocumentDto }>(`/documents/${documentId}/url`),
    onSuccess: r => window.open(r.url, '_blank', 'noopener')
  });
  const d = q.data;
  const pending = d?.pending;
  // The file the approver reviews: the latest stored upload of the pending revision.
  const files = useQuery({ queryKey: ['documents', 'manual_revision', pending ? `${d!.id}:${pending.revision}` : ''], enabled: !!pending && pending.status === 'DRAFT',
    queryFn: () => api<DocumentDto[]>(`/documents?ownerType=manual_revision&ownerId=${encodeURIComponent(`${d!.id}:${pending!.revision}`)}`) });
  const latest = (files.data ?? []).filter(f => f.sha256).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const approverUploaded = !!latest && latest.uploadedBy === `user:${me}`;
  return (
    <Drawer open={!!id} onClose={onClose} eyebrow={d ? `${d.category.toLowerCase()} · owner ${d.owner}` : 'Controlled document'} title={d ? `${d.code} · ${d.title}` : id ?? ''}
      tags={d?.effective && <Pill tone="green">rev {d.effective.revision} effective</Pill>}>
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      {d && (
        <>
          {d.effective && (
            <section className="dsec">
              <h3>Effective revision {d.effective.revision}</h3>
              <DL items={[['Effective from', d.effective.effectiveFrom ?? '—'], ['What changed', d.effective.summary], ['Authored', `${who(d.effective.authoredBy)} · ${zulu(d.effective.authoredAt)}`],
                ['Approved', d.effective.approvedBy ? `${who(d.effective.approvedBy)}${d.effective.approvedAt ? ` · ${zulu(d.effective.approvedAt)}` : ''}` : '—'],
                ['File', d.effective.file ? <span className="mono">sha256 {short(d.effective.file.sha256)}</span> : 'paper original (pre-system)']]} />
              <div className="row" style={{ marginTop: 8 }}>
                {d.effective.file && <button className="btn" onClick={() => open.mutate(d.effective!.file!.documentId)}>Open the approved file</button>}
                {d.mustRead && <button className="btn pri" disabled={ack.isPending} onClick={() => ack.mutate(d.effective!.revision)}>I have read and understood revision {d.effective.revision}</button>}
                {!d.mustRead && d.reads.some(r => r.username === me) && <Pill tone="green">you acknowledged it</Pill>}
              </div>
              <ErrorNote error={ack.error ?? open.error} />
            </section>
          )}

          {canManage && pending && (
            <section className="dsec">
              <h3>Revision {pending.revision} — {pending.status.toLowerCase()}</h3>
              <p style={{ margin: 0 }}>{pending.summary}</p>
              <div className="note">Drafted by {who(pending.authoredBy)} · {zulu(pending.authoredAt)}{pending.effectiveFrom ? ` · effective ${pending.effectiveFrom}` : ''}</div>
              {pending.status === 'DRAFT' && (
                <>
                  <Attachments ownerType="manual_revision" ownerId={`${d.id}:${pending.revision}`} canAttach />
                  <div className="row" style={{ marginTop: 8 }}>
                    <label className="note" htmlFor="rev-eff">Effective from</label>
                    <input id="rev-eff" type="date" className="inp" style={{ maxWidth: 170 }} min={today()} value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} />
                    <button className="btn pri" disabled={approve.isPending || !latest || approverUploaded || pending.authoredBy === `user:${me}`} onClick={() => latest?.sha256 && approve.mutate({ rev: pending.revision, sha256: latest.sha256 })}>Approve revision {pending.revision}</button>
                  </div>
                  {latest && <div className="note mono">Approving file {latest.fileName} · sha256 {short(latest.sha256!)} · uploaded by {who(latest.uploadedBy)}</div>}
                  {!latest && <div className="note">Attach the revised document first.</div>}
                  {(pending.authoredBy === `user:${me}` || approverUploaded) && <div className="note">You {approverUploaded ? 'uploaded the file' : 'drafted it'}; another nominated person approves it (four-eyes).</div>}
                  <ErrorNote error={approve.error} />
                </>
              )}
            </section>
          )}
          {canManage && !pending && (
            <section className="dsec">
              <h3>New revision</h3>
              <textarea className="inp" rows={3} placeholder="What changed — readers acknowledge against this summary" value={summary} onChange={e => setSummary(e.target.value)} />
              <div className="row" style={{ marginTop: 8 }}><button className="btn" disabled={draft.isPending} onClick={() => draft.mutate()}>Draft revision</button></div>
              <ErrorNote error={draft.error} />
            </section>
          )}

          <section className="dsec">
            <h3>Acknowledged revision {d.effective?.revision ?? '—'} <span className="note">{d.reads.length}</span></h3>
            <div className="list">
              {d.reads.map(r => <div key={r.username} className="li"><span className="sev green" /><div><b>{r.name}</b> <span className="note mono">{r.username} · {zulu(r.readAt)}</span></div></div>)}
              {d.reads.length === 0 && <div className="empty">Nobody yet.</div>}
            </div>
            <div className="note">Distributed to: {d.audience.map(a => a.replace('_', ' ')).join(', ')}</div>
          </section>

          <section className="dsec">
            <h3>Revision history</h3>
            <div className="timeline">
              {d.revisions.map(r => (
                <div key={r.revision} className="tl"><i /><div>
                  <b>Rev {r.revision}</b> <Pill tone={tone[r.status]}>{r.status.toLowerCase()}</Pill> <span className="note">{r.effectiveFrom ?? 'not yet effective'} · {who(r.authoredBy)}{r.approvedBy ? ` → ${who(r.approvedBy)}` : ''}</span>
                  <div className="sub">{r.summary}</div>
                </div></div>
              ))}
            </div>
          </section>
        </>
      )}
    </Drawer>
  );
}

function CreateDrawer({ onClose }: { onClose(id?: string): void }) {
  const toast = useUi(s => s.toast);
  const qc = useQueryClient();
  const [f, setF] = useState({ code: '', title: '', category: 'PROCEDURE', audience: ['certifying_staff'] as string[] });
  const save = useMutation({
    mutationFn: () => post<ControlledDocumentDetailDto>('/org/documents', f),
    onSuccess: d => { toast(`${d.code} created — draft its first revision`, 'cyan'); void qc.invalidateQueries({ queryKey: ['controlled-docs'] }); onClose(d.id); }
  });
  return (
    <Drawer open onClose={() => onClose()} eyebrow="Document control" title="New controlled document">
      <div className="form-grid">
        <div className="field"><label htmlFor="cd-code">Code</label><input id="cd-code" className="inp mono" placeholder="PROC-12" value={f.code} onChange={e => setF(x => ({ ...x, code: e.target.value.toUpperCase() }))} /></div>
        <div className="field"><label htmlFor="cd-cat">Category</label><select id="cd-cat" className="inp" value={f.category} onChange={e => setF(x => ({ ...x, category: e.target.value }))}>
          {['EXPOSITION', 'MANUAL', 'PROCEDURE', 'FORM'].map(c => <option key={c} value={c}>{c.toLowerCase()}</option>)}</select></div>
        <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="cd-title">Title</label><input id="cd-title" className="inp" value={f.title} onChange={e => setF(x => ({ ...x, title: e.target.value }))} /></div>
        <div className="field" style={{ gridColumn: 'span 2' }}><label>Distributed to (must read each revision)</label>
          <div className="row" style={{ flexWrap: 'wrap' }}>{ROLES.map(r => <label key={r} className="row" style={{ gap: 4 }}><input type="checkbox" checked={f.audience.includes(r)} onChange={e => setF(x => ({ ...x, audience: e.target.checked ? [...x.audience, r] : x.audience.filter(a => a !== r) }))} /> {r.replace('_', ' ')}</label>)}</div></div>
      </div>
      <div className="row" style={{ marginTop: 10 }}><button className="btn pri" disabled={save.isPending} onClick={() => save.mutate()}>Create</button></div>
      <ErrorNote error={save.error} />
    </Drawer>
  );
}

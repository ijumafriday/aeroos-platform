import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CorrectiveActionDto } from '@aeroos/contracts';
import { post } from '../../lib/api';
import { zulu } from '../../lib/format';
import { useUi } from '../../lib/store';
import { ErrorNote, Pill } from '../../components/ui';

export const actionTone: Record<string, string> = { OPEN: 'amber', DONE: 'cyan', VERIFIED: 'green', CANCELLED: '' };
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** One corrective action: the owner completes it with evidence; the owning domain manager verifies effectiveness. */
export function ActionRow({ a, me, canVerify, onChange }: { a: CorrectiveActionDto; me: string; canVerify: boolean; onChange(): void }) {
  const toast = useUi(s => s.toast);
  const [evidence, setEvidence] = useState('');
  const [note, setNote] = useState('');
  const complete = useMutation({ mutationFn: () => post<CorrectiveActionDto>(`${a.sourceType === 'OCCURRENCE' ? '/safety' : '/quality'}/actions/${a.id}/complete`, { evidence }), onSuccess: () => { toast(`${a.id} done — awaiting verification`, 'cyan'); setEvidence(''); onChange(); } });
  const verify = useMutation({ mutationFn: (effective: boolean) => post<CorrectiveActionDto>(`${a.sourceType === 'OCCURRENCE' ? '/safety' : '/quality'}/actions/${a.id}/verify`, { effective, note }), onSuccess: r => { toast(r.status === 'VERIFIED' ? `${a.id} verified effective` : `${a.id} reopened`, r.status === 'VERIFIED' ? 'green' : 'amber'); onChange(); } });
  const mine = a.owner === me;
  return (
    <div className="step" style={{ alignItems: 'flex-start' }}>
      <Pill tone={actionTone[a.status]}>{a.status.toLowerCase()}</Pill>
      <div style={{ flex: 1, minWidth: 0 }}>
        <b className="mono">{a.id}</b> {a.description}
        <div className="sub">owner <b>{a.owner}</b> · due <span style={a.overdue ? { color: 'var(--red)' } : undefined}>{a.due}{a.overdue ? ' (overdue)' : ''}</span> · from {a.sourceId}</div>
        {a.evidence && <div className="sub">Evidence: {a.evidence}{a.doneBy ? ` — ${a.doneBy}${a.doneAt ? `, ${zulu(a.doneAt)}` : ''}` : ''}</div>}
        {a.verifiedBy && <div className="stamp">verified by {a.verifiedBy}{a.verifiedAt ? ` · ${zulu(a.verifiedAt)}` : ''}</div>}
        {a.status === 'OPEN' && (mine || canVerify) && (
          <div className="row" style={{ marginTop: 6 }}>
            <input className="inp" placeholder="What was done, and where the evidence is" value={evidence} onChange={e => setEvidence(e.target.value)} />
            <button className="btn sm" disabled={complete.isPending} onClick={() => complete.mutate()}>Mark done</button>
          </div>
        )}
        {a.status === 'DONE' && canVerify && (
          <div className="row" style={{ marginTop: 6 }}>
            <input className="inp" placeholder="Verification note" value={note} onChange={e => setNote(e.target.value)} />
            <button className="btn sm pri" disabled={verify.isPending || a.doneBy === me} onClick={() => verify.mutate(true)} title={a.doneBy === me ? 'Someone else verifies your own work' : ''}>Effective</button>
            <button className="btn sm ghost" disabled={verify.isPending || a.doneBy === me} onClick={() => verify.mutate(false)}>Not effective — reopen</button>
          </div>
        )}
        <ErrorNote error={complete.error ?? verify.error} />
      </div>
    </div>
  );
}

/** Corrective actions of one occurrence or finding, with "assign an action" for whoever manages it. */
export function ActionsPanel({ sourceType, sourceId, actions, me, canManage, canVerify, open, invalidate }: {
  sourceType: 'OCCURRENCE' | 'FINDING'; sourceId: string; actions: CorrectiveActionDto[]; me: string; canManage: boolean; canVerify: boolean; open: boolean; invalidate: string[][];
}) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const [f, setF] = useState({ description: '', owner: '', due: inDays(30) });
  const refresh = () => invalidate.forEach(k => void qc.invalidateQueries({ queryKey: k }));
  const add = useMutation({
    mutationFn: () => post<CorrectiveActionDto>(sourceType === 'OCCURRENCE' ? '/safety/actions' : '/quality/actions', { sourceId, ...f }),
    onSuccess: a => { toast(`${a.id} assigned to ${a.owner}`, 'cyan'); setF({ description: '', owner: '', due: inDays(30) }); refresh(); }
  });
  return (
    <div className="stack" style={{ gap: 6 }}>
      {actions.map(a => <ActionRow key={a.id} a={a} me={me} canVerify={canVerify} onChange={refresh} />)}
      {actions.length === 0 && <div className="empty">No corrective actions yet.</div>}
      {canManage && open && (
        <div className="form-grid" style={{ marginTop: 6 }}>
          <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor={`ca-d-${sourceId}`}>New corrective action</label><input id={`ca-d-${sourceId}`} className="inp" value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))} /></div>
          <div className="field"><label htmlFor={`ca-o-${sourceId}`}>Owner (username)</label><input id={`ca-o-${sourceId}`} className="inp mono" placeholder="storekeeper" value={f.owner} onChange={e => setF(x => ({ ...x, owner: e.target.value }))} /></div>
          <div className="field"><label htmlFor={`ca-due-${sourceId}`}>Due</label><input id={`ca-due-${sourceId}`} type="date" className="inp" value={f.due} onChange={e => setF(x => ({ ...x, due: e.target.value }))} /></div>
          <div className="row"><button className="btn" disabled={add.isPending} onClick={() => add.mutate()}>Assign</button></div>
          <ErrorNote error={add.error} />
        </div>
      )}
    </div>
  );
}

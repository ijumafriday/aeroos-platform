import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RecoveryRunDto } from '@aeroos/contracts';
import { api, post } from '../../lib/api';
import { zulu } from '../../lib/format';
import { useUi } from '../../lib/store';
import { Card, ErrorNote, Pill } from '../../components/ui';

const tone: Record<string, string> = { RUNNING: 'mag', PROPOSED: 'cyan', ACCEPTED: 'green', REJECTED: '', FAILED: 'red', STALE: 'amber' };
const kindTone: Record<string, string> = { CANCEL: 'red', DELAY: 'amber', SWAP: 'cyan', SWAP_DELAY: 'amber' };

/** Disruption recovery: ask the optimiser, review its proposal, accept or reject. */
export function RecoveryPanel({ runId, onOpenRun, codes }: { runId: string | null; onOpenRun(id: string): void; codes: Record<string, string> }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const runs = useQuery({
    queryKey: ['ops', 'recovery'],
    queryFn: () => api<RecoveryRunDto[]>('/ops/recovery'),
    retry: false,
    refetchInterval: q => (q.state.data?.some(r => r.status === 'RUNNING') ? 2000 : 30_000)
  });
  const start = useMutation({
    mutationFn: () => post<RecoveryRunDto>('/ops/recovery', { hours: 24 }),
    onSuccess: r => { onOpenRun(r.id); toast(`${r.id} sent to the optimiser`, 'cyan'); void qc.invalidateQueries({ queryKey: ['ops', 'recovery'] }); }
  });
  const decide = useMutation({
    mutationFn: (v: { id: string; action: 'accept' | 'reject' }) => post<RecoveryRunDto>(`/ops/recovery/${v.id}/${v.action}`),
    onSuccess: r => {
      toast(r.status === 'ACCEPTED' ? `${r.id} applied — ${r.changes.length} change(s)` : r.status === 'STALE' ? `${r.id} is stale: ${r.error}` : `${r.id} ${r.status.toLowerCase()}`,
        r.status === 'ACCEPTED' ? 'green' : 'amber');
      void qc.invalidateQueries({ queryKey: ['ops'] });
    }
  });
  if (runs.error) return null; // not an OCC controller or auditor
  const list = runs.data ?? [];
  const sel = list.find(r => r.id === runId) ?? list[0];
  const name = (icao: string) => codes[icao] ?? icao;

  return (
    <Card title="Disruption recovery" meta="OR-Tools CP-SAT" flush>
      <div className="card-b stack">
        <div className="row between">
          <span className="note">Re-plans the next 24 h: tail swaps, delays and cancellations, minimising delay minutes, cancellations and swaps.</span>
          <button className="btn pri" disabled={start.isPending} onClick={() => start.mutate()}>{start.isPending ? 'Starting…' : 'Run optimiser'}</button>
        </div>
        <ErrorNote error={start.error ?? decide.error} />
        {list.length > 0 && (
          <div className="seg" style={{ flexWrap: 'wrap' }}>
            {list.slice(0, 6).map(r => <button key={r.id} className={sel?.id === r.id ? 'on' : ''} onClick={() => onOpenRun(r.id)}>{r.id}</button>)}
          </div>
        )}
        {sel && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row">
              <Pill tone={tone[sel.status]}>{sel.status}</Pill>
              <span className="note">{zulu(sel.createdAt)} · {sel.requestedBy.replace(/^user:/, '')}</span>
              {sel.solver && <span className="note mono">{sel.solver} · cost {sel.objective} · {sel.wallSeconds}s</span>}
            </div>
            {sel.status === 'RUNNING' && <div className="callout">Solving… the optimiser worker is working on it (Temporal task queue “optimiser”).</div>}
            {sel.error && <div className={`callout ${sel.status === 'STALE' ? 'amber' : 'red'}`}>{sel.error}</div>}
            {sel.changes.length > 0 && (
              <div className="tbl-wrap">
                <table className="t">
                  <thead><tr><th>Flight</th><th>Route</th><th>Change</th><th>Tail</th><th>New ETD</th></tr></thead>
                  <tbody>
                    {sel.changes.map(c => (
                      <tr key={c.flightId}>
                        <td className="mono"><b>{c.flightNo}</b></td>
                        <td>{name(c.dep)}–{name(c.arr)}</td>
                        <td><Pill tone={kindTone[c.kind]}>{c.kind.replace('_', ' + ').toLowerCase()}{c.delayMinutes ? ` +${c.delayMinutes}` : ''}</Pill></td>
                        <td className="mono">{c.toTail && c.toTail !== c.fromTail ? `${c.fromTail} → ${c.toTail}` : c.fromTail}</td>
                        <td className="mono">{c.newEtd ? `${c.newEtd.slice(11, 16)}Z` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {sel.status === 'PROPOSED' && sel.changes.length === 0 && <div className="callout green">No changes needed — the plan is already feasible.</div>}
            {sel.status === 'PROPOSED' && (
              <div className="row">
                <button className="btn pri" disabled={decide.isPending} onClick={() => decide.mutate({ id: sel.id, action: 'accept' })}>Accept and apply</button>
                <button className="btn ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: sel.id, action: 'reject' })}>Reject</button>
                <span className="note">Applied only if none of these flights changed since the proposal.</span>
              </div>
            )}
          </div>
        )}
        {list.length === 0 && !runs.isLoading && <div className="empty">No recovery runs yet.</div>}
      </div>
    </Card>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CrewRecoveryRunDto } from '@aeroos/contracts';
import { api, post } from '../../lib/api';
import { zulu } from '../../lib/format';
import { useUi } from '../../lib/store';
import { Card, ErrorNote, Pill } from '../../components/ui';

const tone: Record<CrewRecoveryRunDto['status'], string> = { RUNNING: 'mag', PROPOSED: 'cyan', FAILED: 'red', ACCEPTED: 'green', REJECTED: '', STALE: 'amber' };

/** Re-crew duties that broke a flight-time limitation from standby or reserve (legal options only). */
export function CrewRecoveryPanel({ runId, onOpenRun }: { runId: string | null; onOpenRun(id: string): void }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const runs = useQuery({
    queryKey: ['ops', 'crew-recovery'],
    queryFn: () => api<CrewRecoveryRunDto[]>('/ops/crew-recovery'),
    retry: false,
    refetchInterval: q => ((q.state.data ?? []).some(r => r.status === 'RUNNING') ? 2_000 : 30_000)
  });
  const start = useMutation({
    mutationFn: () => post<CrewRecoveryRunDto>('/ops/crew-recovery'),
    onSuccess: r => { onOpenRun(r.id); toast(`${r.id}: ${r.tasks.length} duties sent to the optimiser`, 'cyan'); void qc.invalidateQueries({ queryKey: ['ops', 'crew-recovery'] }); }
  });
  const decide = useMutation({
    mutationFn: (v: { id: string; action: 'accept' | 'reject' }) => post<CrewRecoveryRunDto>(`/ops/crew-recovery/${v.id}/${v.action}`),
    onSuccess: r => {
      toast(r.status === 'ACCEPTED' ? `${r.id} applied — ${r.tasks.filter(t => t.cover).length} duties re-crewed` : r.status === 'STALE' ? `${r.id} is stale: ${r.error}` : `${r.id} ${r.status.toLowerCase()}`,
        r.status === 'ACCEPTED' ? 'green' : 'amber');
      void qc.invalidateQueries({ queryKey: ['ops'] });
    }
  });
  if (runs.error) return null;
  const list = runs.data ?? [];
  const sel = list.find(r => r.id === runId) ?? list[0];

  return (
    <Card title="Crew recovery" meta="rulepack-checked · CP-SAT" flush>
      <div className="card-b stack">
        <div className="row between">
          <span className="note">Finds duties that break a limit, hands the rest of the duty over at base to the cheapest <b>legal</b> standby or reserve crew member.</span>
          <button className="btn pri" disabled={start.isPending} onClick={() => start.mutate()}>{start.isPending ? 'Starting…' : 'Find cover'}</button>
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
            {sel.status === 'RUNNING' && <div className="callout">Solving… (Temporal task queue “optimiser”).</div>}
            {sel.error && <div className={`callout ${sel.status === 'STALE' ? 'amber' : 'red'}`}>{sel.error}</div>}
            <div className="tbl-wrap">
              <table className="t">
                <thead><tr><th>Duty</th><th>Reason</th><th>Now</th><th>Cover</th></tr></thead>
                <tbody>
                  {sel.tasks.map(t => (
                    <tr key={t.id}>
                      <td className="mono"><b>{t.flightNos.join(' · ')}</b><div className="note">{t.rank} · report {t.report.slice(11, 16)}Z</div></td>
                      <td><span className="note">{t.reason}</span></td>
                      <td>{t.name}<div className="note mono">{t.crewId}</div></td>
                      <td>
                        {t.cover
                          ? <><b>{t.cover.name}</b> <Pill tone={t.cover.kind === 'STANDBY' ? 'green' : 'amber'}>{t.cover.kind.toLowerCase()}</Pill>{t.cover.ftl === 'DISCRETION' && <Pill tone="amber">discretion</Pill>}<div className="note">{t.cover.note}</div></>
                          : sel.status === 'RUNNING' ? <span className="note">{t.options} legal option(s)</span>
                          : <Pill tone="red">{t.options ? 'not covered' : 'no legal cover'}</Pill>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sel.status === 'PROPOSED' && (
              <div className="row">
                <button className="btn pri" disabled={decide.isPending} onClick={() => decide.mutate({ id: sel.id, action: 'accept' })}>Accept and re-crew</button>
                <button className="btn ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: sel.id, action: 'reject' })}>Reject</button>
                <span className="note">Re-checked against the rulepack at the moment you accept.</span>
              </div>
            )}
          </div>
        )}
        {list.length === 0 && !runs.isLoading && <div className="empty">No crew recovery runs yet.</div>}
      </div>
    </Card>
  );
}

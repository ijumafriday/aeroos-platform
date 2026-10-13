import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { CrewDetailDto, CrewSummaryDto } from '@aeroos/contracts';
import { api } from '../../lib/api';
import { Card, Drawer, Head, Pill } from '../../components/ui';
import { CrewRecoveryPanel } from './CrewRecoveryPanel';

const tone = (s: string) => (s === 'OK' ? 'green' : s === 'DISCRETION' ? 'amber' : 'red');
const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const z = (iso: string) => `${iso.slice(5, 10)} ${iso.slice(11, 16)}Z`;

export function Crew() {
  const { crew, run } = useSearch({ from: '/ops/crew' });
  const navigate = useNavigate({ from: '/ops/crew' });
  const q = useQuery({ queryKey: ['ops', 'crew'], queryFn: () => api<CrewSummaryDto[]>('/ops/crew'), refetchInterval: 60_000 });
  const rows = q.data ?? [];
  const bad = rows.filter(r => r.status === 'VIOLATION').length;
  const disc = rows.filter(r => r.status === 'DISCRETION').length;

  return (
    <>
      <Head
        crumb="Flight Ops / Crew"
        title="Crew & Flight-Time Limitations"
        desc="Duties are rebuilt from the live, estimated schedule, so a delay entered in the OCC shows here at once. Limits: FDP by local report time and sectors, minimum rest, cumulative duty and flight time — from the rulepack in force."
      />
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      <div className="kpis">
        <div className="kpi cyan"><div className="l">Crew</div><div className="v">{rows.length}</div></div>
        <div className={`kpi ${bad ? 'red' : 'green'}`}><div className="l">Limit exceeded</div><div className="v">{bad}</div></div>
        <div className={`kpi ${disc ? 'amber' : 'green'}`}><div className="l">Needs discretion</div><div className="v">{disc}</div></div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <CrewRecoveryPanel runId={run ?? null} onOpenRun={id => navigate({ search: s => ({ ...s, run: id }) })} />
      </div>
      <Card title="Roster" meta={`${rows.length} crew`} flush>
        <div className="tbl-wrap">
          <table className="t">
            <thead><tr><th>Crew</th><th>Rank</th><th>Type</th><th>FTL</th><th>Next duty</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="click" tabIndex={0} onClick={() => navigate({ search: s => ({ ...s, crew: r.id }) })} onKeyDown={e => e.key === 'Enter' && navigate({ search: s => ({ ...s, crew: r.id }) })}>
                  <td><b>{r.name}</b> <span className="note mono">{r.id}</span></td>
                  <td>{r.rank}</td>
                  <td>{r.qualifications.join(', ')}</td>
                  <td><Pill tone={tone(r.status)}>{r.status.toLowerCase()}{r.findings ? ` · ${r.findings}` : ''}</Pill></td>
                  <td className="mono">{r.nextDuty ? `${z(r.nextDuty.report)} · ${r.nextDuty.legs}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <CrewDrawer id={crew ?? null} onClose={() => navigate({ search: s => ({ ...s, crew: undefined }) })} />
    </>
  );
}

function CrewDrawer({ id, onClose }: { id: string | null; onClose(): void }) {
  const q = useQuery({ queryKey: ['ops', 'crew', id], queryFn: () => api<CrewDetailDto>(`/ops/crew/${id}`), enabled: !!id });
  const d = q.data;
  return (
    <Drawer open={!!id} onClose={onClose} eyebrow={d ? `${d.rank} · ${d.qualifications.join(', ')} · base ${d.base}` : 'Crew'} title={d?.name ?? id ?? ''}
      tags={d && <Pill tone={tone(d.status)}>FTL {d.status.toLowerCase()}</Pill>}>
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      {d && (
        <>
          {d.violations.length === 0
            ? <div className="callout green"><b>Within all limits.</b><div className="note mono">{d.rule} · {d.basis}</div></div>
            : d.violations.map((v, i) => (
              <div key={i} className={`callout ${v.severity === 'violation' ? 'red' : 'amber'}`}>
                <b>{v.message}</b><div className="note mono">{v.ref} · {d.rule}</div>
              </div>
            ))}
          <section className="dsec">
            <h3>Duties (last 28 days and planned)</h3>
            <div className="stack" style={{ gap: 6 }}>
              {d.duties.map(x => {
                const fdp = Math.round((Date.parse(x.fdpEnd) - Date.parse(x.report)) / 60000);
                const flagged = d.violations.filter(v => v.dutyId === x.id);
                return (
                  <div key={x.id} className={`auth-card ${flagged.length ? 'susp' : ''}`}>
                    <div className="row between">
                      <b className="mono">{z(x.report)}</b>
                      <span className="note">FDP {hm(fdp)} · {x.sectors} sectors · block {hm(x.flightMinutes)}</span>
                    </div>
                    <div className="note mono">{x.legs.map(l => `${l.flightNo}${l.status === 'DELAYED' ? '*' : ''}`).join(' · ')}</div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </Drawer>
  );
}

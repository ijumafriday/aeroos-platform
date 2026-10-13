import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { CrewHubDto } from '@aeroos/contracts';
import { api, post } from '../../lib/api';
import { useUi } from '../../lib/store';
import { Card, ErrorNote, Head, Pill } from '../../components/ui';
import { FatigueForm, FatigueList } from '../ops/Fatigue';
import { fatigueTone } from '../ops/Roster';

const hhmm = (iso: string) => iso.slice(11, 16);
const dispatchTone: Record<string, string> = { NONE: '', OPEN: 'amber', RELEASED: 'green', WITHDRAWN: 'red' };
const ftlTone: Record<string, string> = { OK: 'green', DISCRETION: 'amber', VIOLATION: 'red' };

/** The crew hub: my roster, changes to acknowledge, briefing status of my flights, my fatigue reports. */
export function CrewHub() {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const q = useQuery({ queryKey: ['crew-hub'], queryFn: () => api<CrewHubDto>('/crew/me'), refetchInterval: 120_000 });
  const h = q.data;
  const ack = useMutation({ mutationFn: (through: number) => post('/crew/me/acknowledge', { through }),
    onSuccess: () => { toast('Roster changes acknowledged', 'green'); void qc.invalidateQueries({ queryKey: ['crew-hub'] }); } });
  const flights = (h?.duties ?? []).flatMap(d => d.flights).filter(f => !f.positioning).map(f => ({ id: f.flightId, label: `${f.flightNo} ${f.etd.slice(0, 10)} ${f.dep}–${f.arr}` }));
  return (
    <>
      <Head crumb="Crew / My Roster" title={h?.crew ? `My roster — ${h.crew.name}` : 'My roster'}
        desc="Your duties for the next 30 days with report times, the fatigue index and the dispatch status of each flight (briefing package when released). Changes to your published roster stay listed until you acknowledge them." />
      <ErrorNote error={q.error} />
      {h && !h.crew && <div className="callout amber">Your sign-in is not linked to a crew record. Ask crew planning to link it.</div>}
      {h?.crew && <>
        <Card title="Status" meta={`${h.crew.id} · ${h.crew.rank} · ${h.crew.base} · ${h.crew.qualifications.join('/')}`}>
          <Pill tone={ftlTone[h.status]}>FTL {h.status.toLowerCase()}</Pill>
          {h.violations.map((v, i) => <div key={i} className="note">{v.message}</div>)}
          {h.away.map(a => <div key={a.id} className="note">{a.kind.toLowerCase()}: {a.start.slice(0, 10)} – {a.end.slice(0, 10)}</div>)}
        </Card>
        {h.changes.length > 0 && (
          <Card title="Roster changes to acknowledge" meta={`${h.changes.length}`}>
            <ul>{h.changes.map(c => <li key={c.id} className="mono">{c.change === 'ADDED' ? '+' : '−'} {c.flightNo} {c.date} <span className="note">({c.at.slice(0, 16).replace('T', ' ')}Z)</span></li>)}</ul>
            <button className="btn pri" disabled={ack.isPending} onClick={() => ack.mutate(h.changes[h.changes.length - 1].id)}>Acknowledge</button>
            <ErrorNote error={ack.error} />
          </Card>
        )}
        <Card title="Duties" meta={`${h.duties.length}`} flush>
          <div className="tbl-wrap"><table className="t">
            <thead><tr><th>Report</th><th>Duty end</th><th>Flights</th><th>Fatigue</th></tr></thead>
            <tbody>
              {h.duties.map(d => (
                <tr key={d.id}>
                  <td className="mono">{d.report.slice(0, 10)} {hhmm(d.report)}Z</td>
                  <td className="mono">{hhmm(d.dutyEnd)}Z</td>
                  <td>{d.flights.map(f => (
                    <div key={f.flightId} className="mono">
                      <b>{f.flightNo}</b> {f.dep}–{f.arr} {hhmm(f.etd)}Z · {f.tail}{f.positioning ? ' · positioning' : ''}{' '}
                      <Pill tone={dispatchTone[f.dispatch]}>{f.dispatch === 'NONE' ? 'not prepared' : f.dispatch.toLowerCase()}</Pill>
                      {f.dispatch === 'RELEASED' && <> <Link to="/ops/dispatch" search={{ flight: f.flightId, day: f.etd.slice(0, 10) }}>briefing</Link></>}
                      <span className="note"> {f.crew.map(c => `${c.rank} ${c.name}`).join(', ')}</span>
                    </div>
                  ))}</td>
                  <td title={d.fatigueReasons.join('; ')}><Pill tone={fatigueTone[d.fatigueBand]}>{d.fatigue}</Pill></td>
                </tr>
              ))}
              {h.duties.length === 0 && <tr><td colSpan={4} className="empty">No duties rostered.</td></tr>}
            </tbody>
          </table></div>
        </Card>
        <FatigueForm flights={flights} />
        <FatigueList reports={h.fatigueReports} />
      </>}
    </>
  );
}

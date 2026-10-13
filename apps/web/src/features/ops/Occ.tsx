import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { AirportDto, TimelineDto } from '@aeroos/contracts';
import { api } from '../../lib/api';
import { useNow } from '../../lib/store';
import { Card, Head, Pill } from '../../components/ui';
import { FlightDrawer } from './FlightDrawer';
import { RecoveryPanel } from './RecoveryPanel';
import { Timeline } from './Timeline';

const H = 3_600_000;
const WINDOWS = [['12h', -3, 9], ['24h', -4, 20], ['36h', -6, 30]] as const;

export function Occ() {
  const { flight, run } = useSearch({ from: '/ops/occ' });
  const navigate = useNavigate({ from: '/ops/occ' });
  const now = useNow();
  const [win, setWin] = useState<(typeof WINDOWS)[number][0]>('24h');
  // Window anchored to the hour so the query key is stable between clock ticks.
  const anchor = Math.floor(now / H) * H;
  const [, back, ahead] = WINDOWS.find(w => w[0] === win)!;
  const from = anchor + back * H;
  const to = anchor + ahead * H;
  const q = useQuery({
    queryKey: ['ops', 'timeline', from, to],
    queryFn: () => api<TimelineDto>(`/ops/timeline?from=${new Date(from).toISOString()}&to=${new Date(to).toISOString()}`),
    refetchInterval: 60_000
  });
  const airports = useQuery({ queryKey: ['ops', 'airports'], queryFn: () => api<AirportDto[]>('/ops/airports'), staleTime: 3_600_000 });
  const codes = useMemo(() => Object.fromEntries((airports.data ?? []).map(a => [a.icao, a.iata])), [airports.data]);

  const d = q.data;
  const live = (d?.flights ?? []).filter(f => f.status !== 'CANCELLED');
  const delayed = live.filter(f => f.delayMinutes > 0);
  const cancelled = (d?.flights ?? []).filter(f => f.status === 'CANCELLED');
  const nogo = (d?.tails ?? []).filter(t => !t.dispatchable);
  const warned = live.filter(f => f.warnings.length && Date.parse(f.eta) > now);
  const otp = live.length ? Math.round((100 * live.filter(f => f.delayMinutes < 15).length) / live.length) : 100;
  const select = (id: string) => navigate({ search: s => ({ ...s, flight: id }) });

  return (
    <>
      <Head
        crumb="Flight Ops / OCC"
        title="Operations Control"
        desc="Live schedule by aircraft. Dispatchability comes from CAMO (AOG, expired MEL items); every change is checked against the flight-time limitations of the crew on board."
        actions={<div className="seg">{WINDOWS.map(([k]) => <button key={k} className={win === k ? 'on' : ''} onClick={() => setWin(k)}>{k}</button>)}</div>}
      />
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      <div className="kpis">
        <div className="kpi cyan"><div className="l">Flights in window</div><div className="v">{live.length}</div><div className="s">{cancelled.length} cancelled</div></div>
        <div className={`kpi ${otp < 80 ? 'amber' : 'green'}`}><div className="l">On time (D15)</div><div className="v">{otp}%</div><div className="s">{delayed.length} delayed</div></div>
        <div className={`kpi ${nogo.length ? 'red' : 'green'}`}><div className="l">Not dispatchable</div><div className="v">{nogo.length}</div><div className="s">{nogo.map(t => t.reg).join(', ') || 'all tails available'}</div></div>
        <div className={`kpi ${warned.length ? 'amber' : 'green'}`}><div className="l">Flights with warnings</div><div className="v">{warned.length}</div><div className="s">MEL deadlines, rotation, dispatch</div></div>
      </div>
      <Card title="Timeline" meta={`${new Date(from).toISOString().slice(5, 16).replace('T', ' ')}Z → ${new Date(to).toISOString().slice(5, 16).replace('T', ' ')}Z`} flush>
        {d && <Timeline from={from} to={to} now={now} tails={d.tails} flights={d.flights} selected={flight ?? null} onSelect={select} codes={codes} maintenance={d.maintenance} />}
        {q.isLoading && <div className="empty">Loading the operation…</div>}
        <div className="tl-legend">
          <span><i className="bar scheduled" /> scheduled</span><span><i className="bar delayed" /> delayed (ghost = STD)</span>
          <span><i className="bar cancelled" /> cancelled</span><span><i className="bar diverted" /> diverted / returned (↯)</span><span><i className="bar warn" /> has warnings</span>
          <span><i className="mel-tick" /> MEL rectification deadline</span><span><i className="slot" /> planned maintenance</span><span><i className="actual" /> reported (MVT/ACARS)</span><span><i className="now-tick" /> now</span>
        </div>
      </Card>
      <div className="grid g-two" style={{ marginTop: 14 }}>
        <Card title="Disruptions" meta={`${nogo.length + warned.length}`} flush>
          <div className="list">
            {nogo.map(t => (
              <div key={t.reg} className="li"><span className="sev red" />
                <div><b>{t.reg}</b> <span className="note">{t.type}</span><div className="sub">{t.reasons.join(' · ')}</div></div>
              </div>
            ))}
            {warned.slice(0, 30).map(f => (
              <button key={f.id} className="li click" style={{ width: '100%', textAlign: 'left' }} onClick={() => select(f.id)}>
                <span className="sev amber" />
                <div style={{ minWidth: 0 }}>
                  <b className="mono">{f.flightNo}</b> {codes[f.dep] ?? f.dep}–{codes[f.arr] ?? f.arr} <span className="note">{f.tail} · {f.etd.slice(11, 16)}Z</span>
                  <div className="sub">{f.warnings[0]}{f.warnings.length > 1 ? ` (+${f.warnings.length - 1})` : ''}</div>
                </div>
                {f.delayMinutes > 0 && <Pill tone="amber">+{f.delayMinutes}</Pill>}
              </button>
            ))}
            {nogo.length + warned.length === 0 && <div className="empty">No disruptions in this window.</div>}
          </div>
        </Card>
        <RecoveryPanel runId={run ?? null} onOpenRun={id => navigate({ search: s => ({ ...s, run: id }) })} codes={codes} />
      </div>
      <FlightDrawer id={flight ?? null} codes={codes} onClose={() => navigate({ search: s => ({ ...s, flight: undefined }) })} />
    </>
  );
}

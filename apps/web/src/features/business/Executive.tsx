import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import type { ExecutiveDashboardDto, KpiDto } from '@aeroos/contracts';
import { api } from '../../lib/api';
import { Card, ErrorNote, Head, Pill } from '../../components/ui';

const fmt = (k: KpiDto) => (k.unit === '%' ? `${k.value.toFixed(1)} %` : `${k.value.toLocaleString('en-GB')}${k.unit && k.unit !== '%' ? ` ${k.unit}` : ''}`);
const toneWord: Record<string, string> = { green: 'on target', amber: 'watch', red: 'act now' };

/** The accountable manager's view: operations, technical, safety & quality, crew and commercial figures, live. */
export function Executive() {
  const router = useRouter();
  const q = useQuery({ queryKey: ['exec'], queryFn: () => api<ExecutiveDashboardDto>('/exec/dashboard'), refetchInterval: 120_000 });
  const d = q.data;
  return (
    <>
      <Head crumb="Finance & Business / Executive dashboard" title="Executive Dashboard"
        desc="One page for the accountable manager and the nominated persons: each figure comes live from the module that owns it and links to the page where it is worked." />
      <ErrorNote error={q.error} />
      {d && <>
        {d.sections.map(s => (
          <Card key={s.key} title={s.title}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
              {s.kpis.map(k => (
                <div key={k.key} className="block" style={{ padding: 10, border: '1px solid var(--line)', borderRadius: 6, background: 'var(--raise)' }}>
                  <div className="note">{k.label}</div>
                  <div style={{ font: '700 26px var(--f-disp)', margin: '2px 0' }} className="mono">{fmt(k)}</div>
                  <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {k.tone && <Pill tone={k.tone}>{toneWord[k.tone]}</Pill>}
                    <span className="note">{k.detail}</span>
                  </div>
                  {k.link && <a href={k.link} className="note" onClick={e => { e.preventDefault(); router.history.push(k.link!); }}>open →</a>}
                </div>
              ))}
            </div>
          </Card>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
          <Card title="On-time performance by day" meta="arrivals within 15 min of schedule">
            <Bars data={d.otpByDay.map(x => ({ label: x.date.slice(5), value: x.onTimePct, title: x.onTimePct === null ? `${x.date}: no arrivals` : `${x.date}: ${x.onTimePct} % of arrivals on time (${x.flights} flights)` }))} max={100} unit="%" />
          </Card>
          <Card title="Maintenance revenue by month" meta="USD, from the ledger">
            <Bars data={d.revenueByMonth.map(x => ({ label: x.period.slice(2), value: Math.round(x.revenueCents / 100), title: `${x.period}: ${Math.round(x.revenueCents / 100).toLocaleString('en-GB')} USD` }))} unit="" />
          </Card>
        </div>
        <div className="note">Generated {d.generatedAt.slice(0, 16).replace('T', ' ')}Z for {d.operatorId}.</div>
      </>}
    </>
  );
}

/** One series of bars: thin, rounded at the data end, value on hover; empty days shown as a gap with a dash. */
function Bars({ data, max, unit }: { data: { label: string; value: number | null; title: string }[]; max?: number; unit: string }) {
  const W = 360, H = 150, P = 22, B = 18;
  const top = max ?? Math.max(1, ...data.map(d => d.value ?? 0));
  const step = (W - P) / data.length;
  const bw = Math.min(26, step - 8);
  const y = (v: number) => H - B - (v / top) * (H - B - 12);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Bar chart">
      <line x1={P} x2={W} y1={H - B} y2={H - B} stroke="var(--line2)" />
      <text x={P - 4} y={y(top) + 4} fill="var(--mute)" fontSize="10" textAnchor="end">{top.toLocaleString('en-GB')}{unit}</text>
      {data.map((d, i) => {
        const x = P + i * step + (step - bw) / 2;
        return (
          <g key={d.label}>
            <title>{d.title}</title>
            <rect x={P + i * step} y={0} width={step} height={H} fill="transparent" />
            {d.value === null || d.value === 0
              ? <text x={x + bw / 2} y={H - B - 4} fill="var(--dim)" fontSize="10" textAnchor="middle">–</text>
              : <path d={`M${x},${H - B} V${y(d.value) + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${H - B} Z`} fill="var(--cyan)" />}
            <text x={x + bw / 2} y={H - 5} fill="var(--mute)" fontSize="10" textAnchor="middle">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

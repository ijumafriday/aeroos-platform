import { useEffect, useMemo, useRef, useState } from 'react';
import type { FlightDto, MaintenanceSlotDto, TailRowDto } from '@aeroos/contracts';

/**
 * Tail-by-tail Gantt of the operation. Plain SVG, no licence needed; the props are deliberately the
 * same shape a commercial scheduler (e.g. Bryntum) would be fed, so it can replace this component
 * without touching the page around it.
 */
export interface TimelineProps {
  from: number;
  to: number;
  now: number;
  tails: TailRowDto[];
  flights: FlightDto[];
  selected: string | null;
  onSelect(flightId: string): void;
  /** ICAO → IATA for compact labels. */
  codes: Record<string, string>;
  /** Planned maintenance (CAMO work packages) shown as hatched blocks. */
  maintenance?: MaintenanceSlotDto[];
}

const ROW = 36;
const LABEL = 128;
const HEAD = 26;

export function Timeline({ from, to, now, tails, flights, selected, onSelect, codes, maintenance = [] }: TimelineProps) {
  const iata = (icao: string) => codes[icao] ?? icao;
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(e => setWidth(Math.max(600, e[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const span = to - from;
  const x = (t: number) => LABEL + ((t - from) / span) * (width - LABEL - 8);
  const rows = useMemo(() => {
    const order = [...tails].sort((a, b) => Number(a.dispatchable) - Number(b.dispatchable) || a.type.localeCompare(b.type) || a.reg.localeCompare(b.reg));
    return order.filter(t => flights.some(f => f.tail === t.reg) || !t.dispatchable || maintenance.some(m => m.tail === t.reg));
  }, [tails, flights, maintenance]);
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let t = Math.ceil(from / 3_600_000) * 3_600_000; t < to; t += 3_600_000) out.push(t);
    return out;
  }, [from, to]);
  const height = HEAD + rows.length * ROW + 6;

  return (
    <div ref={ref} className="tl-wrap" role="region" aria-label="Operations timeline">
      <svg width={width} height={height} className="tl">
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="3" height="6" fill="rgba(212,126,234,.22)" />
          </pattern>
        </defs>
        {hours.map(h => {
          const d = new Date(h);
          const major = d.getUTCHours() % 6 === 0;
          return (
            <g key={h}>
              <line x1={x(h)} x2={x(h)} y1={HEAD - 4} y2={height} className={major ? 'grid major' : 'grid'} />
              {(major || span < 30 * 3_600_000) && (
                <text x={x(h) + 3} y={14} className="hour">{d.getUTCHours() === 0 ? d.toISOString().slice(5, 10) : `${String(d.getUTCHours()).padStart(2, '0')}Z`}</text>
              )}
            </g>
          );
        })}
        {rows.map((t, i) => {
          const y = HEAD + i * ROW;
          return (
            <g key={t.reg}>
              <rect x={0} y={y} width={width} height={ROW} className={`row ${i % 2 ? 'odd' : ''} ${t.dispatchable ? '' : 'nogo'}`} />
              <text x={8} y={y + 15} className="reg">{t.reg}</text>
              <text x={8} y={y + 28} className="type">{t.dispatchable ? t.type : `NOT DISPATCHABLE`}</text>
              {t.mel.filter(m => Date.parse(m.deadline) > from && Date.parse(m.deadline) < to).map(m => (
                <g key={m.id}>
                  <line x1={x(Date.parse(m.deadline))} x2={x(Date.parse(m.deadline))} y1={y + 2} y2={y + ROW - 2} className="mel" />
                  <title>MEL {m.melRef} (Cat {m.category}) rectification due {m.deadline.slice(0, 16).replace('T', ' ')}Z</title>
                </g>
              ))}
              {maintenance.filter(m => m.tail === t.reg && Date.parse(m.end) > from && Date.parse(m.start) < to).map(m => {
                const a = x(Math.max(from, Date.parse(m.start)));
                const b = x(Math.min(to, Date.parse(m.end)));
                return (
                  <g key={m.wpId}>
                    <rect x={a} y={y + 2} width={Math.max(2, b - a)} height={ROW - 4} rx={3} className="slot" />
                    {b - a > 60 && <text x={a + 4} y={y + ROW - 6} className="slotlbl">{m.wpId} {m.bay ?? m.station}</text>}
                    <title>{`Planned maintenance ${m.wpId} · ${m.station}${m.bay ? ` ${m.bay}` : ''} · ${m.start.slice(11, 16)}–${m.end.slice(11, 16)}Z · ${m.status}`}</title>
                  </g>
                );
              })}
              {flights.filter(f => f.tail === t.reg).map(f => {
                const a = x(Math.max(from, Date.parse(f.etd)));
                const b = x(Math.min(to, Date.parse(f.eta)));
                if (b <= LABEL || a >= width) return null;
                const cls = ['bar', f.status.toLowerCase(), f.warnings.length ? 'warn' : '', selected === f.id ? 'sel' : ''].join(' ');
                const w = Math.max(3, b - a);
                return (
                  <g key={f.id} className="flt" onClick={() => onSelect(f.id)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onSelect(f.id)}>
                    {f.delayMinutes > 0 && f.status !== 'CANCELLED' && (
                      <rect x={x(Date.parse(f.std))} y={y + 9} width={Math.max(1, a - x(Date.parse(f.std)))} height={ROW - 18} className="ghost" />
                    )}
                    <rect x={a} y={y + 5} width={w} height={ROW - 10} rx={4} className={cls} />
                    {f.actuals.offBlock && (() => {
                      // Reported progress (MVT / ACARS): solid underline from off-block to on-block (or now).
                      const s0 = x(Math.max(from, Date.parse(f.actuals.offBlock)));
                      const s1 = x(Math.min(to, f.actuals.onBlock ? Date.parse(f.actuals.onBlock) : Math.min(now, Date.parse(f.eta))));
                      return s1 > s0 ? <rect x={s0} y={y + ROW - 7} width={s1 - s0} height={2.5} className={`actual ${f.actuals.onBlock ? 'in' : ''}`} /> : null;
                    })()}
                    {w > 46 && <text x={a + 5} y={y + 16} className="lbl">{f.flightNo}</text>}
                    {w > 46 && <text x={a + 5} y={y + 27} className="sub">{iata(f.dep)}–{f.actualArr ? `${iata(f.actualArr)}↯` : f.divertingTo ? `${iata(f.divertingTo)}?` : iata(f.arr)}{f.delayMinutes ? ` +${f.delayMinutes}` : ''}</text>}
                    <title>{`${f.flightNo} ${f.dep}–${f.arr} · ${f.etd.slice(11, 16)}–${f.eta.slice(11, 16)}Z · ${f.status}${f.actuals.offBlock ? ` · OUT ${f.actuals.offBlock.slice(11, 16)}Z` : ''}${f.actuals.onBlock ? ` IN ${f.actuals.onBlock.slice(11, 16)}Z` : ''}${f.delayMinutes ? ` +${f.delayMinutes} min` : ''}${f.warnings.length ? `\n⚠ ${f.warnings.join('\n⚠ ')}` : ''}`}</title>
                  </g>
                );
              })}
            </g>
          );
        })}
        {now > from && now < to && <line x1={x(now)} x2={x(now)} y1={HEAD - 6} y2={height} className="now" />}
      </svg>
    </div>
  );
}

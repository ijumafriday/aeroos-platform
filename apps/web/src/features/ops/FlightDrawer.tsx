import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FlightChangeResultDto, FlightDetailDto, FlightDto, MovementLogDto, TimelineDto } from '@aeroos/contracts';
import { api, post } from '../../lib/api';
import { short, zulu } from '../../lib/format';
import { useUi } from '../../lib/store';
import { DL, Drawer, ErrorNote, Pill } from '../../components/ui';

const ftlTone = (s: string) => (s === 'OK' ? 'green' : s === 'DISCRETION' ? 'amber' : 'red');
const hhmm = (iso: string) => `${iso.slice(11, 16)}Z`;
const opt = (iso: string | null) => (iso ? hhmm(iso) : '—');
const mvtTime = (iso: string) => iso.slice(11, 16).replace(':', '');
/** A ready-to-edit MVT for this flight: departure (AD) before off-block, arrival (AA) after. Stations in IATA code. */
const mvtTemplate = (f: FlightDto, iata: (icao: string) => string) => {
  const line = `${f.flightNo}/${f.std.slice(8, 10)}.${f.tail.replace('-', '')}.`;
  const now = Date.now();
  return f.actuals.offBlock
    ? `MVT\n${line}${iata(f.arr)}\nAA${mvtTime(new Date(now - 5 * 60_000).toISOString())}/${mvtTime(new Date(now).toISOString())}`
    : `MVT\n${line}${iata(f.dep)}\nAD${mvtTime(f.etd)}/${mvtTime(new Date(Date.parse(f.etd) + 12 * 60_000).toISOString())} EA${mvtTime(f.eta)} ${iata(f.arr)}${f.delayMinutes ? `\nDL93/${String(f.delayMinutes).padStart(4, '0')}` : ''}`;
};

export function FlightDrawer({ id, onClose, codes }: { id: string | null; onClose(): void; codes: Record<string, string> }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const q = useQuery({ queryKey: ['ops', 'flight', id], queryFn: () => api<FlightDetailDto>(`/ops/flights/${id}`), enabled: !!id });
  const [delay, setDelay] = useState('');
  const [reason, setReason] = useState('');
  const [tail, setTail] = useState('');
  const [impact, setImpact] = useState<FlightChangeResultDto | null>(null);
  const [mvt, setMvt] = useState('');
  const log = useQuery({ queryKey: ['ops', 'movements', id], queryFn: () => api<MovementLogDto[]>(`/ops/movements?flight=${id}`), enabled: !!id });
  const done = (r: FlightChangeResultDto, msg: string) => {
    setImpact(r);
    toast(msg, 'cyan');
    void qc.invalidateQueries({ queryKey: ['ops'] });
  };
  const delayM = useMutation({
    mutationFn: () => post<FlightChangeResultDto>(`/ops/flights/${id}/delay`, { delayMinutes: Number(delay), reason }),
    onSuccess: r => done(r, `${r.flight.flightNo} ETD ${hhmm(r.flight.etd)}${r.knockOn.length ? ` · knock-on ${r.knockOn.map(k => k.flightNo).join(', ')}` : ''}`)
  });
  const cancelM = useMutation({
    mutationFn: () => post<FlightChangeResultDto>(`/ops/flights/${id}/cancel`, { reason }),
    onSuccess: r => done(r, `${r.flight.flightNo} cancelled`)
  });
  const tailM = useMutation({
    mutationFn: () => post<FlightChangeResultDto>(`/ops/flights/${id}/tail`, { tail }),
    onSuccess: r => done(r, `${r.flight.flightNo} now on ${r.flight.tail}`)
  });
  const mvtM = useMutation({
    mutationFn: () => post<FlightDto>('/ops/movements', { text: mvt }),
    onSuccess: r => { setMvt(''); toast(`${r.flightNo} movement recorded · ${r.status.toLowerCase()}`, 'cyan'); void qc.invalidateQueries({ queryKey: ['ops'] }); },
    onSettled: () => void log.refetch()
  });
  const timeline = qc.getQueriesData<TimelineDto>({ queryKey: ['ops', 'timeline'] })[0]?.[1];
  const d = q.data;
  const f = d?.flight;
  const sameType = (timeline?.tails ?? []).filter(t => f && t.type === f.aircraftType && t.reg !== f.tail);
  const changeable = !!f && (f.status === 'SCHEDULED' || f.status === 'DELAYED') && !f.actuals.offBlock;
  const reportable = !!f && f.status !== 'CANCELLED' && f.status !== 'DIVERTED' && !f.actuals.onBlock;
  const name = (icao: string) => codes[icao] ?? icao;

  return (
    <Drawer
      open={!!id}
      onClose={() => { setImpact(null); onClose(); }}
      eyebrow={f ? `Flight · ${f.date} · ${f.aircraftType}` : 'Flight'}
      title={f ? `${f.flightNo} ${name(f.dep)}–${name(f.arr)}` : id ?? ''}
      tags={f && <>
        <Pill tone={f.status === 'CANCELLED' || f.status === 'DIVERTED' ? 'red' : f.delayMinutes ? 'amber' : 'green'}>{f.status}{f.delayMinutes ? ` +${f.delayMinutes}` : ''}</Pill>
        {f.actualArr && <Pill tone="red">{f.actualArr === f.dep ? 'returned to' : f.status === 'DIVERTED' ? 'diverted to' : 'landing at'} {name(f.actualArr)}</Pill>}
        {!f.actualArr && f.divertingTo && <Pill tone="amber">diverting to {name(f.divertingTo)} (announced)</Pill>}
        <Pill tone="cyan">{f.tail}</Pill>
      </>}
    >
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      {f && d && (
        <>
          <DL items={[
            ['STD → STA', `${hhmm(f.std)} → ${hhmm(f.sta)}`], ['ETD → ETA', `${hhmm(f.etd)} → ${hhmm(f.eta)}`],
            ['Block', `${Math.floor(f.blockMinutes / 60)}:${String(f.blockMinutes % 60).padStart(2, '0')}`], ['Delay reason', f.delayReason ?? '—'],
            ['Load', f.load ? `${f.load.bookedPax}/${f.load.seats} booked${f.load.bookedPax >= f.load.seats ? ` · full (${f.load.jumpSeats} jump seat${f.load.jumpSeats === 1 ? '' : 's'} for positioning crew)` : ` · ${f.load.seats - f.load.bookedPax} free`}` : '—']
          ]} />
          {f.warnings.map(w => <div key={w} className="callout amber">{w}</div>)}

          <section className="dsec">
            <h3>Actual times <span className="note">MVT / ACARS OOOI</span></h3>
            <DL items={[
              ['Off-block (OUT)', opt(f.actuals.offBlock)], ['Airborne (OFF)', opt(f.actuals.airborne)],
              ['Touchdown (ON)', opt(f.actuals.touchdown)], ['On-block (IN)', opt(f.actuals.onBlock)],
              ['Delay codes', f.delayCodes.length ? f.delayCodes.map(c => `${c.code}${c.minutes != null ? `/${c.minutes}′` : ''}`).join(' · ') : '—']
            ]} />
            {d.permissions.manage && reportable && (
              <>
                <div className="field" style={{ marginTop: 8 }}>
                  <label htmlFor="fd-mvt">Record a movement message (e.g. phoned in by the station)</label>
                  <textarea id="fd-mvt" className="inp mono" rows={4} value={mvt} onChange={e => setMvt(e.target.value.toUpperCase())} placeholder={mvtTemplate(f, name)} />
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  <button className="btn" onClick={() => setMvt(mvtTemplate(f, name))}>Fill template</button>
                  <button className="btn pri" disabled={mvt.trim().length < 10 || mvtM.isPending} onClick={() => mvtM.mutate()}>Send MVT</button>
                </div>
                <ErrorNote error={mvtM.error} />
              </>
            )}
            {(log.data ?? []).length > 0 && (
              <div className="stack" style={{ gap: 4, marginTop: 8 }}>
                {log.data!.map(m => (
                  <div key={m.id} className="mvt-log">
                    <Pill tone={m.status === 'APPLIED' ? 'green' : m.status === 'IGNORED' ? 'cyan' : 'red'}>{m.source} · {m.status.toLowerCase()}</Pill>
                    <span className="note">{zulu(m.receivedAt)}</span>
                    <pre className="mono">{m.raw}</pre>
                    {m.detail && <div className="sub">{m.detail}</div>}
                  </div>
                ))}
              </div>
            )}
          </section>

          {impact && impact.crewImpact.length > 0 && (
            <section className="dsec">
              <h3>FTL impact of your change</h3>
              {impact.crewImpact.map(c => (
                <div key={c.crewId} className={`callout ${ftlTone(c.status)}`}>
                  <b>{c.name}</b> · {c.status === 'OK' ? 'within limits' : c.status === 'DISCRETION' ? "commander's discretion needed" : 'LIMIT EXCEEDED — re-crew or re-plan'}
                  {c.findings.map((x, i) => <div key={i} className="sub">{x.message} <span className="note mono">{x.ref}</span></div>)}
                </div>
              ))}
            </section>
          )}

          <section className="dsec">
            <h3>Crew</h3>
            <div className="row">{d.crew.map(c => <Pill key={c.id} tone={ftlTone(c.status)}>{c.positioning ? 'DH ' : ''}{c.rank} {c.name} · FTL {c.status.toLowerCase()}</Pill>)}</div>
            {d.crew.length === 0 && <p className="note">No crew rostered.</p>}
          </section>

          {d.permissions.manage && changeable && (
            <section className="dsec">
              <h3>OCC actions</h3>
              <div className="form-grid">
                <div className="field"><label htmlFor="fd-delay">Total delay (min)</label><input id="fd-delay" className="inp mono" inputMode="numeric" value={delay} onChange={e => setDelay(e.target.value.replace(/\D/g, ''))} placeholder={String(f.delayMinutes || 30)} /></div>
                <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="fd-reason">Reason (IATA code / text)</label><input id="fd-reason" className="inp" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. 93 late inbound aircraft" /></div>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn warn" disabled={!delay || delayM.isPending} onClick={() => delayM.mutate()}>Set delay</button>
                <button className="btn danger" disabled={reason.trim().length < 3 || cancelM.isPending} onClick={() => cancelM.mutate()}>Cancel flight</button>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <select className="inp" style={{ maxWidth: 240 }} value={tail} onChange={e => setTail(e.target.value)} aria-label="Swap to tail">
                  <option value="">Swap to another {f.aircraftType}…</option>
                  {sameType.map(t => <option key={t.reg} value={t.reg} disabled={!t.dispatchable}>{t.reg}{t.dispatchable ? '' : ` — ${t.reasons[0]}`}</option>)}
                </select>
                <button className="btn" disabled={!tail || tailM.isPending} onClick={() => tailM.mutate()}>Swap tail</button>
              </div>
              <ErrorNote error={delayM.error ?? cancelM.error ?? tailM.error} />
            </section>
          )}

          <section className="dsec">
            <h3>Rotation · {f.tail}</h3>
            <div className="stack" style={{ gap: 4 }}>
              {d.rotation.map(r => (
                <div key={r.id} className={`rot ${r.id === f.id ? 'on' : ''} ${r.status === 'CANCELLED' ? 'cx' : ''}`}>
                  <b className="mono">{r.flightNo}</b> <span>{name(r.dep)}–{name(r.arr)}</span>
                  <span className="mono note">{hhmm(r.etd)}–{hhmm(r.eta)}</span>
                  {r.delayMinutes > 0 && <Pill tone="amber">+{r.delayMinutes}</Pill>}
                  {r.warnings.length > 0 && <span className="note" title={r.warnings.join('\n')}>⚠ {r.warnings.length}</span>}
                </div>
              ))}
            </div>
          </section>

          <section className="dsec">
            <h3>Diversion alternates · {name(f.arr)}</h3>
            <div className="row">{d.alternates.map(a => <Pill key={a.icao}>{a.iata} {a.name} · {a.distanceKm} km</Pill>)}</div>
            {d.alternates.length === 0 && <p className="note">None within 600 km.</p>}
          </section>

          <section className="dsec">
            <h3>Audit trail <span className="note mono">chain: ops</span></h3>
            <div className="timeline">
              {d.audit.map(a => (
                <div key={a.seq} className="tl"><i /><div><b>{a.action}</b> <span className="note">{zulu(a.at)} · {a.actor}</span><div className="h">#{a.seq} {short(a.hash)}</div></div></div>
              ))}
              {d.audit.length === 0 && <p className="note">No changes yet.</p>}
            </div>
          </section>
        </>
      )}
    </Drawer>
  );
}

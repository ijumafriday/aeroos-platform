import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { DispatchBoardRowDto, DispatchDto, DispatchLoadDto, MeDto, OverflightPermitDto } from '@aeroos/contracts';
import { api, post } from '../../lib/api';
import { zulu } from '../../lib/format';
import { useUi } from '../../lib/store';
import { Card, DL, Drawer, ErrorNote, Head, Pill } from '../../components/ui';

const tone: Record<string, string> = { NONE: '', OPEN: 'amber', RELEASED: 'green', WITHDRAWN: 'red' };
const kg = (n: number) => `${n.toLocaleString('en-GB')} kg`;
const hhmm = (iso: string) => iso.slice(11, 16);
const who = (s: string | null) => (s ?? '').replace(/^user:/, '');
const today = () => new Date().toISOString().slice(0, 10);

/** Flight dispatch: load sheet, fuel plan, tankering, ICAO flight plan, permits and the dispatch release. */
export function Dispatch() {
  const { flight, day } = useSearch({ from: '/ops/dispatch' });
  const navigate = useNavigate({ from: '/ops/dispatch' });
  const d = day ?? today();
  const q = useQuery({ queryKey: ['dispatch', 'board', d], queryFn: () => api<DispatchBoardRowDto[]>(`/ops/dispatch?day=${d}`), refetchInterval: 60_000 });
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') });
  const isOcc = !!me.data?.roles.includes('occ_controller');
  return (
    <>
      <Head crumb="Flight Ops / Dispatch" title="Dispatch & Load Control"
        desc="Per flight: the load sheet (standard masses, centre of gravity, structural and runway limits), the fuel plan with tankering advice, the ICAO flight plan and overflight permits. A flight is released only when every check passes; a change after release beyond the last-minute-change tolerance withdraws the release."
        actions={<input type="date" className="inp" value={d} onChange={e => navigate({ search: { day: e.target.value, flight } })} aria-label="Day" />} />
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      <Card title="Flights" meta={`${q.data?.length ?? 0}`} flush>
        <div className="tbl-wrap"><table className="t">
          <thead><tr><th>Flight</th><th>Route</th><th>ETD</th><th>Aircraft</th><th>Prepared</th><th>Dispatch</th></tr></thead>
          <tbody>
            {(q.data ?? []).map(r => (
              <tr key={r.flight.id} className="click" tabIndex={0} onClick={() => navigate({ search: { day: d, flight: r.flight.id } })} onKeyDown={e => e.key === 'Enter' && navigate({ search: { day: d, flight: r.flight.id } })}>
                <td><b className="mono">{r.flight.flightNo}</b> <span className="note">{r.flight.status.toLowerCase()}</span></td>
                <td className="mono">{r.flight.dep}–{r.flight.arr}</td>
                <td className="mono">{hhmm(r.flight.etd)}Z</td>
                <td className="mono">{r.flight.tail} · {r.flight.aircraftType}</td>
                <td className="mono">{r.ready}/{r.total}</td>
                <td><Pill tone={tone[r.status]}>{r.status === 'NONE' ? 'not started' : r.status.toLowerCase()}</Pill></td>
              </tr>
            ))}
            {q.data?.length === 0 && <tr><td colSpan={6} className="empty">No flights on {d}.</td></tr>}
          </tbody>
        </table></div>
      </Card>
      <Reference canManage={isOcc} />
      <DispatchDrawer key={flight ?? 'none'} id={flight ?? null} onClose={() => navigate({ search: { day: d, flight: undefined } })} />
    </>
  );
}

const EMPTY_LOAD: DispatchLoadDto = { flightCrew: 2, cabinCrew: 4, adults: 0, children: 0, infants: 0, bags: 0, holdFwdKg: 0, holdAftKg: 0 };

function DispatchDrawer({ id, onClose }: { id: string | null; onClose(): void }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const q = useQuery({ queryKey: ['dispatch', 'flight', id], queryFn: () => api<DispatchDto>(`/ops/dispatch/${id}`), enabled: !!id });
  const x = q.data;
  const [load, setLoad] = useState<DispatchLoadDto>(EMPTY_LOAD);
  const [fuel, setFuel] = useState({ block: '', taxi: '200', extra: '0' });
  const [slot, setSlot] = useState({ ctot: '', sourceRef: '' });
  // Initialise the forms from the server only when the flight or the saved figures change — never on an
  // unrelated save (e.g. fuel) or a background refresh, so typed-in values are not lost.
  const savedLoad = JSON.stringify(x?.load ?? null), savedFuel = JSON.stringify(x?.fuelInput ?? null);
  useEffect(() => {
    if (!x) return;
    setLoad(x.load ?? { ...EMPTY_LOAD, adults: x.flight.load?.bookedPax ?? 0, bags: Math.round((x.flight.load?.bookedPax ?? 0) * 0.7) });
  }, [x?.flight.id, savedLoad]);
  useEffect(() => {
    if (x?.fuelInput) setFuel({ block: String(x.fuelInput.block), taxi: String(x.fuelInput.taxi), extra: String(x.fuelInput.extra) });
  }, [x?.flight.id, savedFuel]);
  const refresh = (r: DispatchDto) => { qc.setQueryData(['dispatch', 'flight', id], r); void qc.invalidateQueries({ queryKey: ['dispatch', 'board'] }); };
  const saveLoad = useMutation({ mutationFn: () => post<DispatchDto>(`/ops/dispatch/${id}/load`, { load, version: x!.version }), onSuccess: r => { toast(r.status === 'WITHDRAWN' ? 'Load changed beyond tolerance — release withdrawn' : 'Load sheet saved', r.status === 'WITHDRAWN' ? 'red' : 'cyan'); refresh(r); } });
  const saveFuel = useMutation({ mutationFn: () => post<DispatchDto>(`/ops/dispatch/${id}/fuel`, { fuel: { block: Number(fuel.block), taxi: Number(fuel.taxi), extra: Number(fuel.extra) }, version: x!.version }),
    onSuccess: r => { toast('Fuel saved', 'cyan'); refresh(r); } });
  const file = useMutation({ mutationFn: () => post<DispatchDto>(`/ops/dispatch/${id}/flight-plan`), onSuccess: r => { toast('Flight plan filed', 'cyan'); refresh(r); } });
  const release = useMutation({ mutationFn: () => post<DispatchDto>(`/ops/dispatch/${id}/release`, { version: x!.version }), onSuccess: r => { toast(`${r.flight.flightNo} released`, 'green'); refresh(r); } });
  const saveSlot = useMutation({ mutationFn: () => post(`/ops/flight-watch/${id}/slot`, { ctot: new Date(slot.ctot).toISOString(), sourceRef: slot.sourceRef }), onSuccess: async () => { toast('Flow slot recorded', 'cyan'); await qc.invalidateQueries({ queryKey: ['dispatch', 'flight', id] }); } });
  const num = (k: keyof DispatchLoadDto) => (
    <div className="field" key={k}><label htmlFor={`ld-${k}`}>{k.replace(/([A-Z])/g, ' $1').replace('Kg', ' kg').toLowerCase()}</label>
      <input id={`ld-${k}`} className="inp mono" inputMode="numeric" value={load[k]} onChange={e => setLoad(l => ({ ...l, [k]: Number(e.target.value.replace(/\D/g, '')) || 0 }))} /></div>
  );
  const prep = !!x?.permissions.prepare;
  const mb = x?.massBalance, fp = x?.fuel;
  return (
    <Drawer open={!!id} onClose={onClose} eyebrow={x ? `Dispatch · ${x.flight.date} · ${x.flight.aircraftType}` : 'Dispatch'}
      title={x ? `${x.flight.flightNo} ${x.flight.dep}–${x.flight.arr} · ${x.flight.tail}` : id ?? ''} tags={x && <Pill tone={tone[x.status]}>{x.status.toLowerCase()}</Pill>}>
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      {x && (
        <>
          <section className="dsec">
            <h3>Release checks</h3>
            <div className="stack" style={{ gap: 4 }}>
              {x.checks.map(c => <div key={c.code} className="row" style={{ alignItems: 'flex-start' }}><Pill tone={c.ok ? 'green' : 'red'}>{c.ok ? '✓' : '✕'} {c.code.replace('_', ' ').toLowerCase()}</Pill><span className="sub">{c.message}</span></div>)}
            </div>
            {x.release && <div className="callout green" style={{ marginTop: 8 }}>Released {zulu(x.release.at)} by {who(x.release.by)} · TOW {kg(x.release.tow)} · {x.release.pax} pax</div>}
            {x.lmc.length > 0 && <div className="sub" style={{ marginTop: 6 }}>Last-minute changes: {x.lmc.map(l => `${hhmm(l.at)}Z ${l.change}`).join(' · ')}</div>}
            <div className="row" style={{ marginTop: 8 }}>
              {x.permissions.release && x.status !== 'RELEASED' && <button className="btn pri" disabled={release.isPending || !x.checks.every(c => c.ok)} onClick={() => release.mutate()}>Release {x.flight.flightNo}</button>}
              <button className="btn ghost" onClick={() => window.print()}>Print briefing package</button>
            </div>
            <ErrorNote error={release.error} />
          </section>

          <section className="dsec">
            <h3>Operational briefing</h3>
            {x.ofp && <div className="block" style={{marginBottom:8}}><div className="row"><Pill tone="green">provider OFP</Pill><b>{x.ofp.provider}</b><span className="note">{x.ofp.providerRef} · rev {x.ofp.revision} · generated {zulu(x.ofp.generatedAt)}</span></div><div className="sub mono">{x.ofp.route} · {x.ofp.cruiseLevel ? `FL${x.ofp.cruiseLevel}` : 'level provider-managed'} · block {x.ofp.blockFuelKg} kg · TOW {x.ofp.takeoffMassKg} kg{x.ofp.alternate ? ` · ALT ${x.ofp.alternate}` : ''}{x.ofp.etopsMinutes ? ` · EDTO ${x.ofp.etopsMinutes} min` : ''}</div><div className="note">performance {x.ofp.performanceRef} · nav {x.ofp.navDataCycle} · WX {x.ofp.weatherRef} · NOTAM {x.ofp.notamRef}</div></div>}
            {x.flightWatch ? <>
              <div className="stack" style={{ gap: 5 }}>
                {x.flightWatch.weather.map(w => <div key={w.station} className="block"><b className="mono">{w.station}</b> <span className="note">METAR {w.metar ? hhmm(w.metar.issuedAt) + 'Z' : 'missing'} · TAF {w.taf ? hhmm(w.taf.issuedAt) + 'Z' : 'missing'}</span>
                  {w.metar && <div className="sub mono">{w.metar.raw}</div>}{w.taf && <div className="sub mono">{w.taf.raw}</div>}</div>)}
                {x.flightWatch.notams.map(n => <div key={n.id} className="row" style={{ alignItems: 'flex-start' }}><Pill tone={n.severity === 'CLOSED' ? 'red' : n.severity === 'RESTRICTED' ? 'amber' : ''}>{n.station} {n.number}</Pill><span className="sub">{n.text}</span></div>)}
                {x.flightWatch.notams.length === 0 && <div className="sub">No active NOTAMs in the flight window.</div>}
                <div className="sub">{x.flightWatch.slot ? `CTOT ${hhmm(x.flightWatch.slot.ctot)}Z · tolerance -${x.flightWatch.slot.toleranceBefore}/+${x.flightWatch.slot.toleranceAfter} min · ${x.flightWatch.slot.sourceRef}` : 'No active CTOT/flow slot.'}</div>
              </div>
              {prep && <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                <input type="datetime-local" className="inp" value={slot.ctot} onChange={e => setSlot(v => ({ ...v, ctot: e.target.value }))} aria-label="CTOT" />
                <input className="inp" placeholder="Slot source/reference" value={slot.sourceRef} onChange={e => setSlot(v => ({ ...v, sourceRef: e.target.value }))} aria-label="Slot source reference" />
                <button className="btn sm" disabled={!slot.ctot || slot.sourceRef.trim().length < 2 || saveSlot.isPending} onClick={() => saveSlot.mutate()}>Record CTOT</button>
                <ErrorNote error={saveSlot.error} />
              </div>}
            </> : <div className="empty">Operational briefing unavailable.</div>}
          </section>

          <section className="dsec">
            <h3>Load sheet</h3>
            {prep && (
              <>
                <div className="form-grid">{(['flightCrew', 'cabinCrew', 'adults', 'children', 'infants', 'bags', 'holdFwdKg', 'holdAftKg'] as const).map(num)}</div>
                <div className="row" style={{ marginTop: 6 }}><button className="btn" disabled={saveLoad.isPending} onClick={() => saveLoad.mutate()}>Save load</button>
                  <span className="note">{x.flight.load ? `${x.flight.load.bookedPax} booked of ${x.flight.load.seats} seats` : ''} · standard masses: adult 84, child 35 kg; bags 11 / 13 / 15 kg (domestic / Europe / intercontinental)</span></div>
                <ErrorNote error={saveLoad.error} />
              </>
            )}
            {mb && (
              <>
                <DL items={[
                  ['Dry operating mass', kg(mb.dow)], ['Passengers / bags', `${kg(mb.paxMass)} / ${kg(mb.bagMass)}`],
                  ['Zero-fuel mass', `${kg(mb.zfw)} (max ${kg(mb.limits.mzfw)}) · ${mb.zfwMac} %MAC`],
                  ['Take-off mass', `${kg(mb.tow)} (limit ${kg(mb.limits.tow)} ${mb.limits.towBy}) · ${mb.towMac} %MAC`],
                  ['Landing mass', `${kg(mb.lw)} (limit ${kg(mb.limits.lw)} ${mb.limits.lwBy}) · ${mb.lwMac} %MAC`],
                  ['Underload', kg(mb.underload)], ['CG limits', x.type ? `${x.type.fwdLimit}–${x.type.aftLimit} %MAC` : '—']
                ]} />
                {mb.findings.map(f => <div key={f} className="callout red">{f}</div>)}
              </>
            )}
          </section>

          <section className="dsec">
            <h3>Fuel plan</h3>
            {prep && (
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <input className="inp mono" style={{ maxWidth: 120 }} placeholder="Block kg" value={fuel.block} onChange={e => setFuel(f => ({ ...f, block: e.target.value.replace(/\D/g, '') }))} aria-label="Block fuel kg" />
                <input className="inp mono" style={{ maxWidth: 90 }} value={fuel.taxi} onChange={e => setFuel(f => ({ ...f, taxi: e.target.value.replace(/\D/g, '') }))} aria-label="Taxi fuel kg" />
                <input className="inp mono" style={{ maxWidth: 90 }} value={fuel.extra} onChange={e => setFuel(f => ({ ...f, extra: e.target.value.replace(/\D/g, '') }))} aria-label="Extra fuel kg" />
                <button className="btn" disabled={saveFuel.isPending || !fuel.block} onClick={() => saveFuel.mutate()}>Save fuel</button>
                <span className="note">block · taxi · extra (kg)</span>
              </div>
            )}
            <ErrorNote error={saveFuel.error} />
            {fp && (
              <DL items={[
                ['Trip', `${kg(fp.trip)} (${fp.tripMinutes} min)`], ['Contingency', `${kg(fp.contingency)} (5 % / 5 min hold)`],
                ['Alternate', `${kg(fp.alternate)}${fp.alternateIcao ? ` to ${fp.alternateIcao} (${fp.alternateMinutes} min)` : ''}`], ['Final reserve', `${kg(fp.finalReserve)} (30 min)`],
                ['Taxi / extra', `${kg(fp.taxi)} / ${kg(fp.extra)}`], ['Required', kg(fp.required)],
                ['Block', <span key="b" style={fp.margin < 0 ? { color: 'var(--red)' } : undefined}>{kg(fp.block)} ({fp.margin >= 0 ? '+' : ''}{fp.margin} kg)</span>]
              ]} />
            )}
            {x.tankering && <div className={`callout ${x.tankering.worthIt ? 'green' : ''}`}>Tankering: {x.tankering.reason}{x.tankering.worthIt ? ` — about ${x.tankering.savingUsd.toLocaleString('en-GB')} USD` : ''} (fuel {x.tankering.priceDep ?? '—'} → {x.tankering.priceArr ?? '—'} USD/kg)</div>}
          </section>

          <section className="dsec">
            <h3>ICAO flight plan</h3>
            <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{x.flightPlan.message || 'No type data — cannot form a flight plan'}</pre>
            <div className="row" style={{ marginTop: 6 }}>
              {prep && <button className="btn" disabled={file.isPending || x.flightPlan.current} onClick={() => file.mutate()}>{x.flightPlan.filedAt ? (x.flightPlan.current ? 'Filed' : 'File again') : 'File flight plan'}</button>}
              {x.flightPlan.filedAt && <span className="note">filed {zulu(x.flightPlan.filedAt)} by {who(x.flightPlan.filedBy)}{x.flightPlan.current ? '' : ' — changed since'}</span>}
            </div>
            <ErrorNote error={file.error} />
          </section>

          <section className="dsec">
            <h3>Route and overflight permits</h3>
            <div className="sub">{x.route ? `${x.route.route} · FL${x.route.cruiseLevel} · ${x.route.countries.join(' → ')}` : 'No route on file'}</div>
            {x.permits.map(p => <div key={p.country} className="row"><Pill tone={p.ok ? 'green' : 'red'}>{p.country}</Pill><span className="sub">{p.ok ? `${p.permit} · ${p.note}` : p.note}</span></div>)}
          </section>
        </>
      )}
    </Drawer>
  );
}

function Reference({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const permits = useQuery({ queryKey: ['dispatch', 'permits'], queryFn: () => api<OverflightPermitDto[]>('/ops/dispatch/permits') });
  const prices = useQuery({ queryKey: ['dispatch', 'prices'], queryFn: () => api<{ station: string; usdPerKg: number; asOf: string }[]>('/ops/dispatch/fuel-prices') });
  const [pf, setPf] = useState({ country: '', number: '', validFrom: today(), validTo: today(), types: '' });
  const [fp, setFp] = useState({ station: '', usdPerKg: '' });
  const addPermit = useMutation({ mutationFn: () => post('/ops/dispatch/permits', { ...pf, types: pf.types.split(',').map(s => s.trim()).filter(Boolean) }),
    onSuccess: () => { toast('Permit recorded', 'cyan'); void qc.invalidateQueries({ queryKey: ['dispatch'] }); } });
  const setPrice = useMutation({ mutationFn: () => post('/ops/dispatch/fuel-prices', { station: fp.station, usdPerKg: Number(fp.usdPerKg) }),
    onSuccess: () => { toast('Fuel price saved', 'cyan'); void qc.invalidateQueries({ queryKey: ['dispatch'] }); } });
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
      <Card title="Overflight permits" meta={`${permits.data?.length ?? 0}`}>
        <div className="stack" style={{ gap: 4 }}>
          {(permits.data ?? []).map(p => <div key={p.id} className="row"><Pill tone={p.expiresInDays < 0 ? 'red' : p.expiresInDays <= 30 ? 'amber' : 'green'}>{p.country}</Pill>
            <span className="mono">{p.number}</span><span className="note">{p.validFrom} → {p.validTo}{p.types.length ? ` · ${p.types.join(', ')}` : ''}{p.expiresInDays <= 30 ? ` · ${p.expiresInDays < 0 ? 'expired' : `expires in ${p.expiresInDays} d`}` : ''}</span></div>)}
        </div>
        {canManage && (
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <input className="inp mono" style={{ maxWidth: 60 }} placeholder="MA" maxLength={2} value={pf.country} onChange={e => setPf(x => ({ ...x, country: e.target.value.toUpperCase() }))} aria-label="Country" />
            <input className="inp mono" style={{ maxWidth: 200 }} placeholder="Permit number" value={pf.number} onChange={e => setPf(x => ({ ...x, number: e.target.value }))} aria-label="Permit number" />
            <input type="date" className="inp" value={pf.validFrom} onChange={e => setPf(x => ({ ...x, validFrom: e.target.value }))} aria-label="Valid from" />
            <input type="date" className="inp" value={pf.validTo} onChange={e => setPf(x => ({ ...x, validTo: e.target.value }))} aria-label="Valid to" />
            <input className="inp" style={{ maxWidth: 200 }} placeholder="Types (blank = all)" value={pf.types} onChange={e => setPf(x => ({ ...x, types: e.target.value }))} aria-label="Types" />
            <button className="btn sm" disabled={addPermit.isPending} onClick={() => addPermit.mutate()}>Record permit</button>
            <ErrorNote error={addPermit.error} />
          </div>
        )}
      </Card>
      <Card title="Fuel prices (USD/kg)" meta={`${prices.data?.length ?? 0}`}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{(prices.data ?? []).map(p => <Pill key={p.station}>{p.station} {p.usdPerKg}</Pill>)}</div>
        {canManage && (
          <div className="row" style={{ marginTop: 8 }}>
            <input className="inp mono" style={{ maxWidth: 80 }} placeholder="ENGM" maxLength={4} value={fp.station} onChange={e => setFp(x => ({ ...x, station: e.target.value.toUpperCase() }))} aria-label="Station" />
            <input className="inp mono" style={{ maxWidth: 100 }} placeholder="0.92" value={fp.usdPerKg} onChange={e => setFp(x => ({ ...x, usdPerKg: e.target.value }))} aria-label="USD per kg" />
            <button className="btn sm" disabled={setPrice.isPending} onClick={() => setPrice.mutate()}>Save price</button>
            <ErrorNote error={setPrice.error} />
          </div>
        )}
      </Card>
      {canManage && <OperationalData />}
    </div>
  );
}

function OperationalData() {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const now = new Date();
  const dt = (d: Date) => d.toISOString().slice(0,16);
  const [wx, setWx] = useState({ station: '', kind: 'METAR', issuedAt: dt(now), validFrom: dt(now), validTo: dt(new Date(now.getTime()+3_600_000)), raw: '', sourceRef: '', visibilityM: '', ceilingFt: '', crosswindKt: '', thunderstorm: false });
  const [nt, setNt] = useState({ station: '', number: '', startsAt: dt(now), endsAt: dt(new Date(now.getTime()+6*3_600_000)), category: 'OTHER', severity: 'INFO', text: '', sourceRef: '' });
  const weather = useMutation({ mutationFn: () => post('/ops/flight-watch/weather', { station: wx.station.toUpperCase(), kind: wx.kind, issuedAt: new Date(wx.issuedAt).toISOString(), validFrom: new Date(wx.validFrom).toISOString(), validTo: new Date(wx.validTo).toISOString(), raw: wx.raw, sourceRef: wx.sourceRef, visibilityM: wx.visibilityM ? Number(wx.visibilityM) : null, ceilingFt: wx.ceilingFt ? Number(wx.ceilingFt) : null, crosswindKt: wx.crosswindKt ? Number(wx.crosswindKt) : null, thunderstorm: wx.thunderstorm }), onSuccess: () => { toast('Weather briefing data recorded', 'cyan'); void qc.invalidateQueries({ queryKey: ['dispatch'] }); } });
  const notam = useMutation({ mutationFn: () => post('/ops/flight-watch/notams', { station: nt.station.toUpperCase(), number: nt.number, startsAt: new Date(nt.startsAt).toISOString(), endsAt: new Date(nt.endsAt).toISOString(), category: nt.category, severity: nt.severity, text: nt.text, sourceRef: nt.sourceRef }), onSuccess: () => { toast('NOTAM recorded', 'cyan'); void qc.invalidateQueries({ queryKey: ['dispatch'] }); } });
  return <Card title="Operational data intake" meta="provenance required">
    <div className="stack">
      <div className="block"><b>Weather</b><div className="row" style={{ flexWrap: 'wrap', marginTop: 6 }}>
        <input className="inp mono" style={{ maxWidth: 80 }} placeholder="HKJK" value={wx.station} onChange={e => setWx(v => ({ ...v, station: e.target.value }))} />
        <select className="inp" value={wx.kind} onChange={e => setWx(v => ({ ...v, kind: e.target.value }))}><option>METAR</option><option>TAF</option></select>
        <input type="datetime-local" className="inp" value={wx.issuedAt} onChange={e => setWx(v => ({ ...v, issuedAt: e.target.value }))} />
        <input type="datetime-local" className="inp" value={wx.validFrom} onChange={e => setWx(v => ({ ...v, validFrom: e.target.value }))} />
        <input type="datetime-local" className="inp" value={wx.validTo} onChange={e => setWx(v => ({ ...v, validTo: e.target.value }))} />
        <input className="inp" placeholder="Provider/source ref" value={wx.sourceRef} onChange={e => setWx(v => ({ ...v, sourceRef: e.target.value }))} />
      </div><textarea className="inp" rows={2} placeholder="Raw METAR/TAF" value={wx.raw} onChange={e => setWx(v => ({ ...v, raw: e.target.value }))} />
      <div className="row" style={{ flexWrap: 'wrap' }}><input className="inp" style={{ maxWidth: 130 }} placeholder="Visibility m" value={wx.visibilityM} onChange={e => setWx(v => ({ ...v, visibilityM: e.target.value.replace(/\D/g,'') }))} /><input className="inp" style={{ maxWidth: 130 }} placeholder="Ceiling ft" value={wx.ceilingFt} onChange={e => setWx(v => ({ ...v, ceilingFt: e.target.value.replace(/\D/g,'') }))} /><input className="inp" style={{ maxWidth: 140 }} placeholder="Crosswind kt" value={wx.crosswindKt} onChange={e => setWx(v => ({ ...v, crosswindKt: e.target.value.replace(/\D/g,'') }))} /><label className="row"><input type="checkbox" checked={wx.thunderstorm} onChange={e => setWx(v => ({ ...v, thunderstorm: e.target.checked }))} /> thunderstorm</label><button className="btn sm" disabled={weather.isPending || wx.station.length !== 4 || wx.raw.trim().length < 4 || wx.sourceRef.trim().length < 2} onClick={() => weather.mutate()}>Record weather</button></div><ErrorNote error={weather.error} /></div>
      <div className="block"><b>NOTAM</b><div className="row" style={{ flexWrap: 'wrap', marginTop: 6 }}><input className="inp mono" style={{ maxWidth:80 }} placeholder="HKJK" value={nt.station} onChange={e => setNt(v => ({...v,station:e.target.value}))}/><input className="inp mono" placeholder="A1234/26" value={nt.number} onChange={e => setNt(v => ({...v,number:e.target.value}))}/><select className="inp" value={nt.category} onChange={e => setNt(v => ({...v,category:e.target.value}))}>{['AIRPORT','RUNWAY','NAV','AIRSPACE','OTHER'].map(x=><option key={x}>{x}</option>)}</select><select className="inp" value={nt.severity} onChange={e => setNt(v => ({...v,severity:e.target.value}))}>{['INFO','RESTRICTED','CLOSED'].map(x=><option key={x}>{x}</option>)}</select><input type="datetime-local" className="inp" value={nt.startsAt} onChange={e => setNt(v => ({...v,startsAt:e.target.value}))}/><input type="datetime-local" className="inp" value={nt.endsAt} onChange={e => setNt(v => ({...v,endsAt:e.target.value}))}/></div><textarea className="inp" rows={2} placeholder="Operational text" value={nt.text} onChange={e => setNt(v => ({...v,text:e.target.value}))}/><div className="row"><input className="inp" placeholder="Provider/source ref" value={nt.sourceRef} onChange={e => setNt(v => ({...v,sourceRef:e.target.value}))}/><button className="btn sm" disabled={notam.isPending || nt.station.length!==4 || nt.number.trim().length<3 || nt.text.trim().length<3 || nt.sourceRef.trim().length<2} onClick={()=>notam.mutate()}>Record NOTAM</button></div><ErrorNote error={notam.error}/></div>
    </div>
  </Card>;
}

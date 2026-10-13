import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { DamageChartDto, DamageDto, DamageTypeDto, EngineDetailDto, EngineSummaryDto, HealthAlertDto } from '@aeroos/contracts';
import { api, post } from '../../lib/api';
import { useUi } from '../../lib/store';
import { Card, DL, Drawer, ErrorNote, Head, Pill } from '../../components/ui';

const who = (s: string | null) => (s ?? '').replace(/^user:/, '');
const levelTone: Record<string, string> = { AMBER: 'amber', RED: 'red' };
const dispTone: Record<string, string> = { ALLOWABLE: 'green', REPAIR: 'amber', REFER: 'red' };
const DAMAGE_TYPES: DamageTypeDto[] = ['DENT', 'SCRATCH', 'GOUGE', 'CORROSION', 'CRACK', 'LIGHTNING', 'DELAMINATION'];

/** Engineering health: engine trend monitoring & oil consumption, and the structural damage chart. */
export function Health() {
  const { tab, engine, tail } = useSearch({ from: '/camo/health' });
  const navigate = useNavigate({ from: '/camo/health' });
  const t = tab === 'damage' ? 'damage' : 'engines';
  return (
    <>
      <Head crumb="CAMO / Engineering Health" title="Engine Health & Structural Damage"
        desc="Engine condition trend monitoring from stabilised-cruise snapshots (ΔEGT, ΔN2, ΔFF, vibration, EGT margin): step shifts, margin limits and a removal forecast; oil consumption per uplift. Structural damage is assessed against the SRM allowable and repair limits by zone, close damages are assessed together, and open damage beyond limits grounds the aircraft."
        actions={<div className="row" style={{ gap: 6 }}>
          <button className={`btn sm ${t === 'engines' ? 'pri' : 'ghost'}`} onClick={() => navigate({ search: { tab: 'engines' } })}>Engines</button>
          <button className={`btn sm ${t === 'damage' ? 'pri' : 'ghost'}`} onClick={() => navigate({ search: { tab: 'damage', tail } })}>Structural damage</button>
        </div>} />
      {t === 'engines'
        ? <Engines open={engine ?? null} onOpen={s => navigate({ search: { tab: 'engines', engine: s ?? undefined } })} />
        : <Damage tail={tail} onTail={r => navigate({ search: { tab: 'damage', tail: r } })} />}
    </>
  );
}

/* ------------------------------------------------------------------ engines */

function Engines({ open, onOpen }: { open: string | null; onOpen(s: string | null): void }) {
  const q = useQuery({ queryKey: ['health', 'engines'], queryFn: () => api<EngineSummaryDto[]>('/camo/health/engines') });
  return (
    <>
      <ErrorNote error={q.error} />
      <Card title="Fleet engines" meta={`${q.data?.length ?? 0} · ${q.data?.filter(e => e.alerts.length).length ?? 0} with alerts`} flush>
        <div className="tbl-wrap"><table className="t">
          <thead><tr><th>Engine</th><th>Aircraft</th><th>EGT margin</th><th>ΔEGT</th><th>ΔN2</th><th>ΔFF</th><th>Vib</th><th>Oil qt/h</th><th>Alerts</th></tr></thead>
          <tbody>
            {(q.data ?? []).map(e => (
              <tr key={e.serial} className="click" tabIndex={0} onClick={() => onOpen(e.serial)} onKeyDown={k => k.key === 'Enter' && onOpen(e.serial)}>
                <td className="mono"><b>{e.serial}</b> <span className="note">{e.engineType}</span></td>
                <td className="mono">{e.tail ? `${e.tail} #${e.position}` : 'removed'}</td>
                <td className="mono">{e.last ? `${e.last.egtMargin.toFixed(0)} °C` : '—'}</td>
                <td className="mono">{e.last ? e.last.egtDev.toFixed(1) : '—'}</td>
                <td className="mono">{e.last ? e.last.n2Dev.toFixed(2) : '—'}</td>
                <td className="mono">{e.last ? e.last.ffDevPct.toFixed(2) : '—'}</td>
                <td className="mono">{e.last ? e.last.vib.toFixed(1) : '—'}</td>
                <td className="mono">{e.oilQph === null ? '—' : e.oilQph.toFixed(2)}</td>
                <td>{e.alerts.length ? e.alerts.map(a => <Pill key={a.code} tone={levelTone[a.level]}>{a.code.replace(/_/g, ' ').toLowerCase()}</Pill>) : <Pill tone="green">normal</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Card>
      <EngineDrawer key={open ?? 'none'} serial={open} onClose={() => onOpen(null)} />
    </>
  );
}

/** A small line chart: one series against flight hours, optional limit lines. */
function Trend({ title, points, unit, limits = [] }: { title: string; points: { x: number; y: number }[]; unit: string; limits?: { y: number; tone: 'amber' | 'red' }[] }) {
  if (points.length < 2) return <div className="note">{title}: not enough data</div>;
  const W = 520, H = 120, P = 28;
  const xs = points.map(p => p.x), ys = [...points.map(p => p.y), ...limits.map(l => l.y)];
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sx = (x: number) => P + ((x - x0) / Math.max(1e-9, x1 - x0)) * (W - P - 6);
  const sy = (y: number) => H - 16 - ((y - y0) / Math.max(1e-9, y1 - y0)) * (H - 28);
  const last = points[points.length - 1];
  return (
    <figure style={{ margin: '8px 0' }}>
      <figcaption className="note">{title} — last {last.y.toFixed(unit === '%' ? 2 : 1)} {unit}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${title} trend`}>
        <line x1={P} x2={W - 6} y1={H - 16} y2={H - 16} stroke="var(--line2)" />
        {limits.map((l, i) => <line key={i} x1={P} x2={W - 6} y1={sy(l.y)} y2={sy(l.y)} stroke={`var(--${l.tone})`} strokeDasharray="4 3" />)}
        <polyline fill="none" stroke="var(--cyan)" strokeWidth="1.5" points={points.map(p => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ')} />
        <circle cx={sx(last.x)} cy={sy(last.y)} r="3" fill="var(--cyan)" />
        <text x={2} y={sy(y1) + 4} fill="var(--mute)" fontSize="10">{y1.toFixed(1)}</text>
        <text x={2} y={sy(y0) + 4} fill="var(--mute)" fontSize="10">{y0.toFixed(1)}</text>
        <text x={P} y={H - 2} fill="var(--mute)" fontSize="10">{x0.toFixed(0)} FH</text>
        <text x={W - 6} y={H - 2} fill="var(--mute)" fontSize="10" textAnchor="end">{x1.toFixed(0)} FH</text>
      </svg>
    </figure>
  );
}

function EngineDrawer({ serial, onClose }: { serial: string | null; onClose(): void }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const q = useQuery({ queryKey: ['health', 'engine', serial], queryFn: () => api<EngineDetailDto>(`/camo/health/engines/${encodeURIComponent(serial!)}`), enabled: !!serial });
  const e = q.data;
  const [quarts, setQuarts] = useState('');
  const [notes, setNotes] = useState<Record<number, string>>({});
  const done = (r: EngineDetailDto, msg: string) => { qc.setQueryData(['health', 'engine', serial], r); void qc.invalidateQueries({ queryKey: ['health', 'engines'] }); toast(msg, 'cyan'); };
  const oil = useMutation({ mutationFn: () => post<EngineDetailDto>(`/camo/health/engines/${encodeURIComponent(serial!)}/oil`, { quarts: Number(quarts) }), onSuccess: r => { setQuarts(''); done(r, 'Oil uplift recorded'); } });
  const close = useMutation({ mutationFn: (a: HealthAlertDto) => post<EngineDetailDto>(`/camo/health/alerts/${a.id}/close`, { note: notes[a.id ?? 0] ?? '' }), onSuccess: r => done(r, 'Alert closed') });
  const pts = (k: 'egtMargin' | 'egtDev' | 'n2Dev' | 'ffDevPct' | 'vib') => (e?.snapshots ?? []).map(s => ({ x: s.fh, y: s[k] }));
  return (
    <Drawer open={!!serial} onClose={onClose} eyebrow="Engine health" title={serial ?? ''} tags={e && <><Pill>{e.engineType}</Pill><Pill>{e.tail ? `${e.tail} #${e.position}` : 'removed'}</Pill></>}>
      <ErrorNote error={q.error ?? oil.error ?? close.error} />
      {e && <>
        <Card title="Alerts" meta={`${e.alerts.length} open`}>
          {e.alerts.length === 0 && <div className="note">No open alerts.</div>}
          {e.alerts.map(a => (
            <div key={`${a.code}-${a.id}`} className="block" style={{ marginBottom: 10 }}>
              <Pill tone={levelTone[a.level]}>{a.level.toLowerCase()}</Pill> <b>{a.code.replace(/_/g, ' ').toLowerCase()}</b> {!a.active && <span className="note">(condition no longer present)</span>}
              <div>{a.message}</div><div className="note">Recommended: {a.action}</div>
              {a.id !== null && e.permissions.manageAlerts && (
                <div className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
                  <div className="field" style={{ flex: 1 }}><label htmlFor={`cl-${a.id}`}>Action taken / finding</label>
                    <input id={`cl-${a.id}`} className="inp" value={notes[a.id] ?? ''} maxLength={2000} onChange={x => setNotes({ ...notes, [a.id!]: x.target.value })} /></div>
                  <button className="btn sm" disabled={(notes[a.id] ?? '').trim().length < 5 || close.isPending} onClick={() => close.mutate(a)}>Close alert</button>
                </div>
              )}
            </div>
          ))}
        </Card>
        <Card title="Trends" meta={`${e.snapshots.length} snapshots`}>
          <Trend title="EGT margin" unit="°C" points={pts('egtMargin')} limits={[{ y: e.limits.egtMarginAmber, tone: 'amber' }, { y: e.limits.egtMarginRed, tone: 'red' }]} />
          <Trend title="ΔEGT" unit="°C" points={pts('egtDev')} />
          <Trend title="ΔN2" unit="%" points={pts('n2Dev')} />
          <Trend title="ΔFF" unit="%" points={pts('ffDevPct')} />
          <Trend title="Vibration" unit="" points={pts('vib')} limits={[{ y: e.limits.vibMax, tone: 'amber' }]} />
        </Card>
        <Card title="Oil consumption" meta={e.oilQph === null ? 'not enough uplifts' : `${e.oilQph.toFixed(2)} qt/h (alert ${e.limits.oilAlertQph}, limit ${e.limits.oilMaxQph})`}>
          <Trend title="Consumption per uplift" unit="qt/h" points={e.oil.filter(o => o.qph !== null).map(o => ({ x: o.fh, y: o.qph! }))} limits={[{ y: e.limits.oilAlertQph, tone: 'amber' }, { y: e.limits.oilMaxQph, tone: 'red' }]} />
          {e.permissions.recordOil && e.tail && (
            <div className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
              <div className="field"><label htmlFor="oil-q">Oil added (quarts)</label><input id="oil-q" className="inp" type="number" min={0.1} max={20} step={0.1} value={quarts} onChange={x => setQuarts(x.target.value)} /></div>
              <button className="btn" disabled={!(Number(quarts) > 0) || oil.isPending} onClick={() => oil.mutate()}>Record uplift</button>
            </div>
          )}
        </Card>
        {e.history.length > 0 && <Card title="Closed alerts">
          {e.history.map(a => <div key={a.id} className="note">{a.closedAt?.slice(0, 10)} · {a.code.replace(/_/g, ' ').toLowerCase()} · {who(a.closedBy)}: {a.closureNote}</div>)}
        </Card>}
      </>}
    </Drawer>
  );
}

/* ------------------------------------------------------------------ structural damage */

function Damage({ tail, onTail }: { tail?: string; onTail(r: string): void }) {
  const q = useQuery({ queryKey: ['health', 'damage', tail ?? ''], queryFn: () => api<DamageChartDto>(`/camo/health/damage?tail=${encodeURIComponent(tail ?? '')}`) });
  const c = q.data;
  const [sel, setSel] = useState<string | null>(null);
  return (
    <>
      <ErrorNote error={q.error} />
      {c && <>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {c.tails.map(t => (
            <button key={t.reg} className={`btn sm ${t.reg === c.tail ? 'pri' : 'ghost'}`} onClick={() => onTail(t.reg)}>
              {t.reg} {t.grounding > 0 ? <Pill tone="red">{t.grounding}</Pill> : t.open > 0 ? <Pill>{t.open}</Pill> : null}
            </button>
          ))}
        </div>
        <Card title={`Damage chart — ${c.tail}`} meta={`${c.aircraftType} · ${c.fc} FC · ${c.damages.filter(d => d.repair?.kind !== 'PERMANENT').length} open`}>
          <Matrix c={c} onPick={setSel} />
          <DamageMap c={c} onPick={setSel} />
        </Card>
        <Card title="Damages" meta={`${c.damages.length}`} flush>
          <div className="tbl-wrap"><table className="t">
            <thead><tr><th>Id</th><th>Zone</th><th>Type</th><th>Size (L×W×D mm)</th><th>Assessment</th><th>Repair / inspection</th><th>Status</th></tr></thead>
            <tbody>{c.damages.map(d => (
              <tr key={d.id} className="click" tabIndex={0} onClick={() => setSel(d.id)} onKeyDown={k => k.key === 'Enter' && setSel(d.id)}>
                <td className="mono"><b>{d.id}</b></td>
                <td>{d.zone} {d.zoneName} · {d.side}</td>
                <td>{d.damageType.toLowerCase()}</td>
                <td className="mono">{d.lengthMm}×{d.widthMm}×{d.depthMm}</td>
                <td><Pill tone={dispTone[d.disposition]}>{d.disposition.toLowerCase()}</Pill> <span className="note">{d.srmRef}</span></td>
                <td className="note">{d.repair ? `${d.repair.kind.toLowerCase()} — ${d.repair.data}${d.repair.untilFc ? ` until ${d.repair.untilFc} FC` : ''}${d.repair.untilDate ? ` until ${d.repair.untilDate}` : ''}` : d.nextInspectionFc ? `inspect at ${d.nextInspectionFc} FC` : ''}</td>
                <td>{d.grounding ? <Pill tone="red">grounds</Pill> : d.repair?.kind === 'PERMANENT' ? <Pill tone="green">repaired</Pill> : <Pill tone="green">ok to fly</Pill>}</td>
              </tr>
            ))}{c.damages.length === 0 && <tr><td colSpan={7} className="empty">No damage recorded.</td></tr>}</tbody>
          </table></div>
        </Card>
        {c.permissions.record && <RecordDamage c={c} />}
        <DamageDrawer key={sel ?? 'none'} c={c} d={c.damages.find(x => x.id === sel) ?? null} onClose={() => setSel(null)} />
      </>}
    </>
  );
}

/** Zones × damage types: count of open damages, coloured by the worst state. */
function Matrix({ c, onPick }: { c: DamageChartDto; onPick(id: string): void }) {
  const open = c.damages.filter(d => d.repair?.kind !== 'PERMANENT');
  return (
    <div className="tbl-wrap"><table className="t">
      <thead><tr><th>Zone</th>{DAMAGE_TYPES.map(t => <th key={t}>{t.toLowerCase()}</th>)}</tr></thead>
      <tbody>{c.zones.map(z => (
        <tr key={z.zone}><td>{z.zone} {z.name}</td>
          {DAMAGE_TYPES.map(t => {
            const ds = open.filter(d => d.zone === z.zone && d.damageType === t);
            if (!ds.length) return <td key={t} className="note">·</td>;
            const tone = ds.some(d => d.grounding) ? 'red' : ds.some(d => d.disposition !== 'ALLOWABLE') ? 'amber' : 'green';
            return <td key={t}><button className="btn sm ghost" onClick={() => onPick(ds[0].id)} title={ds.map(d => d.id).join(', ')}><Pill tone={tone}>{ds.length}</Pill></button></td>;
          })}
        </tr>
      ))}</tbody>
    </table></div>
  );
}

/** Damage positions (x along the zone reference, y across it), by zone; marker size from the damage length. */
function DamageMap({ c, onPick }: { c: DamageChartDto; onPick(id: string): void }) {
  if (!c.damages.length) return null;
  const W = 640, H = 160, P = 20;
  const xs = c.damages.map(d => d.xMm), ys = c.damages.map(d => d.yMm);
  const x0 = Math.min(...xs) - 500, x1 = Math.max(...xs) + 500, y0 = Math.min(...ys) - 500, y1 = Math.max(...ys) + 500;
  const sx = (x: number) => P + ((x - x0) / (x1 - x0)) * (W - 2 * P), sy = (y: number) => H - P - ((y - y0) / (y1 - y0)) * (H - 2 * P);
  const color = (d: DamageDto) => (d.grounding ? 'var(--red)' : d.repair?.kind === 'PERMANENT' ? 'var(--dim)' : d.disposition === 'ALLOWABLE' ? 'var(--green)' : 'var(--amber)');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Damage positions" style={{ marginTop: 8, background: 'var(--bg2)', borderRadius: 6 }}>
      <text x={P} y={14} fill="var(--mute)" fontSize="10">x (station, mm) →  ·  y ↑  ·  colour: green allowable, amber needs repair / temporary, red grounds, grey repaired</text>
      {c.damages.map(d => (
        <g key={d.id} style={{ cursor: 'pointer' }} onClick={() => onPick(d.id)}>
          <circle cx={sx(d.xMm)} cy={sy(d.yMm)} r={Math.max(4, Math.min(14, d.lengthMm / 8))} fill={color(d)} fillOpacity="0.35" stroke={color(d)} />
          <text x={sx(d.xMm) + 10} y={sy(d.yMm) - 6} fill="var(--fg)" fontSize="10">{d.id} · {d.zone}{d.side}</text>
        </g>
      ))}
    </svg>
  );
}

function RecordDamage({ c }: { c: DamageChartDto }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const empty = { zone: c.zones[0]?.zone ?? '100', side: 'L' as 'L' | 'R' | 'C', damageType: 'DENT' as DamageTypeDto, xMm: '', yMm: '', lengthMm: '', widthMm: '', depthMm: '', description: '' };
  const [f, setF] = useState(empty);
  const save = useMutation({
    mutationFn: () => post<{ id: string; chart: DamageChartDto }>('/camo/health/damage', {
      tail: c.tail, zone: f.zone, side: f.side, damageType: f.damageType, xMm: Number(f.xMm), yMm: Number(f.yMm),
      lengthMm: Number(f.lengthMm), widthMm: Number(f.widthMm), depthMm: Number(f.depthMm), description: f.description
    }),
    onSuccess: r => {
      const d = r.chart.damages.find(x => x.id === r.id);
      toast(`${r.id}: ${d?.disposition.toLowerCase() ?? 'recorded'}${d?.grounding ? ' — aircraft grounded until repaired' : ''}`, d?.grounding ? 'red' : 'green');
      setF(empty);
      qc.setQueryData(['health', 'damage', c.tail], r.chart);
      void qc.invalidateQueries({ queryKey: ['health', 'damage'] });
    }
  });
  const n = (k: 'xMm' | 'yMm' | 'lengthMm' | 'widthMm' | 'depthMm', label: string) => (
    <div className="field" key={k}><label htmlFor={`dm-${k}`}>{label}</label><input id={`dm-${k}`} className="inp" type="number" step="0.1" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></div>
  );
  return (
    <Card title={`Record damage on ${c.tail}`}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field"><label htmlFor="dm-zone">Zone</label>
          <select id="dm-zone" className="inp" value={f.zone} onChange={e => setF({ ...f, zone: e.target.value })}>{c.zones.map(z => <option key={z.zone} value={z.zone}>{z.zone} {z.name}</option>)}</select></div>
        <div className="field"><label htmlFor="dm-side">Side</label>
          <select id="dm-side" className="inp" value={f.side} onChange={e => setF({ ...f, side: e.target.value as 'L' | 'R' | 'C' })}><option value="L">left</option><option value="R">right</option><option value="C">centre</option></select></div>
        <div className="field"><label htmlFor="dm-type">Type</label>
          <select id="dm-type" className="inp" value={f.damageType} onChange={e => setF({ ...f, damageType: e.target.value as DamageTypeDto })}>{DAMAGE_TYPES.map(t => <option key={t} value={t}>{t.toLowerCase()}</option>)}</select></div>
        {n('xMm', 'x / station (mm)')}{n('yMm', 'y (mm)')}{n('lengthMm', 'Length (mm)')}{n('widthMm', 'Width (mm)')}{n('depthMm', 'Depth (mm)')}
      </div>
      <div className="field"><label htmlFor="dm-desc">Description</label><input id="dm-desc" className="inp" maxLength={2000} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></div>
      <button className="btn pri" disabled={!f.lengthMm || f.xMm === '' || f.yMm === '' || f.description.trim().length < 5 || save.isPending} onClick={() => save.mutate()}>Record & assess</button>
      <ErrorNote error={save.error} />
    </Card>
  );
}

function DamageDrawer({ c, d, onClose }: { c: DamageChartDto; d: DamageDto | null; onClose(): void }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const [dims, setDims] = useState({ lengthMm: String(d?.lengthMm ?? ''), widthMm: String(d?.widthMm ?? ''), depthMm: String(d?.depthMm ?? ''), note: '' });
  const [data, setData] = useState('');
  const [rep, setRep] = useState({ kind: 'PERMANENT' as 'PERMANENT' | 'TEMPORARY', dataRef: d?.approvedData ?? d?.srmRef ?? '', untilFc: '', untilDate: '' });
  const done = (r: DamageChartDto, msg: string) => { qc.setQueryData(['health', 'damage', c.tail], r); void qc.invalidateQueries({ queryKey: ['health', 'damage'] }); toast(msg, 'cyan'); };
  const inspect = useMutation({ mutationFn: () => post<DamageChartDto>(`/camo/health/damage/${d!.id}/inspect`, { lengthMm: Number(dims.lengthMm), widthMm: Number(dims.widthMm), depthMm: Number(dims.depthMm), note: dims.note, version: d!.version }), onSuccess: r => done(r, 'Inspection recorded') });
  const approve = useMutation({ mutationFn: () => post<DamageChartDto>(`/camo/health/damage/${d!.id}/approve-data`, { approvedData: data, version: d!.version }), onSuccess: r => done(r, 'Repair data recorded') });
  const repair = useMutation({
    mutationFn: () => post<DamageChartDto>(`/camo/health/damage/${d!.id}/repair`, {
      kind: rep.kind, dataRef: rep.dataRef, untilFc: rep.kind === 'TEMPORARY' && rep.untilFc ? Number(rep.untilFc) : null, untilDate: rep.kind === 'TEMPORARY' && rep.untilDate ? rep.untilDate : null, version: d!.version
    }),
    onSuccess: r => done(r, 'Repair recorded')
  });
  const permanent = d?.repair?.kind === 'PERMANENT';
  return (
    <Drawer open={!!d} onClose={onClose} eyebrow={`Structural damage · ${c.tail}`} title={d ? `${d.id} — ${d.damageType.toLowerCase()}` : ''}
      tags={d && <><Pill tone={dispTone[d.disposition]}>{d.disposition.toLowerCase()}</Pill>{d.grounding && <Pill tone="red">grounds the aircraft</Pill>}</>}>
      <ErrorNote error={inspect.error ?? approve.error ?? repair.error} />
      {d && <>
        <DL items={[
          ['Where', `Zone ${d.zone} ${d.zoneName}, side ${d.side}, x ${d.xMm} / y ${d.yMm} mm`],
          ['Size', `${d.lengthMm} × ${d.widthMm} mm, ${d.depthMm} mm deep`],
          ['Found', `${d.foundAt.slice(0, 10)} at ${d.foundFc} FC by ${who(d.foundBy)}`],
          ['Description', d.description],
          ['Assessment', `${d.reason}${d.srmRef ? ` (${d.srmRef})` : ''}`],
          ['Repeat inspection', d.nextInspectionFc ? `at ${d.nextInspectionFc} FC (now ${c.fc})` : '—'],
          ['Approved repair data', d.approvedData ? `${d.approvedData} — ${who(d.approvedBy)}` : '—'],
          ['Repair', d.repair ? `${d.repair.kind.toLowerCase()}: ${d.repair.data}${d.repair.untilFc ? `, until ${d.repair.untilFc} FC` : ''}${d.repair.untilDate ? `, until ${d.repair.untilDate}` : ''} — ${who(d.repair.by)} ${d.repair.at.slice(0, 10)}` : '—'],
          ['Status', d.grounding ?? 'Does not ground the aircraft']
        ]} />
        {!permanent && c.permissions.record && <Card title="Re-inspect (measure again)">
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {(['lengthMm', 'widthMm', 'depthMm'] as const).map(k => <div className="field" key={k}><label htmlFor={`in-${k}`}>{k.replace('Mm', ' (mm)')}</label>
              <input id={`in-${k}`} className="inp" type="number" step="0.1" value={dims[k]} onChange={e => setDims({ ...dims, [k]: e.target.value })} /></div>)}
            <div className="field" style={{ flex: 1 }}><label htmlFor="in-note">Finding</label><input id="in-note" className="inp" value={dims.note} onChange={e => setDims({ ...dims, note: e.target.value })} /></div>
            <button className="btn" disabled={dims.note.trim().length < 3 || inspect.isPending} onClick={() => inspect.mutate()}>Record inspection</button>
          </div>
        </Card>}
        {d.disposition === 'REFER' && !permanent && c.permissions.approveData && <Card title="Engineering disposition (beyond the SRM)">
          <div className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1 }}><label htmlFor="ap-data">Approved repair data (TC holder / DOA reference)</label><input id="ap-data" className="inp" value={data} onChange={e => setData(e.target.value)} /></div>
            <button className="btn" disabled={data.trim().length < 5 || approve.isPending} onClick={() => approve.mutate()}>Record</button>
          </div>
        </Card>}
        {!permanent && c.permissions.repair && <Card title="Record repair">
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field"><label htmlFor="rp-kind">Kind</label>
              <select id="rp-kind" className="inp" value={rep.kind} onChange={e => setRep({ ...rep, kind: e.target.value as 'PERMANENT' | 'TEMPORARY' })}><option value="PERMANENT">permanent</option><option value="TEMPORARY">temporary</option></select></div>
            <div className="field" style={{ flex: 1, minWidth: 200 }}><label htmlFor="rp-data">Repair data</label><input id="rp-data" className="inp" value={rep.dataRef} onChange={e => setRep({ ...rep, dataRef: e.target.value })} /></div>
            {rep.kind === 'TEMPORARY' && <>
              <div className="field"><label htmlFor="rp-fc">Valid until FC</label><input id="rp-fc" className="inp" type="number" value={rep.untilFc} onChange={e => setRep({ ...rep, untilFc: e.target.value })} /></div>
              <div className="field"><label htmlFor="rp-date">or date</label><input id="rp-date" className="inp" type="date" value={rep.untilDate} onChange={e => setRep({ ...rep, untilDate: e.target.value })} /></div>
            </>}
            <button className="btn pri" disabled={rep.dataRef.trim().length < 5 || repair.isPending} onClick={() => repair.mutate()}>Record repair</button>
          </div>
        </Card>}
      </>}
    </Drawer>
  );
}

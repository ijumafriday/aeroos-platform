import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { ComponentDto, ComponentHistoryDto, FleetTailDto, MeDto } from '@aeroos/contracts';
import { api, post } from '../../lib/api';
import { zulu } from '../../lib/format';
import { useUi } from '../../lib/store';
import { Card, DL, Drawer, ErrorNote, Head, Pill } from '../../components/ui';

const REASONS = ['SCHEDULED', 'UNSERVICEABLE', 'LIFE_LIMIT', 'ROBBERY', 'OTHER'] as const;
const lifeTone = (c: ComponentDto) => {
  const fc = c.remaining?.fc, lim = c.lifeLimit?.fc;
  if (fc === null || fc === undefined || !lim) return '';
  return fc <= 0 ? 'red' : fc / lim < 0.05 ? 'amber' : 'green';
};

/** Tracked components (life-limited parts): what is installed where, life used and left, and back-to-birth history. */
export function Components() {
  const { tail, part, serial } = useSearch({ from: '/camo/components' });
  const navigate = useNavigate({ from: '/camo/components' });
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') });
  const fleet = useQuery({ queryKey: ['fleet'], queryFn: () => api<FleetTailDto[]>('/camo/fleet') });
  const q = useQuery({ queryKey: ['components', tail ?? ''], queryFn: () => api<ComponentDto[]>(`/camo/components${tail ? `?tail=${encodeURIComponent(tail)}` : ''}`) });
  const [installing, setInstalling] = useState(false);
  const canRecord = !!me.data?.roles.some(r => ['camo_engineer', 'camo_manager', 'certifying_staff'].includes(r));
  const [find, setFind] = useState({ part: '', serial: '' });
  return (
    <>
      <Head crumb="CAMO / Records" title="Components & Rotable History"
        desc="Life-limited parts by aircraft and position. Time and cycles since new follow the serial number from aircraft to shop to aircraft, and can never go down; every removal and installation is kept, back to birth."
        actions={canRecord && <button className="btn pri" onClick={() => setInstalling(true)}>Install a part</button>} />
      <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <select className="inp" style={{ maxWidth: 200 }} value={tail ?? ''} onChange={e => navigate({ search: { tail: e.target.value || undefined, part, serial } })} aria-label="Aircraft">
          <option value="">All aircraft</option>{(fleet.data ?? []).map(f => <option key={f.reg} value={f.reg}>{f.reg} · {f.type}</option>)}
        </select>
        <span className="note">Find a serial:</span>
        <input className="inp mono" style={{ maxWidth: 160 }} placeholder="Part number" value={find.part} onChange={e => setFind(x => ({ ...x, part: e.target.value }))} />
        <input className="inp mono" style={{ maxWidth: 160 }} placeholder="Serial" value={find.serial} onChange={e => setFind(x => ({ ...x, serial: e.target.value }))} />
        <button className="btn sm" disabled={!find.part || !find.serial} onClick={() => navigate({ search: { tail, part: find.part.trim(), serial: find.serial.trim() } })}>History</button>
      </div>
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      <Card title="Installed" meta={`${q.data?.length ?? 0}`} flush>
        <div className="tbl-wrap"><table className="t">
          <thead><tr><th>Aircraft · position</th><th>Part · serial</th><th>Requirement</th><th>TSN / CSN</th><th>Life left</th><th>Installed</th></tr></thead>
          <tbody>
            {(q.data ?? []).map(c => (
              <tr key={c.id} className="click" tabIndex={0} onClick={() => navigate({ search: { tail, part: c.partNo, serial: c.serial } })} onKeyDown={e => e.key === 'Enter' && navigate({ search: { tail, part: c.partNo, serial: c.serial } })}>
                <td className="mono">{c.tail} · {c.position}</td>
                <td className="mono"><b>{c.partNo}</b> s/n {c.serial}</td>
                <td>{c.requirementRef}</td>
                <td className="mono">{c.tsn.toLocaleString()} FH / {c.csn.toLocaleString()} FC</td>
                <td>{c.remaining ? <Pill tone={lifeTone(c)}>{[c.remaining.fc !== null && `${c.remaining.fc.toLocaleString()} FC`, c.remaining.fh !== null && `${c.remaining.fh.toLocaleString()} FH`].filter(Boolean).join(' · ')}</Pill> : '—'}</td>
                <td className="mono">{zulu(c.installedAt)}</td>
              </tr>
            ))}
            {q.data?.length === 0 && <tr><td colSpan={6} className="empty">No tracked components{tail ? ` on ${tail}` : ''}.</td></tr>}
          </tbody>
        </table></div>
      </Card>
      <HistoryDrawer part={part ?? null} serial={serial ?? null} installedId={(q.data ?? []).find(c => c.partNo === part && c.serial === serial)?.id ?? null} canRecord={canRecord}
        onClose={() => navigate({ search: { tail, part: undefined, serial: undefined } })} />
      {installing && <InstallDrawer fleet={fleet.data ?? []} onClose={done => { setInstalling(false); if (done) navigate({ search: { tail: done.tail, part: done.part, serial: done.serial } }); }} />}
    </>
  );
}

function HistoryDrawer({ part, serial, installedId, canRecord, onClose }: { part: string | null; serial: string | null; installedId: string | null; canRecord: boolean; onClose(): void }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const open = !!part && !!serial;
  const q = useQuery({ queryKey: ['component-history', part, serial], enabled: open,
    queryFn: () => api<ComponentHistoryDto>(`/camo/components/history?partNo=${encodeURIComponent(part!)}&serial=${encodeURIComponent(serial!)}`) });
  const [reason, setReason] = useState<(typeof REASONS)[number]>('SCHEDULED');
  const [ref, setRef] = useState('');
  const remove = useMutation({
    mutationFn: () => post<ComponentHistoryDto>(`/camo/components/${installedId}/remove`, { reason, reference: ref }),
    onSuccess: h => { toast(`${h.partNo} s/n ${h.serial} removed at TSN ${h.tsn} / CSN ${h.csn}`, 'amber'); setRef(''); void qc.invalidateQueries({ queryKey: ['components'] }); void qc.invalidateQueries({ queryKey: ['component-history'] }); void qc.invalidateQueries({ queryKey: ['programme'] }); }
  });
  const h = q.data;
  return (
    <Drawer open={open} onClose={onClose} eyebrow="Component · back-to-birth history" title={`${part ?? ''} s/n ${serial ?? ''}`}
      tags={h && <Pill tone={h.installed ? 'green' : ''}>{h.installed ? `on ${h.installed.tail}` : 'not installed'}</Pill>}>
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      {h && (
        <>
          <DL items={[['Where', h.installed ? `${h.installed.tail} · ${h.installed.position}` : 'Removed (stores / shop)'], ['Time since new', `${h.tsn.toLocaleString()} FH`], ['Cycles since new', `${h.csn.toLocaleString()} FC`]]} />
          <section className="dsec">
            <h3>History</h3>
            <div className="timeline">
              {[...h.events].reverse().map(e => (
                <div key={e.id} className="tl"><i /><div>
                  <b>{e.type === 'INSTALLED' ? 'Installed on' : 'Removed from'} {e.tail} · {e.position}</b> <span className="note">{zulu(e.at)} · {e.recordedBy.replace(/^user:/, '')}</span>
                  <div className="sub mono">TSN {e.tsn.toLocaleString()} · CSN {e.csn.toLocaleString()}{e.reason ? ` · ${e.reason.toLowerCase().replace('_', ' ')}` : ''} · {e.reference}</div>
                </div></div>
              ))}
            </div>
          </section>
          {h.installed && installedId && canRecord && (
            <section className="dsec">
              <h3>Record removal</h3>
              <div className="form-grid">
                <div className="field"><label htmlFor="c-why">Reason</label><select id="c-why" className="inp" value={reason} onChange={e => setReason(e.target.value as (typeof REASONS)[number])}>{REASONS.map(r => <option key={r} value={r}>{r.toLowerCase().replace('_', ' ')}</option>)}</select></div>
                <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="c-ref">Reference (task card, CRS, work order)</label><input id="c-ref" className="inp mono" value={ref} onChange={e => setRef(e.target.value)} /></div>
              </div>
              <div className="row" style={{ marginTop: 8 }}><button className="btn" disabled={remove.isPending} onClick={() => remove.mutate()}>Record removal</button>
                <span className="note">TSN/CSN at removal are computed from the aircraft's counters now.</span></div>
              <ErrorNote error={remove.error} />
            </section>
          )}
        </>
      )}
    </Drawer>
  );
}

function InstallDrawer({ fleet, onClose }: { fleet: FleetTailDto[]; onClose(done?: { tail: string; part: string; serial: string }): void }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const [f, setF] = useState({ tail: fleet[0]?.reg ?? '', position: 'ENG 1', requirementId: '', partNo: '', serial: '', tsn: '', csn: '', reference: '' });
  const set = (k: keyof typeof f, v: string) => setF(x => ({ ...x, [k]: v }));
  const reqs = useQuery({ queryKey: ['components', 'requirements', f.tail], enabled: !!f.tail,
    queryFn: () => api<{ id: string; ref: string; title: string; installed: string | null }[]>(`/camo/components/requirements?tail=${encodeURIComponent(f.tail)}`) });
  const save = useMutation({
    mutationFn: () => post<ComponentHistoryDto>('/camo/components', { ...f, tsn: Number(f.tsn), csn: Number(f.csn) }),
    onSuccess: h => { toast(`${h.partNo} s/n ${h.serial} installed on ${f.tail}`, 'green'); void qc.invalidateQueries({ queryKey: ['components'] }); void qc.invalidateQueries({ queryKey: ['programme'] }); onClose({ tail: f.tail, part: h.partNo, serial: h.serial }); }
  });
  return (
    <Drawer open onClose={() => onClose()} eyebrow="CAMO / Records" title="Install a life-limited part">
      <div className="form-grid">
        <div className="field"><label htmlFor="i-tail">Aircraft</label><select id="i-tail" className="inp" value={f.tail} onChange={e => set('tail', e.target.value)}>{fleet.map(t => <option key={t.reg} value={t.reg}>{t.reg} · {t.type}</option>)}</select></div>
        <div className="field"><label htmlFor="i-req">Requirement</label><select id="i-req" className="inp" value={f.requirementId} onChange={e => set('requirementId', e.target.value)}>
          <option value="">Choose…</option>{(reqs.data ?? []).map(r => <option key={r.id} value={r.id} disabled={!!r.installed}>{r.ref} — {r.title}{r.installed ? ` (fitted: ${r.installed})` : ''}</option>)}</select></div>
        <div className="field"><label htmlFor="i-pos">Position</label><input id="i-pos" className="inp" value={f.position} onChange={e => set('position', e.target.value)} /></div>
        <div className="field"><label htmlFor="i-pn">Part number</label><input id="i-pn" className="inp mono" value={f.partNo} onChange={e => set('partNo', e.target.value)} /></div>
        <div className="field"><label htmlFor="i-sn">Serial</label><input id="i-sn" className="inp mono" value={f.serial} onChange={e => set('serial', e.target.value)} /></div>
        <div className="field"><label htmlFor="i-tsn">TSN (FH)</label><input id="i-tsn" className="inp mono" inputMode="decimal" value={f.tsn} onChange={e => set('tsn', e.target.value)} /></div>
        <div className="field"><label htmlFor="i-csn">CSN (FC)</label><input id="i-csn" className="inp mono" inputMode="numeric" value={f.csn} onChange={e => set('csn', e.target.value)} /></div>
        <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="i-ref">Release certificate / reference</label><input id="i-ref" className="inp mono" placeholder="EASA Form 1 tracking no." value={f.reference} onChange={e => set('reference', e.target.value)} /></div>
      </div>
      <div className="note">A serial with history must be installed with at least the time and cycles it had when it was removed.</div>
      <div className="row" style={{ marginTop: 10 }}><button className="btn pri" disabled={save.isPending || !f.requirementId} onClick={() => save.mutate()}>Install</button></div>
      <ErrorNote error={save.error} />
    </Drawer>
  );
}

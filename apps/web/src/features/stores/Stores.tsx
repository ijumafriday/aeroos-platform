import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StockDto, ToolDto } from '@aeroos/contracts';
import { api, ApiRequestError, post } from '../../lib/api';
import { zulu } from '../../lib/format';
import { useUi } from '../../lib/store';
import { Card, ErrorNote, Head, Pill } from '../../components/ui';
import { queueJson } from '../../lib/offline';
import { BarcodeScanButton } from '../../components/BarcodeScanButton';

interface Slot { wpId: string; tail: string; station: string; bay: string | null; plannedStart: string | null; plannedEnd: string | null; status: string; title: string | null }

const toolTone: Record<string, string> = { OK: 'green', DUE_SOON: 'amber', EXPIRED: 'red' };

export function Stores() {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const stock = useQuery({ queryKey: ['stores', 'stock'], queryFn: () => api<StockDto[]>('/amo/stores') });
  const tools = useQuery({ queryKey: ['stores', 'tools'], queryFn: () => api<ToolDto[]>('/amo/tools') });
  const hangar = useQuery({ queryKey: ['stores', 'hangar'], queryFn: () => api<Slot[]>('/amo/hangar'), refetchInterval: 60_000 });
  const [rx, setRx] = useState({ partNo: '', location: 'ENGM', qty: '', reference: '' });
  const receive = useMutation({
    mutationFn: async () => {
      const payload = { ...rx, qty: Number(rx.qty) };
      if (!navigator.onLine) { await queueJson('/amo/stores/receive', payload, `Receive ${rx.qty} × ${rx.partNo} at ${rx.location}`); return { queued: true }; }
      await post('/amo/stores/receive', payload); return { queued: false };
    },
    onSuccess: r => { toast(r.queued ? `${rx.qty} × ${rx.partNo} queued securely for receipt` : `${rx.qty} × ${rx.partNo} received at ${rx.location}`, r.queued ? 'cyan' : 'green'); setRx(x => ({ ...x, qty: '', reference: '' })); if (!r.queued) void qc.invalidateQueries({ queryKey: ['stores'] }); }
  });
  const forbiddenReceive = receive.error instanceof ApiRequestError && receive.error.status === 403;

  return (
    <>
      <Head crumb="AMO / Resources" title="Hangar Plan, Stores & Tools"
        desc="Work-package slots from CAMO, parts stock with reservations made when task cards are issued, and the tools register. A stamp that records an out-of-calibration tool is refused (Part-145.A.40)." />
      <Card title="Hangar plan · next 7 days" meta={`${hangar.data?.length ?? 0} slot(s)`} flush>
        <div className="tbl-wrap">
          <table className="t">
            <thead><tr><th>Bay</th><th>Aircraft</th><th>Package</th><th>From</th><th>To</th><th>Status</th></tr></thead>
            <tbody>
              {(hangar.data ?? []).map(s => (
                <tr key={s.wpId}>
                  <td className="mono">{s.bay ?? '—'}</td><td className="mono">{s.tail}</td><td><b className="mono">{s.wpId}</b> {s.title ?? ''}</td>
                  <td className="mono">{s.plannedStart ? zulu(s.plannedStart) : '—'}</td><td className="mono">{s.plannedEnd ? zulu(s.plannedEnd) : '—'}</td>
                  <td><Pill tone={s.status === 'RELEASED' ? 'mag' : s.status === 'COMPLETED' ? 'green' : 'cyan'}>{s.status.toLowerCase()}</Pill></td>
                </tr>
              ))}
              {hangar.data?.length === 0 && <tr><td colSpan={6} className="empty">No planned slots. CAMO plans work packages from the due list.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid g-two" style={{ marginTop: 14 }}>
        <Card title="Stores" meta={`${(stock.data ?? []).filter(s => s.low).length} below minimum`} flush>
          <div className="tbl-wrap">
            <table className="t">
              <thead><tr><th>Part</th><th>On hand</th><th>Reserved</th><th>Locations</th></tr></thead>
              <tbody>
                {(stock.data ?? []).map(s => (
                  <tr key={s.partNo}>
                    <td><b className="mono">{s.partNo}</b><div className="sub">{s.description}</div></td>
                    <td className="mono">{s.onHand} {s.unit} {s.low && <Pill tone="red">low</Pill>}</td>
                    <td className="mono">{s.reserved}</td>
                    <td className="note">{s.locations.map(l => `${l.location}: ${l.qty}`).join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-b">
            <div className="form-grid">
              <div className="field"><label htmlFor="rx-p">Part <BarcodeScanButton label="Scan part" onCode={code => setRx(r => ({ ...r, partNo: code }))} /></label>
                <select id="rx-p" className="inp" value={rx.partNo} onChange={e => setRx(r => ({ ...r, partNo: e.target.value }))}>
                  <option value="">Select…</option>{(stock.data ?? []).map(s => <option key={s.partNo}>{s.partNo}</option>)}
                </select></div>
              <div className="field"><label htmlFor="rx-l">Location</label><input id="rx-l" className="inp mono" maxLength={4} value={rx.location} onChange={e => setRx(r => ({ ...r, location: e.target.value.toUpperCase() }))} /></div>
              <div className="field"><label htmlFor="rx-q">Qty</label><input id="rx-q" className="inp mono" inputMode="numeric" value={rx.qty} onChange={e => setRx(r => ({ ...r, qty: e.target.value.replace(/\D/g, '') }))} /></div>
              <div className="field"><label htmlFor="rx-r">GRN / reference</label><input id="rx-r" className="inp" value={rx.reference} onChange={e => setRx(r => ({ ...r, reference: e.target.value }))} /></div>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" disabled={!rx.partNo || !rx.qty || rx.reference.length < 3 || receive.isPending} onClick={() => receive.mutate()}>Receive into stock</button>
              {forbiddenReceive ? <span className="note">Only the storekeeper books stock in.</span> : <ErrorNote error={receive.error} />}
            </div>
          </div>
        </Card>
        <Card title="Tools register" meta={`${(tools.data ?? []).filter(t => t.status === 'EXPIRED').length} out of calibration`} flush>
          <div className="list">
            {(tools.data ?? []).map(t => (
              <div key={t.id} className="li">
                <span className={`sev ${toolTone[t.status]}`} />
                <div style={{ flex: 1 }}><b className="mono">{t.id}</b> {t.description}<div className="sub">s/n {t.serial} · {t.location}</div></div>
                <Pill tone={toolTone[t.status]}>{t.calibrationDue ? `cal. ${t.calibrationDue}` : 'no calibration'}</Pill>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

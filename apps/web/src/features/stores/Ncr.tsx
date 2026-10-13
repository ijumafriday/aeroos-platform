import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { MeDto, NonconformityDto, StockDto } from '@aeroos/contracts';
import { api, post } from '../../lib/api';
import { zulu } from '../../lib/format';
import { useUi } from '../../lib/store';
import { Attachments } from '../../components/Attachments';
import { Card, DL, Drawer, ErrorNote, Head, Pill } from '../../components/ui';

const tone: Record<string, string> = { QUARANTINED: 'amber', SCRAP_PENDING: 'red', CLOSED: 'green' };
const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');
const who = (s: string | null) => (s ?? '').replace(/^user:/, '');

/** Non-conforming parts (145.A.42): quarantine, disposition, witnessed scrapping. */
export function Ncr() {
  const { ncr } = useSearch({ from: '/amo/ncr' });
  const navigate = useNavigate({ from: '/amo/ncr' });
  const [scope, setScope] = useState<'open' | 'all'>('open');
  const [raising, setRaising] = useState(false);
  const q = useQuery({ queryKey: ['ncr', scope], queryFn: () => api<NonconformityDto[]>(`/amo/ncr?scope=${scope}`) });
  return (
    <>
      <Head crumb="AMO / Stores" title="Non-conforming Parts & Scrap"
        desc="A suspect or unserviceable part is quarantined (out of usable stock), engineering decides what happens to it, and a part that cannot return to service is mutilated in front of a second person so it can never re-enter the supply chain. A scrapped serial can never be installed again."
        actions={<button className="btn pri" onClick={() => setRaising(true)}>Quarantine a part</button>} />
      <div className="row" style={{ marginBottom: 10 }}>{(['open', 'all'] as const).map(s => <button key={s} className={`btn sm ${scope === s ? 'pri' : 'ghost'}`} onClick={() => setScope(s)}>{s}</button>)}</div>
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      <Card title="Non-conformance reports" meta={`${q.data?.length ?? 0}`} flush>
        <div className="tbl-wrap"><table className="t">
          <thead><tr><th>NCR</th><th>Part</th><th>Problem</th><th>Status</th><th>Disposition</th></tr></thead>
          <tbody>
            {(q.data ?? []).map(n => (
              <tr key={n.id} className="click" tabIndex={0} onClick={() => navigate({ search: { ncr: n.id } })} onKeyDown={e => e.key === 'Enter' && navigate({ search: { ncr: n.id } })}>
                <td><b className="mono">{n.id}</b><div className="sub">{zulu(n.raisedAt)} · {label(n.source)}</div></td>
                <td className="mono">{n.partNo}{n.serial ? ` s/n ${n.serial}` : ` × ${n.qty}`}</td>
                <td>{n.description}</td>
                <td><Pill tone={tone[n.status]}>{label(n.status)}</Pill></td>
                <td>{n.disposition ? label(n.disposition) : '—'}</td>
              </tr>
            ))}
            {q.data?.length === 0 && <tr><td colSpan={5} className="empty">Nothing in quarantine.</td></tr>}
          </tbody>
        </table></div>
      </Card>
      <NcrDrawer id={ncr ?? null} onClose={() => navigate({ search: { ncr: undefined } })} />
      {raising && <RaiseDrawer onClose={id => { setRaising(false); if (id) navigate({ search: { ncr: id } }); }} />}
    </>
  );
}

function NcrDrawer({ id, onClose }: { id: string | null; onClose(): void }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') });
  const q = useQuery({ queryKey: ['ncr-one', id], queryFn: () => api<NonconformityDto>(`/amo/ncr/${id}`), enabled: !!id });
  const n = q.data;
  const [d, setD] = useState({ disposition: 'SCRAP', reason: '', releaseRef: '' });
  const [method, setMethod] = useState('');
  const roles = me.data?.roles ?? [];
  const canDispose = roles.some(r => ['camo_engineer', 'camo_manager', 'certifying_staff'].includes(r));
  const canWitness = roles.some(r => ['storekeeper', 'quality_manager', 'certifying_staff'].includes(r));
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['ncr'] }); void qc.invalidateQueries({ queryKey: ['ncr-one', id] }); void qc.invalidateQueries({ queryKey: ['stores'] }); };
  const dispose = useMutation({ mutationFn: () => post<NonconformityDto>(`/amo/ncr/${id}/disposition`, { ...d, releaseRef: d.releaseRef || null, version: n!.version }),
    onSuccess: r => { toast(`${r.id}: ${label(r.disposition!)}`, 'cyan'); refresh(); } });
  const mutilate = useMutation({ mutationFn: () => post<NonconformityDto>(`/amo/ncr/${id}/mutilation`, { method, version: n!.version }),
    onSuccess: r => { toast(`${r.id} scrapped — ${r.serial ? `s/n ${r.serial} can never be installed again` : 'removed from the supply chain'}`, 'green'); refresh(); } });
  const mine = !!n && n.dispositionedBy === `user:${me.data?.username}`;
  return (
    <Drawer open={!!id} onClose={onClose} eyebrow="Non-conformance report" title={n ? `${n.id} · ${n.partNo}` : id ?? ''} tags={n && <Pill tone={tone[n.status]}>{label(n.status)}</Pill>}>
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      {n && (
        <>
          <DL items={[
            ['Part', `${n.partNo}${n.serial ? ` s/n ${n.serial}` : ` × ${n.qty}`}`], ['From', `${label(n.source)}${n.location ? ` · ${n.location}` : ''}`],
            ['Raised', `${zulu(n.raisedAt)} · ${who(n.raisedBy)}`], ['Problem', n.description],
            ...(n.disposition ? [['Disposition', `${label(n.disposition)} — ${n.dispositionReason} · ${who(n.dispositionedBy)}${n.releaseRef ? ` · ${n.releaseRef}` : ''}`] as [string, string]] : []),
            ...(n.mutilatedBy ? [['Scrapped', `${n.mutilationMethod} · witnessed by ${who(n.mutilatedBy)} · ${zulu(n.mutilatedAt!)}`] as [string, string]] : [])
          ]} />
          {n.status === 'QUARANTINED' && canDispose && (
            <section className="dsec">
              <h3>Disposition</h3>
              <div className="form-grid">
                <div className="field"><label htmlFor="n-d">Decision</label><select id="n-d" className="inp" value={d.disposition} onChange={e => setD(x => ({ ...x, disposition: e.target.value }))}>
                  <option value="SCRAP">Scrap</option><option value="RETURN_TO_VENDOR">Return to vendor</option><option value="RETURN_TO_STOCK">Return to stock (repaired / inspected)</option></select></div>
                {d.disposition === 'RETURN_TO_STOCK' && <div className="field"><label htmlFor="n-rel">Release certificate</label><input id="n-rel" className="inp mono" value={d.releaseRef} onChange={e => setD(x => ({ ...x, releaseRef: e.target.value }))} /></div>}
                <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="n-why">Engineering reason</label><textarea id="n-why" className="inp" rows={2} value={d.reason} onChange={e => setD(x => ({ ...x, reason: e.target.value }))} /></div>
              </div>
              <div className="row" style={{ marginTop: 8 }}><button className="btn pri" disabled={dispose.isPending} onClick={() => dispose.mutate()}>Record disposition</button></div>
              <ErrorNote error={dispose.error} />
            </section>
          )}
          {n.status === 'SCRAP_PENDING' && canWitness && (
            <section className="dsec">
              <h3>Mutilation (witnessed)</h3>
              <div className="row"><input className="inp" placeholder="How it was mutilated — cut, crushed, drilled…" value={method} onChange={e => setMethod(e.target.value)} />
                <button className="btn pri" disabled={mutilate.isPending || mine} onClick={() => mutilate.mutate()} title={mine ? 'A second person witnesses the scrapping' : ''}>Record scrapping</button></div>
              {mine && <div className="note">You decided the scrapping; a second person witnesses the mutilation.</div>}
              <ErrorNote error={mutilate.error} />
            </section>
          )}
          <section className="dsec"><h3>Photos and documents</h3><Attachments ownerType="ncr" ownerId={n.id} canAttach={n.status !== 'CLOSED'} /></section>
        </>
      )}
    </Drawer>
  );
}

function RaiseDrawer({ onClose }: { onClose(id?: string): void }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const stock = useQuery({ queryKey: ['stores', 'stock'], queryFn: () => api<StockDto[]>('/amo/stores') });
  const [f, setF] = useState({ source: 'STOCK', partNo: '', serial: '', qty: '1', location: 'ENGM', description: '' });
  const set = (k: keyof typeof f, v: string) => setF(x => ({ ...x, [k]: v }));
  const raise = useMutation({
    mutationFn: () => post<NonconformityDto>('/amo/ncr', { source: f.source, partNo: f.partNo, serial: f.serial || null, qty: Number(f.qty) || 1, location: f.location || null, description: f.description }),
    onSuccess: n => { toast(`${n.id}: ${n.partNo} quarantined`, 'amber'); void qc.invalidateQueries({ queryKey: ['ncr'] }); void qc.invalidateQueries({ queryKey: ['stores'] }); onClose(n.id); }
  });
  return (
    <Drawer open onClose={() => onClose()} eyebrow="Stores" title="Quarantine a part">
      <div className="form-grid">
        <div className="field"><label htmlFor="r-src">Found at</label><select id="r-src" className="inp" value={f.source} onChange={e => set('source', e.target.value)}>
          {['STOCK', 'RECEIVING', 'REMOVAL', 'SHOP', 'AUDIT'].map(s => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <div className="field"><label htmlFor="r-pn">Part number</label><input id="r-pn" className="inp mono" list="r-parts" value={f.partNo} onChange={e => set('partNo', e.target.value)} />
          <datalist id="r-parts">{(stock.data ?? []).map(s => <option key={s.partNo} value={s.partNo}>{s.description}</option>)}</datalist></div>
        <div className="field"><label htmlFor="r-sn">Serial (if serialised)</label><input id="r-sn" className="inp mono" value={f.serial} onChange={e => set('serial', e.target.value)} /></div>
        <div className="field"><label htmlFor="r-q">Quantity</label><input id="r-q" className="inp mono" inputMode="numeric" value={f.qty} onChange={e => set('qty', e.target.value.replace(/\D/g, ''))} /></div>
        {f.source === 'STOCK' && <div className="field"><label htmlFor="r-loc">Stores location</label><input id="r-loc" className="inp mono" value={f.location} onChange={e => set('location', e.target.value.toUpperCase())} /></div>}
        <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="r-desc">What is wrong</label><textarea id="r-desc" className="inp" rows={3} value={f.description} onChange={e => set('description', e.target.value)} /></div>
      </div>
      <div className="row" style={{ marginTop: 10 }}><button className="btn pri" disabled={raise.isPending} onClick={() => raise.mutate()}>Quarantine</button></div>
      <ErrorNote error={raise.error} />
    </Drawer>
  );
}

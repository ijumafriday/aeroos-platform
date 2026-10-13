import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type {
  ExchangeDto, MeDto, PartCondition, PbhContractDto, PbhStatementDto, PurchaseOrderDto, ReceiptDto, RequisitionDto, StockDto, VendorDto, WarrantyClaimDto
} from '@aeroos/contracts';
import { api, post } from '../../lib/api';
import { zulu } from '../../lib/format';
import { useUi } from '../../lib/store';
import { Card, ErrorNote, Head, Pill } from '../../components/ui';
import { Logistics } from './Logistics';
import { Warehouse } from './Warehouse';
import { AogLogistics, FulfillmentControl, InventoryControl, SupplyPlanning, WarrantyRecovery } from './SupplyControl';

const TABS = [['procurement', 'Procurement'], ['inventory', 'Inventory control'], ['logistics', 'Logistics & AOG'], ['planning', 'Planning & sources'], ['commercial', 'Warranty & contracts']] as const;
type Tab = (typeof TABS)[number][0];
const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');
const who = (s: string | null) => (s ?? '').replace(/^user:/, '');
const money = (n: number, c: string) => `${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const poTone: Record<string, string> = { PENDING_APPROVAL: 'amber', ISSUED: 'cyan', PARTIALLY_RECEIVED: 'mag', RECEIVED: 'green', CANCELLED: '' };
const CONDS: PartCondition[] = ['NE', 'NS', 'OH', 'SV'];

/** Supply chain: requisitions → quotes → purchase orders → receiving (certificates) → bonded store; warranty, exchanges, PBH, approved suppliers. */
export function Supply() {
  const { tab } = useSearch({ from: '/amo/supply' });
  const navigate = useNavigate({ from: '/amo/supply' });
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') });
  const roles = me.data?.roles ?? [];
  const has = (...r: string[]) => roles.some(x => r.includes(x));
  const t: Tab = (tab as Tab) ?? 'procurement';
  return (
    <>
      <Head crumb="AMO / Stores" title="Procurement & Supply Chain"
        desc="Approved sourcing, controlled inventory custody, fulfillment, replenishment, warranty recovery and AOG logistics. Parts come only from approved suppliers, with an EASA Form 1 or FAA 8130-3 (a certificate of conformity for standard parts), in a serviceable condition (145.A.42). Orders of 5,000 or more are approved by a second person; imports wait in the bonded store until customs clears them; received parts go straight onto task cards that were short." />
      <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        {TABS.map(([k, l]) => <button key={k} className={`btn sm ${t === k ? 'pri' : 'ghost'}`} onClick={() => navigate({ search: { tab: k } })}>{l}</button>)}
      </div>
      {t === 'procurement' && <>
        <Requisitions canRequest={has('storekeeper', 'certifying_staff', 'camo_engineer', 'camo_manager')} canBuy={has('storekeeper')} />
        <Orders me={me.data?.username ?? ''} canApprove={has('camo_manager', 'quality_manager')} canReceive={has('storekeeper')} />
        <Vendors canManage={has('quality_manager')} />
        <Rates canManage={has('quality_manager') || has('camo_manager')} />
      </>}
      {t === 'inventory' && <>
        <Bonded canClear={has('storekeeper')} />
        <Warehouse canManage={has('storekeeper', 'camo_manager')} />
        <InventoryControl canManage={has('storekeeper', 'camo_manager')} />
      </>}
      {t === 'logistics' && <>
        <Logistics canManage={has('storekeeper', 'camo_manager')} />
        <FulfillmentControl canManage={has('storekeeper', 'camo_manager')} />
        <AogLogistics canManage={has('storekeeper', 'camo_manager')} />
      </>}
      {t === 'planning' && <SupplyPlanning canPlan={has('storekeeper', 'camo_engineer', 'camo_manager')} canSource={has('quality_manager', 'storekeeper', 'camo_manager')} />}
      {t === 'commercial' && <>
        <Warranty canClaim={has('storekeeper', 'camo_engineer', 'camo_manager')} />
        <WarrantyRecovery canManage={has('storekeeper', 'camo_engineer', 'camo_manager')} />
        <Exchanges canBuy={has('storekeeper')} />
        <Pbh />
      </>}
    </>
  );
}

function useVendors() {
  return useQuery({ queryKey: ['supply', 'vendors'], queryFn: () => api<VendorDto[]>('/amo/supply/vendors') });
}

function Requisitions({ canRequest, canBuy }: { canRequest: boolean; canBuy: boolean }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const q = useQuery({ queryKey: ['supply', 'requisitions'], queryFn: () => api<RequisitionDto[]>('/amo/supply/requisitions?scope=all') });
  const vendors = useVendors();
  const stock = useQuery({ queryKey: ['stores', 'stock'], queryFn: () => api<StockDto[]>('/amo/stores') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['supply'] });
  const [f, setF] = useState({ partNo: '', qty: '1', station: 'ENGM', neededBy: inDays(14), reason: '' });
  const raise = useMutation({ mutationFn: () => post('/amo/supply/requisitions', { ...f, qty: Number(f.qty), taskCardId: null }), onSuccess: () => { toast('Requisition raised', 'cyan'); setF(x => ({ ...x, partNo: '', reason: '' })); refresh(); } });
  const shortages = useMutation({ mutationFn: () => post<{ created: string[] }>('/amo/supply/requisitions/from-shortages'), onSuccess: r => { toast(r.created.length ? `Raised ${r.created.join(', ')}` : 'No task-card shortages without a requisition', 'cyan'); refresh(); } });
  return (
    <>
      {canRequest && (
        <Card title="New requisition">
          <div className="form-grid">
            <div className="field"><label htmlFor="rq-pn">Part number</label><input id="rq-pn" className="inp mono" list="rq-parts" value={f.partNo} onChange={e => setF(x => ({ ...x, partNo: e.target.value }))} />
              <datalist id="rq-parts">{(stock.data ?? []).map(s => <option key={s.partNo} value={s.partNo}>{s.description}</option>)}</datalist></div>
            <div className="field"><label htmlFor="rq-q">Qty</label><input id="rq-q" className="inp mono" value={f.qty} onChange={e => setF(x => ({ ...x, qty: e.target.value.replace(/\D/g, '') }))} /></div>
            <div className="field"><label htmlFor="rq-s">Station</label><input id="rq-s" className="inp mono" maxLength={4} value={f.station} onChange={e => setF(x => ({ ...x, station: e.target.value.toUpperCase() }))} /></div>
            <div className="field"><label htmlFor="rq-d">Needed by</label><input id="rq-d" type="date" className="inp" value={f.neededBy} onChange={e => setF(x => ({ ...x, neededBy: e.target.value }))} /></div>
            <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="rq-r">Reason</label><input id="rq-r" className="inp" value={f.reason} onChange={e => setF(x => ({ ...x, reason: e.target.value }))} /></div>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" disabled={raise.isPending} onClick={() => raise.mutate()}>Raise requisition</button>
            <button className="btn ghost" disabled={shortages.isPending} onClick={() => shortages.mutate()}>Requisition all task-card shortages</button>
          </div>
          <ErrorNote error={raise.error ?? shortages.error} />
        </Card>
      )}
      {(q.data ?? []).map(r => <RequisitionCard key={r.id} r={r} vendors={vendors.data ?? []} canBuy={canBuy} onChange={refresh} />)}
      {q.data?.length === 0 && <div className="empty">No requisitions.</div>}
    </>
  );
}

function RequisitionCard({ r, vendors, canBuy, onChange }: { r: RequisitionDto; vendors: VendorDto[]; canBuy: boolean; onChange(): void }) {
  const toast = useUi(s => s.toast);
  const [qf, setQf] = useState({ vendorId: vendors.find(v => v.usable)?.id ?? '', unitPrice: '', currency: 'EUR', leadDays: '5', condition: 'NE' as PartCondition, validUntil: inDays(30) });
  const [imp, setImp] = useState(false);
  // Vendors may load after this card: fall back to the first usable supplier at submit time.
  const quote = useMutation({ mutationFn: () => post(`/amo/supply/requisitions/${r.id}/quotes`, { ...qf, vendorId: qf.vendorId || vendors.find(v => v.usable)?.id || '', unitPrice: Number(qf.unitPrice), leadDays: Number(qf.leadDays) }), onSuccess: () => { toast('Quote recorded', 'cyan'); onChange(); } });
  const award = useMutation({ mutationFn: (quoteId: number) => post<PurchaseOrderDto>(`/amo/supply/requisitions/${r.id}/award`, { quoteId, import: imp }),
    onSuccess: po => { toast(`${po.id} ${po.status === 'PENDING_APPROVAL' ? 'raised — awaiting approval' : 'issued'}`, po.status === 'PENDING_APPROVAL' ? 'amber' : 'green'); onChange(); } });
  const open = r.status === 'OPEN';
  return (
    <Card title={<><span className="mono">{r.id}</span> · {r.qty} × <span className="mono">{r.partNo}</span> {r.description && <span className="note">{r.description}</span>}</>}
      meta={<Pill tone={open ? 'amber' : r.status === 'ORDERED' ? 'green' : ''}>{label(r.status)}{r.poId ? ` · ${r.poId}` : ''}</Pill>}>
      <div className="sub">{r.station} · needed by {r.neededBy} · {r.reason}{r.taskCardId ? ` · task card ${r.taskCardId}` : ''} · {who(r.createdBy)}</div>
      <div className="tbl-wrap" style={{ marginTop: 6 }}><table className="t">
        <thead><tr><th>Supplier</th><th>Unit price</th><th>Lead</th><th>Condition</th><th>Valid to</th><th /></tr></thead>
        <tbody>
          {r.quotes.map(q => (
            <tr key={q.id}>
              <td>{q.vendorName}{!q.usable && <> <Pill tone="red">not orderable</Pill></>}</td><td className="mono">{money(q.unitPrice, q.currency)}</td><td className="mono">{q.leadDays} d</td>
              <td>{q.condition}</td><td className="mono">{q.validUntil}</td>
              <td>{open && canBuy && <button className="btn sm pri" disabled={!q.usable || award.isPending} onClick={() => award.mutate(q.id)}>Award</button>}</td>
            </tr>
          ))}
          {r.quotes.length === 0 && <tr><td colSpan={6} className="empty">No quotes yet.</td></tr>}
        </tbody>
      </table></div>
      {open && canBuy && (
        <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
          <select className="inp" style={{ maxWidth: 220 }} value={qf.vendorId || vendors.find(v => v.usable)?.id || ''} onChange={e => setQf(x => ({ ...x, vendorId: e.target.value }))} aria-label="Supplier">
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}{v.usable ? '' : ' (not approved)'}</option>)}</select>
          <input className="inp mono" style={{ maxWidth: 110 }} placeholder="Unit price" value={qf.unitPrice} onChange={e => setQf(x => ({ ...x, unitPrice: e.target.value }))} />
          <input className="inp mono" style={{ maxWidth: 70 }} value={qf.currency} onChange={e => setQf(x => ({ ...x, currency: e.target.value.toUpperCase() }))} aria-label="Currency" />
          <input className="inp mono" style={{ maxWidth: 80 }} placeholder="Lead days" value={qf.leadDays} onChange={e => setQf(x => ({ ...x, leadDays: e.target.value.replace(/\D/g, '') }))} />
          <select className="inp" style={{ maxWidth: 90 }} value={qf.condition} onChange={e => setQf(x => ({ ...x, condition: e.target.value as PartCondition }))} aria-label="Condition">{CONDS.map(c => <option key={c}>{c}</option>)}</select>
          <button className="btn sm" disabled={quote.isPending} onClick={() => quote.mutate()}>Record quote</button>
          <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={imp} onChange={e => setImp(e.target.checked)} /> import (customs)</label>
        </div>
      )}
      <ErrorNote error={quote.error ?? award.error} />
    </Card>
  );
}

function Orders({ me, canApprove, canReceive }: { me: string; canApprove: boolean; canReceive: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['supply', 'orders'], queryFn: () => api<PurchaseOrderDto[]>('/amo/supply/orders?scope=all') });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['supply'] }); void qc.invalidateQueries({ queryKey: ['stores'] }); };
  return (
    <>
      {(q.data ?? []).map(o => <OrderCard key={o.id} o={o} me={me} canApprove={canApprove} canReceive={canReceive} onChange={refresh} />)}
      {q.data?.length === 0 && <div className="empty">No purchase orders.</div>}
    </>
  );
}

function OrderCard({ o, me, canApprove, canReceive, onChange }: { o: PurchaseOrderDto; me: string; canApprove: boolean; canReceive: boolean; onChange(): void }) {
  const toast = useUi(s => s.toast);
  const [f, setF] = useState({ qty: String(o.qty - o.receivedQty), certificateType: 'FORM1', certificateRef: '', condition: o.condition, serials: '' });
  const approve = useMutation({ mutationFn: () => post(`/amo/supply/orders/${o.id}/approve`, { version: o.version }), onSuccess: () => { toast(`${o.id} approved`, 'green'); onChange(); } });
  const receive = useMutation({
    mutationFn: () => post<PurchaseOrderDto>(`/amo/supply/orders/${o.id}/receive`, { qty: Number(f.qty), certificateType: f.certificateType, certificateRef: f.certificateRef, condition: f.condition,
      serials: f.serials.split(/[\s,]+/).filter(Boolean), version: o.version }),
    onSuccess: r => { toast(`${r.id}: received ${f.qty}${r.import ? ' into the bonded store' : ' into stock'}`, 'green'); onChange(); }
  });
  const mine = o.createdBy === `user:${me}`;
  const receivable = o.status === 'ISSUED' || o.status === 'PARTIALLY_RECEIVED';
  return (
    <Card title={<><span className="mono">{o.id}</span> · {o.qty} × <span className="mono">{o.partNo}</span> · {o.vendorName}</>} meta={<Pill tone={poTone[o.status]}>{label(o.status)}</Pill>}>
      <div className="sub">{money(o.unitPrice, o.currency)} each · total <b>{money(o.total, o.currency)}</b> · {o.condition} · to {o.station}{o.import ? ' · import (customs)' : ''} · received {o.receivedQty}/{o.qty} · raised by {who(o.createdBy)}{o.approvedBy ? ` · approved by ${who(o.approvedBy)}` : ''}</div>
      {o.status === 'PENDING_APPROVAL' && canApprove && (
        <div className="row" style={{ marginTop: 6 }}><button className="btn pri sm" disabled={approve.isPending || mine} onClick={() => approve.mutate()}>Approve order</button>
          {mine && <span className="note">You raised it; someone else approves.</span>}</div>
      )}
      {receivable && canReceive && (
        <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
          <input className="inp mono" style={{ maxWidth: 70 }} value={f.qty} onChange={e => setF(x => ({ ...x, qty: e.target.value.replace(/\D/g, '') }))} aria-label="Quantity received" />
          <select className="inp" style={{ maxWidth: 150 }} value={f.certificateType} onChange={e => setF(x => ({ ...x, certificateType: e.target.value }))} aria-label="Certificate">
            <option value="FORM1">EASA Form 1</option><option value="FAA_8130_3">FAA 8130-3</option><option value="COC">CoC (standard parts)</option></select>
          <input className="inp mono" style={{ maxWidth: 180 }} placeholder="Certificate tracking no." value={f.certificateRef} onChange={e => setF(x => ({ ...x, certificateRef: e.target.value }))} />
          <select className="inp" style={{ maxWidth: 80 }} value={f.condition} onChange={e => setF(x => ({ ...x, condition: e.target.value as PartCondition }))} aria-label="Condition">{[...CONDS, 'AR'].map(c => <option key={c}>{c}</option>)}</select>
          <input className="inp mono" style={{ maxWidth: 200 }} placeholder="Serials (if serialised)" value={f.serials} onChange={e => setF(x => ({ ...x, serials: e.target.value }))} />
          <button className="btn sm" disabled={receive.isPending} onClick={() => receive.mutate()}>Receive</button>
        </div>
      )}
      {o.receipts.length > 0 && <div className="sub" style={{ marginTop: 6 }}>{o.receipts.map(r => `${r.id}: ${r.qty} · ${r.certificateType} ${r.certificateRef} · ${r.condition} · ${zulu(r.receivedAt)}${r.customsStatus !== 'NONE' ? ` · ${label(r.customsStatus)}` : ''}`).join(' — ')}</div>}
      <ErrorNote error={approve.error ?? receive.error} />
    </Card>
  );
}

function Bonded({ canClear }: { canClear: boolean }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const q = useQuery({ queryKey: ['supply', 'bonded'], queryFn: () => api<ReceiptDto[]>('/amo/supply/bonded') });
  const [ref, setRef] = useState<Record<string, string>>({});
  const clear = useMutation({ mutationFn: (id: string) => post(`/amo/supply/receipts/${id}/clear`, { customsRef: ref[id] ?? '' }),
    onSuccess: (_r, id) => { toast(`${id} cleared — in stock`, 'green'); void qc.invalidateQueries({ queryKey: ['supply'] }); void qc.invalidateQueries({ queryKey: ['stores'] }); } });
  return (
    <Card title="Bonded store (awaiting customs)" meta={`${q.data?.length ?? 0}`} flush>
      <div className="tbl-wrap"><table className="t">
        <thead><tr><th>Receipt</th><th>Part</th><th>Supplier · certificate</th><th>Received</th><th>Customs</th></tr></thead>
        <tbody>
          {(q.data ?? []).map(r => (
            <tr key={r.id}>
              <td className="mono">{r.id}{r.poId ? ` · ${r.poId}` : ''}</td><td className="mono">{r.qty} × {r.partNo}</td>
              <td>{r.vendorName} · {r.certificateType} {r.certificateRef}</td><td className="mono">{zulu(r.receivedAt)} · {r.station}</td>
              <td>{canClear && <div className="row"><input className="inp mono" style={{ maxWidth: 160 }} placeholder="Customs entry no." value={ref[r.id] ?? ''} onChange={e => setRef(x => ({ ...x, [r.id]: e.target.value }))} />
                <button className="btn sm" disabled={clear.isPending} onClick={() => clear.mutate(r.id)}>Cleared</button></div>}</td>
            </tr>
          ))}
          {q.data?.length === 0 && <tr><td colSpan={5} className="empty">Nothing waiting for customs.</td></tr>}
        </tbody>
      </table></div>
      <ErrorNote error={clear.error} />
    </Card>
  );
}

function Warranty({ canClaim }: { canClaim: boolean }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') });
  const isMine = (c: WarrantyClaimDto) => !!me.data && c.createdBy === `user:${me.data.username}`;
  const toast = useUi(s => s.toast);
  const q = useQuery({ queryKey: ['supply', 'claims'], queryFn: () => api<WarrantyClaimDto[]>('/amo/supply/claims') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['supply', 'claims'] });
  const [f, setF] = useState({ receiptId: '', serial: '', failure: '', failedAt: inDays(0), claimedAmount: '', currency: 'EUR' });
  const claim = useMutation({ mutationFn: () => post('/amo/supply/claims', { ...f, serial: f.serial || null, claimedAmount: Number(f.claimedAmount) }), onSuccess: () => { toast('Warranty claim submitted', 'cyan'); refresh(); } });
  const decide = useMutation({ mutationFn: (x: { id: string; decision: string; version: number; creditAmount?: number }) => post(`/amo/supply/claims/${x.id}/decide`, { decision: x.decision, version: x.version, creditAmount: x.creditAmount ?? null, vendorRef: null }),
    onSuccess: () => { toast('Claim updated', 'cyan'); refresh(); } });
  return (
    <>
      <Card title="Warranty claims" meta={`${q.data?.length ?? 0}`} flush>
        <div className="tbl-wrap"><table className="t">
          <thead><tr><th>Claim</th><th>Part</th><th>Failure</th><th>Claimed</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(q.data ?? []).map(c => (
              <tr key={c.id}>
                <td className="mono">{c.id}<div className="sub">{c.vendorName}</div></td><td className="mono">{c.partNo}{c.serial ? ` s/n ${c.serial}` : ''}</td>
                <td>{c.failure} <span className="note">{c.failedAt}</span></td><td className="mono">{money(c.claimedAmount, c.currency)}{c.creditAmount !== null ? ` → ${money(c.creditAmount, c.currency)}` : ''}</td>
                <td><Pill tone={c.status === 'CREDITED' ? 'green' : c.status === 'REJECTED' ? 'red' : 'amber'}>{label(c.status)}</Pill></td>
                <td>{canClaim && !isMine(c) && c.status === 'SUBMITTED' && <><button className="btn sm" onClick={() => decide.mutate({ id: c.id, decision: 'ACCEPTED', version: c.version })}>Accepted</button> <button className="btn sm ghost" onClick={() => decide.mutate({ id: c.id, decision: 'REJECTED', version: c.version })}>Rejected</button></>}
                  {canClaim && isMine(c) && (c.status === 'SUBMITTED' || c.status === 'ACCEPTED') && <span className="note">decided by someone else</span>}
                  {canClaim && !isMine(c) && c.status === 'ACCEPTED' && <button className="btn sm pri" onClick={() => decide.mutate({ id: c.id, decision: 'CREDITED', version: c.version, creditAmount: c.claimedAmount })}>Credited</button>}</td>
              </tr>
            ))}
            {q.data?.length === 0 && <tr><td colSpan={6} className="empty">No claims.</td></tr>}
          </tbody>
        </table></div>
        <ErrorNote error={decide.error} />
      </Card>
      {canClaim && (
        <Card title="New claim">
          <div className="form-grid">
            <div className="field"><label htmlFor="wc-gr">Goods receipt</label><input id="wc-gr" className="inp mono" placeholder="GR-0002" value={f.receiptId} onChange={e => setF(x => ({ ...x, receiptId: e.target.value }))} /></div>
            <div className="field"><label htmlFor="wc-sn">Serial</label><input id="wc-sn" className="inp mono" value={f.serial} onChange={e => setF(x => ({ ...x, serial: e.target.value }))} /></div>
            <div className="field"><label htmlFor="wc-at">Failed on</label><input id="wc-at" type="date" className="inp" value={f.failedAt} onChange={e => setF(x => ({ ...x, failedAt: e.target.value }))} /></div>
            <div className="field"><label htmlFor="wc-amt">Claimed</label><input id="wc-amt" className="inp mono" value={f.claimedAmount} onChange={e => setF(x => ({ ...x, claimedAmount: e.target.value }))} /></div>
            <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="wc-f">Failure</label><input id="wc-f" className="inp" value={f.failure} onChange={e => setF(x => ({ ...x, failure: e.target.value }))} /></div>
          </div>
          <div className="row" style={{ marginTop: 8 }}><button className="btn" disabled={claim.isPending} onClick={() => claim.mutate()}>Submit claim</button></div>
          <ErrorNote error={claim.error} />
        </Card>
      )}
    </>
  );
}

function Exchanges({ canBuy }: { canBuy: boolean }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const q = useQuery({ queryKey: ['supply', 'exchanges'], queryFn: () => api<ExchangeDto[]>('/amo/supply/exchanges') });
  const [ref, setRef] = useState<Record<string, string>>({});
  const core = useMutation({ mutationFn: (id: string) => post(`/amo/supply/exchanges/${id}/core-returned`, { coreRef: ref[id] ?? '' }), onSuccess: (_r, id) => { toast(`${id}: core returned`, 'green'); void qc.invalidateQueries({ queryKey: ['supply', 'exchanges'] }); } });
  return (
    <Card title="Exchanges (cores owed to suppliers)" meta={`${(q.data ?? []).filter(e => e.overdue).length} overdue`} flush>
      <div className="tbl-wrap"><table className="t">
        <thead><tr><th>Exchange</th><th>Part</th><th>Received · core owed</th><th>Fee</th><th>Core due</th><th /></tr></thead>
        <tbody>
          {(q.data ?? []).map(e => (
            <tr key={e.id}>
              <td className="mono">{e.id}<div className="sub">{e.vendorName}</div></td><td className="mono">{e.partNo}</td><td className="mono">{e.serialIn} · {e.serialOut}</td>
              <td className="mono">{money(e.fee, e.currency)}</td>
              <td>{e.status === 'CORE_RETURNED' ? <Pill tone="green">returned {e.coreReturnedAt ? zulu(e.coreReturnedAt) : ''}</Pill> : <Pill tone={e.overdue ? 'red' : 'amber'}>{e.coreDue}{e.overdue ? ' overdue' : ''}</Pill>}</td>
              <td>{canBuy && e.status === 'OPEN' && <div className="row"><input className="inp mono" style={{ maxWidth: 150 }} placeholder="Shipment / AWB" value={ref[e.id] ?? ''} onChange={x => setRef(r => ({ ...r, [e.id]: x.target.value }))} />
                <button className="btn sm" disabled={core.isPending} onClick={() => core.mutate(e.id)}>Core sent</button></div>}</td>
            </tr>
          ))}
          {q.data?.length === 0 && <tr><td colSpan={6} className="empty">No exchanges.</td></tr>}
        </tbody>
      </table></div>
      <ErrorNote error={core.error} />
    </Card>
  );
}

function Pbh() {
  const q = useQuery({ queryKey: ['supply', 'pbh'], queryFn: () => api<PbhContractDto[]>('/amo/supply/pbh') });
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}><label className="note" htmlFor="pbh-m">Statement month</label><input id="pbh-m" type="month" className="inp" style={{ maxWidth: 170 }} value={month} onChange={e => setMonth(e.target.value)} /></div>
      {(q.data ?? []).map(c => <PbhCard key={c.id} c={c} month={month} />)}
      {q.data?.length === 0 && <div className="empty">No power-by-the-hour contracts.</div>}
    </>
  );
}

function PbhCard({ c, month }: { c: PbhContractDto; month: string }) {
  const s = useQuery({ queryKey: ['supply', 'pbh', c.id, month], queryFn: () => api<PbhStatementDto>(`/amo/supply/pbh/${c.id}/statement?month=${month}`) });
  return (
    <Card title={<><span className="mono">{c.id}</span> · {c.vendorName}</>} meta={`${money(c.ratePerFh, c.currency)} / FH`}>
      <div className="sub">{c.scope} · {c.starts} → {c.ends}</div>
      <table className="t" style={{ marginTop: 6 }}>
        <thead><tr><th>Aircraft</th><th>Flight hours</th><th>Charge</th></tr></thead>
        <tbody>
          {(s.data?.lines ?? []).map(l => <tr key={l.tail}><td className="mono">{l.tail}</td><td className="mono">{l.fh.toLocaleString('en-GB')}</td><td className="mono">{money(l.amount, c.currency)}</td></tr>)}
          {s.data && <tr><td><b>Total {month}</b></td><td /><td className="mono"><b>{money(s.data.total, c.currency)}</b></td></tr>}
        </tbody>
      </table>
      <ErrorNote error={s.error} />
    </Card>
  );
}

function Vendors({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const q = useVendors();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['supply'] });
  const [f, setF] = useState({ name: '', approvalType: 'DISTRIBUTOR', approvalRef: '', approvedUntil: inDays(365), warrantyMonths: '12', country: 'NO' });
  const add = useMutation({ mutationFn: () => post('/amo/supply/vendors', { ...f, warrantyMonths: Number(f.warrantyMonths) }), onSuccess: () => { toast('Supplier approved', 'green'); refresh(); } });
  const set = useMutation({ mutationFn: (x: { id: string; status: string; approvedUntil: string | null }) => post(`/amo/supply/vendors/${x.id}/status`, { ...x, reason: x.status === 'SUSPENDED' ? 'Suspended by quality' : 'Re-approved after audit' }),
    onSuccess: () => { toast('Supplier updated', 'cyan'); refresh(); } });
  return (
    <>
      <Card title="Approved supplier list" meta={`${q.data?.length ?? 0}`} flush>
        <div className="tbl-wrap"><table className="t">
          <thead><tr><th>Supplier</th><th>Approval</th><th>Valid to</th><th>Warranty</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(q.data ?? []).map(v => (
              <tr key={v.id}>
                <td><b>{v.name}</b> <span className="note mono">{v.id} · {v.country}</span></td><td className="sub">{label(v.approvalType)} · {v.approvalRef}</td>
                <td className="mono">{v.approvedUntil}</td><td className="mono">{v.warrantyMonths} mo</td>
                <td><Pill tone={v.usable ? 'green' : 'red'}>{v.status === 'SUSPENDED' ? 'suspended' : v.usable ? 'approved' : 'lapsed'}</Pill></td>
                <td>{canManage && (v.status === 'APPROVED'
                  ? <button className="btn sm ghost" onClick={() => set.mutate({ id: v.id, status: 'SUSPENDED', approvedUntil: null })}>Suspend</button>
                  : <button className="btn sm" onClick={() => set.mutate({ id: v.id, status: 'APPROVED', approvedUntil: inDays(365) })}>Re-approve 1 yr</button>)}
                  {canManage && v.status === 'APPROVED' && !v.usable && <button className="btn sm" onClick={() => set.mutate({ id: v.id, status: 'APPROVED', approvedUntil: inDays(365) })}>Renew 1 yr</button>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <ErrorNote error={set.error} />
      </Card>
      {canManage && (
        <Card title="Approve a supplier">
          <div className="form-grid">
            <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="v-n">Name</label><input id="v-n" className="inp" value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} /></div>
            <div className="field"><label htmlFor="v-t">Approval</label><select id="v-t" className="inp" value={f.approvalType} onChange={e => setF(x => ({ ...x, approvalType: e.target.value }))}>
              {['PART_145', 'PART_21G', 'DISTRIBUTOR', 'OEM'].map(a => <option key={a} value={a}>{label(a)}</option>)}</select></div>
            <div className="field"><label htmlFor="v-r">Reference</label><input id="v-r" className="inp mono" value={f.approvalRef} onChange={e => setF(x => ({ ...x, approvalRef: e.target.value }))} /></div>
            <div className="field"><label htmlFor="v-u">Valid to</label><input id="v-u" type="date" className="inp" value={f.approvedUntil} onChange={e => setF(x => ({ ...x, approvedUntil: e.target.value }))} /></div>
            <div className="field"><label htmlFor="v-w">Warranty (months)</label><input id="v-w" className="inp mono" value={f.warrantyMonths} onChange={e => setF(x => ({ ...x, warrantyMonths: e.target.value.replace(/\D/g, '') }))} /></div>
            <div className="field"><label htmlFor="v-c">Country</label><input id="v-c" className="inp mono" maxLength={2} value={f.country} onChange={e => setF(x => ({ ...x, country: e.target.value.toUpperCase() }))} /></div>
          </div>
          <div className="row" style={{ marginTop: 8 }}><button className="btn" disabled={add.isPending} onClick={() => add.mutate()}>Approve supplier</button></div>
          <ErrorNote error={add.error} />
        </Card>
      )}
    </>
  );
}

/** Reference exchange rates to USD for the purchase-order approval limit. */
function Rates({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const q = useQuery({ queryKey: ['supply', 'rates'], queryFn: () => api<{ currency: string; basePerUnit: number; asOf: string; stale: boolean }[]>('/amo/supply/rates') });
  const [f, setF] = useState({ currency: '', basePerUnit: '' });
  const save = useMutation({ mutationFn: () => post('/amo/supply/rates', { currency: f.currency, basePerUnit: Number(f.basePerUnit) }),
    onSuccess: () => { toast(`${f.currency.toUpperCase()} rate saved`, 'cyan'); setF({ currency: '', basePerUnit: '' }); void qc.invalidateQueries({ queryKey: ['supply', 'rates'] }); } });
  return (
    <Card title="Exchange rates (USD per unit)" meta={`${q.data?.length ?? 0}`}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {(q.data ?? []).map(r => <Pill key={r.currency} tone={r.stale ? 'amber' : ''}>{r.currency} {r.basePerUnit} · {r.asOf}{r.stale ? ' (stale)' : ''}</Pill>)}
      </div>
      <div className="note" style={{ marginTop: 6 }}>Orders are compared with the approval limit (5,000 USD) at these rates. Quotes in a currency without a rate are refused.</div>
      {canManage && (
        <div className="row" style={{ marginTop: 8 }}>
          <input className="inp mono" style={{ maxWidth: 90 }} placeholder="EUR" maxLength={3} value={f.currency} onChange={e => setF(x => ({ ...x, currency: e.target.value.toUpperCase() }))} aria-label="Currency" />
          <input className="inp mono" style={{ maxWidth: 140 }} placeholder="USD per unit" value={f.basePerUnit} onChange={e => setF(x => ({ ...x, basePerUnit: e.target.value }))} aria-label="USD per unit" />
          <button className="btn sm" disabled={save.isPending} onClick={() => save.mutate()}>Save rate</button>
          <ErrorNote error={save.error} />
        </div>
      )}
    </Card>
  );
}

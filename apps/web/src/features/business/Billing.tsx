import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { BillingOverviewDto, CustomerOrderDto, InvoiceDto } from '@aeroos/contracts';
import { api, post } from '../../lib/api';
import { useUi } from '../../lib/store';
import { Card, DL, Drawer, ErrorNote, Head, Pill } from '../../components/ui';
import { money } from './Ledger';

const statusTone: Record<string, string> = { QUOTED: 'cyan', APPROVED: 'cyan', IN_WORK: 'amber', COMPLETED: 'amber', INVOICED: 'green', CANCELLED: '' };
const invTone: Record<string, string> = { ISSUED: 'amber', PARTIALLY_PAID: 'amber', PAID: 'green', CREDITED: '' };
const AGE: [keyof BillingOverviewDto['ageing'], string][] = [['CURRENT', 'not due'], ['D1_30', '1–30 days'], ['D31_60', '31–60'], ['D61_90', '61–90'], ['D90_PLUS', 'over 90']];
const who = (s: string) => s.replace(/^user:/, '');
const today = () => new Date().toISOString().slice(0, 10);

/** Third-party maintenance: customers, orders from quote to invoice, receivables. */
export function Billing() {
  const { order } = useSearch({ from: '/amo/billing' });
  const navigate = useNavigate({ from: '/amo/billing' });
  const q = useQuery({ queryKey: ['billing'], queryFn: () => api<BillingOverviewDto>('/amo/billing') });
  const b = q.data;
  return (
    <>
      <Head crumb="AMO / Third-party maintenance & billing" title="Third-party Maintenance & Billing"
        desc="Work for other operators under the Part-145 approval: quote, the customer's approval (their PO, checked against the credit limit), labour, parts and subcontracted services booked against the order, invoice (more than 10 % above the quote needs the customer's approval of the overrun), payments and credit notes. Invoices and payments post to the general ledger." />
      <ErrorNote error={q.error} />
      {b && <>
        <Card title="Receivables" meta={`${b.baseCurrency}, by days past due`}>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
            {AGE.map(([k, l]) => <div key={k}><div className="note">{l}</div><div className="mono" style={{ font: '700 18px var(--f-mono)', color: k !== 'CURRENT' && b.ageing[k] ? 'var(--amber)' : undefined }}>{money(b.ageing[k])}</div></div>)}
          </div>
        </Card>
        <Card title="Orders" meta={`${b.orders.length}`} flush>
          <div className="tbl-wrap"><table className="t">
            <thead><tr><th>Order</th><th>Customer</th><th>Aircraft</th><th>Work</th><th>Quote net</th><th>Booked net</th><th>Status</th></tr></thead>
            <tbody>{b.orders.map(o => (
              <tr key={o.id} className="click" tabIndex={0} onClick={() => navigate({ search: { order: o.id } })} onKeyDown={e => e.key === 'Enter' && navigate({ search: { order: o.id } })}>
                <td className="mono"><b>{o.id}</b></td><td>{o.customerName}</td><td className="mono">{o.aircraftReg} · {o.aircraftType}</td><td>{o.title}</td>
                <td className="mono">{money(o.quote.netCents)} {o.currency}</td>
                <td className="mono">{money(o.actual.netCents)} {o.overrunNeedsApproval && <Pill tone="red">+{o.overrunPct} %</Pill>}</td>
                <td><Pill tone={statusTone[o.status]}>{o.status.replace('_', ' ').toLowerCase()}</Pill></td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
        <Card title="Customers" meta={`${b.customers.length}`} flush>
          <div className="tbl-wrap"><table className="t">
            <thead><tr><th>Customer</th><th>Terms</th><th>Credit limit</th><th>Open</th><th>Overdue</th></tr></thead>
            <tbody>{b.customers.map(c => (
              <tr key={c.id}><td><b>{c.name}</b> <span className="note mono">{c.id} · {c.country}</span></td>
                <td className="note">{c.labourRate} {c.currency}/h · parts +{c.partsMarkupPct} % · services +{c.serviceMarkupPct} % · VAT {c.vatPct} % · {c.paymentTermsDays} days</td>
                <td className="mono">{c.creditLimit.toLocaleString('en-GB')} {c.currency}</td><td className="mono">{money(c.openCents)}</td>
                <td className="mono" style={{ color: c.overdueCents ? 'var(--amber)' : undefined }}>{money(c.overdueCents)}</td></tr>
            ))}</tbody>
          </table></div>
        </Card>
        {b.permissions.quote && <NewQuote b={b} onCreated={id => navigate({ search: { order: id } })} />}
        {b.permissions.manageCustomers && <NewCustomer />}
        <OrderDrawer key={order ?? 'none'} id={order ?? null} b={b} onClose={() => navigate({ search: { order: undefined } })} />
      </>}
    </>
  );
}

type Line = { kind: 'LABOUR' | 'PART' | 'SERVICE'; description: string; qty: string; unitCost: string };

function NewQuote({ b, onCreated }: { b: BillingOverviewDto; onCreated(id: string): void }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const [f, setF] = useState({ customerId: b.customers[0]?.id ?? '', aircraftReg: '', aircraftType: '', title: '' });
  const [lines, setLines] = useState<Line[]>([{ kind: 'LABOUR', description: '', qty: '', unitCost: '0' }]);
  const save = useMutation({
    mutationFn: () => post<CustomerOrderDto>('/amo/billing/orders', { ...f, lines: lines.map(l => ({ kind: l.kind, description: l.description, qty: Number(l.qty), unitCost: Number(l.unitCost || 0) })) }),
    onSuccess: r => { toast(`${r.id} quoted: ${money(r.quote.totalCents)} ${r.currency}`, 'green'); void qc.invalidateQueries({ queryKey: ['billing'] }); onCreated(r.id); }
  });
  const set = (i: number, k: keyof Line, v: string) => setLines(lines.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <Card title="New quote">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field"><label htmlFor="q-cust">Customer</label><select id="q-cust" className="inp" value={f.customerId} onChange={e => setF({ ...f, customerId: e.target.value })}>{b.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label htmlFor="q-reg">Registration</label><input id="q-reg" className="inp" value={f.aircraftReg} onChange={e => setF({ ...f, aircraftReg: e.target.value })} /></div>
        <div className="field"><label htmlFor="q-type">Type</label><input id="q-type" className="inp" value={f.aircraftType} onChange={e => setF({ ...f, aircraftType: e.target.value })} /></div>
        <div className="field" style={{ flex: 1, minWidth: 220 }}><label htmlFor="q-title">Work</label><input id="q-title" className="inp" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></div>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="row" style={{ gap: 6, marginTop: 4 }}>
          <select className="inp" aria-label={`Kind ${i + 1}`} value={l.kind} onChange={e => set(i, 'kind', e.target.value)}><option value="LABOUR">labour (h)</option><option value="PART">part</option><option value="SERVICE">subcontract</option></select>
          <input className="inp" aria-label={`Description ${i + 1}`} placeholder="description" value={l.description} onChange={e => set(i, 'description', e.target.value)} />
          <input className="inp" aria-label={`Quantity ${i + 1}`} placeholder={l.kind === 'LABOUR' ? 'hours' : 'qty'} type="number" min={0} step="0.5" value={l.qty} onChange={e => set(i, 'qty', e.target.value)} />
          {l.kind !== 'LABOUR' && <input className="inp" aria-label={`Unit cost ${i + 1}`} placeholder="unit cost" type="number" min={0} step="0.01" value={l.unitCost} onChange={e => set(i, 'unitCost', e.target.value)} />}
        </div>
      ))}
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <button className="btn sm ghost" onClick={() => setLines([...lines, { kind: 'PART', description: '', qty: '', unitCost: '' }])}>Add line</button>
        <button className="btn pri" disabled={!f.customerId || f.aircraftReg.length < 3 || f.aircraftType.trim().length < 2 || f.title.trim().length < 5 || lines.some(l => l.description.trim().length < 2 || !(Number(l.qty) > 0)) || save.isPending} onClick={() => save.mutate()}>Create quote</button>
      </div>
      <ErrorNote error={save.error} />
    </Card>
  );
}

function NewCustomer() {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const [f, setF] = useState({ name: '', country: '', currency: 'EUR', labourRate: '90', partsMarkupPct: '15', serviceMarkupPct: '10', vatPct: '0', paymentTermsDays: '30', creditLimit: '50000' });
  const save = useMutation({
    mutationFn: () => post<BillingOverviewDto>('/amo/billing/customers', { name: f.name, country: f.country, currency: f.currency, labourRate: Number(f.labourRate), partsMarkupPct: Number(f.partsMarkupPct),
      serviceMarkupPct: Number(f.serviceMarkupPct), vatPct: Number(f.vatPct), paymentTermsDays: Number(f.paymentTermsDays), creditLimit: Number(f.creditLimit) }),
    onSuccess: r => { qc.setQueryData(['billing'], r); toast(`${f.name} added`, 'green'); setF({ ...f, name: '' }); }
  });
  const fld = (k: 'name' | 'country' | 'currency' | 'labourRate' | 'partsMarkupPct' | 'serviceMarkupPct' | 'vatPct' | 'paymentTermsDays' | 'creditLimit', label: string, w = 90) => (
    <div className="field" key={k}><label htmlFor={`cu-${k}`}>{label}</label><input id={`cu-${k}`} className="inp" style={{ width: w }} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></div>
  );
  return (
    <Card title="New customer">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {fld('name', 'Name', 220)}{fld('country', 'Country (ISO)', 70)}{fld('currency', 'Currency', 70)}{fld('labourRate', 'Labour rate/h')}{fld('partsMarkupPct', 'Parts +%', 70)}
        {fld('serviceMarkupPct', 'Services +%', 70)}{fld('vatPct', 'VAT %', 60)}{fld('paymentTermsDays', 'Terms (days)', 70)}{fld('creditLimit', 'Credit limit', 110)}
        <button className="btn" disabled={f.name.trim().length < 2 || f.country.length !== 2 || save.isPending} onClick={() => save.mutate()}>Add</button>
      </div>
      <ErrorNote error={save.error} />
    </Card>
  );
}

function OrderDrawer({ id, b, onClose }: { id: string | null; b: BillingOverviewDto; onClose(): void }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const q = useQuery({ queryKey: ['billing', 'order', id], queryFn: () => api<CustomerOrderDto>(`/amo/billing/orders/${encodeURIComponent(id!)}`), enabled: !!id });
  const o = q.data;
  const [ref, setRef] = useState('');
  const [overrunRef, setOverrunRef] = useState('');
  const [line, setLine] = useState<Line & { workDate: string }>({ kind: 'LABOUR', description: '', qty: '', unitCost: '0', workDate: today() });
  const done = (r: CustomerOrderDto, msg: string, tone: 'green' | 'cyan' = 'cyan') => { qc.setQueryData(['billing', 'order', id], r); void qc.invalidateQueries({ queryKey: ['billing'] }); toast(msg, tone); };
  const approve = useMutation({ mutationFn: () => post<CustomerOrderDto>(`/amo/billing/orders/${o!.id}/approve`, { customerRef: ref, version: o!.version }), onSuccess: r => done(r, `${r.id} approved by the customer`, 'green') });
  const status = useMutation({ mutationFn: (to: 'CANCELLED' | 'COMPLETED' | 'IN_WORK') => post<CustomerOrderDto>(`/amo/billing/orders/${o!.id}/status`, { to, version: o!.version }), onSuccess: r => done(r, `${r.id} ${r.status.toLowerCase().replace('_', ' ')}`) });
  const book = useMutation({
    mutationFn: () => post<CustomerOrderDto>(`/amo/billing/orders/${o!.id}/lines`, { kind: line.kind, description: line.description, qty: Number(line.qty), unitCost: Number(line.unitCost || 0), workDate: line.workDate }),
    onSuccess: r => { setLine({ ...line, description: '', qty: '' }); done(r, 'Work booked'); }
  });
  const invoice = useMutation({ mutationFn: () => post<CustomerOrderDto>(`/amo/billing/orders/${o!.id}/invoice`, { overrunRef: overrunRef || undefined, version: o!.version }), onSuccess: r => done(r, `Invoiced: ${r.invoices[r.invoices.length - 1]?.id ?? ''}`, 'green') });
  const err = q.error ?? approve.error ?? status.error ?? book.error ?? invoice.error;
  return (
    <Drawer open={!!id} onClose={onClose} eyebrow="Customer order" title={o ? `${o.id} — ${o.customerName}` : id ?? ''} tags={o && <><Pill tone={statusTone[o.status]}>{o.status.replace('_', ' ').toLowerCase()}</Pill><Pill>{o.currency}</Pill></>}>
      <ErrorNote error={err} />
      {o && <>
        <DL items={[['Aircraft', `${o.aircraftReg} · ${o.aircraftType}`], ['Work', o.title], ['Customer approval', o.customerRef ?? '—'], ['Cost centre', o.costCentre || 'default MRO sales'], ['Quoted by', `${who(o.createdBy)} ${o.createdAt.slice(0, 10)}`]]} />
        <Card title="Quote" meta={`net ${money(o.quote.netCents)} · VAT ${money(o.quote.vatCents)} · total ${money(o.quote.totalCents)} ${o.currency}`}>
          <Lines lines={o.quote.lines} />
          {o.status === 'QUOTED' && b.permissions.quote && (
            <div className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: 1 }}><label htmlFor="ap-ref">Customer's approval (their PO number)</label><input id="ap-ref" className="inp" value={ref} onChange={e => setRef(e.target.value)} /></div>
              <button className="btn pri" disabled={ref.trim().length < 2 || approve.isPending} onClick={() => approve.mutate()}>Record approval</button>
              <button className="btn ghost" disabled={status.isPending} onClick={() => status.mutate('CANCELLED')}>Cancel quote</button>
            </div>
          )}
        </Card>
        <Card title="Work booked" meta={`net ${money(o.actual.netCents)} ${o.currency}${o.quote.netCents ? ` · ${o.overrunPct >= 0 ? '+' : ''}${o.overrunPct} % vs quote` : ''}`}>
          <Lines lines={o.actual.lines} />
          {['APPROVED', 'IN_WORK', 'COMPLETED'].includes(o.status) && b.permissions.book && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 6 }}>
              <select className="inp" aria-label="Kind" value={line.kind} onChange={e => setLine({ ...line, kind: e.target.value as Line['kind'] })}><option value="LABOUR">labour (h)</option><option value="PART">part</option><option value="SERVICE">subcontract</option></select>
              <input className="inp" aria-label="Description" placeholder="description" value={line.description} onChange={e => setLine({ ...line, description: e.target.value })} />
              <input className="inp" aria-label="Quantity" placeholder={line.kind === 'LABOUR' ? 'hours' : 'qty'} type="number" min={0} step="0.5" value={line.qty} onChange={e => setLine({ ...line, qty: e.target.value })} />
              {line.kind !== 'LABOUR' && <input className="inp" aria-label="Unit cost" placeholder="unit cost" type="number" min={0} step="0.01" value={line.unitCost} onChange={e => setLine({ ...line, unitCost: e.target.value })} />}
              <input className="inp" aria-label="Work date" type="date" value={line.workDate} onChange={e => setLine({ ...line, workDate: e.target.value })} />
              <button className="btn" disabled={line.description.trim().length < 2 || !(Number(line.qty) > 0) || book.isPending} onClick={() => book.mutate()}>Book</button>
            </div>
          )}
          <div className="row" style={{ gap: 6, marginTop: 8 }}>
            {o.status === 'IN_WORK' && b.permissions.book && <button className="btn" disabled={status.isPending} onClick={() => status.mutate('COMPLETED')}>Work completed</button>}
            {o.status === 'COMPLETED' && b.permissions.book && <button className="btn ghost" disabled={status.isPending} onClick={() => status.mutate('IN_WORK')}>Reopen</button>}
          </div>
        </Card>
        {o.status === 'COMPLETED' && b.permissions.invoice && (
          <Card title="Invoice">
            {o.overrunNeedsApproval && <div className="callout amber">{o.overrunPct} % above the quote: record the customer's approval of the overrun to invoice.</div>}
            <div className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
              {o.overrunNeedsApproval && <div className="field" style={{ flex: 1 }}><label htmlFor="ov-ref">Customer's overrun approval reference</label><input id="ov-ref" className="inp" value={overrunRef} onChange={e => setOverrunRef(e.target.value)} /></div>}
              <button className="btn pri" disabled={(o.overrunNeedsApproval && overrunRef.trim().length < 2) || invoice.isPending} onClick={() => invoice.mutate()}>Issue invoice ({money(o.actual.totalCents)} {o.currency})</button>
            </div>
          </Card>
        )}
        {o.invoices.map(i => <InvoiceCard key={i.id} i={i} canInvoice={b.permissions.invoice} onDone={r => done(r, 'Saved', 'green')} />)}
      </>}
    </Drawer>
  );
}

function Lines({ lines }: { lines: { kind: string; description: string; qty: number; unitPrice: number; amountCents: number }[] }) {
  if (!lines.length) return <div className="note">None yet.</div>;
  return (
    <table className="t"><tbody>{lines.map((l, i) => (
      <tr key={i}><td>{l.kind.toLowerCase()}</td><td>{l.description}</td><td className="mono" style={{ textAlign: 'right' }}>{l.qty} × {l.unitPrice.toFixed(2)}</td><td className="mono" style={{ textAlign: 'right' }}>{money(l.amountCents)}</td></tr>
    ))}</tbody></table>
  );
}

function InvoiceCard({ i, canInvoice, onDone }: { i: InvoiceDto; canInvoice: boolean; onDone(r: CustomerOrderDto): void }) {
  const [pay, setPay] = useState({ amount: '', reference: '', receivedOn: today() });
  const [reason, setReason] = useState('');
  const payM = useMutation({ mutationFn: () => post<CustomerOrderDto>(`/amo/billing/invoices/${i.id}/payments`, { amount: Number(pay.amount), reference: pay.reference, receivedOn: pay.receivedOn, version: i.version }), onSuccess: onDone });
  const credit = useMutation({ mutationFn: () => post<CustomerOrderDto>(`/amo/billing/invoices/${i.id}/credit`, { reason, version: i.version }), onSuccess: onDone });
  const open = i.totalCents - i.paidCents;
  return (
    <Card title={`${i.kind === 'CREDIT_NOTE' ? 'Credit note' : 'Invoice'} ${i.id}`} meta={`${i.issuedOn} · due ${i.dueOn} · ${money(i.totalCents)} ${i.currency}`}>
      <Pill tone={invTone[i.status]}>{i.status.replace('_', ' ').toLowerCase()}</Pill> {i.overdueDays > 0 && <Pill tone="red">{i.overdueDays} days overdue</Pill>}
      {i.credits && <span className="note"> credits {i.credits}</span>} {i.reason && <span className="note"> — {i.reason}</span>}
      <Lines lines={i.lines} />
      <div className="note">net {money(i.netCents)} · VAT {money(i.vatCents)} · paid {money(i.paidCents)}</div>
      {i.payments.map(p => <div key={p.reference} className="note">Payment {p.reference}: {money(p.amountCents)} on {p.receivedOn} ({who(p.recordedBy)})</div>)}
      {canInvoice && i.kind === 'INVOICE' && i.status !== 'CREDITED' && open > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 6 }}>
          <div className="field"><label htmlFor={`pa-${i.id}`}>Amount</label><input id={`pa-${i.id}`} className="inp" type="number" step="0.01" value={pay.amount} placeholder={money(open)} onChange={e => setPay({ ...pay, amount: e.target.value })} /></div>
          <div className="field"><label htmlFor={`pr-${i.id}`}>Bank reference</label><input id={`pr-${i.id}`} className="inp" value={pay.reference} onChange={e => setPay({ ...pay, reference: e.target.value })} /></div>
          <div className="field"><label htmlFor={`pd-${i.id}`}>Received</label><input id={`pd-${i.id}`} className="inp" type="date" value={pay.receivedOn} onChange={e => setPay({ ...pay, receivedOn: e.target.value })} /></div>
          <button className="btn" disabled={!(Number(pay.amount) > 0) || pay.reference.trim().length < 2 || payM.isPending} onClick={() => payM.mutate()}>Record payment</button>
        </div>
      )}
      {canInvoice && i.kind === 'INVOICE' && i.status === 'ISSUED' && i.paidCents === 0 && (
        <div className="row" style={{ gap: 6, alignItems: 'flex-end', marginTop: 6 }}>
          <div className="field" style={{ flex: 1 }}><label htmlFor={`cr-${i.id}`}>Credit note reason</label><input id={`cr-${i.id}`} className="inp" value={reason} onChange={e => setReason(e.target.value)} /></div>
          <button className="btn ghost" disabled={reason.trim().length < 5 || credit.isPending} onClick={() => credit.mutate()}>Credit in full</button>
        </div>
      )}
      <ErrorNote error={payM.error ?? credit.error} />
    </Card>
  );
}

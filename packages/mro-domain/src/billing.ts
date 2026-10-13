import { DomainError } from '@aeroos/kernel';

/**
 * Third-party maintenance billing (the AMO selling Part-145 work to other operators): a customer order is quoted,
 * approved by the customer (their PO), worked (labour, parts, subcontracted services booked against it), completed
 * and invoiced. Money is kept in integer cents of the order currency to avoid rounding drift.
 */

export type LineKind = 'LABOUR' | 'PART' | 'SERVICE';
export type OrderStatus = 'QUOTED' | 'APPROVED' | 'IN_WORK' | 'COMPLETED' | 'INVOICED' | 'CANCELLED';

export interface CustomerTerms {
  /** Price per labour hour, order currency. */
  labourRate: number;
  /** Mark-up on parts and on subcontracted services, percent. */
  partsMarkupPct: number;
  serviceMarkupPct: number;
  /** VAT/sales tax percent (0 for an export of services / reverse charge). */
  vatPct: number;
  paymentTermsDays: number;
  creditLimit: number;
}

export interface OrderLine { kind: LineKind; description: string; qty: number; unitCost: number }
export interface PricedLine extends OrderLine { unitPrice: number; amountCents: number }

/**
 * Half-up rounding to cents (accounting rounding, not banker's). The value is first snapped to 1/10 000 of a cent so
 * binary floating-point noise (1.005 is stored as 1.00499999…) cannot turn a half cent into a round-down.
 */
export const cents = (v: number) => Math.sign(v) * Math.round(Math.round(Math.abs(v) * 1e6) / 1e4);
export const fromCents = (c: number) => c / 100;

/** Selling price of a line: labour at the customer rate; parts and services at cost plus the mark-up. */
export function priceLine(l: OrderLine, t: CustomerTerms): PricedLine {
  if (!(l.qty > 0)) throw new DomainError('LINE_QTY', 'Quantity must be more than 0', 422);
  if (l.unitCost < 0) throw new DomainError('LINE_COST', 'Cost cannot be negative', 422);
  const unitPrice = l.kind === 'LABOUR' ? t.labourRate : l.kind === 'PART' ? l.unitCost * (1 + t.partsMarkupPct / 100) : l.unitCost * (1 + t.serviceMarkupPct / 100);
  return { ...l, unitPrice: fromCents(cents(unitPrice)), amountCents: cents(l.qty * fromCents(cents(unitPrice))) };
}

export interface Totals { netCents: number; vatCents: number; totalCents: number; byKind: Record<LineKind, number> }

/** Net = sum of line amounts; VAT on the net (one rounding); total = net + VAT. */
export function totals(lines: PricedLine[], vatPct: number): Totals {
  const byKind: Record<LineKind, number> = { LABOUR: 0, PART: 0, SERVICE: 0 };
  for (const l of lines) byKind[l.kind] += l.amountCents;
  const netCents = lines.reduce((s, l) => s + l.amountCents, 0);
  const vatCents = cents(fromCents(netCents) * vatPct / 100);
  return { netCents, vatCents, totalCents: netCents + vatCents, byKind };
}

/** Customers approve the quote; invoicing more than 10 % above it needs their recorded approval of the overrun. */
export const OVERRUN_TOLERANCE = 0.10;
export function overrun(quoteNetCents: number, actualNetCents: number): { over: boolean; pct: number } {
  const pct = quoteNetCents > 0 ? (actualNetCents - quoteNetCents) / quoteNetCents : actualNetCents > 0 ? Infinity : 0;
  return { over: pct > OVERRUN_TOLERANCE, pct };
}

/** Approving an order commits credit: open receivables plus this quote must stay within the customer's limit. */
export function creditCheck(openReceivablesCents: number, quoteTotalCents: number, creditLimit: number): { ok: boolean; message: string } {
  const after = openReceivablesCents + quoteTotalCents;
  return after <= cents(creditLimit)
    ? { ok: true, message: `Within the credit limit (${fromCents(after).toFixed(2)} of ${creditLimit.toFixed(2)})` }
    : { ok: false, message: `Credit limit exceeded: ${fromCents(openReceivablesCents).toFixed(2)} open + ${fromCents(quoteTotalCents).toFixed(2)} this order > ${creditLimit.toFixed(2)}` };
}

const NEXT: Record<OrderStatus, OrderStatus[]> = {
  QUOTED: ['APPROVED', 'CANCELLED'], APPROVED: ['IN_WORK', 'CANCELLED'], IN_WORK: ['COMPLETED'], COMPLETED: ['INVOICED', 'IN_WORK'], INVOICED: [], CANCELLED: []
};
export function transition(from: OrderStatus, to: OrderStatus) {
  if (!NEXT[from].includes(to)) throw new DomainError('ORDER_STATUS', `An order that is ${from.toLowerCase()} cannot become ${to.toLowerCase()}`, 409);
  return to;
}
/** Work can be booked once the customer approved, until the order is invoiced. */
export function canBook(s: OrderStatus) {
  if (!['APPROVED', 'IN_WORK', 'COMPLETED'].includes(s)) throw new DomainError('ORDER_STATUS', `Work cannot be booked on an order that is ${s.toLowerCase()}`, 409);
}

/* ------------------------------------------------------------------ receivables */

export type AgeBucket = 'CURRENT' | 'D1_30' | 'D31_60' | 'D61_90' | 'D90_PLUS';
export const AGE_BUCKETS: AgeBucket[] = ['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'];

export function ageBucket(dueDate: string, today: string): AgeBucket {
  const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
  return days <= 0 ? 'CURRENT' : days <= 30 ? 'D1_30' : days <= 60 ? 'D31_60' : days <= 90 ? 'D61_90' : 'D90_PLUS';
}

export function ageing(invoices: { dueDate: string; openCents: number }[], today: string): Record<AgeBucket, number> {
  const out: Record<AgeBucket, number> = { CURRENT: 0, D1_30: 0, D31_60: 0, D61_90: 0, D90_PLUS: 0 };
  for (const i of invoices) if (i.openCents > 0) out[ageBucket(i.dueDate, today)] += i.openCents;
  return out;
}

export function dueDate(issued: string, termsDays: number): string {
  return new Date(Date.parse(`${issued}T00:00:00Z`) + termsDays * 86_400_000).toISOString().slice(0, 10);
}

/** A payment cannot exceed what is still open on the invoice. */
export function applyPayment(totalCents: number, paidCents: number, paymentCents: number): { paidCents: number; status: 'PARTIALLY_PAID' | 'PAID' } {
  if (!(paymentCents > 0)) throw new DomainError('PAYMENT', 'The payment must be more than 0', 422);
  if (paidCents + paymentCents > totalCents) throw new DomainError('OVERPAYMENT', `Only ${fromCents(totalCents - paidCents).toFixed(2)} is still open on this invoice`, 422);
  const paid = paidCents + paymentCents;
  return { paidCents: paid, status: paid === totalCents ? 'PAID' : 'PARTIALLY_PAID' };
}

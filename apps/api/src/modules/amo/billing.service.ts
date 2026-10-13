import { Body, Controller, Get, Inject, Injectable, Param, Post } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { date, integer, jsonb, bigint, numeric, pgSchema, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { BillingLineDto, BillingOverviewDto, CustomerDto, CustomerOrderDto, InvoiceDto, OrderStatusDto } from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import {
  ageing, applyPayment, BASE_CURRENCY, canBook, creditCheck, dueDate, overrun, priceLine, totals, transition,
  type CustomerTerms, type LineKind, type OrderLine, type OrderStatus, type PricedLine
} from '@aeroos/mro-domain';
import { actorOf, CurrentPrincipal, type Principal } from '../../platform/auth/principal';
import { AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { OutboxService } from '../../platform/events/outbox';
import { ZodPipe } from '../../platform/http/http';
import { fxRates } from './supply.service';

const amo = pgSchema('amo');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const cents = (name: string) => bigint(name, { mode: 'number' });

export const customers = amo.table('customers', {
  id: text('id').primaryKey(), operatorId: text('operator_id').notNull(), name: text('name').notNull(), country: text('country').notNull(), currency: text('currency').notNull(),
  labourRate: numeric('labour_rate', { precision: 10, scale: 2 }).notNull(), partsMarkupPct: numeric('parts_markup_pct', { precision: 5, scale: 2 }).notNull(),
  serviceMarkupPct: numeric('service_markup_pct', { precision: 5, scale: 2 }).notNull(), vatPct: numeric('vat_pct', { precision: 5, scale: 2 }).notNull(),
  paymentTermsDays: integer('payment_terms_days').notNull(), creditLimit: money('credit_limit').notNull(), createdBy: text('created_by').notNull(), createdAt: ts('created_at').notNull().defaultNow()
});
export const customerOrders = amo.table('customer_orders', {
  id: text('id').primaryKey(), operatorId: text('operator_id').notNull(), customerId: text('customer_id').notNull(), aircraftReg: text('aircraft_reg').notNull(),
  aircraftType: text('aircraft_type').notNull(), title: text('title').notNull(), status: text('status').notNull(), currency: text('currency').notNull(),
  quoteLines: jsonb('quote_lines').$type<OrderLine[]>().notNull(), quoteNetCents: cents('quote_net_cents').notNull(), customerRef: text('customer_ref'),
  approvedAt: ts('approved_at'), overrunRef: text('overrun_ref'), costCentre: text('cost_centre').notNull(), createdBy: text('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(), version: integer('version').notNull().default(1)
});
export const orderLines = amo.table('order_lines', {
  id: serial('id').primaryKey(), orderId: text('order_id').notNull(), kind: text('kind').notNull(), description: text('description').notNull(),
  qty: numeric('qty', { precision: 10, scale: 2 }).notNull(), unitCost: numeric('unit_cost', { precision: 12, scale: 2 }).notNull(),
  workDate: date('work_date', { mode: 'string' }).notNull(), bookedBy: text('booked_by').notNull(), bookedAt: ts('booked_at').notNull().defaultNow()
});
export const invoices = amo.table('invoices', {
  id: text('id').primaryKey(), operatorId: text('operator_id').notNull(), kind: text('kind').notNull(), credits: text('credits'), orderId: text('order_id').notNull(),
  customerId: text('customer_id').notNull(), issuedOn: date('issued_on', { mode: 'string' }).notNull(), dueOn: date('due_on', { mode: 'string' }).notNull(),
  currency: text('currency').notNull(), basePerUnit: numeric('base_per_unit', { precision: 14, scale: 6 }).notNull(), lines: jsonb('lines').$type<PricedLine[]>().notNull(),
  labourCents: cents('labour_cents').notNull(), partsCents: cents('parts_cents').notNull(), serviceCents: cents('service_cents').notNull(),
  netCents: cents('net_cents').notNull(), vatCents: cents('vat_cents').notNull(), totalCents: cents('total_cents').notNull(), paidCents: cents('paid_cents').notNull().default(0),
  status: text('status').notNull(), reason: text('reason'), issuedBy: text('issued_by').notNull(), issuedAt: ts('issued_at').notNull().defaultNow(), version: integer('version').notNull().default(1)
});
export const payments = amo.table('payments', {
  id: serial('id').primaryKey(), invoiceId: text('invoice_id').notNull(), amountCents: cents('amount_cents').notNull(), reference: text('reference').notNull(),
  receivedOn: date('received_on', { mode: 'string' }).notNull(), recordedBy: text('recorded_by').notNull(), recordedAt: ts('recorded_at').notNull().defaultNow()
});

type CustomerRow = typeof customers.$inferSelect;
type OrderRow = typeof customerOrders.$inferSelect;
type InvoiceRow = typeof invoices.$inferSelect;
const CHAIN = 'amo';
const today = () => new Date().toISOString().slice(0, 10);
const termsOf = (c: CustomerRow): CustomerTerms => ({
  labourRate: Number(c.labourRate), partsMarkupPct: Number(c.partsMarkupPct), serviceMarkupPct: Number(c.serviceMarkupPct), vatPct: Number(c.vatPct),
  paymentTermsDays: c.paymentTermsDays, creditLimit: Number(c.creditLimit)
});
const lineDto = (l: PricedLine): BillingLineDto => ({ kind: l.kind, description: l.description, qty: l.qty, unitCost: l.unitCost, unitPrice: l.unitPrice, amountCents: l.amountCents });
const daysBetween = (a: string, b: string) => Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const openOf = (i: InvoiceRow) => (i.kind === 'INVOICE' && i.status !== 'CREDITED' ? i.totalCents - i.paidCents : 0);

/**
 * Third-party maintenance billing (ADR-0025): customers with their commercial terms, orders quoted → approved by the
 * customer (credit limit) → worked → completed → invoiced (quote overrun > 10 % needs the customer's approval),
 * payments and credit notes. Invoices, credit notes and payments are published for the general ledger.
 */
@Injectable()
export class BillingService {
  constructor(
    @Inject(DB_TOKEN.amo) private readonly db: ModuleDb,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService
  ) {}

  private res(operatorId: string, id = '*') { return { kind: 'billing' as const, id, attr: { operatorId } }; }
  /** Next number of an invoice series in the calling transaction (gap-free: rolled back with it). */
  private async invoiceNumber(operatorId: string, series: 'INV' | 'CN', issued: string) {
    const year = Number(issued.slice(0, 4));
    const r = await this.db.db.execute<{ n: number }>(sql`
      insert into amo.invoice_numbers (operator_id, series, year, last) values (${operatorId}, ${series}, ${year}, 1)
      on conflict (operator_id, series, year) do update set last = amo.invoice_numbers.last + 1
      returning last as n`);
    // each issuer has its own continuous series; the issuer is part of the number (invoice ids are global keys)
    return `${series}-${operatorId}-${year}-${String(r.rows[0].n).padStart(4, '0')}`;
  }
  private async seq(name: string) {
    const r = await this.db.db.execute<{ n: string }>(sql.raw(`select nextval('amo.${name}')::text as n`));
    return r.rows[0].n;
  }
  private async rate(currency: string) {
    const [r] = await this.db.db.select().from(fxRates).where(eq(fxRates.currency, currency));
    if (!r) throw new DomainError('FX_RATE', `No reference exchange rate for ${currency}`, 422);
    return Number(r.basePerUnit);
  }
  private async customer(operatorId: string, id: string) {
    const [c] = await this.db.db.select().from(customers).where(and(eq(customers.id, id), eq(customers.operatorId, operatorId)));
    if (!c) throw new DomainError('CUSTOMER_NOT_FOUND', `Customer ${id} not found`, 404);
    return c;
  }
  private async orderRow(operatorId: string, id: string, lock = false) {
    const q = this.db.db.select().from(customerOrders).where(and(eq(customerOrders.id, id), eq(customerOrders.operatorId, operatorId)));
    const [o] = lock ? await q.for('update') : await q;
    if (!o) throw new DomainError('ORDER_NOT_FOUND', `Order ${id} not found`, 404);
    return o;
  }
  private async openReceivablesCents(customerId: string) {
    const rows = await this.db.db.select().from(invoices).where(eq(invoices.customerId, customerId));
    return rows.reduce((s, i) => s + openOf(i), 0);
  }

  private invoiceDto(i: InvoiceRow, names: Map<string, string>, pays: (typeof payments.$inferSelect)[]): InvoiceDto {
    const overdue = openOf(i) > 0 ? Math.max(0, daysBetween(i.dueOn, today())) : 0;
    return {
      id: i.id, kind: i.kind as InvoiceDto['kind'], credits: i.credits, orderId: i.orderId, customerId: i.customerId, customerName: names.get(i.customerId) ?? i.customerId,
      issuedOn: i.issuedOn, dueOn: i.dueOn, currency: i.currency, lines: i.lines.map(lineDto), netCents: i.netCents, vatCents: i.vatCents, totalCents: i.totalCents,
      paidCents: i.paidCents, status: i.status as InvoiceDto['status'], overdueDays: overdue, reason: i.reason,
      payments: pays.filter(p => p.invoiceId === i.id).map(p => ({ amountCents: p.amountCents, reference: p.reference, receivedOn: p.receivedOn, recordedBy: p.recordedBy })),
      version: i.version
    };
  }

  private orderDto(o: OrderRow, c: CustomerRow, lines: (typeof orderLines.$inferSelect)[], invs: InvoiceDto[]): CustomerOrderDto {
    const t = termsOf(c);
    const quoteLines = o.quoteLines.map(l => priceLine(l, t));
    const q = totals(quoteLines, t.vatPct);
    const actual = lines.map(l => ({ ...priceLine({ kind: l.kind as LineKind, description: l.description, qty: Number(l.qty), unitCost: Number(l.unitCost) }, t), id: l.id, workDate: l.workDate, bookedBy: l.bookedBy }));
    const a = totals(actual, t.vatPct);
    const ov = overrun(o.quoteNetCents, a.netCents);
    return {
      id: o.id, customerId: c.id, customerName: c.name, aircraftReg: o.aircraftReg, aircraftType: o.aircraftType, title: o.title, status: o.status as OrderStatusDto, currency: o.currency,
      quote: { lines: quoteLines.map(lineDto), netCents: q.netCents, vatCents: q.vatCents, totalCents: q.totalCents },
      actual: { lines: actual.map(l => ({ ...lineDto(l), id: l.id, workDate: l.workDate, bookedBy: l.bookedBy })), netCents: a.netCents, vatCents: a.vatCents, totalCents: a.totalCents },
      overrunPct: Number.isFinite(ov.pct) ? Math.round(ov.pct * 1000) / 10 : 100, overrunNeedsApproval: ov.over && !o.overrunRef,
      customerRef: o.customerRef, overrunRef: o.overrunRef, costCentre: o.costCentre, invoices: invs.filter(i => i.orderId === o.id),
      createdBy: o.createdBy, createdAt: o.createdAt.toISOString(), version: o.version
    };
  }

  async overview(p: Principal): Promise<BillingOverviewDto> {
    await this.authz.check(p, this.res(p.operatorId), 'read');
    const [cs, os, invs, perms] = await Promise.all([
      this.db.db.select().from(customers).where(eq(customers.operatorId, p.operatorId)).orderBy(asc(customers.name)),
      this.db.db.select().from(customerOrders).where(eq(customerOrders.operatorId, p.operatorId)).orderBy(desc(customerOrders.createdAt)),
      this.db.db.select().from(invoices).where(eq(invoices.operatorId, p.operatorId)).orderBy(desc(invoices.issuedAt)),
      this.authz.decide(p, this.res(p.operatorId), ['manage_customers', 'quote', 'book', 'invoice'])
    ]);
    const [ls, pays] = await Promise.all([
      os.length ? this.db.db.select().from(orderLines).where(inArray(orderLines.orderId, os.map(o => o.id))).orderBy(asc(orderLines.workDate), asc(orderLines.id)) : [],
      invs.length ? this.db.db.select().from(payments).where(inArray(payments.invoiceId, invs.map(i => i.id))).orderBy(asc(payments.receivedOn)) : []
    ]);
    const names = new Map<string, string>(cs.map(c => [c.id, c.name] as [string, string]));
    const invDtos = invs.map(i => this.invoiceDto(i, names, pays));
    // receivables ageing in base currency (each invoice at its own rate)
    const rate = new Map<string, number>(invs.map(i => [i.id, Number(i.basePerUnit)] as [string, number]));
    const age = ageing(invs.map(i => ({ dueDate: i.dueOn, openCents: Math.round(openOf(i) * (rate.get(i.id) ?? 1)) })), today());
    return {
      customers: cs.map((c): CustomerDto => {
        const mine = invs.filter(i => i.customerId === c.id);
        return {
          id: c.id, name: c.name, country: c.country, currency: c.currency, labourRate: Number(c.labourRate), partsMarkupPct: Number(c.partsMarkupPct), serviceMarkupPct: Number(c.serviceMarkupPct),
          vatPct: Number(c.vatPct), paymentTermsDays: c.paymentTermsDays, creditLimit: Number(c.creditLimit),
          openCents: mine.reduce((s, i) => s + openOf(i), 0), overdueCents: mine.filter(i => i.dueOn < today()).reduce((s, i) => s + openOf(i), 0)
        };
      }),
      orders: os.map(o => this.orderDto(o, cs.find(c => c.id === o.customerId)!, ls.filter(l => l.orderId === o.id), invDtos)),
      invoices: invDtos, ageing: age, baseCurrency: BASE_CURRENCY,
      permissions: { manageCustomers: perms.manage_customers, quote: perms.quote, book: perms.book, invoice: perms.invoice }
    };
  }

  async order(p: Principal, id: string): Promise<CustomerOrderDto> {
    await this.authz.check(p, this.res(p.operatorId, id), 'read');
    const o = await this.orderRow(p.operatorId, id);
    const c = await this.customer(p.operatorId, o.customerId);
    const [ls, invs] = await Promise.all([
      this.db.db.select().from(orderLines).where(eq(orderLines.orderId, id)).orderBy(asc(orderLines.workDate), asc(orderLines.id)),
      this.db.db.select().from(invoices).where(eq(invoices.orderId, id)).orderBy(asc(invoices.issuedAt))
    ]);
    const pays = invs.length ? await this.db.db.select().from(payments).where(inArray(payments.invoiceId, invs.map(i => i.id))) : [];
    return this.orderDto(o, c, ls, invs.map(i => this.invoiceDto(i, new Map([[c.id, c.name]]), pays)));
  }

  async addCustomer(p: Principal, b: { name: string; country: string; currency: string; labourRate: number; partsMarkupPct: number; serviceMarkupPct: number; vatPct: number; paymentTermsDays: number; creditLimit: number }) {
    await this.authz.check(p, this.res(p.operatorId), 'manage_customers');
    await this.rate(b.currency);
    await this.db.transaction(async () => {
      const [dup] = await this.db.db.select({ id: customers.id }).from(customers).where(and(eq(customers.operatorId, p.operatorId), eq(customers.name, b.name.trim())));
      if (dup) throw new DomainError('CUSTOMER_EXISTS', `${b.name} is already a customer (${dup.id})`, 409);
      const id = `CU-${(await this.seq('customer_seq')).padStart(4, '0')}`;
      await this.db.db.insert(customers).values({ id, operatorId: p.operatorId, name: b.name.trim(), country: b.country, currency: b.currency, labourRate: String(b.labourRate),
        partsMarkupPct: String(b.partsMarkupPct), serviceMarkupPct: String(b.serviceMarkupPct), vatPct: String(b.vatPct), paymentTermsDays: b.paymentTermsDays, creditLimit: String(b.creditLimit), createdBy: actorOf(p) });
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'customer.created', entityType: 'customer', entityId: id, data: b });
    });
    return this.overview(p);
  }

  async quote(p: Principal, b: { customerId: string; aircraftReg: string; aircraftType: string; title: string; lines: OrderLine[]; costCentre?: string }) {
    await this.authz.check(p, this.res(p.operatorId), 'quote');
    const c = await this.customer(p.operatorId, b.customerId);
    const priced = b.lines.map(l => priceLine(l, termsOf(c)));
    const id = await this.db.transaction(async () => {
      const id = `CO-${(await this.seq('customer_order_seq')).padStart(4, '0')}`;
      const net = totals(priced, Number(c.vatPct)).netCents;
      await this.db.db.insert(customerOrders).values({ id, operatorId: p.operatorId, customerId: c.id, aircraftReg: b.aircraftReg.toUpperCase(), aircraftType: b.aircraftType, title: b.title.trim(),
        status: 'QUOTED', currency: c.currency, quoteLines: b.lines, quoteNetCents: net, costCentre: b.costCentre ?? '', createdBy: actorOf(p) });
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'order.quoted', entityType: 'customer_order', entityId: id, data: { customer: c.id, netCents: net, currency: c.currency } });
      return id;
    });
    return this.order(p, id);
  }

  /** The customer accepted (their purchase order): checked against the credit limit. */
  async approve(p: Principal, id: string, b: { customerRef: string; version: number }) {
    await this.authz.check(p, this.res(p.operatorId, id), 'quote');
    await this.db.transaction(async () => {
      const o = await this.orderRow(p.operatorId, id, true);
      if (o.version !== b.version) throw new DomainError('CHANGED', `${id} changed meanwhile — reload`, 409);
      transition(o.status as OrderStatus, 'APPROVED');
      const c = await this.customer(p.operatorId, o.customerId);
      // serialise credit decisions per customer
      await this.db.db.execute(sql`select pg_advisory_xact_lock(hashtext(${'credit:' + c.id}))`);
      const quoteTotal = totals(o.quoteLines.map(l => priceLine(l, termsOf(c))), Number(c.vatPct)).totalCents;
      const committed = await this.db.db.select().from(customerOrders).where(and(eq(customerOrders.customerId, c.id), inArray(customerOrders.status, ['APPROVED', 'IN_WORK', 'COMPLETED'])));
      const committedCents = committed.reduce((s, x) => s + totals(x.quoteLines.map(l => priceLine(l, termsOf(c))), Number(c.vatPct)).totalCents, 0);
      const chk = creditCheck((await this.openReceivablesCents(c.id)) + committedCents, quoteTotal, Number(c.creditLimit));
      if (!chk.ok) throw new DomainError('CREDIT_LIMIT', `${chk.message} (${c.currency}, including approved orders not yet invoiced) — collect payment or raise the limit first`, 422);
      await this.db.db.update(customerOrders).set({ status: 'APPROVED', customerRef: b.customerRef.trim(), approvedAt: new Date(), version: o.version + 1 }).where(eq(customerOrders.id, id));
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'order.approved', entityType: 'customer_order', entityId: id, data: { customerRef: b.customerRef, credit: chk.message } });
    });
    return this.order(p, id);
  }

  async setStatus(p: Principal, id: string, to: 'CANCELLED' | 'COMPLETED' | 'IN_WORK', version: number) {
    await this.authz.check(p, this.res(p.operatorId, id), to === 'CANCELLED' ? 'quote' : 'book');
    await this.db.transaction(async () => {
      const o = await this.orderRow(p.operatorId, id, true);
      if (o.version !== version) throw new DomainError('CHANGED', `${id} changed meanwhile — reload`, 409);
      transition(o.status as OrderStatus, to);
      if (to === 'COMPLETED') {
        const [n] = await this.db.db.select({ n: sql<string>`count(*)::text` }).from(orderLines).where(eq(orderLines.orderId, id));
        if (Number(n.n) === 0) throw new DomainError('NO_WORK', 'Nothing has been booked on this order', 422);
      }
      await this.db.db.update(customerOrders).set({ status: to, version: o.version + 1 }).where(eq(customerOrders.id, id));
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: `order.${to.toLowerCase()}`, entityType: 'customer_order', entityId: id, data: {} });
    });
    return this.order(p, id);
  }

  async book(p: Principal, id: string, b: { kind: LineKind; description: string; qty: number; unitCost: number; workDate: string }) {
    await this.authz.check(p, this.res(p.operatorId, id), 'book');
    if (b.workDate > today()) throw new DomainError('WORK_DATE', 'Work cannot be booked in the future', 422);
    await this.db.transaction(async () => {
      const o = await this.orderRow(p.operatorId, id, true);
      canBook(o.status as OrderStatus);
      const c = await this.customer(p.operatorId, o.customerId);
      priceLine({ kind: b.kind, description: b.description, qty: b.qty, unitCost: b.kind === 'LABOUR' ? 0 : b.unitCost }, termsOf(c));
      await this.db.db.insert(orderLines).values({ orderId: id, kind: b.kind, description: b.description.trim(), qty: String(b.qty), unitCost: String(b.kind === 'LABOUR' ? 0 : b.unitCost), workDate: b.workDate, bookedBy: actorOf(p) });
      await this.db.db.update(customerOrders).set({ status: o.status === 'APPROVED' ? 'IN_WORK' : o.status, version: o.version + 1 }).where(eq(customerOrders.id, id));
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'order.work_booked', entityType: 'customer_order', entityId: id, data: b });
    });
    return this.order(p, id);
  }

  /** Invoice the booked work of a completed order; above the quote by more than 10 % the customer's approval reference is required. */
  async invoice(p: Principal, id: string, b: { overrunRef?: string; version: number }) {
    await this.authz.check(p, this.res(p.operatorId, id), 'invoice');
    await this.db.transaction(async () => {
      const o = await this.orderRow(p.operatorId, id, true);
      if (o.version !== b.version) throw new DomainError('CHANGED', `${id} changed meanwhile — reload`, 409);
      transition(o.status as OrderStatus, 'INVOICED');
      const c = await this.customer(p.operatorId, o.customerId);
      const t = termsOf(c);
      const ls = await this.db.db.select().from(orderLines).where(eq(orderLines.orderId, id)).orderBy(asc(orderLines.workDate), asc(orderLines.id));
      const priced = ls.map(l => priceLine({ kind: l.kind as LineKind, description: l.description, qty: Number(l.qty), unitCost: Number(l.unitCost) }, t));
      const tot = totals(priced, t.vatPct);
      const ov = overrun(o.quoteNetCents, tot.netCents);
      const overrunRef = b.overrunRef?.trim() || o.overrunRef;
      if (ov.over && !overrunRef) {
        throw new DomainError('QUOTE_OVERRUN', `${(ov.pct * 100).toFixed(1)} % above the quote — record the customer's approval of the overrun (their reference) to invoice`, 422);
      }
      const rate = await this.rate(o.currency);
      const issued = today();
      const invId = await this.invoiceNumber(p.operatorId, 'INV', issued);
      await this.db.db.insert(invoices).values({
        id: invId, operatorId: p.operatorId, kind: 'INVOICE', orderId: id, customerId: c.id, issuedOn: issued, dueOn: dueDate(issued, t.paymentTermsDays), currency: o.currency,
        basePerUnit: String(rate), lines: priced, labourCents: tot.byKind.LABOUR, partsCents: tot.byKind.PART, serviceCents: tot.byKind.SERVICE,
        netCents: tot.netCents, vatCents: tot.vatCents, totalCents: tot.totalCents, status: 'ISSUED', issuedBy: actorOf(p)
      });
      await this.db.db.update(customerOrders).set({ status: 'INVOICED', overrunRef: ov.over ? overrunRef : o.overrunRef, version: o.version + 1 }).where(eq(customerOrders.id, id));
      await this.outbox.add(this.db, { type: 'amo.invoice.issued', data: {
        invoiceId: invId, kind: 'INVOICE', credits: null, orderId: id, customerId: c.id, customerName: c.name, issuedOn: issued, currency: o.currency, basePerUnit: rate,
        labourCents: tot.byKind.LABOUR, partsCents: tot.byKind.PART, serviceCents: tot.byKind.SERVICE, vatCents: tot.vatCents, totalCents: tot.totalCents, costCentre: o.costCentre
      } }, { operatorId: p.operatorId, actor: actorOf(p) });
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'invoice.issued', entityType: 'invoice', entityId: invId,
        data: { order: id, totalCents: tot.totalCents, currency: o.currency, overrunPct: Math.round(ov.pct * 1000) / 10, overrunRef: ov.over ? overrunRef : null } });
    });
    return this.order(p, id);
  }

  async pay(p: Principal, invoiceId: string, b: { amount: number; reference: string; receivedOn: string; version: number }) {
    await this.authz.check(p, this.res(p.operatorId, invoiceId), 'invoice');
    if (b.receivedOn > today()) throw new DomainError('DATE', 'The payment date is in the future', 422);
    const orderId = await this.db.transaction(async () => {
      const [i] = await this.db.db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.operatorId, p.operatorId))).for('update');
      if (!i) throw new DomainError('INVOICE_NOT_FOUND', `Invoice ${invoiceId} not found`, 404);
      if (i.version !== b.version) throw new DomainError('CHANGED', `${invoiceId} changed meanwhile — reload`, 409);
      if (i.kind !== 'INVOICE' || i.status === 'CREDITED') throw new DomainError('NOT_PAYABLE', `${invoiceId} is ${i.kind === 'INVOICE' ? 'credited' : 'a credit note'}`, 409);
      const amountCents = Math.round(b.amount * 100);
      const next = applyPayment(i.totalCents, i.paidCents, amountCents);
      const [dup] = await this.db.db.select({ id: payments.id }).from(payments).where(and(eq(payments.invoiceId, invoiceId), eq(payments.reference, b.reference.trim())));
      if (dup) throw new DomainError('DUPLICATE_PAYMENT', `Payment ${b.reference} is already recorded on ${invoiceId}`, 409);
      await this.db.db.insert(payments).values({ invoiceId, amountCents, reference: b.reference.trim(), receivedOn: b.receivedOn, recordedBy: actorOf(p) });
      await this.db.db.update(invoices).set({ paidCents: next.paidCents, status: next.status, version: i.version + 1 }).where(eq(invoices.id, invoiceId));
      const [c] = await this.db.db.select().from(customers).where(eq(customers.id, i.customerId));
      await this.outbox.add(this.db, { type: 'amo.payment.received', data: {
        invoiceId, customerName: c?.name ?? i.customerId, reference: b.reference.trim(), receivedOn: b.receivedOn, amountCents, currency: i.currency, basePerUnit: Number(i.basePerUnit),
        settles: next.status === 'PAID'
      } }, { operatorId: p.operatorId, actor: actorOf(p) });
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'invoice.payment', entityType: 'invoice', entityId: invoiceId, data: { amountCents, reference: b.reference, status: next.status } });
      return i.orderId;
    });
    return this.order(p, orderId);
  }

  /** Credit the whole of an unpaid invoice (e.g. wrong lines): the order goes back to completed for a corrected invoice. */
  async credit(p: Principal, invoiceId: string, b: { reason: string; version: number }) {
    await this.authz.check(p, this.res(p.operatorId, invoiceId), 'invoice');
    const orderId = await this.db.transaction(async () => {
      const [i] = await this.db.db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.operatorId, p.operatorId))).for('update');
      if (!i) throw new DomainError('INVOICE_NOT_FOUND', `Invoice ${invoiceId} not found`, 404);
      if (i.version !== b.version) throw new DomainError('CHANGED', `${invoiceId} changed meanwhile — reload`, 409);
      if (i.kind !== 'INVOICE' || i.status === 'CREDITED') throw new DomainError('NOT_CREDITABLE', `${invoiceId} cannot be credited`, 409);
      if (i.paidCents > 0) throw new DomainError('PAID', `${invoiceId} has payments recorded — refund them in the ERP first`, 422);
      const o = await this.orderRow(p.operatorId, i.orderId, true);
      const [c] = await this.db.db.select().from(customers).where(eq(customers.id, i.customerId));
      const issued = today();
      const cnId = await this.invoiceNumber(p.operatorId, 'CN', issued);
      await this.db.db.insert(invoices).values({ ...i, id: cnId, kind: 'CREDIT_NOTE', credits: i.id, issuedOn: issued, dueOn: issued, paidCents: 0, status: 'CREDITED', reason: b.reason.trim(), issuedBy: actorOf(p), issuedAt: new Date(), version: 1 });
      await this.db.db.update(invoices).set({ status: 'CREDITED', reason: b.reason.trim(), version: i.version + 1 }).where(eq(invoices.id, invoiceId));
      // a corrected invoice needs a fresh customer approval for any overrun (the old one covered the old figure)
      await this.db.db.update(customerOrders).set({ status: 'COMPLETED', overrunRef: null, version: o.version + 1 }).where(eq(customerOrders.id, o.id));
      await this.outbox.add(this.db, { type: 'amo.invoice.issued', data: {
        invoiceId: cnId, kind: 'CREDIT_NOTE', credits: i.id, orderId: o.id, customerId: i.customerId, customerName: c?.name ?? i.customerId, issuedOn: issued, currency: i.currency,
        basePerUnit: Number(i.basePerUnit), labourCents: i.labourCents, partsCents: i.partsCents, serviceCents: i.serviceCents, vatCents: i.vatCents, totalCents: i.totalCents, costCentre: o.costCentre
      } }, { operatorId: p.operatorId, actor: actorOf(p) });
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'invoice.credited', entityType: 'invoice', entityId: invoiceId, data: { creditNote: cnId, reason: b.reason } });
      return o.id;
    });
    return this.order(p, orderId);
  }

  /** For the executive dashboard: open orders, receivables (base currency) and overdue part. */
  async kpis(operatorId: string) {
    const [os, invs] = await Promise.all([
      this.db.db.select({ status: customerOrders.status }).from(customerOrders).where(eq(customerOrders.operatorId, operatorId)),
      this.db.db.select().from(invoices).where(eq(invoices.operatorId, operatorId))
    ]);
    const base = (i: InvoiceRow) => Math.round(openOf(i) * Number(i.basePerUnit));
    return {
      openOrders: os.filter(o => ['QUOTED', 'APPROVED', 'IN_WORK', 'COMPLETED'].includes(o.status)).length,
      toInvoice: os.filter(o => o.status === 'COMPLETED').length,
      receivablesCents: invs.reduce((s, i) => s + base(i), 0),
      overdueCents: invs.filter(i => i.dueOn < today()).reduce((s, i) => s + base(i), 0)
    };
  }
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ver = z.number().int().min(1);
const lineSchema = z.object({ kind: z.enum(['LABOUR', 'PART', 'SERVICE']), description: z.string().trim().min(2).max(200), qty: z.number().min(0.01).max(10000).multipleOf(0.01), unitCost: z.number().min(0).max(10_000_000) });
const customerSchema = z.object({
  name: z.string().trim().min(2).max(120), country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/), currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  labourRate: z.number().positive().max(100000), partsMarkupPct: z.number().min(0).max(200), serviceMarkupPct: z.number().min(0).max(200), vatPct: z.number().min(0).max(50),
  paymentTermsDays: z.number().int().min(0).max(180), creditLimit: z.number().min(0).max(1e10)
});
const quoteSchema = z.object({
  customerId: z.string().min(3).max(20), aircraftReg: z.string().trim().min(3).max(10), aircraftType: z.string().trim().min(2).max(40), title: z.string().trim().min(5).max(200),
  lines: z.array(lineSchema).min(1).max(50),
  // optional: an MRO-sales cost centre of the operator; empty → the operator's default MRO-sales centre (resolved by the ledger)
  costCentre: z.string().trim().max(20).optional()
});
const approveSchema = z.object({ customerRef: z.string().trim().min(2).max(60), version: ver });
const statusSchema = z.object({ to: z.enum(['CANCELLED', 'COMPLETED', 'IN_WORK']), version: ver });
const bookSchema = lineSchema.extend({ workDate: day });
const invoiceSchema = z.object({ overrunRef: z.string().trim().max(60).optional(), version: ver });
const paySchema = z.object({ amount: z.number().positive().max(1e10), reference: z.string().trim().min(2).max(60), receivedOn: day, version: ver });
const creditSchema = z.object({ reason: z.string().trim().min(5).max(500), version: ver });

@Controller('amo/billing')
export class BillingController {
  constructor(private readonly b: BillingService) {}
  @Get() overview(@CurrentPrincipal() p: Principal) { return this.b.overview(p); }
  @Post('customers') addCustomer(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(customerSchema)) x: z.infer<typeof customerSchema>) { return this.b.addCustomer(p, x); }
  @Post('orders') quote(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(quoteSchema)) x: z.infer<typeof quoteSchema>) { return this.b.quote(p, x); }
  @Get('orders/:id') order(@CurrentPrincipal() p: Principal, @Param('id') id: string) { return this.b.order(p, id); }
  @Post('orders/:id/approve') approve(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(approveSchema)) x: z.infer<typeof approveSchema>) { return this.b.approve(p, id, x); }
  @Post('orders/:id/status') status(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(statusSchema)) x: z.infer<typeof statusSchema>) { return this.b.setStatus(p, id, x.to, x.version); }
  @Post('orders/:id/lines') book(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(bookSchema)) x: z.infer<typeof bookSchema>) { return this.b.book(p, id, x); }
  @Post('orders/:id/invoice') invoice(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(invoiceSchema)) x: z.infer<typeof invoiceSchema>) { return this.b.invoice(p, id, x); }
  @Post('invoices/:id/payments') pay(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(paySchema)) x: z.infer<typeof paySchema>) { return this.b.pay(p, id, x); }
  @Post('invoices/:id/credit') credit(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(creditSchema)) x: z.infer<typeof creditSchema>) { return this.b.credit(p, id, x); }
}

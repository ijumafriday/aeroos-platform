import { BadRequestException, Body, Controller, Get, Inject, Injectable, Param, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { boolean, date, integer, numeric, pgSchema, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type {
  EventEnvelope, ExchangeDto, PbhContractDto, PbhStatementDto, PurchaseOrderDto, QuoteDto, ReceiptDto, RequisitionDto, VendorDto, WarrantyClaimDto
} from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import {
  approvePo, coreOverdue, decideClaim, newPoStatus, pbhStatement, poTotal, receiveAgainstPo, requireApprovedVendor, underWarranty,
  type ClaimStatus, type Condition, type PoStatus, type PurchaseOrder, type Vendor
} from '@aeroos/mro-domain';
import { actorOf, CurrentPrincipal, type Principal } from '../../platform/auth/principal';
import { AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { InboxService, OutboxService } from '../../platform/events/outbox';
import { ZodPipe } from '../../platform/http/http';
import { NotificationsService } from '../../platform/notifications/notifications.service';
import { parts, reservations, stock } from './stores.service';

const amo = pgSchema('amo');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

export const vendors = amo.table('vendors', {
  id: text('id').primaryKey(), operatorId: text('operator_id').notNull(), name: text('name').notNull(), approvalType: text('approval_type').notNull(),
  approvalRef: text('approval_ref').notNull(), approvedUntil: date('approved_until', { mode: 'string' }).notNull(), status: text('status').notNull(),
  warrantyMonths: integer('warranty_months').notNull(), country: text('country').notNull()
});
export const requisitions = amo.table('requisitions', {
  id: text('id').primaryKey(), operatorId: text('operator_id').notNull(), partNo: text('part_no').notNull(), qty: integer('qty').notNull(), station: text('station').notNull(),
  neededBy: date('needed_by', { mode: 'string' }).notNull(), taskCardId: text('task_card_id'), reason: text('reason').notNull(), status: text('status').notNull(),
  createdBy: text('created_by').notNull(), createdAt: ts('created_at').notNull().defaultNow()
});
export const quotes = amo.table('quotes', {
  id: serial('id').primaryKey(), requisitionId: text('requisition_id').notNull(), vendorId: text('vendor_id').notNull(), unitPrice: money('unit_price').notNull(),
  currency: text('currency').notNull(), leadDays: integer('lead_days').notNull(), condition: text('condition').notNull(), validUntil: date('valid_until', { mode: 'string' }).notNull(),
  createdBy: text('created_by').notNull(), createdAt: ts('created_at').notNull().defaultNow()
});
export const purchaseOrders = amo.table('purchase_orders', {
  id: text('id').primaryKey(), operatorId: text('operator_id').notNull(), requisitionId: text('requisition_id'), vendorId: text('vendor_id').notNull(), partNo: text('part_no').notNull(),
  qty: integer('qty').notNull(), receivedQty: integer('received_qty').notNull().default(0), unitPrice: money('unit_price').notNull(), currency: text('currency').notNull(),
  condition: text('condition').notNull(), import: boolean('import').notNull().default(false), station: text('station').notNull(), status: text('status').notNull(),
  createdBy: text('created_by').notNull(), createdAt: ts('created_at').notNull().defaultNow(), approvedBy: text('approved_by'), approvedAt: ts('approved_at'), version: integer('version').notNull()
});
export const receipts = amo.table('receipts', {
  id: text('id').primaryKey(), operatorId: text('operator_id').notNull(), poId: text('po_id'), vendorId: text('vendor_id').notNull(), partNo: text('part_no').notNull(),
  qty: integer('qty').notNull(), serials: text('serials').array().notNull().default([]), certificateType: text('certificate_type').notNull(), certificateRef: text('certificate_ref').notNull(),
  condition: text('condition').notNull(), station: text('station').notNull(), customsStatus: text('customs_status').notNull(), customsRef: text('customs_ref'),
  clearedBy: text('cleared_by'), clearedAt: ts('cleared_at'), receivedBy: text('received_by').notNull(), receivedAt: ts('received_at').notNull().defaultNow()
});
export const warrantyClaims = amo.table('warranty_claims', {
  id: text('id').primaryKey(), operatorId: text('operator_id').notNull(), receiptId: text('receipt_id').notNull(), vendorId: text('vendor_id').notNull(), partNo: text('part_no').notNull(),
  serial: text('serial'), failure: text('failure').notNull(), failedAt: date('failed_at', { mode: 'string' }).notNull(), claimedAmount: money('claimed_amount').notNull(),
  currency: text('currency').notNull(), status: text('status').notNull(), vendorRef: text('vendor_ref'), creditAmount: money('credit_amount'), decidedBy: text('decided_by'),
  decidedAt: ts('decided_at'), createdBy: text('created_by').notNull(), createdAt: ts('created_at').notNull().defaultNow(), version: integer('version').notNull()
});
export const exchanges = amo.table('exchanges', {
  id: text('id').primaryKey(), operatorId: text('operator_id').notNull(), vendorId: text('vendor_id').notNull(), partNo: text('part_no').notNull(), serialIn: text('serial_in').notNull(),
  serialOut: text('serial_out').notNull(), fee: money('fee').notNull(), currency: text('currency').notNull(), coreDue: date('core_due', { mode: 'string' }).notNull(),
  status: text('status').notNull(), coreReturnedAt: ts('core_returned_at'), coreRef: text('core_ref'), createdBy: text('created_by').notNull(), createdAt: ts('created_at').notNull().defaultNow()
});
export const pbhContracts = amo.table('pbh_contracts', {
  id: text('id').primaryKey(), operatorId: text('operator_id').notNull(), vendorId: text('vendor_id').notNull(), scope: text('scope').notNull(), tails: text('tails').array().notNull(),
  ratePerFh: numeric('rate_per_fh', { precision: 10, scale: 2 }).notNull(), currency: text('currency').notNull(),
  starts: date('starts', { mode: 'string' }).notNull(), ends: date('ends', { mode: 'string' }).notNull()
});
export const flightHours = amo.table('flight_hours', {
  flightId: text('flight_id').primaryKey(), operatorId: text('operator_id').notNull(), tail: text('tail').notNull(), arrivedAt: ts('arrived_at').notNull(), minutes: integer('minutes').notNull()
});

export const fxRates = amo.table('fx_rates', {
  currency: text('currency').primaryKey(), basePerUnit: numeric('base_per_unit', { precision: 14, scale: 6 }).notNull(), asOf: date('as_of', { mode: 'string' }).notNull()
});

const CHAIN = 'amo';
const today = () => new Date().toISOString().slice(0, 10);
const num = (s: string | null) => (s === null ? null : Number(s));
type VRow = typeof vendors.$inferSelect;
type PoRow = typeof purchaseOrders.$inferSelect;
type RcRow = typeof receipts.$inferSelect;

const vendorOf = (v: VRow): Vendor => ({ id: v.id, name: v.name, status: v.status as Vendor['status'], approvedUntil: v.approvedUntil, warrantyMonths: v.warrantyMonths });
const usable = (v: VRow) => { try { requireApprovedVendor(vendorOf(v), new Date()); return true; } catch { return false; } };
const poDomain = (r: PoRow): PurchaseOrder => ({
  id: r.id, partNo: r.partNo, qty: r.qty, receivedQty: r.receivedQty, unitPrice: Number(r.unitPrice), condition: r.condition as Condition, status: r.status as PoStatus,
  createdBy: r.createdBy, approvedBy: r.approvedBy, version: r.version
});

/**
 * Supply chain (ADR-0021): approved suppliers, requisitions with quotes, purchase orders (second-person approval
 * above the threshold), receiving against release certificates (145.A.42), the bonded store, warranty claims,
 * exchanges with core returns, and power-by-the-hour statements from flight hours projected from Ops events.
 * Receipts into stock fill task-card shortages at that station automatically.
 */
@Injectable()
export class SupplyService {
  constructor(
    @Inject(DB_TOKEN.amo) private readonly db: ModuleDb,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService
  ) {}

  private res(operatorId: string) {
    return { kind: 'procurement' as const, id: '*', attr: { operatorId } };
  }
  private async can(p: Principal, action: string) {
    await this.authz.check(p, this.res(p.operatorId), action);
  }
  private async seq(name: string, prefix: string, width = 4) {
    const r = await this.db.db.execute<{ n: string }>(sql.raw(`select nextval('amo.${name}')::text as n`));
    return `${prefix}-${r.rows[0].n.padStart(width, '0')}`;
  }
  /** Base-currency value of one unit of `currency`; unknown currencies are refused (finance adds the rate). */
  private async rate(currency: string): Promise<number> {
    const [r] = await this.db.db.select().from(fxRates).where(eq(fxRates.currency, currency));
    if (!r) throw new DomainError('FX_RATE', `No reference exchange rate for ${currency} — use USD/EUR/… or ask finance to add it`, 422);
    return Number(r.basePerUnit);
  }

  async rates(p: Principal) {
    await this.can(p, 'read');
    const rows = await this.db.db.select().from(fxRates).orderBy(asc(fxRates.currency));
    const stale = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    return rows.map(r => ({ currency: r.currency, basePerUnit: Number(r.basePerUnit), asOf: r.asOf, stale: r.asOf < stale }));
  }

  /** Reference rates are shared by every operator (they are market data, not operator data). */
  async setRate(p: Principal, b: { currency: string; basePerUnit: number }) {
    await this.can(p, 'manage_rates');
    if (b.currency === 'USD' && b.basePerUnit !== 1) throw new DomainError('BASE_CURRENCY', 'USD is the base currency (rate 1)', 422);
    await this.db.transaction(async () => {
      await this.db.db.insert(fxRates).values({ currency: b.currency, basePerUnit: String(b.basePerUnit), asOf: today() })
        .onConflictDoUpdate({ target: fxRates.currency, set: { basePerUnit: String(b.basePerUnit), asOf: today() } });
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'fx_rate.set', entityType: 'fx_rate', entityId: b.currency, data: b });
    });
    return this.rates(p);
  }

  private async vendorMap(operatorId: string) {
    return new Map<string, VRow>((await this.db.db.select().from(vendors).where(eq(vendors.operatorId, operatorId))).map(v => [v.id, v]));
  }
  private async vendor(operatorId: string, id: string): Promise<VRow> {
    const [v] = await this.db.db.select().from(vendors).where(and(eq(vendors.id, id), eq(vendors.operatorId, operatorId)));
    if (!v) throw new DomainError('NOT_FOUND', `No supplier ${id}`, 404);
    return v;
  }

  /* ------------------------------------------------------------------ approved supplier list */

  async vendors(p: Principal): Promise<VendorDto[]> {
    await this.can(p, 'read');
    return [...(await this.vendorMap(p.operatorId)).values()].sort((a, b) => a.name.localeCompare(b.name)).map(v => ({
      id: v.id, name: v.name, approvalType: v.approvalType as VendorDto['approvalType'], approvalRef: v.approvalRef, approvedUntil: v.approvedUntil,
      status: v.status as VendorDto['status'], warrantyMonths: v.warrantyMonths, country: v.country, usable: usable(v)
    }));
  }

  async addVendor(p: Principal, b: { name: string; approvalType: VendorDto['approvalType']; approvalRef: string; approvedUntil: string; warrantyMonths: number; country: string }) {
    await this.can(p, 'manage_vendors');
    await this.db.transaction(async () => {
      const id = await this.seq('vendor_seq', 'V', 3);
      await this.db.db.insert(vendors).values({ id, operatorId: p.operatorId, ...b, status: 'APPROVED' });
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'vendor.approved', entityType: 'vendor', entityId: id, data: b });
    });
    return this.vendors(p);
  }

  /** Suspend (e.g. after a bad audit or a suspected unapproved part) or re-approve with a new expiry. */
  async setVendor(p: Principal, id: string, b: { status: 'APPROVED' | 'SUSPENDED'; approvedUntil: string | null; reason: string }) {
    await this.can(p, 'manage_vendors');
    const v = await this.vendor(p.operatorId, id);
    await this.db.transaction(async () => {
      await this.db.db.update(vendors).set({ status: b.status, approvedUntil: b.approvedUntil ?? v.approvedUntil }).where(eq(vendors.id, id));
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: b.status === 'SUSPENDED' ? 'vendor.suspended' : 'vendor.reapproved',
        entityType: 'vendor', entityId: id, data: { ...b, previous: { status: v.status, approvedUntil: v.approvedUntil } } });
    });
    return this.vendors(p);
  }

  /* ------------------------------------------------------------------ requisitions and quotes (RFQ) */

  async requisitions(p: Principal, scope: 'open' | 'all'): Promise<RequisitionDto[]> {
    await this.can(p, 'read');
    const where = scope === 'open' ? and(eq(requisitions.operatorId, p.operatorId), eq(requisitions.status, 'OPEN')) : eq(requisitions.operatorId, p.operatorId);
    const rows = await this.db.db.select().from(requisitions).where(where).orderBy(desc(requisitions.createdAt)).limit(300);
    if (!rows.length) return [];
    const ids = rows.map(r => r.id);
    const [qs, vm, partRows, pos] = await Promise.all([
      this.db.db.select().from(quotes).where(inArray(quotes.requisitionId, ids)).orderBy(asc(quotes.unitPrice)),
      this.vendorMap(p.operatorId),
      this.db.db.select().from(parts).where(inArray(parts.partNo, [...new Set(rows.map(r => r.partNo))])),
      this.db.db.select({ id: purchaseOrders.id, requisitionId: purchaseOrders.requisitionId }).from(purchaseOrders).where(inArray(purchaseOrders.requisitionId, ids))
    ]);
    return rows.map(r => ({
      id: r.id, partNo: r.partNo, description: partRows.find(x => x.partNo === r.partNo)?.description ?? null, qty: r.qty, station: r.station, neededBy: r.neededBy,
      taskCardId: r.taskCardId, reason: r.reason, status: r.status as RequisitionDto['status'], createdBy: r.createdBy, createdAt: r.createdAt.toISOString(),
      poId: pos.find(x => x.requisitionId === r.id)?.id ?? null,
      quotes: qs.filter(q => q.requisitionId === r.id).map((q): QuoteDto => {
        const v = vm.get(q.vendorId);
        return { id: q.id, vendorId: q.vendorId, vendorName: v?.name ?? q.vendorId, unitPrice: Number(q.unitPrice), currency: q.currency, leadDays: q.leadDays,
          condition: q.condition as Condition, validUntil: q.validUntil, usable: !!v && usable(v) && q.validUntil >= today() };
      })
    }));
  }

  async requisition(p: Principal, b: { partNo: string; qty: number; station: string; neededBy: string; reason: string; taskCardId: string | null }) {
    await this.can(p, 'requisition');
    await this.db.transaction(async () => {
      const [part] = await this.db.db.select().from(parts).where(eq(parts.partNo, b.partNo));
      if (!part) throw new DomainError('PART_UNKNOWN', `${b.partNo} is not in the parts catalogue`, 404);
      if (b.taskCardId) {
        const tc = await this.db.db.execute<{ n: string }>(sql`select count(*)::text as n from amo.task_cards where id = ${b.taskCardId} and operator_id = ${p.operatorId}`);
        if (tc.rows[0].n === '0') throw new DomainError('NOT_FOUND', `No task card ${b.taskCardId}`, 404);
      }
      const id = await this.seq('requisition_seq', 'RQ');
      await this.db.db.insert(requisitions).values({ id, operatorId: p.operatorId, ...b, status: 'OPEN', createdBy: actorOf(p) });
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'requisition.raised', entityType: 'requisition', entityId: id, data: b });
    });
    return this.requisitions(p, 'open');
  }

  /** One requisition per task-card shortage that has none yet. */
  async requisitionShortages(p: Principal) {
    await this.can(p, 'requisition');
    const created: string[] = [];
    await this.db.transaction(async () => {
      // One run at a time per operator, so two clicks cannot raise duplicate requisitions.
      await this.db.db.execute(sql`select pg_advisory_xact_lock(hashtext(${`amo.shortages:${p.operatorId}`}))`);
      const short = await this.db.db.execute<{ task_card_id: string; part_no: string; qty: string; station: string }>(sql`
        select r.task_card_id, r.part_no, sum(r.qty)::text as qty, coalesce(s.station, 'ENGM') as station
        from amo.reservations r join amo.task_cards c on c.id = r.task_card_id
        left join amo.wp_slots s on s.wp_id = split_part(c.source_id, '/', 1)
        where r.status = 'SHORT' and c.operator_id = ${p.operatorId} and c.status <> 'CERTIFIED'
          and not exists (select 1 from amo.requisitions q where q.operator_id = ${p.operatorId} and q.task_card_id = r.task_card_id and q.part_no = r.part_no and q.status <> 'CANCELLED')
          and exists (select 1 from amo.parts pt where pt.part_no = r.part_no)
        group by r.task_card_id, r.part_no, s.station`);
      for (const s of short.rows) {
        const id = await this.seq('requisition_seq', 'RQ');
        const b = { partNo: s.part_no, qty: Number(s.qty), station: s.station, neededBy: today(), reason: `Shortage on task card ${s.task_card_id}`, taskCardId: s.task_card_id };
        await this.db.db.insert(requisitions).values({ id, operatorId: p.operatorId, ...b, status: 'OPEN', createdBy: actorOf(p) });
        await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'requisition.raised', entityType: 'requisition', entityId: id, data: b });
        created.push(id);
      }
    });
    return { created };
  }

  private async openRequisition(p: Principal, id: string, lock = false) {
    const q = this.db.db.select().from(requisitions).where(and(eq(requisitions.id, id), eq(requisitions.operatorId, p.operatorId)));
    const [r] = lock ? await q.for('update') : await q;
    if (!r) throw new DomainError('NOT_FOUND', `No requisition ${id}`, 404);
    if (r.status !== 'OPEN') throw new DomainError('REQUISITION_STATE', `${id} is ${r.status.toLowerCase()}`, 409);
    return r;
  }

  async addQuote(p: Principal, id: string, b: { vendorId: string; unitPrice: number; currency: string; leadDays: number; condition: Condition; validUntil: string }) {
    await this.can(p, 'purchase');
    const r = await this.openRequisition(p, id);
    const v = await this.vendor(p.operatorId, b.vendorId);
    await this.rate(b.currency);
    // Quotes are recorded from any supplier (to compare), but only an approved one can be awarded.
    await this.db.transaction(async () => {
      await this.db.db.insert(quotes).values({ requisitionId: r.id, ...b, unitPrice: b.unitPrice.toFixed(2), createdBy: actorOf(p) });
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'quote.recorded', entityType: 'requisition', entityId: id, data: { ...b, vendor: v.name } });
    });
    return this.requisitions(p, 'open');
  }

  async award(p: Principal, id: string, b: { quoteId: number; import: boolean }): Promise<PurchaseOrderDto> {
    await this.can(p, 'purchase');
    const poId = await this.db.transaction(async () => {
      const r = await this.openRequisition(p, id, true);
      const [q] = await this.db.db.select().from(quotes).where(and(eq(quotes.id, b.quoteId), eq(quotes.requisitionId, id)));
      if (!q) throw new DomainError('NOT_FOUND', `Quote ${b.quoteId} is not for ${id}`, 404);
      if (q.validUntil < today()) throw new DomainError('QUOTE_EXPIRED', `The quote expired on ${q.validUntil}`, 422);
      const v = await this.vendor(p.operatorId, q.vendorId);
      requireApprovedVendor(vendorOf(v), new Date());
      // The approval limit is in USD and counts recent open orders for the same part from the same supplier
      // (an order split in two still needs a second person).
      // Serialise awards for the same supplier and part, so two at once cannot both slip under the limit.
      await this.db.db.execute(sql`select pg_advisory_xact_lock(hashtext(${`amo.po:${p.operatorId}:${v.id}:${r.partNo}`}))`);
      const basePerUnit = await this.rate(q.currency);
      const recent = await this.db.db.execute<{ total: string | null }>(sql`
        select sum(o.qty * o.unit_price * f.base_per_unit)::text as total from amo.purchase_orders o join amo.fx_rates f on f.currency = o.currency
        where o.operator_id = ${p.operatorId} and o.vendor_id = ${v.id} and o.part_no = ${r.partNo} and o.status <> 'CANCELLED'
          and o.created_at > now() - interval '30 days'`);
      const status = newPoStatus({ qty: r.qty, unitPrice: Number(q.unitPrice), condition: q.condition as Condition },
        { basePerUnit, recentOpenBase: Number(recent.rows[0]?.total ?? 0) });
      const poId = await this.seq('po_seq', 'PO');
      await this.db.db.insert(purchaseOrders).values({ id: poId, operatorId: p.operatorId, requisitionId: id, vendorId: v.id, partNo: r.partNo, qty: r.qty, unitPrice: q.unitPrice,
        currency: q.currency, condition: q.condition, import: b.import, station: r.station, status, createdBy: actorOf(p), version: 1 });
      await this.db.db.update(requisitions).set({ status: 'ORDERED' }).where(eq(requisitions.id, id));
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'po.raised', entityType: 'purchase_order', entityId: poId,
        data: { requisitionId: id, vendor: v.name, partNo: r.partNo, qty: r.qty, unitPrice: Number(q.unitPrice), currency: q.currency, status } });
      if (status === 'PENDING_APPROVAL') {
        await this.notifications.raise(this.db, { operatorId: p.operatorId, actor: 'system:stores', severity: 'amber', link: `/amo/supply?tab=orders&po=${poId}`,
          title: `${poId} awaiting approval`, body: `${r.qty} × ${r.partNo} from ${v.name}: ${poTotal({ qty: r.qty, unitPrice: Number(q.unitPrice) }).toLocaleString('en-GB')} ${q.currency}` });
      }
      return poId;
    });
    return this.order(p, poId);
  }

  async cancelRequisition(p: Principal, id: string, reason: string) {
    await this.can(p, 'purchase');
    await this.db.transaction(async () => {
      await this.openRequisition(p, id, true);
      await this.db.db.update(requisitions).set({ status: 'CANCELLED' }).where(eq(requisitions.id, id));
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'requisition.cancelled', entityType: 'requisition', entityId: id, data: { reason } });
    });
    return this.requisitions(p, 'open');
  }

  /* ------------------------------------------------------------------ purchase orders and receiving */

  private receiptDto(r: RcRow, vm: Map<string, VRow>): ReceiptDto {
    return {
      id: r.id, poId: r.poId, vendorId: r.vendorId, vendorName: vm.get(r.vendorId)?.name ?? r.vendorId, partNo: r.partNo, qty: r.qty, serials: r.serials,
      certificateType: r.certificateType as ReceiptDto['certificateType'], certificateRef: r.certificateRef, condition: r.condition as Condition, station: r.station,
      customsStatus: r.customsStatus as ReceiptDto['customsStatus'], customsRef: r.customsRef, receivedBy: r.receivedBy, receivedAt: r.receivedAt.toISOString(),
      clearedBy: r.clearedBy, clearedAt: r.clearedAt?.toISOString() ?? null
    };
  }

  private poDto(r: PoRow, vm: Map<string, VRow>, rcs: RcRow[]): PurchaseOrderDto {
    return {
      id: r.id, requisitionId: r.requisitionId, vendorId: r.vendorId, vendorName: vm.get(r.vendorId)?.name ?? r.vendorId, partNo: r.partNo, qty: r.qty, receivedQty: r.receivedQty,
      unitPrice: Number(r.unitPrice), total: poTotal({ qty: r.qty, unitPrice: Number(r.unitPrice) }), currency: r.currency, condition: r.condition as Condition, import: r.import,
      station: r.station, status: r.status as PoStatus, createdBy: r.createdBy, createdAt: r.createdAt.toISOString(), approvedBy: r.approvedBy,
      approvedAt: r.approvedAt?.toISOString() ?? null, version: r.version, receipts: rcs.filter(x => x.poId === r.id).map(x => this.receiptDto(x, vm))
    };
  }

  async orders(p: Principal, scope: 'open' | 'all'): Promise<PurchaseOrderDto[]> {
    await this.can(p, 'read');
    const where = scope === 'open'
      ? and(eq(purchaseOrders.operatorId, p.operatorId), inArray(purchaseOrders.status, ['PENDING_APPROVAL', 'ISSUED', 'PARTIALLY_RECEIVED']))
      : eq(purchaseOrders.operatorId, p.operatorId);
    const rows = await this.db.db.select().from(purchaseOrders).where(where).orderBy(desc(purchaseOrders.createdAt)).limit(300);
    const [vm, rcs] = await Promise.all([this.vendorMap(p.operatorId), rows.length ? this.db.db.select().from(receipts).where(inArray(receipts.poId, rows.map(r => r.id))) : Promise.resolve([] as RcRow[])]);
    return rows.map(r => this.poDto(r, vm, rcs));
  }

  private async poRow(p: Principal, id: string, lock = false): Promise<PoRow> {
    const q = this.db.db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.operatorId, p.operatorId)));
    const [r] = lock ? await q.for('update') : await q;
    if (!r) throw new DomainError('NOT_FOUND', `No purchase order ${id}`, 404);
    return r;
  }

  async order(p: Principal, id: string): Promise<PurchaseOrderDto> {
    await this.can(p, 'read');
    const r = await this.poRow(p, id);
    return this.poDto(r, await this.vendorMap(p.operatorId), await this.db.db.select().from(receipts).where(eq(receipts.poId, id)));
  }

  async approve(p: Principal, id: string, version: number): Promise<PurchaseOrderDto> {
    await this.can(p, 'approve');
    await this.db.transaction(async () => {
      const r = await this.poRow(p, id, true);
      if (r.version !== version) throw new DomainError('CHANGED', `${id} was changed by someone else — reload`, 409);
      requireApprovedVendor(vendorOf(await this.vendor(p.operatorId, r.vendorId)), new Date());
      const next = approvePo(poDomain(r), actorOf(p));
      await this.db.db.update(purchaseOrders).set({ status: next.status, approvedBy: next.approvedBy, approvedAt: new Date(), version: next.version }).where(eq(purchaseOrders.id, id));
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'po.approved', entityType: 'purchase_order', entityId: id,
        data: { total: poTotal(poDomain(r)), currency: r.currency, raisedBy: r.createdBy } });
    });
    return this.order(p, id);
  }

  async cancelOrder(p: Principal, id: string, reason: string): Promise<PurchaseOrderDto> {
    await this.can(p, 'purchase');
    await this.db.transaction(async () => {
      const r = await this.poRow(p, id, true);
      if (r.status !== 'PENDING_APPROVAL' && r.status !== 'ISSUED') throw new DomainError('PO_STATE', `${id} is ${r.status.toLowerCase().replace('_', ' ')} — only unreceived orders are cancelled`, 409);
      await this.db.db.update(purchaseOrders).set({ status: 'CANCELLED', version: r.version + 1 }).where(eq(purchaseOrders.id, id));
      if (r.requisitionId) await this.db.db.update(requisitions).set({ status: 'OPEN' }).where(eq(requisitions.id, r.requisitionId));
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'po.cancelled', entityType: 'purchase_order', entityId: id, data: { reason } });
    });
    return this.order(p, id);
  }

  /**
   * Fill task-card shortages at `station` from free stock, oldest first, whole lines only. Called in the same
   * transaction that put the stock on the shelf.
   */
  private async fillShortages(operatorId: string, partNo: string, station: string): Promise<string[]> {
    const [line] = await this.db.db.select().from(stock).where(and(eq(stock.operatorId, operatorId), eq(stock.partNo, partNo), eq(stock.location, station))).for('update');
    if (!line) return [];
    const held = await this.db.db.select().from(reservations).where(and(eq(reservations.partNo, partNo), eq(reservations.location, station), eq(reservations.status, 'RESERVED')));
    let free = line.qty - held.reduce((n: number, h) => n + Number(h.qty), 0);
    // Only this operator's task cards: the parts were bought (and received) by this operator.
    const short = await this.db.db.select().from(reservations)
      .where(and(eq(reservations.partNo, partNo), eq(reservations.status, 'SHORT'),
        sql`${reservations.taskCardId} in (select id from amo.task_cards where operator_id = ${operatorId} and status <> 'CERTIFIED')`))
      .orderBy(asc(reservations.id)).for('update');
    const filled: string[] = [];
    for (const s of short) {
      if (s.qty > free) continue;
      await this.db.db.update(reservations).set({ status: 'RESERVED', location: station }).where(eq(reservations.id, s.id));
      free -= s.qty;
      filled.push(s.taskCardId);
    }
    return filled;
  }

  private async putInStock(operatorId: string, partNo: string, station: string, qty: number) {
    await this.db.db.insert(stock).values({ operatorId, partNo, location: station, qty }).onConflictDoUpdate({ target: [stock.operatorId, stock.partNo, stock.location], set: { qty: sql`${stock.qty} + ${qty}` } });
    return this.fillShortages(operatorId, partNo, station);
  }

  async receive(p: Principal, id: string, b: { qty: number; certificateType: ReceiptDto['certificateType']; certificateRef: string; condition: Condition; serials: string[]; version: number }): Promise<PurchaseOrderDto> {
    await this.can(p, 'receive');
    await this.db.transaction(async () => {
      const r = await this.poRow(p, id, true);
      if (r.version !== b.version) throw new DomainError('CHANGED', `${id} was changed by someone else — reload`, 409);
      const v = await this.vendor(p.operatorId, r.vendorId);
      requireApprovedVendor(vendorOf(v), new Date());
      const [part] = await this.db.db.select().from(parts).where(eq(parts.partNo, r.partNo));
      const next = receiveAgainstPo(poDomain(r), b, part ? { standardPart: part.standardPart } : null);
      const grId = await this.seq('receipt_seq', 'GR');
      const bonded = r.import;
      await this.db.db.insert(receipts).values({ id: grId, operatorId: p.operatorId, poId: id, vendorId: v.id, partNo: r.partNo, qty: b.qty, serials: b.serials,
        certificateType: b.certificateType, certificateRef: b.certificateRef.trim(), condition: b.condition, station: r.station, customsStatus: bonded ? 'BONDED' : 'NONE', receivedBy: actorOf(p) });
      await this.db.db.update(purchaseOrders).set({ receivedQty: next.receivedQty, status: next.status, version: next.version }).where(eq(purchaseOrders.id, id));
      const filled = bonded ? [] : await this.putInStock(p.operatorId, r.partNo, r.station, b.qty);
      // the ledger accrues the stock against the supplier at today's reference rate
      const basePerUnit = await this.rate(r.currency);
      await this.outbox.add(this.db, { type: 'amo.goods.received', data: {
        receiptId: grId, poId: id, partNo: r.partNo, qty: b.qty, unitPrice: Number(r.unitPrice), currency: r.currency, basePerUnit,
        amountBaseCents: Math.round(b.qty * Number(r.unitPrice) * basePerUnit * 100), receivedAt: new Date().toISOString(), station: r.station
      } }, { operatorId: p.operatorId, actor: actorOf(p) });
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'goods.received', entityType: 'purchase_order', entityId: id,
        data: { receipt: grId, qty: b.qty, certificate: `${b.certificateType} ${b.certificateRef.trim()}`, condition: b.condition, serials: b.serials, bonded, shortagesFilled: filled } });
      if (filled.length) {
        await this.notifications.raise(this.db, { operatorId: p.operatorId, actor: 'system:stores', severity: 'green', link: '/amo/task-cards',
          title: `${r.partNo} received — reserved for ${filled.join(', ')}`, body: `Goods receipt ${grId} at ${r.station}.` });
      }
    });
    return this.order(p, id);
  }

  async bonded(p: Principal): Promise<ReceiptDto[]> {
    await this.can(p, 'read');
    const rows = await this.db.db.select().from(receipts).where(and(eq(receipts.operatorId, p.operatorId), eq(receipts.customsStatus, 'BONDED'))).orderBy(asc(receipts.receivedAt));
    const vm = await this.vendorMap(p.operatorId);
    return rows.map(r => this.receiptDto(r, vm));
  }

  /** Customs released the goods: out of the bonded store into usable stock (and onto waiting task cards). */
  async clear(p: Principal, receiptId: string, customsRef: string): Promise<ReceiptDto[]> {
    await this.can(p, 'clear_customs');
    await this.db.transaction(async () => {
      const [r] = await this.db.db.select().from(receipts).where(and(eq(receipts.id, receiptId), eq(receipts.operatorId, p.operatorId))).for('update');
      if (!r) throw new DomainError('NOT_FOUND', `No receipt ${receiptId}`, 404);
      if (r.customsStatus !== 'BONDED') throw new DomainError('NOT_BONDED', `${receiptId} is not in the bonded store`, 409);
      await this.db.db.update(receipts).set({ customsStatus: 'CLEARED', customsRef, clearedBy: actorOf(p), clearedAt: new Date() }).where(eq(receipts.id, receiptId));
      const filled = await this.putInStock(p.operatorId, r.partNo, r.station, r.qty);
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'customs.cleared', entityType: 'receipt', entityId: receiptId,
        data: { customsRef, partNo: r.partNo, qty: r.qty, station: r.station, shortagesFilled: filled } });
    });
    return this.bonded(p);
  }

  /* ------------------------------------------------------------------ warranty */

  async claims(p: Principal): Promise<WarrantyClaimDto[]> {
    await this.can(p, 'read');
    const [rows, vm] = await Promise.all([this.db.db.select().from(warrantyClaims).where(eq(warrantyClaims.operatorId, p.operatorId)).orderBy(desc(warrantyClaims.createdAt)), this.vendorMap(p.operatorId)]);
    return rows.map(c => ({
      id: c.id, receiptId: c.receiptId, vendorId: c.vendorId, vendorName: vm.get(c.vendorId)?.name ?? c.vendorId, partNo: c.partNo, serial: c.serial, failure: c.failure,
      failedAt: c.failedAt, claimedAmount: Number(c.claimedAmount), currency: c.currency, status: c.status as ClaimStatus, vendorRef: c.vendorRef, creditAmount: num(c.creditAmount),
      decidedBy: c.decidedBy, decidedAt: c.decidedAt?.toISOString() ?? null, createdBy: c.createdBy, createdAt: c.createdAt.toISOString(), version: c.version
    }));
  }

  /** A claim needs the receipt the part came in on, and a failure inside the supplier's warranty period. */
  async claim(p: Principal, b: { receiptId: string; serial: string | null; failure: string; failedAt: string; claimedAmount: number; currency: string }) {
    await this.can(p, 'claim');
    await this.db.transaction(async () => {
      // Locked: two claims for the same unit at once are refused cleanly, not by the unique index.
      const [r] = await this.db.db.select().from(receipts).where(and(eq(receipts.id, b.receiptId), eq(receipts.operatorId, p.operatorId))).for('update');
      if (!r) throw new DomainError('NOT_FOUND', `No receipt ${b.receiptId}`, 404);
      if (r.serials.length && (!b.serial || !r.serials.includes(b.serial))) throw new DomainError('SERIAL', `${b.receiptId} delivered ${r.serials.join(', ')} — name the failed serial`, 422);
      const v = await this.vendor(p.operatorId, r.vendorId);
      await this.rate(b.currency);
      if (!underWarranty(r.receivedAt, v.warrantyMonths, b.failedAt)) {
        throw new DomainError('OUT_OF_WARRANTY', `${v.name} gives ${v.warrantyMonths} months from receipt (${r.receivedAt.toISOString().slice(0, 10)}); the failure on ${b.failedAt} is outside it`, 422);
      }
      const live = await this.db.db.select({ id: warrantyClaims.id }).from(warrantyClaims)
        .where(and(eq(warrantyClaims.receiptId, r.id), sql`coalesce(${warrantyClaims.serial}, '') = ${b.serial ?? ''}`, sql`${warrantyClaims.status} <> 'REJECTED'`));
      if (live.length) throw new DomainError('DUPLICATE_CLAIM', `${live[0].id} is already open for this ${b.serial ? `serial ${b.serial}` : 'delivery'}`, 409);
      const id = await this.seq('claim_seq', 'WC');
      await this.db.db.insert(warrantyClaims).values({ id, operatorId: p.operatorId, receiptId: r.id, vendorId: v.id, partNo: r.partNo, serial: b.serial, failure: b.failure,
        failedAt: b.failedAt, claimedAmount: b.claimedAmount.toFixed(2), currency: b.currency, status: 'SUBMITTED', createdBy: actorOf(p), version: 1 });
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'warranty.claimed', entityType: 'warranty_claim', entityId: id, data: b });
    });
    return this.claims(p);
  }

  async decide(p: Principal, id: string, b: { decision: 'ACCEPTED' | 'REJECTED' | 'CREDITED'; vendorRef: string | null; creditAmount: number | null; version: number }) {
    await this.can(p, 'decide_claim');
    await this.db.transaction(async () => {
      const [c] = await this.db.db.select().from(warrantyClaims).where(and(eq(warrantyClaims.id, id), eq(warrantyClaims.operatorId, p.operatorId))).for('update');
      if (!c) throw new DomainError('NOT_FOUND', `No claim ${id}`, 404);
      if (c.version !== b.version) throw new DomainError('CHANGED', `${id} was changed by someone else — reload`, 409);
      const next = decideClaim(c.status as ClaimStatus, b.decision, b.creditAmount, Number(c.claimedAmount), { claimant: c.createdBy, by: actorOf(p) });
      await this.db.db.update(warrantyClaims).set({ status: next.status, vendorRef: b.vendorRef ?? c.vendorRef, creditAmount: b.creditAmount === null ? c.creditAmount : b.creditAmount.toFixed(2),
        decidedBy: actorOf(p), decidedAt: new Date(), version: c.version + 1 }).where(eq(warrantyClaims.id, id));
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: `warranty.${b.decision.toLowerCase()}`, entityType: 'warranty_claim', entityId: id, data: b });
    });
    return this.claims(p);
  }

  /* ------------------------------------------------------------------ exchanges and PBH */

  async exchanges(p: Principal): Promise<ExchangeDto[]> {
    await this.can(p, 'read');
    const [rows, vm] = await Promise.all([this.db.db.select().from(exchanges).where(eq(exchanges.operatorId, p.operatorId)).orderBy(asc(exchanges.coreDue)), this.vendorMap(p.operatorId)]);
    const now = new Date();
    return rows.map(e => ({
      id: e.id, vendorId: e.vendorId, vendorName: vm.get(e.vendorId)?.name ?? e.vendorId, partNo: e.partNo, serialIn: e.serialIn, serialOut: e.serialOut, fee: Number(e.fee),
      currency: e.currency, coreDue: e.coreDue, status: e.status as ExchangeDto['status'], overdue: coreOverdue({ status: e.status as ExchangeDto['status'], coreDue: e.coreDue }, now),
      coreReturnedAt: e.coreReturnedAt?.toISOString() ?? null, coreRef: e.coreRef, createdAt: e.createdAt.toISOString()
    }));
  }

  async exchange(p: Principal, b: { vendorId: string; partNo: string; serialIn: string; serialOut: string; fee: number; currency: string; coreDue: string }) {
    await this.can(p, 'purchase');
    const v = await this.vendor(p.operatorId, b.vendorId);
    requireApprovedVendor(vendorOf(v), new Date());
    if (b.serialIn === b.serialOut) throw new DomainError('SERIALS', 'The unit received and the core returned are different serials', 422);
    if (b.coreDue < today()) throw new DomainError('CORE_DUE', 'The core due date is in the past', 422);
    await this.rate(b.currency);
    await this.db.transaction(async () => {
      const id = await this.seq('exchange_seq', 'EX');
      await this.db.db.insert(exchanges).values({ id, operatorId: p.operatorId, ...b, fee: b.fee.toFixed(2), status: 'OPEN', createdBy: actorOf(p) });
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'exchange.opened', entityType: 'exchange', entityId: id, data: { ...b, vendor: v.name } });
    });
    return this.exchanges(p);
  }

  async coreReturned(p: Principal, id: string, coreRef: string) {
    await this.can(p, 'purchase');
    await this.db.transaction(async () => {
      const [e] = await this.db.db.select().from(exchanges).where(and(eq(exchanges.id, id), eq(exchanges.operatorId, p.operatorId))).for('update');
      if (!e) throw new DomainError('NOT_FOUND', `No exchange ${id}`, 404);
      if (e.status !== 'OPEN') throw new DomainError('EXCHANGE_STATE', `${id}'s core was already returned`, 409);
      await this.db.db.update(exchanges).set({ status: 'CORE_RETURNED', coreReturnedAt: new Date(), coreRef }).where(eq(exchanges.id, id));
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'exchange.core_returned', entityType: 'exchange', entityId: id,
        data: { coreRef, serialOut: e.serialOut, late: e.coreDue < today() } });
    });
    return this.exchanges(p);
  }

  async pbh(p: Principal): Promise<PbhContractDto[]> {
    await this.can(p, 'read');
    const [rows, vm] = await Promise.all([this.db.db.select().from(pbhContracts).where(eq(pbhContracts.operatorId, p.operatorId)).orderBy(asc(pbhContracts.id)), this.vendorMap(p.operatorId)]);
    return rows.map(c => ({ id: c.id, vendorId: c.vendorId, vendorName: vm.get(c.vendorId)?.name ?? c.vendorId, scope: c.scope, tails: c.tails, ratePerFh: Number(c.ratePerFh),
      currency: c.currency, starts: c.starts, ends: c.ends }));
  }

  /** Monthly charge: flight hours of the covered aircraft in the month (inside the contract period) × the rate. */
  async statement(p: Principal, id: string, month: string): Promise<PbhStatementDto> {
    await this.can(p, 'read');
    if (!/^\d{4}-\d{2}$/.test(month)) throw new BadRequestException('month must look like 2026-10');
    const [c] = await this.db.db.select().from(pbhContracts).where(and(eq(pbhContracts.id, id), eq(pbhContracts.operatorId, p.operatorId)));
    if (!c) throw new DomainError('NOT_FOUND', `No PBH contract ${id}`, 404);
    const from = new Date(`${month}-01T00:00:00Z`);
    const to = new Date(from); to.setUTCMonth(to.getUTCMonth() + 1);
    const start = new Date(Math.max(from.getTime(), Date.parse(`${c.starts}T00:00:00Z`)));
    const end = new Date(Math.min(to.getTime(), Date.parse(`${c.ends}T00:00:00Z`) + 86_400_000));
    const fh: Record<string, number> = Object.fromEntries(c.tails.map(t => [t, 0]));
    if (start < end) {
      const rows = await this.db.db.select({ tail: flightHours.tail, minutes: sql<string>`sum(${flightHours.minutes})::text` }).from(flightHours)
        .where(and(eq(flightHours.operatorId, p.operatorId), inArray(flightHours.tail, c.tails), gte(flightHours.arrivedAt, start), lt(flightHours.arrivedAt, end)))
        .groupBy(flightHours.tail);
      for (const r of rows) fh[r.tail] = Number(r.minutes) / 60;
    }
    const s = pbhStatement(fh, Number(c.ratePerFh));
    return { contractId: id, month, currency: c.currency, ratePerFh: Number(c.ratePerFh), ...s };
  }

  /** Projection of Ops arrivals (idempotent per flight). */
  async onFlightArrived(env: EventEnvelope<'ops.flight.arrived'>) {
    const d = env.data;
    const minutes = d.flightMinutes ?? d.blockMinutes;
    if (!minutes || minutes <= 0) return;
    await this.inbox.once(this.db, 'amo.flight-hours', env, async () => {
      await this.db.db.insert(flightHours).values({ flightId: d.flightId, operatorId: env.operatorId, tail: d.tail, arrivedAt: new Date(d.arrivedAt), minutes }).onConflictDoNothing();
    });
  }
}

/* ------------------------------------------------------------------ HTTP */

const date10 = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cond = z.enum(['NE', 'NS', 'OH', 'SV', 'AR']);
const ver = z.number().int().positive();
const vendorSchema = z.object({ name: z.string().trim().min(3).max(120), approvalType: z.enum(['PART_145', 'PART_21G', 'DISTRIBUTOR', 'OEM']), approvalRef: z.string().trim().min(3).max(80),
  approvedUntil: date10, warrantyMonths: z.number().int().min(0).max(120).default(12), country: z.string().trim().length(2) });
const vendorStatusSchema = z.object({ status: z.enum(['APPROVED', 'SUSPENDED']), approvedUntil: date10.nullable().default(null), reason: z.string().trim().min(5).max(500) });
const reqSchema = z.object({ partNo: z.string().trim().min(2).max(60), qty: z.number().int().positive().max(100_000), station: z.string().trim().length(4), neededBy: date10,
  reason: z.string().trim().min(5).max(500), taskCardId: z.string().max(40).nullable().default(null) });
const amount = z.number().min(0.01, 'At least 0.01').max(100_000_000).transform(n => Math.round(n * 100) / 100);
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'ISO currency code, e.g. EUR');
const rateSchema = z.object({ currency, basePerUnit: z.number().positive().max(100_000) });
const quoteSchema = z.object({ vendorId: z.string().min(2).max(20), unitPrice: amount, currency, leadDays: z.number().int().min(0).max(720),
  condition: cond, validUntil: date10 });
const awardSchema = z.object({ quoteId: z.number().int().positive(), import: z.boolean().default(false) });
const reasonSchema = z.object({ reason: z.string().trim().min(5).max(500) });
const receiveSchema = z.object({ qty: z.number().int().positive(), certificateType: z.enum(['FORM1', 'FAA_8130_3', 'COC']), certificateRef: z.string().trim().max(80),
  condition: cond, serials: z.array(z.string().trim().min(1).max(60)).max(1000).default([]), version: ver });
const clearSchema = z.object({ customsRef: z.string().trim().min(3).max(80) });
const claimSchema = z.object({ receiptId: z.string().min(2).max(20), serial: z.string().trim().max(60).nullable().default(null), failure: z.string().trim().min(10).max(2000),
  failedAt: date10, claimedAmount: amount, currency });
const decideSchema = z.object({ decision: z.enum(['ACCEPTED', 'REJECTED', 'CREDITED']), vendorRef: z.string().trim().max(80).nullable().default(null),
  creditAmount: amount.nullable().default(null), version: ver });
const exchangeSchema = z.object({ vendorId: z.string().min(2).max(20), partNo: z.string().trim().min(2).max(60), serialIn: z.string().trim().min(1).max(60), serialOut: z.string().trim().min(1).max(60),
  fee: z.number().min(0).max(100_000_000).transform(n => Math.round(n * 100) / 100), currency, coreDue: date10 });
const coreSchema = z.object({ coreRef: z.string().trim().min(3).max(80) });

@Controller('amo/supply')
export class SupplyController {
  constructor(private readonly s: SupplyService) {}

  @Get('rates') rates(@CurrentPrincipal() p: Principal) { return this.s.rates(p); }
  @Post('rates') setRate(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(rateSchema)) b: z.infer<typeof rateSchema>) { return this.s.setRate(p, b); }
  @Get('vendors') vendors(@CurrentPrincipal() p: Principal) { return this.s.vendors(p); }
  @Post('vendors') addVendor(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(vendorSchema)) b: z.infer<typeof vendorSchema>) { return this.s.addVendor(p, b); }
  @Post('vendors/:id/status') setVendor(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(vendorStatusSchema)) b: z.infer<typeof vendorStatusSchema>) { return this.s.setVendor(p, id, b); }

  @Get('requisitions') requisitions(@CurrentPrincipal() p: Principal, @Query('scope') scope?: string) { return this.s.requisitions(p, scope === 'all' ? 'all' : 'open'); }
  @Post('requisitions') requisition(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(reqSchema)) b: z.infer<typeof reqSchema>) { return this.s.requisition(p, b); }
  @Post('requisitions/from-shortages') shortages(@CurrentPrincipal() p: Principal) { return this.s.requisitionShortages(p); }
  @Post('requisitions/:id/quotes') quote(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(quoteSchema)) b: z.infer<typeof quoteSchema>) { return this.s.addQuote(p, id, b); }
  @Post('requisitions/:id/award') award(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(awardSchema)) b: z.infer<typeof awardSchema>) { return this.s.award(p, id, b); }
  @Post('requisitions/:id/cancel') cancelReq(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(reasonSchema)) b: z.infer<typeof reasonSchema>) { return this.s.cancelRequisition(p, id, b.reason); }

  @Get('orders') orders(@CurrentPrincipal() p: Principal, @Query('scope') scope?: string) { return this.s.orders(p, scope === 'all' ? 'all' : 'open'); }
  @Get('orders/:id') order(@CurrentPrincipal() p: Principal, @Param('id') id: string) { return this.s.order(p, id); }
  @Post('orders/:id/approve') approve(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(z.object({ version: ver }))) b: { version: number }) { return this.s.approve(p, id, b.version); }
  @Post('orders/:id/cancel') cancel(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(reasonSchema)) b: z.infer<typeof reasonSchema>) { return this.s.cancelOrder(p, id, b.reason); }
  @Post('orders/:id/receive') receive(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(receiveSchema)) b: z.infer<typeof receiveSchema>) { return this.s.receive(p, id, b); }

  @Get('bonded') bonded(@CurrentPrincipal() p: Principal) { return this.s.bonded(p); }
  @Post('receipts/:id/clear') clear(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(clearSchema)) b: z.infer<typeof clearSchema>) { return this.s.clear(p, id, b.customsRef); }

  @Get('claims') claims(@CurrentPrincipal() p: Principal) { return this.s.claims(p); }
  @Post('claims') claim(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(claimSchema)) b: z.infer<typeof claimSchema>) { return this.s.claim(p, b); }
  @Post('claims/:id/decide') decide(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(decideSchema)) b: z.infer<typeof decideSchema>) { return this.s.decide(p, id, b); }

  @Get('exchanges') exchanges(@CurrentPrincipal() p: Principal) { return this.s.exchanges(p); }
  @Post('exchanges') exchange(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(exchangeSchema)) b: z.infer<typeof exchangeSchema>) { return this.s.exchange(p, b); }
  @Post('exchanges/:id/core-returned') core(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(coreSchema)) b: z.infer<typeof coreSchema>) { return this.s.coreReturned(p, id, b.coreRef); }

  @Get('pbh') pbh(@CurrentPrincipal() p: Principal) { return this.s.pbh(p); }
  @Get('pbh/:id/statement') statement(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Query('month') month?: string) {
    const m = month ?? new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new BadRequestException('month: yyyy-mm');
    return this.s.statement(p, id, m);
  }
}

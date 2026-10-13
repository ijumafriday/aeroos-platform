import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { boolean, date, integer, pgSchema, serial, text, timestamp } from 'drizzle-orm/pg-core';
import type { EventEnvelope, StockDto, TaskCardDto, ToolDto } from '@aeroos/contracts';
import { DAY_MS, DomainError } from '@aeroos/kernel';
import { allocate, type Tool } from '@aeroos/mro-domain';
import { actorOf, type Principal } from '../../platform/auth/principal';
import { AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { InboxService } from '../../platform/events/outbox';

const amo = pgSchema('amo');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const tools = amo.table('tools', {
  id: text('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  description: text('description').notNull(),
  serial: text('serial').notNull(),
  location: text('location').notNull(),
  calibrationDue: date('calibration_due', { mode: 'string' })
});

export const parts = amo.table('parts', {
  partNo: text('part_no').primaryKey(),
  description: text('description').notNull(),
  unit: text('unit').notNull(),
  minStock: integer('min_stock').notNull(),
  standardPart: boolean('standard_part').notNull().default(false)
});

export const stock = amo.table('stock', {
  operatorId: text('operator_id').notNull(),
  partNo: text('part_no').notNull(),
  location: text('location').notNull(),
  qty: integer('qty').notNull()
});

export const reservations = amo.table('reservations', {
  id: serial('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  taskCardId: text('task_card_id').notNull(),
  partNo: text('part_no').notNull(),
  location: text('location'),
  qty: integer('qty').notNull(),
  status: text('status').notNull(),
  createdAt: ts('created_at').notNull().defaultNow()
});

export const wpSlots = amo.table('wp_slots', {
  wpId: text('wp_id').primaryKey(),
  tail: text('tail').notNull(),
  station: text('station').notNull(),
  bay: text('bay'),
  plannedStart: ts('planned_start'),
  plannedEnd: ts('planned_end'),
  status: text('status').notNull(),
  title: text('title'),
  operatorId: text('operator_id'),
  updatedAt: ts('updated_at').notNull().defaultNow()
});

const toolDto = (t: typeof tools.$inferSelect, now: Date): ToolDto => {
  const due = t.calibrationDue ? Date.parse(`${t.calibrationDue}T00:00:00Z`) : null;
  return {
    id: t.id, description: t.description, serial: t.serial, location: t.location, calibrationDue: t.calibrationDue,
    status: due === null ? 'OK' : due <= now.getTime() ? 'EXPIRED' : due - now.getTime() < 30 * DAY_MS ? 'DUE_SOON' : 'OK'
  };
};

/**
 * Hangar floor resources: calibrated tools (Part-145.A.40), parts stock with reservations per task card,
 * and the hangar plan (work-package slots projected from CAMO events).
 */
@Injectable()
export class StoresService {
  constructor(
    @Inject(DB_TOKEN.amo) private readonly db: ModuleDb,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService
  ) {}

  private resource(operatorId: string) {
    return { kind: 'stores' as const, id: '*', attr: { operatorId } };
  }

  async tools(p: Principal): Promise<ToolDto[]> {
    await this.authz.check(p, this.resource(p.operatorId), 'read');
    const now = new Date();
    return (await this.db.db.select().from(tools).where(eq(tools.operatorId, p.operatorId)).orderBy(asc(tools.id))).map(t => toolDto(t, now));
  }

  /** Tools a mechanic records against a step; unknown ids are refused, calibration is checked by the domain. */
  async toolsForSigning(operatorId: string, ids: string[]): Promise<Tool[]> {
    if (!ids.length) return [];
    const rows = await this.db.db.select().from(tools).where(and(eq(tools.operatorId, operatorId), inArray(tools.id, ids)));
    const missing = ids.filter(id => !rows.some(r => r.id === id));
    if (missing.length) throw new DomainError('TOOL_UNKNOWN', `Unknown tool ${missing.join(', ')}`, 404);
    return rows.map(r => ({ id: r.id, description: r.description, calibrationDue: r.calibrationDue ? new Date(`${r.calibrationDue}T00:00:00Z`) : null }));
  }

  async stock(p: Principal): Promise<StockDto[]> {
    await this.authz.check(p, this.resource(p.operatorId), 'read');
    const [partRows, stockRows, reserved] = await Promise.all([
      this.db.db.select().from(parts).orderBy(asc(parts.partNo)),
      this.db.db.select().from(stock).where(eq(stock.operatorId, p.operatorId)),
      this.db.db.select({ partNo: reservations.partNo, qty: sql<string>`sum(${reservations.qty})::text` }).from(reservations)
        .where(and(eq(reservations.operatorId, p.operatorId), eq(reservations.status, 'RESERVED'))).groupBy(reservations.partNo)
    ]);
    const res = new Map<string, number>(reserved.map(r => [r.partNo, Number(r.qty)]));
    return partRows.map(pr => {
      const lines = stockRows.filter(s => s.partNo === pr.partNo);
      const onHand: number = lines.reduce((n: number, l) => n + Number(l.qty), 0);
      const r = res.get(pr.partNo) ?? 0;
      return { partNo: pr.partNo, description: pr.description, unit: pr.unit, minStock: pr.minStock, onHand, reserved: r, locations: lines.map(l => ({ location: l.location, qty: l.qty })), low: onHand - r < pr.minStock };
    });
  }

  async receive(p: Principal, body: { partNo: string; location: string; qty: number; reference: string }) {
    await this.authz.check(p, this.resource(p.operatorId), 'receive');
    return this.db.transaction(async () => {
      const [part] = await this.db.db.select().from(parts).where(eq(parts.partNo, body.partNo));
      if (!part) throw new DomainError('PART_UNKNOWN', `${body.partNo} is not in the parts catalogue`, 404);
      await this.db.db.insert(stock).values({ operatorId: p.operatorId, partNo: body.partNo, location: body.location, qty: body.qty })
        .onConflictDoUpdate({ target: [stock.operatorId, stock.partNo, stock.location], set: { qty: sql`${stock.qty} + ${body.qty}` } });
      await this.audit.record(this.db, 'amo', { operatorId: p.operatorId, actor: actorOf(p), action: 'stock.received', entityType: 'part', entityId: body.partNo, data: body });
      return { ok: true };
    });
  }

  /** Reserve parts for a new task card (inside the card's transaction). Shortages are recorded, not hidden. */
  async reserve(operatorId: string, taskCardId: string, needs: { partNo: string; qty: number }[], station: string) {
    if (!needs.length) return;
    this.db.requireTransaction('Reserving parts');
    const [lines, held] = await Promise.all([
      this.db.db.select().from(stock).where(and(eq(stock.operatorId, operatorId), inArray(stock.partNo, needs.map(n => n.partNo)))).for('update'),
      this.db.db.select().from(reservations).where(and(eq(reservations.operatorId, operatorId), inArray(reservations.partNo, needs.map(n => n.partNo)), eq(reservations.status, 'RESERVED')))
    ]);
    // Free quantity per line = physical stock minus what is already reserved from that line.
    const free = lines.map(l => ({ ...l, qty: l.qty - held.filter(h => h.partNo === l.partNo && h.location === l.location).reduce((n: number, h) => n + Number(h.qty), 0) }));
    const { allocations, shortages } = allocate(needs, free, station);
    for (const a of allocations) await this.db.db.insert(reservations).values({ operatorId, taskCardId, partNo: a.partNo, location: a.location, qty: a.qty, status: 'RESERVED' });
    for (const s of shortages) await this.db.db.insert(reservations).values({ operatorId, taskCardId, partNo: s.partNo, location: null, qty: s.missing, status: 'SHORT' });
  }

  async reservationsFor(operatorId: string, taskCardId: string): Promise<TaskCardDto['reservations']> {
    const rows = await this.db.db.select().from(reservations).where(and(eq(reservations.operatorId, operatorId), eq(reservations.taskCardId, taskCardId))).orderBy(asc(reservations.id));
    return rows.map(r => ({ partNo: r.partNo, location: r.location ?? '—', qty: r.qty, status: r.status as 'RESERVED' | 'ISSUED' | 'SHORT' }));
  }

  /** On CRS: reserved parts are issued (stock decremented) in the same transaction as the certificate. */
  async issueFor(operatorId: string, taskCardId: string) {
    this.db.requireTransaction('Issuing parts');
    const held = await this.db.db.select().from(reservations).where(and(eq(reservations.operatorId, operatorId), eq(reservations.taskCardId, taskCardId), eq(reservations.status, 'RESERVED'))).for('update');
    for (const h of held) {
      const r = await this.db.db.update(stock).set({ qty: sql`${stock.qty} - ${h.qty}` })
        .where(and(eq(stock.operatorId, operatorId), eq(stock.partNo, h.partNo), eq(stock.location, h.location!), gte(stock.qty, h.qty))).returning({ qty: stock.qty });
      if (!r.length) throw new DomainError('STOCK_CHANGED', `${h.partNo} at ${h.location} no longer has ${h.qty} in stock`, 409);
      await this.db.db.update(reservations).set({ status: 'ISSUED' }).where(eq(reservations.id, h.id));
    }
    return held.map(h => ({ partNo: h.partNo, location: h.location, qty: h.qty }));
  }

  /* ---------------------------------------------------------- hangar plan (projection of CAMO work packages) */

  async hangar(p: Principal, from: Date, to: Date) {
    await this.authz.check(p, this.resource(p.operatorId), 'read');
    return this.db.db.select().from(wpSlots).where(and(eq(wpSlots.operatorId, p.operatorId), lt(wpSlots.plannedStart, to), gte(wpSlots.plannedEnd, from))).orderBy(asc(wpSlots.plannedStart));
  }

  async onWpEvent(env: EventEnvelope) {
    await this.inbox.once(this.db, 'amo.hangar', env, async () => {
      if (env.type === 'camo.wp.planned') {
        const d = (env as EventEnvelope<'camo.wp.planned'>).data;
        await this.db.db.insert(wpSlots).values({ wpId: d.wpId, operatorId: env.operatorId, tail: d.tail, station: d.station, bay: d.bay || null, plannedStart: new Date(d.plannedStart), plannedEnd: new Date(d.plannedEnd), status: d.status })
          .onConflictDoUpdate({ target: wpSlots.wpId, set: { operatorId: env.operatorId, bay: d.bay || null, plannedStart: new Date(d.plannedStart), plannedEnd: new Date(d.plannedEnd), status: d.status, updatedAt: new Date() } });
      } else if (env.type === 'camo.wp.released') {
        const d = (env as EventEnvelope<'camo.wp.released'>).data;
        await this.db.db.update(wpSlots).set({ status: 'RELEASED', title: d.title, updatedAt: new Date() }).where(eq(wpSlots.wpId, d.wpId));
      } else if (env.type === 'camo.wp.completed') {
        await this.db.db.update(wpSlots).set({ status: 'COMPLETED', updatedAt: new Date() }).where(eq(wpSlots.wpId, (env as EventEnvelope<'camo.wp.completed'>).data.wpId));
      }
    });
  }
}

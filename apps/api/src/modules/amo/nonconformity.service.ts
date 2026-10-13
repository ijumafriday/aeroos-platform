import { Body, Controller, Get, Inject, Injectable, Param, Post, Query } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { integer, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { NonconformityDto } from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import { dispose, witnessMutilation, type Disposition, type Nonconformity, type NcrStatus } from '@aeroos/mro-domain';
import { actorOf, CurrentPrincipal, type Principal } from '../../platform/auth/principal';
import { AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { OutboxService } from '../../platform/events/outbox';
import { ZodPipe } from '../../platform/http/http';
import { NotificationsService } from '../../platform/notifications/notifications.service';
import { parts, reservations, stock } from './stores.service';

const amo = pgSchema('amo');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const nonconformities = amo.table('nonconformities', {
  id: text('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  partNo: text('part_no').notNull(),
  serial: text('serial'),
  qty: integer('qty').notNull(),
  location: text('location'),
  source: text('source').notNull(),
  description: text('description').notNull(),
  raisedBy: text('raised_by').notNull(),
  raisedAt: ts('raised_at').notNull().defaultNow(),
  status: text('status').notNull(),
  disposition: text('disposition'),
  dispositionReason: text('disposition_reason'),
  releaseRef: text('release_ref'),
  dispositionedBy: text('dispositioned_by'),
  dispositionedAt: ts('dispositioned_at'),
  mutilationMethod: text('mutilation_method'),
  mutilatedBy: text('mutilated_by'),
  mutilatedAt: ts('mutilated_at'),
  version: integer('version').notNull()
});

type Row = typeof nonconformities.$inferSelect;
const CHAIN = 'amo';

const toDomain = (r: Row): Nonconformity => ({
  id: r.id, partNo: r.partNo, serial: r.serial, qty: r.qty, status: r.status as NcrStatus, disposition: r.disposition as Disposition | null, dispositionedBy: r.dispositionedBy, version: r.version
});
const dto = (r: Row): NonconformityDto => ({
  id: r.id, partNo: r.partNo, serial: r.serial, qty: r.qty, location: r.location, source: r.source as NonconformityDto['source'], description: r.description,
  raisedBy: r.raisedBy, raisedAt: r.raisedAt.toISOString(), status: r.status as NcrStatus, disposition: r.disposition as Disposition | null,
  dispositionReason: r.dispositionReason, releaseRef: r.releaseRef, dispositionedBy: r.dispositionedBy, dispositionedAt: r.dispositionedAt?.toISOString() ?? null,
  mutilationMethod: r.mutilationMethod, mutilatedBy: r.mutilatedBy, mutilatedAt: r.mutilatedAt?.toISOString() ?? null, version: r.version
});

/**
 * Non-conforming parts and scrapping (ADR-0020, 145.A.42): quarantine (out of usable stock), disposition by
 * engineering, mutilation of scrapped parts witnessed by a second person, and an `amo.part.scrapped` event so
 * CAMO records the serial as scrapped in its back-to-birth history and refuses to install it ever again.
 */
@Injectable()
export class NonconformityService {
  constructor(
    @Inject(DB_TOKEN.amo) private readonly db: ModuleDb,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationsService
  ) {}

  private resource(operatorId: string, id = '*') {
    return { kind: 'nonconformity' as const, id, attr: { operatorId } };
  }

  async list(p: Principal, scope: 'open' | 'all'): Promise<NonconformityDto[]> {
    await this.authz.check(p, this.resource(p.operatorId), 'read');
    const where = scope === 'open' ? and(eq(nonconformities.operatorId, p.operatorId), inArray(nonconformities.status, ['QUARANTINED', 'SCRAP_PENDING']))
      : eq(nonconformities.operatorId, p.operatorId);
    return (await this.db.db.select().from(nonconformities).where(where).orderBy(desc(nonconformities.raisedAt)).limit(300)).map(dto);
  }

  private async row(id: string, lock = false): Promise<Row> {
    const q = this.db.db.select().from(nonconformities).where(eq(nonconformities.id, id));
    const [r] = lock ? await q.for('update') : await q;
    if (!r) throw new DomainError('NOT_FOUND', `No NCR ${id}`, 404);
    return r;
  }

  async get(p: Principal, id: string): Promise<NonconformityDto> {
    const r = await this.row(id);
    await this.authz.check(p, this.resource(r.operatorId, id), 'read');
    return dto(r);
  }

  /** Quarantine: a part taken from stock leaves usable stock at once. */
  async raise(p: Principal, b: { partNo: string; serial: string | null; qty: number; location: string | null; source: NonconformityDto['source']; description: string }): Promise<NonconformityDto> {
    await this.authz.check(p, this.resource(p.operatorId), 'raise');
    if (b.serial && b.qty !== 1) throw new DomainError('SERIAL_QTY', 'A serialised part is quarantined one at a time', 422);
    if (b.source === 'STOCK' && !b.location) throw new DomainError('LOCATION_REQUIRED', 'Say which stores location the part is taken from', 422);
    const id = await this.db.transaction(async () => {
      const [part] = await this.db.db.select().from(parts).where(eq(parts.partNo, b.partNo));
      if (!part && !b.serial) throw new DomainError('PART_UNKNOWN', `${b.partNo} is not in the parts catalogue`, 404);
      if (b.source === 'STOCK') {
        // Only free stock can be quarantined from the shelf: parts reserved for task cards stay theirs
        // (release the reservation, or quarantine the part when it is issued, instead).
        const [line] = await this.db.db.select().from(stock).where(and(eq(stock.operatorId, p.operatorId), eq(stock.partNo, b.partNo), eq(stock.location, b.location!))).for('update');
        const held = await this.db.db.select().from(reservations)
          .where(and(eq(reservations.partNo, b.partNo), eq(reservations.location, b.location!), eq(reservations.status, 'RESERVED')));
        const reserved = held.reduce((n: number, h) => n + Number(h.qty), 0);
        const free = (line?.qty ?? 0) - reserved;
        if (free < b.qty) {
          throw new DomainError('NOT_FREE', `${b.location} holds ${line?.qty ?? 0} × ${b.partNo}, ${reserved} reserved for task cards (${[...new Set(held.map(h => h.taskCardId))].join(', ') || '—'}); only ${Math.max(0, free)} can be quarantined`, 422);
        }
        await this.db.db.update(stock).set({ qty: sql`${stock.qty} - ${b.qty}` }).where(and(eq(stock.operatorId, p.operatorId), eq(stock.partNo, b.partNo), eq(stock.location, b.location!)));
      }
      const n = await this.db.db.execute<{ n: string }>(sql`select nextval('amo.ncr_seq')::text as n`);
      const id = `NCR-${n.rows[0].n.padStart(4, '0')}`;
      await this.db.db.insert(nonconformities).values({ id, operatorId: p.operatorId, partNo: b.partNo, serial: b.serial, qty: b.qty, location: b.location, source: b.source,
        description: b.description, raisedBy: actorOf(p), status: 'QUARANTINED', version: 1 });
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'ncr.raised', entityType: 'nonconformity', entityId: id, data: b });
      return id;
    });
    return this.get(p, id);
  }

  async dispose(p: Principal, id: string, b: { disposition: Disposition; reason: string; releaseRef: string | null; version: number }): Promise<NonconformityDto> {
    const first = await this.row(id);
    await this.authz.check(p, this.resource(first.operatorId, id), 'disposition');
    await this.db.transaction(async () => {
      const r = await this.row(id, true);
      if (r.version !== b.version) throw new DomainError('CHANGED', `${id} was changed by someone else — reload`, 409);
      const next = dispose(toDomain(r), b.disposition, b.reason, actorOf(p), b.releaseRef);
      // Back to stock only from where it came (or the default store for receiving and removals).
      if (b.disposition === 'RETURN_TO_STOCK') {
        const [part] = await this.db.db.select().from(parts).where(eq(parts.partNo, r.partNo));
        if (!part) throw new DomainError('PART_UNKNOWN', `${r.partNo} is not a stocked part; install it from the component records instead`, 422);
        const location = r.location ?? 'ENGM';
        await this.db.db.insert(stock).values({ operatorId: p.operatorId, partNo: r.partNo, location, qty: r.qty })
          .onConflictDoUpdate({ target: [stock.operatorId, stock.partNo, stock.location], set: { qty: sql`${stock.qty} + ${r.qty}` } });
      }
      await this.db.db.update(nonconformities).set({ status: next.status, disposition: b.disposition, dispositionReason: b.reason.trim(), releaseRef: b.releaseRef,
        dispositionedBy: actorOf(p), dispositionedAt: new Date(), version: next.version }).where(eq(nonconformities.id, id));
      await this.audit.record(this.db, CHAIN, { operatorId: r.operatorId, actor: actorOf(p), action: 'ncr.dispositioned', entityType: 'nonconformity', entityId: id,
        data: { disposition: b.disposition, reason: b.reason, releaseRef: b.releaseRef } });
      if (next.status === 'SCRAP_PENDING') {
        await this.notifications.raise(this.db, { operatorId: r.operatorId, actor: 'system:stores', severity: 'amber', link: `/amo/ncr?ncr=${id}`,
          title: `${id}: ${r.partNo}${r.serial ? ` s/n ${r.serial}` : ''} to be scrapped`, body: 'Mutilate it and record the witness (a second person).' });
      }
    });
    return this.get(p, id);
  }

  async mutilate(p: Principal, id: string, b: { method: string; version: number }): Promise<NonconformityDto> {
    const first = await this.row(id);
    await this.authz.check(p, this.resource(first.operatorId, id), 'witness');
    await this.db.transaction(async () => {
      const r = await this.row(id, true);
      if (r.version !== b.version) throw new DomainError('CHANGED', `${id} was changed by someone else — reload`, 409);
      const next = witnessMutilation(toDomain(r), actorOf(p), b.method);
      const at = new Date();
      await this.db.db.update(nonconformities).set({ status: next.status, mutilationMethod: b.method.trim(), mutilatedBy: actorOf(p), mutilatedAt: at, version: next.version })
        .where(eq(nonconformities.id, id));
      await this.audit.record(this.db, CHAIN, { operatorId: r.operatorId, actor: actorOf(p), action: 'ncr.scrapped', entityType: 'nonconformity', entityId: id,
        data: { partNo: r.partNo, serial: r.serial, qty: r.qty, method: b.method.trim(), dispositionedBy: r.dispositionedBy } });
      await this.outbox.add(this.db, { type: 'amo.part.scrapped', data: { ncrId: id, partNo: r.partNo, serial: r.serial, method: b.method.trim(), at: at.toISOString() } },
        { operatorId: r.operatorId, actor: actorOf(p) });
    });
    return this.get(p, id);
  }
}

const raiseSchema = z.object({
  partNo: z.string().trim().min(2).max(60), serial: z.string().trim().min(1).max(60).nullable().default(null), qty: z.number().int().positive().max(10_000).default(1),
  location: z.string().trim().min(2).max(10).nullable().default(null), source: z.enum(['RECEIVING', 'STOCK', 'REMOVAL', 'SHOP', 'AUDIT']),
  description: z.string().trim().min(10).max(3000)
});
const disposeSchema = z.object({
  disposition: z.enum(['SCRAP', 'RETURN_TO_VENDOR', 'RETURN_TO_STOCK']), reason: z.string().trim().min(10).max(3000),
  releaseRef: z.string().trim().max(120).nullable().default(null), version: z.number().int().positive()
});
const mutilateSchema = z.object({ method: z.string().trim().min(5).max(500), version: z.number().int().positive() });

@Controller('amo/ncr')
export class NonconformityController {
  constructor(private readonly ncr: NonconformityService) {}

  @Get()
  list(@CurrentPrincipal() p: Principal, @Query('scope') scope?: string) { return this.ncr.list(p, scope === 'all' ? 'all' : 'open'); }

  @Get(':id')
  get(@CurrentPrincipal() p: Principal, @Param('id') id: string) { return this.ncr.get(p, id); }

  @Post()
  raise(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(raiseSchema)) b: z.infer<typeof raiseSchema>) { return this.ncr.raise(p, b); }

  @Post(':id/disposition')
  dispose(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(disposeSchema)) b: z.infer<typeof disposeSchema>) { return this.ncr.dispose(p, id, b); }

  @Post(':id/mutilation')
  mutilate(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(mutilateSchema)) b: z.infer<typeof mutilateSchema>) { return this.ncr.mutilate(p, id, b); }
}

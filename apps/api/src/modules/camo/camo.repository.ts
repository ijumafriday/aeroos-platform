import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { MelCategory } from '@aeroos/compliance';
import type { FleetTailDto, MelItemDto, Trade } from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import type { EngineeringOrder, MelItem, MelStatus } from '@aeroos/mro-domain';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { engineeringOrders, fleet, melItems } from './camo.tables';

type Row = typeof melItems.$inferSelect;

const toDomain = (r: Row): MelItem => ({ ...r, category: r.category as MelCategory, status: r.status as MelStatus });

export const melToDto = (m: MelItem): MelItemDto => ({
  id: m.id,
  operatorId: m.operatorId,
  tail: m.tail,
  aircraftType: m.aircraftType,
  melRef: m.melRef,
  ata: m.ata,
  category: m.category,
  title: m.title,
  description: m.description,
  raisedAt: m.raisedAt.toISOString(),
  raisedBy: m.raisedBy,
  originalDeadline: m.originalDeadline.toISOString(),
  deadline: m.deadline.toISOString(),
  deadlineRule: m.deadlineRule,
  deadlineBasis: m.deadlineBasis,
  extensions: m.extensions,
  status: m.status,
  eoId: m.eoId,
  closedAt: m.closedAt?.toISOString() ?? null,
  closedBy: m.closedBy,
  closureRef: m.closureRef
});

/** Public query surface for other modules (AMO needs the aircraft type of a tail). */
@Injectable()
export class FleetQuery {
  constructor(@Inject(DB_TOKEN.camo) private readonly db: ModuleDb) {}

  async get(reg: string): Promise<FleetTailDto | null> {
    const [r] = await this.db.db.select().from(fleet).where(eq(fleet.reg, reg)).limit(1);
    return r ? { reg: r.reg, operatorId: r.operatorId, type: r.aircraftType, msn: r.msn, status: r.status as FleetTailDto['status'] } : null;
  }

  async list(operatorId: string): Promise<FleetTailDto[]> {
    const rows = await this.db.db.select().from(fleet).where(eq(fleet.operatorId, operatorId)).orderBy(asc(fleet.reg));
    return rows.map(r => ({ reg: r.reg, operatorId: r.operatorId, type: r.aircraftType, msn: r.msn, status: r.status as FleetTailDto['status'] }));
  }
}

@Injectable()
export class MelRepository {
  constructor(@Inject(DB_TOKEN.camo) private readonly db: ModuleDb) {}

  private async next(seq: 'mel_seq' | 'eo_seq'): Promise<string> {
    const r = await this.db.db.execute<{ n: string }>(sql.raw(`select nextval('camo.${seq}')::text as n`));
    return r.rows[0].n;
  }

  async nextMelId() {
    return `DD-${await this.next('mel_seq')}`;
  }

  async nextEoId() {
    return `EO-${new Date().getUTCFullYear()}-${(await this.next('eo_seq')).padStart(4, '0')}`;
  }

  /** Load one item; `lock` takes a row lock for the rest of the transaction. */
  async get(id: string, opts: { lock?: boolean } = {}): Promise<MelItem | null> {
    const q = this.db.db.select().from(melItems).where(eq(melItems.id, id)).limit(1);
    const [r] = opts.lock ? await q.for('update') : await q;
    return r ? toDomain(r) : null;
  }

  async require(id: string, opts: { lock?: boolean } = {}): Promise<MelItem> {
    const m = await this.get(id, opts);
    if (!m) throw new DomainError('MEL_NOT_FOUND', `Deferral ${id} not found`, 404);
    return m;
  }

  async byEoId(eoId: string): Promise<MelItem | null> {
    const [r] = await this.db.db.select().from(melItems).where(eq(melItems.eoId, eoId)).limit(1);
    return r ? toDomain(r) : null;
  }

  async list(operatorId: string, statuses: MelStatus[]): Promise<MelItem[]> {
    const rows = await this.db.db.select().from(melItems)
      .where(and(eq(melItems.operatorId, operatorId), inArray(melItems.status, statuses)))
      .orderBy(asc(melItems.deadline))
      .limit(500);
    return rows.map(toDomain);
  }

  async recentClosed(operatorId: string, limit: number): Promise<MelItem[]> {
    const rows = await this.db.db.select().from(melItems)
      .where(and(eq(melItems.operatorId, operatorId), eq(melItems.status, 'CLOSED')))
      .orderBy(desc(melItems.closedAt))
      .limit(limit);
    return rows.map(toDomain);
  }

  async count(operatorId: string): Promise<number> {
    const r = await this.db.db.execute<{ n: string }>(sql`select count(*)::text as n from camo.mel_items where operator_id = ${operatorId}`);
    return Number(r.rows[0].n);
  }

  async insert(m: MelItem) {
    await this.db.db.insert(melItems).values({ ...m });
  }

  /** Optimistic concurrency: the update applies only if nobody changed the row since it was read. */
  async update(next: MelItem, expectedVersion: number) {
    const { id, ...rest } = next;
    const r = await this.db.db.update(melItems).set(rest)
      .where(and(eq(melItems.id, id), eq(melItems.version, expectedVersion)))
      .returning({ id: melItems.id });
    if (!r.length) throw new DomainError('CONCURRENT_UPDATE', `Deferral ${id} was changed by someone else. Reload and try again.`, 409);
  }

  async insertEo(eo: EngineeringOrder) {
    await this.db.db.insert(engineeringOrders).values({
      id: eo.id, operatorId: eo.operatorId, tail: eo.tail, aircraftType: eo.aircraftType, title: eo.title, ata: eo.ata, trade: eo.trade,
      sourceType: eo.source.type, sourceId: eo.source.id, steps: eo.steps, estimatedHours: eo.estimatedHours, status: eo.status,
      createdAt: eo.createdAt, createdBy: eo.createdBy
    });
  }

  async getEo(id: string) {
    const [r] = await this.db.db.select().from(engineeringOrders).where(eq(engineeringOrders.id, id)).limit(1);
    return r ? { ...r, trade: r.trade as Trade, createdAt: r.createdAt.toISOString() } : null;
  }
}

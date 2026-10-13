import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { link, recordOf, verifyChain, type AuditRecord } from '@aeroos/audit';
import type { AuditEntryDto, AuditVerifyDto } from '@aeroos/contracts';
import { DB_TOKEN, type ModuleDb } from '../database/module-db';
import { auditLog } from '../database/platform.tables';

export interface AuditInput {
  /** The operator the entry concerns (null only for platform-wide events). Used to scope the audit view. */
  operatorId: string | null;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  data: Record<string, unknown>;
  rule?: string | null;
  at?: Date;
}

/**
 * Writes to a module's hash chain inside that module's transaction, so the audit entry exists
 * if and only if the change committed. An advisory lock per chain serialises appends.
 */
@Injectable()
export class AuditService {
  async record(mdb: ModuleDb, chain: string, e: AuditInput): Promise<string> {
    mdb.requireTransaction('Writing an audit entry');
    await mdb.db.execute(sql`select pg_advisory_xact_lock(hashtext(${'audit:' + chain}))`);
    const [head] = await mdb.db
      .select({ hash: auditLog.hash })
      .from(auditLog)
      .where(eq(auditLog.chain, chain))
      .orderBy(desc(auditLog.seq))
      .limit(1);
    const record: AuditRecord = {
      chain,
      at: (e.at ?? new Date()).toISOString(),
      actor: e.actor,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      data: JSON.parse(JSON.stringify(e.data)) as Record<string, unknown>, // exactly what jsonb will hold
      rule: e.rule ?? null,
      ...(e.operatorId ? { operatorId: e.operatorId } : {})
    };
    const l = link(head ?? null, record);
    await mdb.db.insert(auditLog).values({
      chain,
      at: new Date(record.at),
      actor: record.actor,
      action: record.action,
      entityType: record.entityType,
      entityId: record.entityId,
      data: record.data,
      rule: record.rule,
      prevHash: l.prevHash,
      hash: l.hash,
      operatorId: e.operatorId
    });
    return l.hash;
  }
}

/** Read side, using the platform role (read-only on the audit log). */
@Injectable()
export class AuditQuery {
  constructor(@Inject(DB_TOKEN.platform) private readonly db: ModuleDb) {}

  async forEntity(operatorId: string, entityType: string, entityId: string): Promise<AuditEntryDto[]> {
    const rows = await this.db.db.select().from(auditLog)
      .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId), or(eq(auditLog.operatorId, operatorId), isNull(auditLog.operatorId))))
      .orderBy(asc(auditLog.seq));
    return rows.map(toDto);
  }

  /** Latest entries of a chain for one operator (plus entries from before operator tagging, which have none). */
  async recent(chain: string, operatorId: string, limit: number): Promise<AuditEntryDto[]> {
    const rows = await this.db.db.select().from(auditLog)
      .where(and(eq(auditLog.chain, chain), or(eq(auditLog.operatorId, operatorId), isNull(auditLog.operatorId))))
      .orderBy(desc(auditLog.seq)).limit(limit);
    return rows.map(toDto);
  }

  /** Recompute every hash in the chain from the stored records. */
  async verify(chain: string): Promise<Omit<AuditVerifyDto, 'anchor'>> {
    const rows = await this.db.db.select().from(auditLog).where(eq(auditLog.chain, chain)).orderBy(asc(auditLog.seq));
    const r = verifyChain(chain, rows.map(x => ({
      seq: x.seq,
      prevHash: x.prevHash,
      hash: x.hash,
      record: recordOf(x)
    })));
    return {
      chain,
      ok: r.ok,
      count: r.count,
      head: r.ok ? r.head : null,
      brokenAtSeq: r.ok ? null : r.brokenAtSeq,
      reason: r.ok ? null : r.reason,
      verifiedAt: new Date().toISOString()
    };
  }
}

const toDto = (x: typeof auditLog.$inferSelect): AuditEntryDto => ({
  seq: x.seq,
  chain: x.chain,
  at: x.at.toISOString(),
  actor: x.actor,
  action: x.action,
  entityType: x.entityType,
  entityId: x.entityId,
  data: x.data,
  rule: x.rule,
  prevHash: x.prevHash,
  hash: x.hash
});

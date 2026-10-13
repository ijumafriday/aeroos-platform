import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { AuditVerifyDto } from '@aeroos/contracts';
import type { KeyService, SignatureEnvelope } from '@aeroos/signing';
import { DB_TOKEN, type ModuleDb } from '../database/module-db';
import { auditAnchors, auditLog } from '../database/platform.tables';
import { KEY_SERVICE } from '../keys/keys.provider';
import { ObjectStore } from '../storage/object-store';

export interface AnchorBody { chain: string; seq: number; hash: string; anchoredAt: string }

/**
 * External anchoring of the audit chains (ADR-0005). Every hour the head of each chain is signed
 * and written to a write-once (Object Lock, COMPLIANCE mode) bucket. A database superuser could
 * rebuild a chain consistently, but could not rewrite an anchored object or forge its signature —
 * so verification compares the live chain with the latest anchor.
 */
@Injectable()
export class AnchorService {
  private readonly log = new Logger('Anchors');

  constructor(
    @Inject(DB_TOKEN.platform) private readonly db: ModuleDb,
    private readonly store: ObjectStore,
    @Inject(KEY_SERVICE) private readonly keys: KeyService
  ) {}

  async anchorAll(): Promise<{ chain: string; seq: number | null; anchored: boolean }[]> {
    const chains = await this.db.db.execute<{ chain: string }>(sql`select distinct chain from platform.audit_log`);
    const out: { chain: string; seq: number | null; anchored: boolean }[] = [];
    for (const { chain } of chains.rows) out.push(await this.anchor(chain));
    return out;
  }

  async anchor(chain: string): Promise<{ chain: string; seq: number | null; anchored: boolean }> {
    const [head] = await this.db.db.select({ seq: auditLog.seq, hash: auditLog.hash }).from(auditLog)
      .where(eq(auditLog.chain, chain)).orderBy(desc(auditLog.seq)).limit(1);
    if (!head) return { chain, seq: null, anchored: false };
    const [last] = await this.db.db.select({ seq: auditAnchors.seq }).from(auditAnchors)
      .where(eq(auditAnchors.chain, chain)).orderBy(desc(auditAnchors.seq)).limit(1);
    if (last && last.seq >= head.seq) return { chain, seq: head.seq, anchored: false };

    const anchoredAt = new Date();
    const body: AnchorBody = { chain, seq: head.seq, hash: head.hash, anchoredAt: anchoredAt.toISOString() };
    const signature = await this.keys.sign(body, anchoredAt);
    const objectKey = `${chain}/${String(head.seq).padStart(12, '0')}-${head.hash}.json`;
    await this.store.putAnchor(objectKey, JSON.stringify({ ...body, signature }, null, 2));
    await this.db.db.insert(auditAnchors).values({
      chain, seq: head.seq, hash: head.hash, anchoredAt, objectKey, signature: signature as unknown as Record<string, unknown>
    }).onConflictDoNothing();
    this.log.log(`anchored ${chain} at seq ${head.seq}`);
    return { chain, seq: head.seq, anchored: true };
  }

  /**
   * Compare the latest anchor with the live chain and with the object in the write-once bucket.
   * `matches` is true only if all three agree and the anchor signature verifies.
   */
  async check(chain: string): Promise<AuditVerifyDto['anchor']> {
    const [a] = await this.db.db.select().from(auditAnchors).where(eq(auditAnchors.chain, chain)).orderBy(desc(auditAnchors.seq)).limit(1);
    if (!a) return null;
    const [row] = await this.db.db.select({ hash: auditLog.hash }).from(auditLog).where(and(eq(auditLog.chain, chain), eq(auditLog.seq, a.seq))).limit(1);
    let matches = !!row && row.hash === a.hash;
    if (matches) {
      try {
        const stored = JSON.parse(await this.store.getAnchor(a.objectKey)) as AnchorBody & { signature: SignatureEnvelope };
        const body: AnchorBody = { chain: stored.chain, seq: stored.seq, hash: stored.hash, anchoredAt: stored.anchoredAt };
        matches = stored.hash === a.hash && stored.seq === a.seq && (await this.keys.verify(body, stored.signature));
      } catch (e) {
        this.log.warn(`anchor object ${a.objectKey} unreadable: ${(e as Error).message}`);
        matches = false;
      }
    }
    return { seq: a.seq, hash: a.hash, anchoredAt: a.anchoredAt.toISOString(), objectKey: a.objectKey, matches };
  }
}

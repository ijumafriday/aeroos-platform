import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { topicFor, type DomainEvent, type EventEnvelope } from '@aeroos/contracts';
import { newId } from '@aeroos/kernel';
import { DB_TOKEN, type ModuleDb } from '../database/module-db';
import { deadLetters, inbox, outbox } from '../database/platform.tables';
import { Metrics } from '../observability/metrics';
import { KafkaService } from './kafka.service';

/**
 * Transactional outbox. A module writes its events in the same database transaction as its state
 * change, so an event is published if and only if the change committed. The relay then ships
 * unpublished rows to Kafka.
 */
@Injectable()
export class OutboxService {
  async add(mdb: ModuleDb, ev: DomainEvent, ctx: { operatorId: string; actor: string; correlationId?: string | null }): Promise<EventEnvelope> {
    mdb.requireTransaction('Writing to the outbox');
    const env: EventEnvelope = {
      id: newId(),
      type: ev.type,
      data: ev.data,
      occurredAt: new Date().toISOString(),
      operatorId: ctx.operatorId,
      actor: ctx.actor,
      correlationId: ctx.correlationId ?? null
    };
    // Partition by aircraft where there is one, so events about the same tail stay in order.
    const key = (ev.data as { tail?: string }).tail ?? ctx.operatorId;
    await mdb.db.insert(outbox).values({ id: env.id, topic: topicFor(ev.type), key, type: ev.type, payload: env });
    return env;
  }
}

@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('OutboxRelay');
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(@Inject(DB_TOKEN.platform) private readonly db: ModuleDb, private readonly kafka: KafkaService) {}

  onApplicationBootstrap() {
    this.schedule(0);
    // Backlog and age of the oldest unpublished event: the first thing to look at when the UI seems stale.
    Metrics.meter.createObservableGauge('aeroos_outbox_backlog', { description: 'Unpublished outbox events' })
      .addCallback(async r => r.observe((await this.backlog()).count));
    Metrics.meter.createObservableGauge('aeroos_outbox_oldest_age_seconds', { description: 'Age of the oldest unpublished event' })
      .addCallback(async r => r.observe((await this.backlog()).ageSeconds));
    Metrics.meter.createObservableGauge('aeroos_dead_letters', { description: 'Events parked after consumer retries are exhausted' })
      .addCallback(async r => {
        const [v] = await this.db.db.select({ count: sql<number>`count(*)::int` }).from(deadLetters).catch(() => [{ count: 0 }]);
        r.observe(Number(v?.count ?? 0));
      });
  }

  private backlogCache: { at: number; value: Promise<{ count: number; ageSeconds: number }> } | null = null;

  /** One query per collection cycle for both gauges. */
  private backlog(): Promise<{ count: number; ageSeconds: number }> {
    if (!this.backlogCache || Date.now() - this.backlogCache.at > 5_000) {
      this.backlogCache = {
        at: Date.now(),
        value: this.db.db.select({ count: sql<number>`count(*)::int`, age: sql<number>`coalesce(extract(epoch from now() - min(${outbox.createdAt})), 0)::float8` })
          .from(outbox).where(isNull(outbox.publishedAt))
          .then(([r]) => ({ count: Number(r?.count ?? 0), ageSeconds: Number(r?.age ?? 0) }))
          .catch(() => ({ count: 0, ageSeconds: 0 }))
      };
    }
    return this.backlogCache.value;
  }

  onApplicationShutdown() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private async tick() {
    let next = 300;
    try {
      const sent = await this.drain();
      if (sent > 0) next = 0; // keep draining while there is a backlog
    } catch (e) {
      this.log.warn(`relay paused: ${(e as Error).message}`);
      next = 3000;
    }
    this.schedule(next);
  }

  /** Publish up to 200 pending events. SKIP LOCKED lets several replicas relay in parallel. */
  private drain(): Promise<number> {
    return this.db.transaction(async () => {
      const rows = await this.db.db
        .select()
        .from(outbox)
        .where(isNull(outbox.publishedAt))
        .orderBy(asc(outbox.createdAt))
        .limit(200)
        .for('update', { skipLocked: true });
      if (!rows.length) return 0;
      await this.kafka.publish(rows.map(r => ({ topic: r.topic, key: r.key, envelope: r.payload })));
      await this.db.db.update(outbox).set({ publishedAt: new Date() }).where(inArray(outbox.id, rows.map(r => r.id)));
      for (const r of rows) Metrics.eventsPublished.add(1, { topic: r.topic });
      return rows.length;
    });
  }
}

/**
 * Exactly-once processing on top of at-least-once delivery: the consumer records the event id in
 * the same transaction as its own state change, and skips events it has already processed.
 */
@Injectable()
export class InboxService {
  async once(mdb: ModuleDb, consumer: string, env: EventEnvelope, fn: () => Promise<void>): Promise<boolean> {
    return mdb.transaction(async () => {
      const claimed = await mdb.db
        .insert(inbox)
        .values({ consumer, eventId: env.id })
        .onConflictDoNothing()
        .returning({ eventId: inbox.eventId });
      if (!claimed.length) return false;
      await fn();
      return true;
    });
  }

  /** For diagnostics: has this consumer processed the event? */
  async seen(mdb: ModuleDb, consumer: string, eventId: string) {
    const r = await mdb.db.select().from(inbox).where(and(eq(inbox.consumer, consumer), eq(inbox.eventId, eventId))).limit(1);
    return r.length > 0;
  }
}

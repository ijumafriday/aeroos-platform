import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { BadRequestException, Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { EVENT_TYPES, TOPICS, type EventEnvelope, type EventType } from '@aeroos/contracts';
import { newId } from '@aeroos/kernel';
import type { KeyService } from '@aeroos/signing';
import { CONFIG, type Config } from '../../config';
import { DB_TOKEN, type ModuleDb } from '../database/module-db';
import { KEY_SERVICE } from '../keys/keys.provider';
import { KafkaService } from '../events/kafka.service';
import { webhookDeliveries, webhookSubscriptions } from '../database/platform.tables';
import { runTenantContext } from '../database/tenant-context';
import { Metrics } from '../observability/metrics';

const MAX_ATTEMPTS = 8;
const EVENT_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

function privateAddress(ip: string): boolean {
  if (ip === '::1' || ip === '0.0.0.0') return true;
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;
  if (!isIP(ip)) return true;
  if (ip.includes(':')) return false;
  const [a,b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

@Injectable()
export class WebhookService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Webhooks');
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB_TOKEN.platform) private readonly db: ModuleDb,
    @Inject(KEY_SERVICE) private readonly keys: KeyService,
    private readonly kafka: KafkaService
  ) {}

  onApplicationBootstrap() {
    this.kafka.start('aeroos-webhook-enqueue-v1', Object.values(TOPICS), env => this.enqueue(env), { fromBeginning: false });
    this.schedule(500);
  }

  onApplicationShutdown() { this.stopped = true; if (this.timer) clearTimeout(this.timer); }
  private schedule(ms: number) { if (!this.stopped) this.timer = setTimeout(() => void this.tick(), ms); }
  private async tick() { try { await this.deliverDue(); } catch (e) { this.log.warn((e as Error).message); } this.schedule(1000); }

  async validateEndpoint(raw: string): Promise<string> {
    let u: URL;
    try { u = new URL(raw); } catch { throw new BadRequestException('endpoint must be a valid URL'); }
    if (!['http:','https:'].includes(u.protocol)) throw new BadRequestException('webhook endpoint must use HTTP(S)');
    if (this.config.NODE_ENV === 'production' && u.protocol !== 'https:') throw new BadRequestException('production webhooks require HTTPS');
    if (u.username || u.password) throw new BadRequestException('webhook endpoint must not contain credentials');
    if (this.config.NODE_ENV === 'production') {
      const addresses = await lookup(u.hostname, { all: true });
      if (!addresses.length || addresses.some(a => privateAddress(a.address))) throw new BadRequestException('webhook endpoint resolves to a private or local address');
    }
    return u.toString();
  }

  validateEventTypes(types: string[]): EventType[] {
    const known = new Set<string>(EVENT_TYPES);
    for (const t of types) {
      if (!EVENT_PATTERN.test(t) || !known.has(t)) throw new BadRequestException(`unknown event type ${t}`);
    }
    return [...new Set(types)] as EventType[];
  }

  async create(operatorId: string, actor: string, input: { name: string; endpoint: string; eventTypes: string[] }) {
    const endpoint = await this.validateEndpoint(input.endpoint);
    const eventTypes = this.validateEventTypes(input.eventTypes);
    if (!eventTypes.length) throw new BadRequestException('eventTypes must not be empty');
    const id = newId();
    await this.db.db.insert(webhookSubscriptions).values({ id, operatorId, name: input.name.trim(), endpoint, eventTypes, createdBy: actor });
    return { id, operatorId, name: input.name.trim(), endpoint, eventTypes, active: true };
  }

  list(operatorId: string) { return this.db.db.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.operatorId, operatorId)).orderBy(asc(webhookSubscriptions.createdAt)); }
  deliveries(operatorId: string, subscriptionId: string) { return this.db.db.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.operatorId, operatorId), eq(webhookDeliveries.subscriptionId, subscriptionId))).orderBy(sql`${webhookDeliveries.createdAt} desc`).limit(100); }
  async setActive(operatorId: string, id: string, active: boolean) { await this.db.db.update(webhookSubscriptions).set({ active, updatedAt: new Date() }).where(and(eq(webhookSubscriptions.operatorId, operatorId), eq(webhookSubscriptions.id, id))); return { id, active }; }

  private enqueue(env: EventEnvelope) {
    return runTenantContext({ operatorId: env.operatorId, system: false }, async () => {
      const subs = await this.db.db.select().from(webhookSubscriptions).where(and(eq(webhookSubscriptions.operatorId, env.operatorId), eq(webhookSubscriptions.active, true)));
      for (const sub of subs.filter(s => s.eventTypes.includes(env.type))) {
        await this.db.db.insert(webhookDeliveries).values({ id: newId(), operatorId: env.operatorId, subscriptionId: sub.id, eventId: env.id, eventType: env.type, payload: env }).onConflictDoNothing();
      }
    });
  }

  private deliverDue() {
    return runTenantContext({ operatorId: '', system: true }, () => this.db.transaction(async () => {
      const rows = await this.db.db.select().from(webhookDeliveries)
        .where(and(eq(webhookDeliveries.status, 'PENDING'), lte(webhookDeliveries.nextAttemptAt, new Date())))
        .orderBy(asc(webhookDeliveries.nextAttemptAt)).limit(25).for('update', { skipLocked: true });
      for (const row of rows) {
        const [sub] = await this.db.db.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.id, row.subscriptionId)).limit(1);
        if (!sub?.active) continue;
        const signature = await this.keys.sign(row.payload, new Date());
        let status: number | null = null; let error: string | null = null;
        try {
          await this.validateEndpoint(sub.endpoint);
          const res = await fetch(sub.endpoint, { method: 'POST', headers: {
            'content-type': 'application/json', 'user-agent': 'AeroOS-Webhooks/1.0',
            'x-aeroos-event-id': row.eventId, 'x-aeroos-event-type': row.eventType,
            'x-aeroos-key-id': signature.keyId, 'x-aeroos-signed-at': signature.signedAt,
            'x-aeroos-payload-sha256': signature.payloadSha256, 'x-aeroos-signature': signature.signature
          }, body: JSON.stringify(row.payload), signal: AbortSignal.timeout(10_000), redirect: 'error' });
          status = res.status;
          if (!res.ok) error = `HTTP ${res.status}`;
        } catch (e) { error = (e as Error).message.slice(0, 1000); }
        const attempts = row.attempts + 1;
        if (!error) {
          await this.db.db.update(webhookDeliveries).set({ status: 'DELIVERED', attempts, lastStatus: status, lastError: null, deliveredAt: new Date() }).where(eq(webhookDeliveries.id, row.id));
          Metrics.webhookDeliveries.add(1, { outcome: 'delivered', eventType: row.eventType });
        } else {
          const exhausted = attempts >= MAX_ATTEMPTS;
          const delay = Math.min(3600, 2 ** attempts * 5);
          await this.db.db.update(webhookDeliveries).set({ status: exhausted ? 'FAILED' : 'PENDING', attempts, lastStatus: status, lastError: error, nextAttemptAt: new Date(Date.now() + delay * 1000) }).where(eq(webhookDeliveries.id, row.id));
          Metrics.webhookDeliveries.add(1, { outcome: exhausted ? 'failed' : 'retry', eventType: row.eventType });
        }
      }
    }));
  }
}

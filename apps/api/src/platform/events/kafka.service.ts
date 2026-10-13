import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Kafka, logLevel, type Consumer, type Producer } from 'kafkajs';
import { TOPICS, type EventEnvelope } from '@aeroos/contracts';
import { newId } from '@aeroos/kernel';
import { CONFIG, type Config } from '../../config';
import { DB_TOKEN, type ModuleDb } from '../database/module-db';
import { deadLetters } from '../database/platform.tables';

export type EventHandler = (env: EventEnvelope) => Promise<void>;

const MAX_ATTEMPTS = 8;

/**
 * Kafka access behind one small surface. Producers are idempotent; consumers retry a failing
 * message with backoff and then park it in platform.dead_letters so one bad event never blocks
 * a partition. Swap kafkajs for another client here without touching the modules.
 */
@Injectable()
export class KafkaService implements OnApplicationShutdown {
  private readonly log = new Logger('Kafka');
  private readonly kafka: Kafka;
  private producer: Producer | null = null;
  private readonly consumers: Consumer[] = [];
  private topicsReady: Promise<void> | null = null;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB_TOKEN.platform) private readonly platformDb: ModuleDb
  ) {
    this.kafka = new Kafka({
      clientId: `${config.KAFKA_CLIENT_ID}-${config.INSTANCE_ID}`,
      brokers: config.KAFKA_BROKERS,
      logLevel: logLevel.WARN,
      retry: { retries: 10, initialRetryTime: 500, maxRetryTime: 15_000 }
    });
  }

  /** Create the versioned topics once (auto-creation is disabled on the brokers). */
  ensureTopics(): Promise<void> {
    this.topicsReady ??= (async () => {
      const admin = this.kafka.admin();
      await admin.connect();
      try {
        const existing = new Set(await admin.listTopics());
        const missing = Object.values(TOPICS).filter(t => !existing.has(t));
        if (missing.length) {
          await admin.createTopics({
            waitForLeaders: true,
            topics: missing.map(topic => ({ topic, numPartitions: this.config.KAFKA_PARTITIONS, replicationFactor: this.config.KAFKA_REPLICATION }))
          });
          this.log.log(`created topics ${missing.join(', ')}`);
        }
      } finally {
        await admin.disconnect();
      }
    })().catch(e => {
      this.topicsReady = null;
      throw e;
    });
    return this.topicsReady;
  }

  async publish(messages: { topic: string; key: string; envelope: EventEnvelope }[]) {
    if (!messages.length) return;
    await this.ensureTopics();
    const producer: Producer = this.producer ?? (await this.connectProducer());
    const byTopic = new Map<string, { key: string; value: string; headers: Record<string, string> }[]>();
    for (const m of messages) {
      const list = byTopic.get(m.topic) ?? [];
      list.push({ key: m.key, value: JSON.stringify(m.envelope), headers: { 'event-type': m.envelope.type, 'event-id': m.envelope.id } });
      byTopic.set(m.topic, list);
    }
    await producer.sendBatch({ topicMessages: [...byTopic].map(([topic, msgs]) => ({ topic, messages: msgs })) });
  }

  private async connectProducer(): Promise<Producer> {
    const p: Producer = this.kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
    await p.connect();
    this.producer = p;
    return p;
  }

  /**
   * Subscribe a consumer group. `fromBeginning` is true for business consumers (they must see every
   * event, deduplicated by the inbox) and false for the live fan-out (only new events matter).
   */
  async subscribe(groupId: string, topics: string[], handler: EventHandler, opts: { fromBeginning: boolean } = { fromBeginning: true }) {
    await this.ensureTopics();
    const consumer = this.kafka.consumer({ groupId, sessionTimeout: 30_000 });
    await consumer.connect();
    await consumer.subscribe({ topics, fromBeginning: opts.fromBeginning });
    this.consumers.push(consumer);
    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        if (!message.value) return;
        const env = JSON.parse(message.value.toString()) as EventEnvelope;
        for (let attempt = 1; ; attempt++) {
          try {
            await handler(env);
            return;
          } catch (e) {
            if (attempt >= MAX_ATTEMPTS) {
              this.log.error(`${groupId}: ${env.type} ${env.id} failed ${attempt} times; dead-lettered: ${(e as Error).message}`);
              await this.platformDb.db.insert(deadLetters).values({ id: newId(), consumer: groupId, topic, payload: env, error: String((e as Error).stack ?? e) });
              return;
            }
            const wait = Math.min(30_000, 500 * 2 ** attempt);
            this.log.warn(`${groupId}: ${env.type} attempt ${attempt} failed (${(e as Error).message}); retrying in ${wait} ms`);
            await new Promise(r => setTimeout(r, wait));
          }
        }
      }
    });
    this.log.log(`consumer ${groupId} subscribed to ${topics.join(', ')}`);
  }

  /** Start a consumer in the background, retrying until the broker is reachable. Never blocks boot. */
  start(groupId: string, topics: string[], handler: EventHandler, opts: { fromBeginning: boolean } = { fromBeginning: true }) {
    void (async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          await this.subscribe(groupId, topics, handler, opts);
          return;
        } catch (e) {
          this.log.warn(`consumer ${groupId} not started (attempt ${attempt}): ${(e as Error).message}`);
          await new Promise(r => setTimeout(r, Math.min(30_000, 2000 * attempt)));
        }
      }
    })();
  }

  async onApplicationShutdown() {
    await Promise.allSettled(this.consumers.map(c => c.disconnect()));
    await this.producer?.disconnect().catch(() => undefined);
  }
}

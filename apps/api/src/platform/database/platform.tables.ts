import { sql } from 'drizzle-orm';
import { bigint, bigserial, boolean, char, integer, jsonb, pgSchema, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { EventEnvelope } from '@aeroos/contracts';

export const platform = pgSchema('platform');

export const auditLog = platform.table('audit_log', {
  seq: bigserial('seq', { mode: 'number' }).primaryKey(),
  chain: text('chain').notNull(),
  at: timestamp('at', { withTimezone: true, mode: 'date' }).notNull(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  rule: text('rule'),
  prevHash: char('prev_hash', { length: 64 }).notNull(),
  hash: char('hash', { length: 64 }).notNull(),
  operatorId: text('operator_id')
});

export const outbox = platform.table('outbox', {
  id: uuid('id').primaryKey(),
  topic: text('topic').notNull(),
  key: text('key').notNull(),
  type: text('type').notNull(),
  payload: jsonb('payload').$type<EventEnvelope>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' })
});

export const inbox = platform.table('inbox', {
  consumer: text('consumer').notNull(),
  eventId: uuid('event_id').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
}, t => ({ pk: primaryKey({ columns: [t.consumer, t.eventId] }) }));

export const deadLetters = platform.table('dead_letters', {
  id: uuid('id').primaryKey(),
  consumer: text('consumer').notNull(),
  topic: text('topic').notNull(),
  payload: jsonb('payload').notNull(),
  error: text('error').notNull(),
  failedAt: timestamp('failed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
});

export const notifications = platform.table('notifications', {
  id: uuid('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  severity: text('severity').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  link: text('link'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  readBy: text('read_by').array().notNull().default(sql`'{}'::text[]`)
});

export const idempotency = platform.table('idempotency', {
  actor: text('actor').notNull(),
  key: text('key').notNull(),
  status: text('status').notNull(),
  response: jsonb('response'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
}, t => ({ pk: primaryKey({ columns: [t.actor, t.key] }) }));

export const documents = platform.table('documents', {
  id: text('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  ownerType: text('owner_type').notNull(),
  ownerId: text('owner_id').notNull(),
  kind: text('kind').notNull(),
  fileName: text('file_name').notNull(),
  contentType: text('content_type').notNull(),
  objectKey: text('object_key').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  sha256: char('sha256', { length: 64 }),
  status: text('status').notNull(),
  uploadedBy: text('uploaded_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  storedAt: timestamp('stored_at', { withTimezone: true, mode: 'date' })
});

export const auditAnchors = platform.table('audit_anchors', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  chain: text('chain').notNull(),
  seq: bigint('seq', { mode: 'number' }).notNull(),
  hash: char('hash', { length: 64 }).notNull(),
  anchoredAt: timestamp('anchored_at', { withTimezone: true, mode: 'date' }).notNull(),
  objectKey: text('object_key').notNull(),
  signature: jsonb('signature').$type<Record<string, unknown>>().notNull()
});

export const passkeys = platform.table('passkeys', {
  credentialId: text('credential_id').primaryKey(),
  subject: text('subject').notNull(),
  username: text('username').notNull(),
  label: text('label').notNull(),
  publicKeyPem: text('public_key_pem').notNull(),
  alg: integer('alg').notNull(),
  signCount: bigint('sign_count', { mode: 'number' }).notNull().default(0),
  aaguid: text('aaguid').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' })
});

export const webauthnChallenges = platform.table('webauthn_challenges', {
  id: uuid('id').primaryKey(),
  subject: text('subject').notNull(),
  purpose: text('purpose').notNull(),
  context: jsonb('context').$type<Record<string, unknown>>().notNull(),
  nonce: text('nonce').notNull(),
  challenge: text('challenge').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' })
});


export const webhookSubscriptions = platform.table('webhook_subscriptions', {
  id: uuid('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  name: text('name').notNull(),
  endpoint: text('endpoint').notNull(),
  eventTypes: text('event_types').array().notNull(),
  active: boolean('active').notNull().default(true),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
});

export const webhookDeliveries = platform.table('webhook_deliveries', {
  id: uuid('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  subscriptionId: uuid('subscription_id').notNull(),
  eventId: uuid('event_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').$type<EventEnvelope>().notNull(),
  status: text('status').notNull().default('PENDING'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  lastStatus: integer('last_status'),
  lastError: text('last_error'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
}, t => ({ subscriptionEventUnique: unique().on(t.subscriptionId, t.eventId) }));

export const userViews = platform.table('user_views', {
  id: uuid('id').primaryKey(), operatorId: text('operator_id').notNull(), subject: text('subject').notNull(), route: text('route').notNull(), name: text('name').notNull(),
  search: jsonb('search').$type<Record<string, string>>().notNull().default({}), isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(), updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
});

export const savedSearches = platform.table('saved_searches', {
  id: uuid('id').primaryKey(), operatorId: text('operator_id').notNull(), subject: text('subject').notNull(), name: text('name').notNull(), query: text('query').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(), updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
});

export const migrationJobs = platform.table('migration_jobs', {
  id: uuid('id').primaryKey(), operatorId: text('operator_id').notNull(), target: text('target').notNull(), strategy: text('strategy').notNull(), status: text('status').notNull().default('DRAFT'),
  sourceName: text('source_name').notNull(), createdBy: text('created_by').notNull(), createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  validatedBy: text('validated_by'), validatedAt: timestamp('validated_at', { withTimezone: true, mode: 'date' }), appliedBy: text('applied_by'), applyStartedAt: timestamp('apply_started_at', { withTimezone: true, mode: 'date' }), appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'date' }),
  error: text('error'), summary: jsonb('summary').$type<Record<string, unknown>>().notNull().default({})
});

export const migrationRows = platform.table('migration_rows', {
  jobId: uuid('job_id').notNull(), operatorId: text('operator_id').notNull(), rowNo: integer('row_no').notNull(), raw: jsonb('raw').$type<Record<string, unknown>>().notNull(),
  normalized: jsonb('normalized').$type<Record<string, unknown>>(), status: text('status').notNull().default('STAGED'), error: text('error')
}, t => ({ pk: primaryKey({ columns: [t.jobId, t.rowNo] }) }));

export const decisionRules = platform.table('decision_rules', {
  id: uuid('id').primaryKey(), operatorId: text('operator_id').notNull(), name: text('name').notNull(), eventType: text('event_type').notNull(), status: text('status').notNull().default('DRAFT'), priority: integer('priority').notNull().default(100),
  condition: jsonb('condition').$type<Record<string, unknown>>().notNull(), action: jsonb('action').$type<Record<string, unknown>>().notNull(), createdBy: text('created_by').notNull(), createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  activatedBy: text('activated_by'), activatedAt: timestamp('activated_at', { withTimezone: true, mode: 'date' }), retiredBy: text('retired_by'), retiredAt: timestamp('retired_at', { withTimezone: true, mode: 'date' }), changeReason: text('change_reason')
});

export const ruleExecutions = platform.table('rule_executions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(), operatorId: text('operator_id').notNull(), ruleId: uuid('rule_id').notNull(), eventId: uuid('event_id').notNull(), eventType: text('event_type').notNull(), matched: boolean('matched').notNull(), outcome: text('outcome').notNull(), error: text('error'),
  executedAt: timestamp('executed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
});

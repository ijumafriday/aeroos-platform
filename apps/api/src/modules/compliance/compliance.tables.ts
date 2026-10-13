import { boolean, integer, jsonb, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const compliance = pgSchema('compliance');

export const operatorProfiles = compliance.table('operator_profiles', {
  operatorId: text('operator_id').primaryKey(),
  name: text('name').notNull(),
  authority: text('authority').notNull(),
  melTimeZone: text('mel_time_zone').notNull(),
  approvedTypes: text('approved_types').array().notNull()
});

export const melEntries = compliance.table('mel_entries', {
  operatorId: text('operator_id').notNull(),
  ref: text('ref').notNull(),
  ata: text('ata').notNull(),
  title: text('title').notNull(),
  category: text('category').notNull(),
  intervalHours: integer('interval_hours'),
  extensionPermitted: boolean('extension_permitted').notNull(),
  opsProcedure: text('ops_procedure'),
  maintProcedure: text('maint_procedure')
}, t => ({ pk: primaryKey({ columns: [t.operatorId, t.ref] }) }));

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const masterDataSets = compliance.table('master_data_sets', {
  id: uuid('id').primaryKey(), operatorId: text('operator_id').notNull(), key: text('key').notNull(), domain: text('domain').notNull(), title: text('title').notNull(),
  sourceRef: text('source_ref').notNull(), contentSha256: text('content_sha256').notNull(), status: text('status').notNull(), revision: integer('revision').notNull(),
  createdBy: text('created_by').notNull(), createdAt: ts('created_at').notNull(), validatedBy: text('validated_by'), validatedAt: ts('validated_at'), approvedBy: text('approved_by'), approvedAt: ts('approved_at'),
  effectiveFrom: ts('effective_from'), supersededBy: uuid('superseded_by'), withdrawalReason: text('withdrawal_reason'), metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(), version: integer('version').notNull()
});

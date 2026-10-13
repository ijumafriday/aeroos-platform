import { doublePrecision, integer, jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';

export const camo = pgSchema('camo');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const fleet = camo.table('fleet', {
  reg: text('reg').primaryKey(),
  operatorId: text('operator_id').notNull(),
  aircraftType: text('aircraft_type').notNull(),
  msn: text('msn').notNull(),
  status: text('status').notNull()
});

export const melItems = camo.table('mel_items', {
  id: text('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  tail: text('tail').notNull(),
  aircraftType: text('aircraft_type').notNull(),
  melRef: text('mel_ref').notNull(),
  ata: text('ata').notNull(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  raisedAt: ts('raised_at').notNull(),
  raisedBy: text('raised_by').notNull(),
  originalDeadline: ts('original_deadline').notNull(),
  deadline: ts('deadline').notNull(),
  deadlineRule: text('deadline_rule').notNull(),
  deadlineBasis: text('deadline_basis').notNull(),
  extensions: integer('extensions').notNull(),
  status: text('status').notNull(),
  eoId: text('eo_id'),
  closedAt: ts('closed_at'),
  closedBy: text('closed_by'),
  closureRef: text('closure_ref'),
  version: integer('version').notNull()
});

export const engineeringOrders = camo.table('engineering_orders', {
  id: text('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  tail: text('tail').notNull(),
  aircraftType: text('aircraft_type').notNull(),
  title: text('title').notNull(),
  ata: text('ata').notNull(),
  trade: text('trade').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  steps: jsonb('steps').$type<string[]>().notNull(),
  estimatedHours: doublePrecision('estimated_hours').notNull(),
  status: text('status').notNull(),
  createdAt: ts('created_at').notNull(),
  createdBy: text('created_by').notNull()
});

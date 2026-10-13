import { bigserial, boolean, date, integer, jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';
import type { ConfigurationEffectivityDto } from '@aeroos/contracts';

const engineering = pgSchema('engineering');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const configurationBaselines = engineering.table('configuration_baselines', {
  id: text('id').primaryKey(), operatorId: text('operator_id').notNull(), aircraftType: text('aircraft_type').notNull(), name: text('name').notNull(),
  revision: integer('revision').notNull(), status: text('status').notNull(), effectiveFrom: date('effective_from', { mode: 'string' }),
  createdBy: text('created_by').notNull(), createdAt: ts('created_at').notNull().defaultNow(), approvedBy: text('approved_by'), approvedAt: ts('approved_at'), version: integer('version').notNull()
});
export const configurationPositions = engineering.table('configuration_positions', {
  id: text('id').primaryKey(), operatorId: text('operator_id').notNull(), baselineId: text('baseline_id').notNull(), code: text('code').notNull(), parentId: text('parent_id'),
  ata: text('ata').notNull(), title: text('title').notNull(), required: boolean('required').notNull(), maxQty: integer('max_qty').notNull(),
  effectivity: jsonb('effectivity').$type<ConfigurationEffectivityDto>().notNull()
});
export const allowableParts = engineering.table('allowable_parts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(), operatorId: text('operator_id').notNull(), positionId: text('position_id').notNull(), partNo: text('part_no').notNull(),
  description: text('description').notNull(), requiredMods: text('required_mods').array().notNull()
});
export const installedItems = engineering.table('installed_items', {
  id: text('id').primaryKey(), operatorId: text('operator_id').notNull(), tail: text('tail').notNull(), aircraftType: text('aircraft_type').notNull(), positionId: text('position_id').notNull(), positionCode: text('position_code').notNull(),
  partNo: text('part_no').notNull(), serial: text('serial').notNull(), mods: text('mods').array().notNull(), installedAt: ts('installed_at').notNull(), installationRef: text('installation_ref').notNull(),
  installedBy: text('installed_by').notNull(), removedAt: ts('removed_at'), removalRef: text('removal_ref'), removedBy: text('removed_by')
});

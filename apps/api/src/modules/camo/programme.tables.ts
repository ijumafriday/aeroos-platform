import { bigserial, boolean, date, doublePrecision, integer, jsonb, primaryKey, serial, text, timestamp } from 'drizzle-orm/pg-core';
import type { Trade } from '@aeroos/contracts';
import type { Interval } from '@aeroos/mro-domain';
import { camo } from './camo.tables';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const aircraftCounters = camo.table('aircraft_counters', {
  reg: text('reg').primaryKey(),
  deliveryDate: date('delivery_date', { mode: 'string' }).notNull(),
  baseAt: ts('base_at').notNull(),
  baseFh: doublePrecision('base_fh').notNull(),
  baseFc: integer('base_fc').notNull()
});

export const utilisationLog = camo.table('utilisation', {
  flightId: text('flight_id').primaryKey(),
  tail: text('tail').notNull(),
  arrivedAt: ts('arrived_at').notNull(),
  blockMinutes: integer('block_minutes').notNull()
});

export const requirements = camo.table('requirements', {
  id: text('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  kind: text('kind').notNull(),
  ref: text('ref').notNull(),
  title: text('title').notNull(),
  ata: text('ata').notNull(),
  types: text('types').array().notNull(),
  interval: jsonb('interval').$type<Interval>().notNull(),
  repetitive: boolean('repetitive').notNull(),
  steps: jsonb('steps').$type<string[]>().notNull(),
  estimatedHours: doublePrecision('estimated_hours').notNull(),
  tools: text('tools').array().notNull(),
  parts: jsonb('parts').$type<{ partNo: string; qty: number }[]>().notNull(),
  active: boolean('active').notNull(),
  /** null = every aircraft of the types; otherwise only these registrations (AD/SB applicability). */
  tails: text('tails').array()
});

export const components = camo.table('components', {
  id: text('id').primaryKey(),
  tail: text('tail').notNull(),
  requirementId: text('requirement_id').notNull(),
  partNo: text('part_no').notNull(),
  serial: text('serial').notNull(),
  position: text('position').notNull(),
  installedAt: ts('installed_at').notNull(),
  aircraftFhAtInstall: doublePrecision('aircraft_fh_at_install').notNull(),
  aircraftFcAtInstall: integer('aircraft_fc_at_install').notNull(),
  partTsnAtInstall: doublePrecision('part_tsn_at_install').notNull(),
  partCsnAtInstall: integer('part_csn_at_install').notNull(),
  removedAt: ts('removed_at')
});

export const compliance = camo.table('compliance', {
  id: serial('id').primaryKey(),
  requirementId: text('requirement_id').notNull(),
  tail: text('tail').notNull(),
  doneAt: ts('done_at').notNull(),
  fh: doublePrecision('fh').notNull(),
  fc: integer('fc').notNull(),
  reference: text('reference').notNull(),
  recordedBy: text('recorded_by').notNull()
});

export interface StoredWpItem { requirementId: string; ref: string; title: string; ata: string; complied: { at: string; crsNumber: string } | null }

export const workPackages = camo.table('work_packages', {
  id: text('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  tail: text('tail').notNull(),
  aircraftType: text('aircraft_type').notNull(),
  title: text('title').notNull(),
  station: text('station').notNull(),
  bay: text('bay'),
  plannedStart: ts('planned_start'),
  plannedEnd: ts('planned_end'),
  status: text('status').notNull(),
  items: jsonb('items').$type<StoredWpItem[]>().notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  checkType: text('check_type').notNull(),
  priority: text('priority').notNull(),
  resourcePlan: jsonb('resource_plan').$type<{ trade: Trade; requiredHours: number; availableHours: number }[]>().notNull(),
  dependencies: jsonb('dependencies').$type<{ beforeRequirementId: string; afterRequirementId: string }[]>().notNull(),
  frozenAt: ts('frozen_at'),
  frozenBy: text('frozen_by'),
  version: integer('version').notNull()
});

export const hangarBays = camo.table('hangar_bays', {
  id: text('id').primaryKey(), operatorId: text('operator_id').notNull(), station: text('station').notNull(), code: text('code').notNull(), name: text('name').notNull(), active: boolean('active').notNull()
});

export const airworthiness = camo.table('airworthiness', {
  reg: text('reg').primaryKey(),
  airworthy: boolean('airworthy').notNull(),
  reasons: jsonb('reasons').$type<string[]>().notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow()
});

export const alertLevels = camo.table('reliability_alert_levels', {
  operatorId: text('operator_id').notNull(),
  ata: text('ata').notNull(),
  alertLevel: doublePrecision('alert_level').notNull()
}, t => ({ pk: primaryKey({ columns: [t.operatorId, t.ata] }) }));

/* ------------------------------------------------------------------ AD / SB intake (round 9) */

export const directives = camo.table('directives', {
  id: text('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  kind: text('kind').notNull(),
  ref: text('ref').notNull(),
  revision: text('revision').notNull(),
  authority: text('authority').notNull(),
  title: text('title').notNull(),
  ata: text('ata').notNull(),
  types: text('types').array().notNull(),
  msnRanges: jsonb('msn_ranges').$type<{ from: string; to: string }[] | null>(),
  effective: date('effective', { mode: 'string' }).notNull(),
  action: text('action').notNull(),
  interval: jsonb('interval').$type<Interval>().notNull(),
  repetitive: boolean('repetitive').notNull(),
  estimatedHours: doublePrecision('estimated_hours').notNull(),
  steps: jsonb('steps').$type<string[]>().notNull(),
  supersedes: text('supersedes'),
  status: text('status').notNull(),
  decision: text('decision'),
  decisionReason: text('decision_reason'),
  receivedBy: text('received_by').notNull(),
  receivedAt: ts('received_at').notNull().defaultNow(),
  evaluatedBy: text('evaluated_by'),
  evaluatedAt: ts('evaluated_at'),
  incorporatedBy: text('incorporated_by'),
  incorporatedAt: ts('incorporated_at'),
  confirmedBy: text('confirmed_by'),
  confirmedAt: ts('confirmed_at'),
  requirementId: text('requirement_id'),
  version: integer('version').notNull()
});

export const directiveTails = camo.table('directive_tails', {
  directiveId: text('directive_id').notNull(),
  tail: text('tail').notNull(),
  applicable: boolean('applicable').notNull(),
  reason: text('reason').notNull(),
  overridden: boolean('overridden').notNull()
}, t => ({ pk: primaryKey({ columns: [t.directiveId, t.tail] }) }));

export const requirementStart = camo.table('requirement_start', {
  requirementId: text('requirement_id').notNull(),
  tail: text('tail').notNull(),
  at: ts('at').notNull(),
  fh: doublePrecision('fh').notNull(),
  fc: integer('fc').notNull()
}, t => ({ pk: primaryKey({ columns: [t.requirementId, t.tail] }) }));

/* ------------------------------------------------------------------ component history (round 9) */

export const componentEvents = camo.table('component_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  operatorId: text('operator_id').notNull(),
  partNo: text('part_no').notNull(),
  serial: text('serial').notNull(),
  type: text('type').notNull(),
  tail: text('tail').notNull(),
  position: text('position').notNull(),
  at: ts('at').notNull(),
  tsn: doublePrecision('tsn').notNull(),
  csn: integer('csn').notNull(),
  reason: text('reason'),
  reference: text('reference').notNull(),
  recordedBy: text('recorded_by').notNull(),
  recordedAt: ts('recorded_at').notNull().defaultNow()
});

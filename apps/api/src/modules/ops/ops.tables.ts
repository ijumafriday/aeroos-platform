import { bigserial, boolean, date, doublePrecision, integer, jsonb, pgSchema, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import type { CrewRecoveryProblem, CrewRecoverySolution, RecoveryChangeDto, RecoveryProblem, RecoverySolution } from '@aeroos/contracts';

const ops = pgSchema('ops');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const airports = ops.table('airports', {
  icao: text('icao').primaryKey(),
  iata: text('iata').notNull(),
  name: text('name').notNull(),
  timeZone: text('time_zone').notNull(),
  lat: doublePrecision('lat').notNull(),
  lon: doublePrecision('lon').notNull(),
  isBase: boolean('is_base').notNull()
  // "location" (geography) is used only in SQL (alternates query), so it is not mapped here.
});

export const flights = ops.table('flights', {
  id: text('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  flightNo: text('flight_no').notNull(),
  opDate: date('op_date', { mode: 'string' }).notNull(),
  dep: text('dep').notNull(),
  arr: text('arr').notNull(),
  std: ts('std').notNull(),
  sta: ts('sta').notNull(),
  etd: ts('etd').notNull(),
  eta: ts('eta').notNull(),
  tail: text('tail').notNull(),
  aircraftType: text('aircraft_type').notNull(),
  status: text('status').notNull(),
  delayMinutes: integer('delay_minutes').notNull(),
  delayReason: text('delay_reason'),
  version: integer('version').notNull(),
  offBlock: ts('off_block'),
  airborne: ts('airborne'),
  touchdown: ts('touchdown'),
  onBlock: ts('on_block'),
  actualArr: text('actual_arr'),
  divertingTo: text('diverting_to'),
  bookedPax: integer('booked_pax').notNull().default(0),
  delayCodes: jsonb('delay_codes').$type<{ code: string; minutes: number | null }[]>().notNull().default([])
});

export const movements = ops.table('movements', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  operatorId: text('operator_id').notNull(),
  receivedAt: ts('received_at').notNull().defaultNow(),
  source: text('source').notNull(),
  raw: text('raw').notNull(),
  flightId: text('flight_id'),
  status: text('status').notNull(),
  detail: text('detail'),
  receivedBy: text('received_by').notNull()
});

export const crewMembers = ops.table('crew_members', {
  id: text('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  name: text('name').notNull(),
  rank: text('rank').notNull(),
  base: text('base').notNull(),
  qualifications: text('qualifications').array().notNull(),
  active: boolean('active').notNull().default(true),
  /** Keycloak username of the crew member (crew hub sign-in), null when not linked. */
  username: text('username')
});

export const crewAssignments = ops.table('crew_assignments', {
  crewId: text('crew_id').notNull(),
  flightId: text('flight_id').notNull(),
  role: text('role').notNull(),
  dutyKey: text('duty_key').notNull(),
  positioning: boolean('positioning').notNull().default(false)
}, t => ({ pk: primaryKey({ columns: [t.crewId, t.flightId] }) }));

export const tailMel = ops.table('tail_mel', {
  melItemId: text('mel_item_id').primaryKey(),
  tail: text('tail').notNull(),
  melRef: text('mel_ref').notNull(),
  category: text('category').notNull(),
  deadline: ts('deadline').notNull(),
  expired: boolean('expired').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow()
});

export const recoveryRuns = ops.table('recovery_runs', {
  id: text('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  status: text('status').notNull(),
  windowFrom: ts('window_from').notNull(),
  windowTo: ts('window_to').notNull(),
  problem: jsonb('problem').$type<RecoveryProblem>().notNull(),
  solution: jsonb('solution').$type<RecoverySolution | null>(),
  changes: jsonb('changes').$type<RecoveryChangeDto[]>().notNull(),
  solver: text('solver'),
  objective: doublePrecision('objective'),
  wallSeconds: doublePrecision('wall_seconds'),
  error: text('error'),
  requestedBy: text('requested_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  decidedBy: text('decided_by'),
  decidedAt: ts('decided_at')
});

export const tailAirworthiness = ops.table('tail_airworthiness', {
  reg: text('reg').primaryKey(),
  airworthy: boolean('airworthy').notNull(),
  reasons: jsonb('reasons').$type<string[]>().notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow()
});

export const maintenanceSlots = ops.table('maintenance_slots', {
  wpId: text('wp_id').primaryKey(),
  tail: text('tail').notNull(),
  station: text('station').notNull(),
  bay: text('bay'),
  plannedStart: ts('planned_start').notNull(),
  plannedEnd: ts('planned_end').notNull(),
  status: text('status').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow()
});

export const standby = ops.table('standby', {
  crewId: text('crew_id').notNull(),
  startAt: ts('start_at').notNull(),
  endAt: ts('end_at').notNull(),
  base: text('base').notNull(),
  operatorId: text('operator_id').notNull(),
  status: text('status').notNull().default('AVAILABLE'),
  calledFlightId: text('called_flight_id'),
  calledAt: ts('called_at'),
  calledBy: text('called_by')
}, t => ({ pk: primaryKey({ columns: [t.crewId, t.startAt] }) }));

export const crewRecoveryRuns = ops.table('crew_recovery_runs', {
  id: text('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  status: text('status').notNull(),
  problem: jsonb('problem').$type<CrewRecoveryProblem>().notNull(),
  solution: jsonb('solution').$type<CrewRecoverySolution | null>(),
  solver: text('solver'),
  objective: doublePrecision('objective'),
  wallSeconds: doublePrecision('wall_seconds'),
  error: text('error'),
  requestedBy: text('requested_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  decidedBy: text('decided_by'),
  decidedAt: ts('decided_at')
});

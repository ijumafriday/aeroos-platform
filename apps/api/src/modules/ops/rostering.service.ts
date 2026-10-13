import { Body, Controller, ForbiddenException, Get, Inject, Injectable, Param, Post, Query } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, gte, inArray, lte, sql } from 'drizzle-orm';
import { bigserial, bigint, date, integer, jsonb, numeric, pgSchema, primaryKey, serial, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type {
  CrewHubDto, CrewPreferenceDto, CrewPreferenceKind, FatigueBand, FatigueReportDto, PairingDto, ReserveDto, RosterChangeDto, RosterCrewRowDto, RosterDutyDto, RosterGridDto, RosterOpenFlightDto, RosterPublicationDto,
  RosterRunDto, UnavailabilityDto, UnavailabilityKind
} from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import {
  buildDuties, buildRoster, canChange, fatigueReportSeverity, pairings, publicationNotice, rosterFatigue, typeRating,
  type CrewLeg, type CrewRecord, type CrewRosterLeg, type Duty, type DutyScheme, type Flight, type Pairing, type RosterAssignment, type Unfilled
} from '@aeroos/ops-domain';
import { actorOf, CurrentPrincipal, type Principal } from '../../platform/auth/principal';
import { AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { ZodPipe } from '../../platform/http/http';
import { NotificationsService } from '../../platform/notifications/notifications.service';
import { CrewService, ftlStatus } from './crew.service';
import { dispatch } from './dispatch.service';
import { CHAIN } from './flight-ops.service';
import { flightToDomain, OpsRepository } from './ops.repository';
import { crewAssignments, crewMembers, flights, standby } from './ops.tables';
import { MasterDataService } from '../compliance/master-data.service';
import { cabinRequirements, frmsAssessments } from './operational-planning.service';

const ops = pgSchema('ops');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const crewUnavailability = ops.table('crew_unavailability', {
  id: serial('id').primaryKey(), operatorId: text('operator_id').notNull(), crewId: text('crew_id').notNull(), kind: text('kind').notNull(),
  startAt: ts('start_at').notNull(), endAt: ts('end_at').notNull(), note: text('note'), cancelled: boolean('cancelled').notNull().default(false),
  createdBy: text('created_by').notNull(), createdAt: ts('created_at').notNull().defaultNow()
});
export const rosterRuns = ops.table('roster_runs', {
  id: text('id').primaryKey(), operatorId: text('operator_id').notNull(),
  periodFrom: date('period_from', { mode: 'string' }).notNull(), periodTo: date('period_to', { mode: 'string' }).notNull(), status: text('status').notNull(),
  proposal: jsonb('proposal').$type<{ assignments: RosterAssignment[]; unfilled: (Unfilled & { flightNos: string })[]; flightNos: Record<string, string>; versions?: Record<string, number> }>().notNull(),
  createdBy: text('created_by').notNull(), createdAt: ts('created_at').notNull().defaultNow(), decidedBy: text('decided_by'), decidedAt: ts('decided_at')
});
export const rosterPublications = ops.table('roster_publications', {
  id: serial('id').primaryKey(), operatorId: text('operator_id').notNull(),
  periodFrom: date('period_from', { mode: 'string' }).notNull(), periodTo: date('period_to', { mode: 'string' }).notNull(),
  notice: text('notice'), note: text('note'), publishedBy: text('published_by').notNull(), publishedAt: ts('published_at').notNull().defaultNow()
});
export const rosterChanges = ops.table('roster_changes', {
  id: bigserial('id', { mode: 'number' }).primaryKey(), operatorId: text('operator_id').notNull(), crewId: text('crew_id').notNull(),
  flightId: text('flight_id').notNull(), change: text('change').notNull(), at: ts('at').notNull().defaultNow()
});
export const rosterAcks = ops.table('roster_acks', {
  crewId: text('crew_id').primaryKey(), lastChangeId: bigint('last_change_id', { mode: 'number' }).notNull(), acknowledgedAt: ts('acknowledged_at').notNull().defaultNow()
});
export const fatigueReports = ops.table('fatigue_reports', {
  id: serial('id').primaryKey(), operatorId: text('operator_id').notNull(), crewId: text('crew_id').notNull(), flightId: text('flight_id'),
  kss: integer('kss').notNull(), samnPerelli: integer('samn_perelli').notNull(), sleepHours24: numeric('sleep_hours_24', { precision: 4, scale: 1 }),
  severity: text('severity').notNull(), narrative: text('narrative').notNull(), status: text('status').notNull().default('OPEN'),
  reportedBy: text('reported_by').notNull(), reportedAt: ts('reported_at').notNull().defaultNow(),
  reviewedBy: text('reviewed_by'), reviewedAt: ts('reviewed_at'), reviewNote: text('review_note')
});

export const pairingRecords = ops.table('pairings', {
  id: text('id').primaryKey(), operatorId: text('operator_id').notNull(), name: text('name').notNull(), base: text('base').notNull(),
  startsOn: date('starts_on', { mode: 'string' }).notNull(), endsOn: date('ends_on', { mode: 'string' }).notNull(), status: text('status').notNull(),
  createdBy: text('created_by').notNull(), createdAt: ts('created_at').notNull().defaultNow(), approvedBy: text('approved_by'), approvedAt: ts('approved_at')
});
export const pairingLegs = ops.table('pairing_legs', {
  operatorId: text('operator_id').notNull(), pairingId: text('pairing_id').notNull(), seq: integer('seq').notNull(), dutyNo: integer('duty_no').notNull(), flightId: text('flight_id').notNull()
}, t => ({ pk: primaryKey({ columns: [t.pairingId, t.seq] }) }));
export const crewPreferences = ops.table('crew_preferences', {
  id: bigserial('id', { mode: 'number' }).primaryKey(), operatorId: text('operator_id').notNull(), crewId: text('crew_id').notNull(), kind: text('kind').notNull(),
  startsAt: ts('starts_at').notNull(), endsAt: ts('ends_at').notNull(), weight: integer('weight').notNull(), note: text('note'), createdBy: text('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(), cancelled: boolean('cancelled').notNull().default(false)
});

const DAY = 86_400_000;
const MAX_PERIOD_DAYS = 31;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const dayStart = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime())) throw new DomainError('BAD_DATE', `Not a date: ${s}`, 422);
  return d;
};
const period = (from: string, to: string) => {
  const a = dayStart(from), b = dayStart(to);
  if (b < a) throw new DomainError('PERIOD', 'The period ends before it starts', 422);
  if ((b.getTime() - a.getTime()) / DAY + 1 > MAX_PERIOD_DAYS) throw new DomainError('PERIOD', `At most ${MAX_PERIOD_DAYS} days at a time`, 422);
  return { from: a, to: new Date(b.getTime() + DAY) };
};
const flightNosOf = (ids: string[], nos: Record<string, string>) => ids.map(i => nos[i] ?? i).join(' · ');

type CrewRow = typeof crewMembers.$inferSelect;
type UnavailRow = typeof crewUnavailability.$inferSelect;
type FatigueRow = typeof fatigueReports.$inferSelect;

const unavailDto = (r: UnavailRow, names: Map<string, string>): UnavailabilityDto => ({
  id: r.id, crewId: r.crewId, crewName: names.get(r.crewId) ?? r.crewId, kind: r.kind as UnavailabilityKind, start: r.startAt.toISOString(), end: r.endAt.toISOString(),
  note: r.note, createdBy: r.createdBy
});
const fatigueDto = (r: FatigueRow, names: Map<string, string>, username: string): FatigueReportDto => ({
  id: r.id, crewId: r.crewId, crewName: names.get(r.crewId) ?? r.crewId, flightId: r.flightId, kss: r.kss, samnPerelli: r.samnPerelli,
  sleepHours24: r.sleepHours24 === null ? null : Number(r.sleepHours24), severity: r.severity as FatigueBand, narrative: r.narrative, status: r.status as FatigueReportDto['status'],
  reportedAt: r.reportedAt.toISOString(), reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt?.toISOString() ?? null, reviewNote: r.reviewNote, mine: r.reportedBy === username
});
const crewRecord = (c: CrewRow): CrewRecord => ({ id: c.id, name: c.name, rank: c.rank as CrewRecord['rank'], base: c.base, qualifications: c.qualifications });

function dutyDto(d: Duty, legs: CrewLeg[], fatigue: ReturnType<typeof rosterFatigue>): RosterDutyDto {
  const f = fatigue.get(d.id) ?? { score: 0, band: 'LOW' as const, reasons: [] };
  return {
    id: d.id, report: d.report.toISOString(), dutyEnd: d.dutyEnd.toISOString(), sectors: d.sectors, flightMinutes: d.flightMinutes,
    legs: d.legs.map(l => ({
      flightId: l.id, flightNo: l.flightNo, dep: l.dep, arr: l.arr, etd: l.etd.toISOString(), eta: l.eta.toISOString(), tail: l.tail, aircraftType: l.aircraftType,
      status: l.status, positioning: legs.some(x => x.flight.id === l.id && x.positioning === true)
    })),
    fatigue: f.score, fatigueBand: f.band, fatigueReasons: f.reasons
  };
}

/**
 * Crew rostering (ADR-0023): the roster grid for a period, the roster builder (proposal → accept/reject), leave
 * and days off, and publication (14 days ahead, ORO.FTL.110). Accepting re-checks everything under a lock:
 * flights still open, crew still free, every affected roster still legal.
 */
@Injectable()
export class RosteringService {
  constructor(
    private readonly masterData: MasterDataService,
    @Inject(DB_TOKEN.ops) private readonly db: ModuleDb,
    private readonly repo: OpsRepository,
    private readonly crew: CrewService,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService
  ) {}

  private rosterRes(p: Principal, id = '*') {
    return { kind: 'crew_roster' as const, id, attr: { operatorId: p.operatorId } };
  }

  private async names(operatorId: string) {
    const rows = await this.db.db.select({ id: crewMembers.id, name: crewMembers.name }).from(crewMembers).where(eq(crewMembers.operatorId, operatorId));
    return new Map<string, string>(rows.map(r => [r.id, r.name] as [string, string]));
  }

  private async pairingDtos(operatorId: string, fromS: string, toS: string): Promise<PairingDto[]> {
    const rows = await this.db.db.select().from(pairingRecords).where(and(eq(pairingRecords.operatorId, operatorId), lte(pairingRecords.startsOn, toS), gte(pairingRecords.endsOn, fromS))).orderBy(asc(pairingRecords.startsOn), asc(pairingRecords.id));
    if (!rows.length) return [];
    const ids = rows.map(r => r.id);
    const ls = await this.db.db.select({ pairingId: pairingLegs.pairingId, seq: pairingLegs.seq, dutyNo: pairingLegs.dutyNo, flight: flights }).from(pairingLegs).innerJoin(flights, eq(flights.id, pairingLegs.flightId)).where(and(eq(pairingLegs.operatorId, operatorId), inArray(pairingLegs.pairingId, ids))).orderBy(asc(pairingLegs.pairingId), asc(pairingLegs.seq));
    return rows.map(r => ({ id: r.id, name: r.name, base: r.base, startsOn: r.startsOn, endsOn: r.endsOn, status: r.status as PairingDto['status'], createdBy: r.createdBy, createdAt: r.createdAt.toISOString(), approvedBy: r.approvedBy, approvedAt: r.approvedAt?.toISOString() ?? null,
      legs: ls.filter(x => x.pairingId === r.id).map(x => { const f = flightToDomain(x.flight); return { flightId: f.id, flightNo: f.flightNo, dep: f.dep, arr: f.arr, etd: f.etd.toISOString(), eta: f.eta.toISOString(), tail: f.tail, aircraftType: f.aircraftType, status: f.status, positioning: false, dutyNo: x.dutyNo }; }) }));
  }

  private async preferenceDtos(operatorId: string, from: Date, to: Date, names: Map<string,string>): Promise<CrewPreferenceDto[]> {
    const rows = await this.db.db.select().from(crewPreferences).where(and(eq(crewPreferences.operatorId, operatorId), eq(crewPreferences.cancelled, false), sql`${crewPreferences.startsAt} < ${to}`, sql`${crewPreferences.endsAt} > ${from}`)).orderBy(asc(crewPreferences.startsAt));
    return rows.map(r => ({ id: r.id, crewId: r.crewId, crewName: names.get(r.crewId) ?? r.crewId, kind: r.kind as CrewPreferenceKind, startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString(), weight: r.weight, note: r.note, createdBy: r.createdBy, cancelled: r.cancelled }));
  }

  private async reserveDtos(operatorId: string, from: Date, to: Date, names: Map<string,string>): Promise<ReserveDto[]> {
    const rows = await this.db.db.select().from(standby).where(and(eq(standby.operatorId, operatorId), sql`${standby.startAt} < ${to}`, sql`${standby.endAt} > ${from}`)).orderBy(asc(standby.startAt));
    return rows.map(r => ({ crewId: r.crewId, crewName: names.get(r.crewId) ?? r.crewId, base: r.base, start: r.startAt.toISOString(), end: r.endAt.toISOString(), status: r.status as ReserveDto['status'], calledFlightId: r.calledFlightId, calledAt: r.calledAt?.toISOString() ?? null, calledBy: r.calledBy }));
  }

  private async unavailability(operatorId: string, from: Date, to: Date, crewIds?: string[]) {
    return this.db.db.select().from(crewUnavailability).where(and(
      eq(crewUnavailability.operatorId, operatorId), eq(crewUnavailability.cancelled, false),
      sql`${crewUnavailability.startAt} < ${to}`, sql`${crewUnavailability.endAt} > ${from}`,
      ...(crewIds ? [inArray(crewUnavailability.crewId, crewIds.length ? crewIds : [''])] : [])
    )).orderBy(asc(crewUnavailability.startAt));
  }

  /** Flights of the period (by operating date) with the operating crew they already have. */
  private async periodFlights(operatorId: string, from: string, to: string) {
    const rows = await this.db.db.select().from(flights).where(and(eq(flights.operatorId, operatorId), gte(flights.opDate, from), lte(flights.opDate, to))).orderBy(asc(flights.etd));
    const ids = rows.map(r => r.id);
    const crewed = ids.length ? await this.db.db.select({ flightId: crewAssignments.flightId, role: crewAssignments.role }).from(crewAssignments)
      .where(and(inArray(crewAssignments.flightId, ids), eq(crewAssignments.positioning, false))) : [];
    return rows.map(r => {
      const roles = new Set(crewed.filter(c => c.flightId === r.id).map(c => c.role));
      return { flight: flightToDomain(r), missing: (['CPT', 'FO'] as const).filter(x => !roles.has(x)) };
    });
  }

  private runDto(r: typeof rosterRuns.$inferSelect, names: Map<string, string>): RosterRunDto {
    const nos = r.proposal.flightNos;
    return {
      id: r.id, from: r.periodFrom, to: r.periodTo, status: r.status as RosterRunDto['status'], createdBy: r.createdBy, createdAt: r.createdAt.toISOString(), decidedBy: r.decidedBy,
      assignments: r.proposal.assignments.map(a => ({ ...a, flightNos: flightNosOf(a.flightIds, nos), crewName: names.get(a.crewId) ?? a.crewId })),
      unfilled: r.proposal.unfilled
    };
  }

  async grid(p: Principal, fromS: string, toS: string): Promise<RosterGridDto> {
    await this.authz.check(p, this.rosterRes(p), 'read');
    const { from, to } = period(fromS, toS);
    const perms = await this.authz.decide(p, this.rosterRes(p), ['build', 'publish', 'manage_unavailability']);
    const crew = await this.repo.crew(p.operatorId);
    const names = new Map<string, string>(crew.map(c => [c.id, c.name] as [string, string]));
    const now = new Date();
    const [legs, away, fl, runs, pubs, schemes, pairingList, preferenceList, reserveList] = await Promise.all([
      this.repo.legsFor(crew.map(c => c.id), new Date(from.getTime() - 365 * DAY), new Date(to.getTime() + DAY)),
      this.unavailability(p.operatorId, from, to),
      this.periodFlights(p.operatorId, fromS, toS),
      this.db.db.select().from(rosterRuns).where(and(eq(rosterRuns.operatorId, p.operatorId), lte(rosterRuns.periodFrom, toS), gte(rosterRuns.periodTo, fromS))).orderBy(desc(rosterRuns.createdAt)).limit(10),
      this.db.db.select().from(rosterPublications).where(and(eq(rosterPublications.operatorId, p.operatorId), lte(rosterPublications.periodFrom, toS), gte(rosterPublications.periodTo, fromS))).orderBy(desc(rosterPublications.publishedAt)),
      this.crew.schemes(),
      this.pairingDtos(p.operatorId, fromS, toS),
      this.preferenceDtos(p.operatorId, from, to, names),
      this.reserveDtos(p.operatorId, from, to, names)
    ]);
    const rows: RosterCrewRowDto[] = crew.map(c => {
      const mine = legs.filter(l => l.crewId === c.id);
      const duties = buildDuties(mine, schemes(c.base));
      const fatigue = rosterFatigue(duties);
      const inPeriod = duties.filter(d => d.report < to && d.dutyEnd > from);
      return {
        id: c.id, name: c.name, rank: c.rank as RosterCrewRowDto['rank'], base: c.base, qualifications: c.qualifications,
        status: ftlStatus(this.crew.violations(p.operatorId, duties, now)),
        blockMinutes: inPeriod.reduce((n, d) => n + d.flightMinutes, 0),
        duties: inPeriod.map(d => dutyDto(d, mine, fatigue)),
        away: away.filter(a => a.crewId === c.id).map(a => unavailDto(a, names))
      };
    });
    const openFlights: RosterOpenFlightDto[] = fl.filter(x => x.flight.status !== 'CANCELLED' && x.missing.length).map(({ flight: f, missing }) => ({
      flightId: f.id, flightNo: f.flightNo, date: f.date, dep: f.dep, arr: f.arr, etd: f.etd.toISOString(), eta: f.eta.toISOString(), tail: f.tail, aircraftType: f.aircraftType, missing
    }));
    const cabinReqRows = await this.db.db.select().from(cabinRequirements).where(eq(cabinRequirements.operatorId, p.operatorId));
    const cabinReqByType = new Map(cabinReqRows.map(r => [r.aircraftType, r]));
    const cabin = await Promise.all(fl.filter(x => x.flight.status !== 'CANCELLED').map(async ({flight:f}) => { const req=cabinReqByType.get(f.aircraftType); const asg=await this.db.db.select({role:crewAssignments.role}).from(crewAssignments).where(eq(crewAssignments.flightId,f.id)); return {flightId:f.id,flightNo:f.flightNo,aircraftType:f.aircraftType,assignedSccm:asg.filter(x=>x.role==='SCCM').length,requiredSccm:req?.sccmRequired??0,assignedCc:asg.filter(x=>x.role==='CC').length,requiredCc:req?.ccRequired??0,configured:!!req}; }));
    return {
      from: fromS, to: toS, crew: rows, openFlights, runs: runs.map(r => this.runDto(r, names)),
      publications: pubs.map((r): RosterPublicationDto => ({ id: r.id, from: r.periodFrom, to: r.periodTo, notice: r.notice, note: r.note, publishedBy: r.publishedBy, publishedAt: r.publishedAt.toISOString() })),
      pairings: pairingList, preferences: preferenceList, reserves: reserveList, cabin,
      permissions: { build: perms.build, publish: perms.publish, manageUnavailability: perms.manage_unavailability }
    };
  }

  async createPairing(p: Principal, b: { name: string; base: string; flightIds: string[] }): Promise<PairingDto> {
    await this.authz.check(p, this.rosterRes(p), 'build');
    const ids = [...new Set(b.flightIds)];
    if (ids.length < 1 || ids.length > 20 || ids.length !== b.flightIds.length) throw new DomainError('PAIRING_LEGS', 'A pairing needs 1–20 unique flight legs', 422);
    const rows = await this.db.db.select().from(flights).where(and(eq(flights.operatorId, p.operatorId), inArray(flights.id, ids)));
    if (rows.length !== ids.length) throw new DomainError('PAIRING_FLIGHT', 'One or more pairing flights do not belong to this operator', 422);
    const ordered = ids.map(id => rows.find(r => r.id === id)!);
    for (let i=1;i<ordered.length;i++) if (ordered[i].etd < ordered[i-1].etd) throw new DomainError('PAIRING_ORDER', 'Pairing flightIds must be supplied in chronological operating order', 422);
    if (ordered[0].dep !== b.base || ordered[ordered.length - 1].arr !== b.base) throw new DomainError('PAIRING_BASE', `Pairing must start and finish at ${b.base}`, 422);
    if (new Set(ordered.map(x => x.aircraftType)).size !== 1) throw new DomainError('PAIRING_TYPE', 'A pairing cannot mix aircraft types', 422);
    for (let i=1;i<ordered.length;i++) {
      if (ordered[i].dep !== ordered[i-1].arr) throw new DomainError('PAIRING_CONTINUITY', `${ordered[i-1].flightNo} arrives ${ordered[i-1].arr} but ${ordered[i].flightNo} departs ${ordered[i].dep}`, 422);
      if (ordered[i].etd < ordered[i-1].eta) throw new DomainError('PAIRING_OVERLAP', 'Pairing legs overlap', 422);
    }
    const startsOn = ordered[0].opDate, endsOn = ordered[ordered.length-1].opDate;
    if ((dayStart(endsOn).getTime() - dayStart(startsOn).getTime()) / DAY > 6) throw new DomainError('PAIRING_LENGTH', 'A pairing can span at most 7 operating days', 422);
    const id = `PAIR-${randomUUID().slice(0,8).toUpperCase()}`;
    await this.db.transaction(async () => {
      await this.db.db.insert(pairingRecords).values({ id, operatorId: p.operatorId, name: b.name.trim(), base: b.base, startsOn, endsOn, status: 'DRAFT', createdBy: actorOf(p) });
      let dutyNo = 1;
      const legRows = ordered.map((f,i) => {
        if (i > 0 && f.etd.getTime() - ordered[i-1].eta.getTime() >= 6 * 3_600_000) dutyNo++;
        return { operatorId: p.operatorId, pairingId: id, seq: i+1, dutyNo, flightId: f.id };
      });
      await this.db.db.insert(pairingLegs).values(legRows);
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'pairing.created', entityType: 'pairing', entityId: id, data: { name: b.name, base: b.base, flights: ordered.map(x => x.id) } });
    });
    return (await this.pairingDtos(p.operatorId, startsOn, endsOn)).find(x => x.id === id)!;
  }

  async approvePairing(p: Principal, id: string): Promise<PairingDto> {
    await this.authz.check(p, this.rosterRes(p, id), 'build');
    const actor = actorOf(p);
    const row = await this.db.transaction(async () => {
      const [r] = await this.db.db.select().from(pairingRecords).where(and(eq(pairingRecords.id, id), eq(pairingRecords.operatorId, p.operatorId))).for('update');
      if (!r) throw new DomainError('PAIRING_NOT_FOUND', id, 404);
      if (r.status !== 'DRAFT') throw new DomainError('PAIRING_STATE', `${id} is ${r.status.toLowerCase()}`, 409);
      if (r.createdBy === actor) throw new DomainError('INDEPENDENT_APPROVAL', 'The creator cannot approve the same pairing', 422);
      const [u] = await this.db.db.update(pairingRecords).set({ status: 'APPROVED', approvedBy: actor, approvedAt: new Date() }).where(eq(pairingRecords.id, id)).returning();
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor, action: 'pairing.approved', entityType: 'pairing', entityId: id, data: {} });
      return u;
    });
    return (await this.pairingDtos(p.operatorId, row.startsOn, row.endsOn)).find(x => x.id === id)!;
  }

  async addPreference(p: Principal, b: { crewId: string; kind: CrewPreferenceKind; startsAt: string; endsAt: string; weight: number; note?: string }): Promise<CrewPreferenceDto> {
    await this.authz.check(p, this.rosterRes(p, b.crewId), 'manage_unavailability');
    const c = await this.repo.crewMember(b.crewId, p.operatorId);
    const a = new Date(b.startsAt), z = new Date(b.endsAt); if (Number.isNaN(a.getTime()) || Number.isNaN(z.getTime()) || a >= z) throw new DomainError('PREFERENCE_DATES', 'Preference period is invalid', 422);
    const [r] = await this.db.db.insert(crewPreferences).values({ operatorId: p.operatorId, crewId: c.id, kind: b.kind, startsAt: a, endsAt: z, weight: b.weight, note: b.note?.trim() || null, createdBy: actorOf(p) }).returning();
    await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'crew.preference_recorded', entityType: 'crew_member', entityId: c.id, data: { id: r.id, kind: b.kind, startsAt: b.startsAt, endsAt: b.endsAt, weight: b.weight } });
    return { id: r.id, crewId: r.crewId, crewName: c.name, kind: r.kind as CrewPreferenceKind, startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString(), weight: r.weight, note: r.note, createdBy: r.createdBy, cancelled: r.cancelled };
  }

  async cancelPreference(p: Principal, id: number) {
    await this.authz.check(p, this.rosterRes(p), 'manage_unavailability');
    const [r] = await this.db.db.update(crewPreferences).set({ cancelled: true }).where(and(eq(crewPreferences.id, id), eq(crewPreferences.operatorId, p.operatorId), eq(crewPreferences.cancelled, false))).returning();
    if (!r) throw new DomainError('PREFERENCE_NOT_FOUND', `Preference ${id} not found`, 404);
    await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'crew.preference_cancelled', entityType: 'crew_member', entityId: r.crewId, data: { id } });
    return { ok: true };
  }

  async addReserve(p: Principal, b: { crewId: string; base: string; start: string; end: string }): Promise<ReserveDto> {
    await this.authz.check(p, this.rosterRes(p, b.crewId), 'manage_unavailability');
    const c = await this.repo.crewMember(b.crewId, p.operatorId); const a = new Date(b.start), z = new Date(b.end);
    if (Number.isNaN(a.getTime()) || Number.isNaN(z.getTime()) || a >= z || z.getTime()-a.getTime() > 24*60*60*1000) throw new DomainError('RESERVE_DATES', 'Reserve must be a valid period of at most 24 hours', 422);
    const [r] = await this.db.db.insert(standby).values({ crewId: c.id, startAt: a, endAt: z, base: b.base, operatorId: p.operatorId, status: 'AVAILABLE' }).returning();
    await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'crew.reserve_created', entityType: 'crew_member', entityId: c.id, data: { start: b.start, end: b.end, base: b.base } });
    return { crewId: c.id, crewName: c.name, base: r.base, start: r.startAt.toISOString(), end: r.endAt.toISOString(), status: 'AVAILABLE', calledFlightId: null, calledAt: null, calledBy: null };
  }

  async callReserve(p: Principal, b: { crewId: string; start: string; flightId: string }): Promise<ReserveDto> {
    await this.authz.check(p, this.rosterRes(p, b.crewId), 'recover');
    const start = new Date(b.start); if (Number.isNaN(start.getTime())) throw new DomainError('RESERVE_START', 'Reserve start is invalid', 422);
    const [f] = await this.db.db.select().from(flights).where(and(eq(flights.id, b.flightId), eq(flights.operatorId, p.operatorId))); if (!f) throw new DomainError('FLIGHT_NOT_FOUND', b.flightId, 404);
    const c = await this.repo.crewMember(b.crewId, p.operatorId); const actor = actorOf(p);
    if (!c.qualifications.includes(typeRating(f.aircraftType))) throw new DomainError('RESERVE_QUALIFICATION', `${c.name} is not qualified on ${f.aircraftType}`, 422);
    const [r] = await this.db.db.update(standby).set({ status: 'CALLED', calledFlightId: f.id, calledAt: new Date(), calledBy: actor }).where(and(eq(standby.operatorId, p.operatorId), eq(standby.crewId, c.id), eq(standby.startAt, start), eq(standby.base, f.dep), eq(standby.status, 'AVAILABLE'), lte(standby.startAt, f.etd), gte(standby.endAt, f.etd))).returning();
    if (!r) throw new DomainError('RESERVE_NOT_AVAILABLE', 'No matching available reserve at the departure base covers this flight', 409);
    await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor, action: 'crew.reserve_called', entityType: 'crew_member', entityId: c.id, data: { flightId: f.id, reserveStart: b.start } });
    await this.notifications.raise(this.db, { operatorId: p.operatorId, actor, severity: 'amber', link: `/ops/crew?crew=${c.id}`, title: `${c.name} reserve called`, body: `Called for ${f.flightNo} ${f.dep}–${f.arr}. Assignment remains subject to crew-recovery legality checks.` });
    return { crewId: c.id, crewName: c.name, base: r.base, start: r.startAt.toISOString(), end: r.endAt.toISOString(), status: 'CALLED', calledFlightId: r.calledFlightId, calledAt: r.calledAt?.toISOString() ?? null, calledBy: r.calledBy };
  }

  /** Propose crew for every flight of the period that has no operating crew yet. Nothing is booked until accepted. */
  async build(p: Principal, b: { from: string; to: string }): Promise<RosterRunDto> {
    await this.authz.check(p, this.rosterRes(p), 'build');
    const { from, to } = period(b.from, b.to);
    if (b.from < isoDay(new Date())) throw new DomainError('PERIOD_PAST', 'Roster from today onwards; use crew recovery for the day of operation', 422);
    const open = (await this.periodFlights(p.operatorId, b.from, b.to))
      .filter(x => canChange(x.flight) && x.missing.length === 2 && x.flight.etd.getTime() > Date.now()).map(x => x.flight);
    const crew = (await this.repo.crew(p.operatorId)).map(crewRecord);
    const legs = await this.repo.legsFor(crew.map(c => c.id), new Date(from.getTime() - 365 * DAY), new Date(to.getTime() + 2 * DAY));
    const rosters = new Map<string, CrewRosterLeg[]>(crew.map(c => [c.id, legs.filter(l => l.crewId === c.id).map(l => ({ ...l, role: l.role as 'CPT' | 'FO' }))]));
    const away = (await this.unavailability(p.operatorId, new Date(from.getTime() - DAY), new Date(to.getTime() + DAY)))
      .map(a => ({ crewId: a.crewId, kind: a.kind as UnavailabilityKind | 'STANDBY', start: a.startAt, end: a.endAt }));
    // standby shifts are the day-of-operation cover: never roster flying into them
    for (const sb of await this.repo.standbyBetween(crew.map(c => c.id), new Date(from.getTime() - DAY), new Date(to.getTime() + DAY))) {
      away.push({ crewId: sb.crewId, kind: 'STANDBY', start: sb.startAt, end: sb.endAt });
    }
    const approved = (await this.pairingDtos(p.operatorId, b.from, b.to)).filter(x => x.status === 'APPROVED');
    const openMap = new Map(open.map(f => [f.id, f] as [string, Flight]));
    const planned: Pairing[] = approved.flatMap(x => {
      const fs = x.legs.map(l => openMap.get(l.flightId)).filter(Boolean) as Flight[];
      return fs.length === x.legs.length && fs.length ? [{ key: x.id, date: x.startsOn, tail: fs[0].tail, aircraftType: fs[0].aircraftType, base: x.base, legs: fs, dutyNos: x.legs.map(l => l.dutyNo) }] : [];
    });
    const plannedIds = new Set(planned.flatMap(x => x.legs.map(l => l.id)));
    const ps = [...planned, ...pairings(open.filter(f => !plannedIds.has(f.id)))];
    const rawPrefs = await this.db.db.select().from(crewPreferences).where(and(eq(crewPreferences.operatorId, p.operatorId), eq(crewPreferences.cancelled, false), sql`${crewPreferences.startsAt} < ${to}`, sql`${crewPreferences.endsAt} > ${from}`));
    const airports = new Map((await this.repo.airports()).map(a => [a.icao, a.timeZone] as [string,string]));
    const localHour = (d: Date, base: string) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: airports.get(base) ?? 'UTC', hour: '2-digit', hourCycle: 'h23' }).format(d));
    const preferenceCost = (c: CrewRecord, pairing: Pairing) => {
      const a = pairing.legs[0].etd, z = pairing.legs[pairing.legs.length-1].eta; let cost = 0;
      for (const pref of rawPrefs.filter(x => x.crewId === c.id && x.startsAt < z && x.endsAt > a)) {
        const w = pref.weight;
        if (pref.kind === 'PREFER_OFF') cost += 1000 * w;
        else if (pref.kind === 'PREFER_FLY') cost -= 80 * w;
        else if (pref.kind === 'AVOID_NIGHT') { const h = localHour(a, c.base); if (h >= 21 || h < 6) cost += 250 * w; }
        else if (pref.kind === 'PREFER_EARLY') cost += localHour(a, c.base) < 10 ? -40 * w : 25 * w;
        else if (pref.kind === 'PREFER_LATE') cost += localHour(a, c.base) >= 15 ? -40 * w : 25 * w;
      }
      return cost;
    };
    const result = buildRoster(ps, crew, rosters, away, await this.crew.schemes(), this.crew.judge(p.operatorId, new Date()), preferenceCost);
    const legsOf = new Map(ps.map(x => [x.key, x.legs.map(l => l.flightNo).join(' · ')]));
    const proposal = {
      assignments: result.assignments,
      unfilled: result.unfilled.map(u => ({ ...u, flightNos: legsOf.get(u.pairingKey) ?? '' })),
      flightNos: Object.fromEntries(open.map(f => [f.id, f.flightNo])),
      // accepting refuses if any flight changed (tail, type, times) after the proposal
      versions: Object.fromEntries(open.map(f => [f.id, f.version]))
    };
    const row = await this.db.transaction(async () => {
      const r = await this.db.db.execute<{ n: string }>(sql`select nextval('ops.roster_run_seq')::text as n`);
      const id = `RR-${String(r.rows[0].n).padStart(4, '0')}`;
      const [ins] = await this.db.db.insert(rosterRuns).values({ id, operatorId: p.operatorId, periodFrom: b.from, periodTo: b.to, status: 'PROPOSED', proposal, createdBy: actorOf(p) }).returning();
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'roster.proposed', entityType: 'roster_run', entityId: id,
        data: { from: b.from, to: b.to, assignments: result.assignments.length, unfilled: result.unfilled.length } });
      return ins;
    });
    return this.runDto(row, new Map(crew.map(c => [c.id, c.name])));
  }

  async accept(p: Principal, id: string): Promise<RosterRunDto> {
    await this.authz.check(p, this.rosterRes(p, id), 'build');
    const row = await this.db.transaction(async () => {
      await this.db.db.execute(sql`select pg_advisory_xact_lock(hashtext(${'crew-recovery:' + p.operatorId}))`);
      const [run] = await this.db.db.select().from(rosterRuns).where(and(eq(rosterRuns.id, id), eq(rosterRuns.operatorId, p.operatorId))).for('update');
      if (!run) throw new DomainError('RUN_NOT_FOUND', `Roster proposal ${id} not found`, 404);
      if (run.status !== 'PROPOSED') throw new DomainError('RUN_DECIDED', `${id} is already ${run.status.toLowerCase()}`, 409);
      const as = run.proposal.assignments;
      const flightIds = [...new Set<string>(as.flatMap(a => a.flightIds))];
      const fl = new Map<string, Flight>((await this.repo.flightsByIds(flightIds, { lock: true })).map(f => [f.id, f] as [string, Flight]));
      const taken = flightIds.length ? await this.db.db.select().from(crewAssignments).where(inArray(crewAssignments.flightId, flightIds)) : [];
      const crew = new Map<string, CrewRow>((await this.repo.crew(p.operatorId)).map(c => [c.id, c] as [string, CrewRow]));
      const stale = (why: string) => new DomainError('ROSTER_STALE', `${why} since ${id} was proposed — build a new proposal`, 409);
      const now = Date.now();
      for (const a of as) {
        if (!crew.has(a.crewId)) throw stale(`${a.crewId} is no longer active`);
        for (const fid of a.flightIds) {
          const f = fl.get(fid);
          if (!f || !canChange(f) || f.etd.getTime() <= now || (run.proposal.versions && run.proposal.versions[fid] !== f.version)) throw stale(`${run.proposal.flightNos[fid] ?? fid} changed`);
          if (taken.some(t => t.flightId === fid && t.role === a.role && !t.positioning)) throw stale(`${run.proposal.flightNos[fid] ?? fid} got a ${a.role}`);
          if (taken.some(t => t.flightId === fid && t.crewId === a.crewId)) throw stale(`${crew.get(a.crewId)!.name} is now on ${run.proposal.flightNos[fid] ?? fid}`);
        }
      }
      if (!as.length) {
        const [empty] = await this.db.db.update(rosterRuns).set({ status: 'ACCEPTED', decidedBy: actorOf(p), decidedAt: new Date() }).where(eq(rosterRuns.id, id)).returning();
        await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'roster.accepted', entityType: 'roster_run', entityId: id, data: { assignments: [] } });
        return empty;
      }
      const ends = as.flatMap(a => a.flightIds.map(i => fl.get(i)!));
      const minT = new Date(Math.min(...ends.map(f => f.etd.getTime())) - DAY), maxT = new Date(Math.max(...ends.map(f => f.eta.getTime())) + DAY);
      const who = [...new Set<string>(as.map(a => a.crewId))];
      const away = [
        ...(await this.unavailability(p.operatorId, minT, maxT, who)).map(x => ({ crewId: x.crewId, startAt: x.startAt, endAt: x.endAt })),
        ...(await this.repo.standbyBetween(who, minT, maxT)).map(x => ({ crewId: x.crewId, startAt: x.startAt, endAt: x.endAt }))
      ];
      for (const a of as) {
        const fs = a.flightIds.map(i => fl.get(i)!);
        const s = fs[0].etd.getTime() - 60 * 60_000, e = fs[fs.length - 1].eta.getTime() + 30 * 60_000;
        if (away.some(x => x.crewId === a.crewId && x.startAt.getTime() < e && x.endAt.getTime() > s)) throw stale(`${crew.get(a.crewId)!.name} is now unavailable`);
      }
      if (as.length) {
        await this.db.db.insert(crewAssignments).values(as.flatMap(a => a.flightIds.map((flightId, i) => ({ crewId: a.crewId, flightId, role: a.role, dutyKey: `${id}:${a.pairingKey}:D${a.dutyNos?.[i] ?? 1}` }))));
      }
      // every affected roster must still be legal and free of overlaps with what has been booked meanwhile
      const affected = [...new Set<string>(as.map(a => a.crewId))].map(c => crew.get(c)!);
      if (affected.length) {
        const legs = await this.repo.legsFor(affected.map(c => c.id), new Date(minT.getTime() - 365 * DAY), new Date(maxT.getTime() + DAY));
        const schemes = await this.crew.schemes();
        const judge = this.crew.judge(p.operatorId, new Date());
        for (const c of affected) {
          const mine = legs.filter(l => l.crewId === c.id && l.flight.status !== 'CANCELLED').sort((x, y) => x.flight.etd.getTime() - y.flight.etd.getTime());
          for (let i = 1; i < mine.length; i++) {
            if (mine[i].flight.etd < mine[i - 1].flight.eta) throw stale(`${c.name} is now flying ${mine[i - 1].flight.flightNo} at the same time as ${mine[i].flight.flightNo}`);
          }
          const v = judge(buildDuties(mine, schemes(c.base)));
          if (v.status === 'VIOLATION') throw stale(`${c.name}'s roster would break the flight-time limitations (${v.message ?? ''})`);
        }
      }
      const [upd] = await this.db.db.update(rosterRuns).set({ status: 'ACCEPTED', decidedBy: actorOf(p), decidedAt: new Date() }).where(eq(rosterRuns.id, id)).returning();
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'roster.accepted', entityType: 'roster_run', entityId: id,
        data: { assignments: as.map(a => ({ crewId: a.crewId, role: a.role, flights: a.flightIds })) } });
      return upd;
    });
    return this.runDto(row, await this.names(p.operatorId));
  }

  async reject(p: Principal, id: string): Promise<RosterRunDto> {
    await this.authz.check(p, this.rosterRes(p, id), 'build');
    const row = await this.db.transaction(async () => {
      const [upd] = await this.db.db.update(rosterRuns).set({ status: 'REJECTED', decidedBy: actorOf(p), decidedAt: new Date() })
        .where(and(eq(rosterRuns.id, id), eq(rosterRuns.operatorId, p.operatorId), eq(rosterRuns.status, 'PROPOSED'))).returning();
      if (!upd) throw new DomainError('RUN_DECIDED', `${id} not found or already decided`, 409);
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'roster.rejected', entityType: 'roster_run', entityId: id, data: {} });
      return upd;
    });
    return this.runDto(row, await this.names(p.operatorId));
  }

  /** Publish a period: from then on every change to it is logged for the crew member to acknowledge. */
  async publish(p: Principal, b: { from: string; to: string; note?: string }): Promise<RosterPublicationDto> {
    await this.masterData.assertEffective(p.operatorId, ['compliance.ftl']);
    await this.authz.check(p, this.rosterRes(p), 'publish');
    period(b.from, b.to);
    const notice = publicationNotice(b.from, new Date());
    if (notice && !b.note?.trim()) throw new DomainError('SHORT_NOTICE', `${notice} Give the reason in the note.`, 422);
    const periodRows = (await this.periodFlights(p.operatorId, b.from, b.to)).filter(x => x.flight.status !== 'CANCELLED');
    const open = periodRows.filter(x => x.missing.length).length;
    const reqs = await this.db.db.select().from(cabinRequirements).where(eq(cabinRequirements.operatorId, p.operatorId));
    const reqByType = new Map(reqs.map(x => [x.aircraftType, x]));
    const cabinGaps: string[] = [];
    for (const row of periodRows) {
      const req = reqByType.get(row.flight.aircraftType);
      if (!req) { cabinGaps.push(`${row.flight.flightNo}: cabin complement not configured for ${row.flight.aircraftType}`); continue; }
      const assigned = await this.db.db.select({ role: crewAssignments.role }).from(crewAssignments).where(eq(crewAssignments.flightId, row.flight.id));
      const sccm = assigned.filter(x => x.role === 'SCCM').length, cc = assigned.filter(x => x.role === 'CC').length;
      if (sccm < req.sccmRequired || cc < req.ccRequired) cabinGaps.push(`${row.flight.flightNo}: cabin crew ${sccm}/${req.sccmRequired} SCCM, ${cc}/${req.ccRequired} CC`);
    }
    if (cabinGaps.length) throw new DomainError('CABIN_ROSTER_INCOMPLETE', `Roster cannot be published: ${cabinGaps.slice(0, 10).join('; ')}${cabinGaps.length > 10 ? `; +${cabinGaps.length-10} more` : ''}`, 409);
    const grid = await this.grid(p, b.from, b.to);
    const dutyIds = grid.crew.flatMap(c => c.duties.map(d => d.id));
    if (dutyIds.length) {
      const assessments = await this.db.db.select().from(frmsAssessments).where(and(eq(frmsAssessments.operatorId, p.operatorId), inArray(frmsAssessments.dutyId, dutyIds))).orderBy(desc(frmsAssessments.generatedAt));
      const latest = new Map<string, typeof assessments[number]>(); for (const a of assessments) { const k=`${a.crewId}|${a.dutyId}`; if(!latest.has(k)) latest.set(k,a); }
      const critical = [...latest.values()].filter(a => a.riskBand === 'CRITICAL');
      if (critical.length) throw new DomainError('FRMS_CRITICAL', `Validated fatigue assessment blocks publication for ${critical.map(x => `${x.crewId}/${x.dutyId}`).slice(0,10).join(', ')}`, 409);
    }
    const r = await this.db.transaction(async () => {
      const [ins] = await this.db.db.insert(rosterPublications).values({ operatorId: p.operatorId, periodFrom: b.from, periodTo: b.to, notice, note: b.note?.trim() || null, publishedBy: actorOf(p) }).returning();
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'roster.published', entityType: 'roster_publication', entityId: String(ins.id),
        data: { from: b.from, to: b.to, notice, note: b.note ?? null, openFlights: open } });
      await this.notifications.raise(this.db, { operatorId: p.operatorId, actor: actorOf(p), severity: notice || open ? 'amber' : 'green', link: '/crew/me',
        title: `Roster published: ${b.from} – ${b.to}`, body: `${notice ? 'Short notice. ' : ''}${open ? `${open} flights still need crew. ` : ''}Crew: check and acknowledge your roster.` });
      return ins;
    });
    return { id: r.id, from: r.periodFrom, to: r.periodTo, notice: r.notice, note: r.note, publishedBy: r.publishedBy, publishedAt: r.publishedAt.toISOString() };
  }

  async addUnavailability(p: Principal, b: { crewId: string; kind: UnavailabilityKind; start: string; end: string; note?: string }) {
    await this.authz.check(p, this.rosterRes(p, b.crewId), 'manage_unavailability');
    const c = await this.repo.crewMember(b.crewId, p.operatorId);
    const start = new Date(b.start), end = new Date(b.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) throw new DomainError('DATES', 'The period ends before it starts', 422);
    if ((end.getTime() - start.getTime()) / DAY > 60) throw new DomainError('DATES', 'At most 60 days at a time', 422);
    const clashes = (await this.repo.legsFor([c.id], new Date(start.getTime() - DAY), new Date(end.getTime() + DAY)))
      .filter(l => l.flight.status !== 'CANCELLED' && l.flight.etd < end && l.flight.eta > start);
    const r = await this.db.transaction(async () => {
      const [ins] = await this.db.db.insert(crewUnavailability).values({ operatorId: p.operatorId, crewId: c.id, kind: b.kind, startAt: start, endAt: end, note: b.note?.trim() || null, createdBy: actorOf(p) }).returning();
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'crew.unavailability_recorded', entityType: 'crew_member', entityId: c.id,
        data: { kind: b.kind, start: b.start, end: b.end, clashes: clashes.map(l => l.flight.id) } });
      if (clashes.length) {
        // the reason (sickness, leave) is not put in the operator-wide notification
        await this.notifications.raise(this.db, { operatorId: p.operatorId, actor: actorOf(p), severity: 'amber', link: '/ops/roster',
          title: `${c.name} unavailable on rostered flights`, body: `${clashes.map(l => l.flight.flightNo).join(', ')} need another crew member (crew recovery).` });
      }
      return ins;
    });
    return { unavailability: unavailDto(r, new Map([[c.id, c.name]])), clashes: clashes.map(l => ({ flightId: l.flight.id, flightNo: l.flight.flightNo, etd: l.flight.etd.toISOString() })) };
  }

  async cancelUnavailability(p: Principal, id: number) {
    await this.authz.check(p, this.rosterRes(p), 'manage_unavailability');
    await this.db.transaction(async () => {
      const [r] = await this.db.db.update(crewUnavailability).set({ cancelled: true })
        .where(and(eq(crewUnavailability.id, id), eq(crewUnavailability.operatorId, p.operatorId), eq(crewUnavailability.cancelled, false))).returning();
      if (!r) throw new DomainError('NOT_FOUND', `Unavailability ${id} not found`, 404);
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'crew.unavailability_cancelled', entityType: 'crew_member', entityId: r.crewId, data: { id } });
    });
    return { ok: true };
  }
}

/**
 * Fatigue risk management (ORO.FTL.120): crew report fatigue (KSS, Samn-Perelli, sleep, narrative) without fear of
 * blame; the safety office reviews. Reports are visible to the reporter and the safety office only; the roster
 * shows a fatigue index per duty for planning.
 */
@Injectable()
export class FatigueService {
  constructor(
    @Inject(DB_TOKEN.ops) private readonly db: ModuleDb,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService
  ) {}

  private fatigueRes(p: Principal, id = '*', reporter = '') {
    return { kind: 'fatigue_report' as const, id, attr: { operatorId: p.operatorId, reporter } };
  }

  async mine(p: Principal): Promise<CrewRow | null> {
    const [c] = await this.db.db.select().from(crewMembers).where(and(eq(crewMembers.username, p.username), eq(crewMembers.operatorId, p.operatorId), eq(crewMembers.active, true)));
    return c ?? null;
  }

  async submit(p: Principal, b: { kss: number; samnPerelli: number; sleepHours24?: number | null; flightId?: string | null; narrative: string }): Promise<FatigueReportDto> {
    await this.authz.check(p, this.fatigueRes(p, 'new', p.username), 'report');
    const c = await this.mine(p);
    if (!c) throw new DomainError('NOT_CREW', 'Your account is not linked to a crew record', 422);
    const severity = fatigueReportSeverity(b.kss, b.samnPerelli);
    if (b.flightId) {
      const [a] = await this.db.db.select({ f: flights.id }).from(crewAssignments).innerJoin(flights, eq(flights.id, crewAssignments.flightId))
        .where(and(eq(crewAssignments.crewId, c.id), eq(crewAssignments.flightId, b.flightId)));
      if (!a) throw new DomainError('NOT_YOUR_FLIGHT', 'Pick one of your own flights (or none)', 422);
    }
    const r = await this.db.transaction(async () => {
      const [ins] = await this.db.db.insert(fatigueReports).values({
        operatorId: p.operatorId, crewId: c.id, flightId: b.flightId ?? null, kss: b.kss, samnPerelli: b.samnPerelli,
        sleepHours24: b.sleepHours24 === undefined || b.sleepHours24 === null ? null : String(b.sleepHours24), severity, narrative: b.narrative.trim(), reportedBy: p.username
      }).returning();
      // the audit trail and the notification carry no narrative and no name: fatigue reporting is confidential
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: 'confidential-reporter', action: 'fatigue.reported', entityType: 'fatigue_report', entityId: `FR-${ins.id}`, data: { severity } });
      if (severity !== 'LOW') {
        await this.notifications.raise(this.db, { operatorId: p.operatorId, actor: 'system:frm', severity: severity === 'HIGH' ? 'red' : 'amber', link: '/ops/fatigue',
          title: `${severity === 'HIGH' ? 'High' : 'Moderate'} fatigue report FR-${ins.id}`, body: 'For the safety office to review.' });
      }
      return ins;
    });
    return fatigueDto(r, new Map([[c.id, c.name]]), p.username);
  }

  async list(p: Principal): Promise<FatigueReportDto[]> {
    const { read } = await this.authz.decide(p, this.fatigueRes(p), ['read']);
    const where = read ? eq(fatigueReports.operatorId, p.operatorId) : and(eq(fatigueReports.operatorId, p.operatorId), eq(fatigueReports.reportedBy, p.username));
    const rows = await this.db.db.select().from(fatigueReports).where(where).orderBy(desc(fatigueReports.reportedAt)).limit(200);
    const names = new Map<string, string>((await this.db.db.select({ id: crewMembers.id, name: crewMembers.name }).from(crewMembers).where(eq(crewMembers.operatorId, p.operatorId))).map(r => [r.id, r.name] as [string, string]));
    return rows.map(r => fatigueDto(r, names, p.username));
  }

  async review(p: Principal, id: number, note: string): Promise<FatigueReportDto> {
    // role check first (no report id oracle), then the per-report check (not one's own) once the row is known
    await this.authz.check(p, this.fatigueRes(p, '*', ''), 'review');
    const r = await this.db.transaction(async () => {
      const [row] = await this.db.db.select().from(fatigueReports).where(and(eq(fatigueReports.id, id), eq(fatigueReports.operatorId, p.operatorId))).for('update');
      if (!row) throw new DomainError('NOT_FOUND', `FR-${id} not found`, 404);
      await this.authz.check(p, this.fatigueRes(p, `FR-${id}`, row.reportedBy), 'review');
      if (row.status !== 'OPEN') throw new DomainError('REVIEWED', `FR-${id} is already reviewed`, 409);
      if (row.reportedBy === p.username) throw new ForbiddenException('You cannot review your own fatigue report');
      const [upd] = await this.db.db.update(fatigueReports).set({ status: 'REVIEWED', reviewedBy: p.username, reviewedAt: new Date(), reviewNote: note.trim() }).where(eq(fatigueReports.id, id)).returning();
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'fatigue.reviewed', entityType: 'fatigue_report', entityId: `FR-${id}`, data: { severity: row.severity } });
      return upd;
    });
    const names = new Map<string, string>((await this.db.db.select({ id: crewMembers.id, name: crewMembers.name }).from(crewMembers).where(eq(crewMembers.id, r.crewId))).map(x => [x.id, x.name] as [string, string]));
    return fatigueDto(r, names, p.username);
  }
}

/** The crew hub: a crew member's own roster, its changes since they last acknowledged it, briefing status and fatigue reports. */
@Injectable()
export class CrewHubService {
  constructor(
    @Inject(DB_TOKEN.ops) private readonly db: ModuleDb,
    private readonly repo: OpsRepository,
    private readonly crew: CrewService,
    private readonly fatigue: FatigueService,
    private readonly authz: AuthzService
  ) {}

  private hubRes(p: Principal) {
    return { kind: 'crew_hub' as const, id: p.username, attr: { operatorId: p.operatorId } };
  }

  async me(p: Principal): Promise<CrewHubDto> {
    await this.authz.check(p, this.hubRes(p), 'read');
    const c = await this.fatigue.mine(p);
    if (!c) return { crew: null, status: 'OK', violations: [], duties: [], changes: [], away: [], fatigueReports: [] };
    const now = new Date();
    const legs = await this.repo.legsFor([c.id], new Date(now.getTime() - 365 * DAY), new Date(now.getTime() + 31 * DAY));
    const scheme: DutyScheme = (await this.crew.schemes())(c.base);
    const duties = buildDuties(legs, scheme);
    const fatigue = rosterFatigue(duties);
    const violations = this.crew.violations(p.operatorId, duties, now);
    const shown = duties.filter(d => d.dutyEnd.getTime() > now.getTime() - 2 * DAY);
    const ids = shown.flatMap(d => d.legs.map(l => l.id));
    const [disp, onboard, ack, away, reports] = await Promise.all([
      ids.length ? this.db.db.select({ flightId: dispatch.flightId, status: dispatch.status }).from(dispatch).where(inArray(dispatch.flightId, ids)) : [],
      this.repo.crewOnFlights(ids),
      this.db.db.select().from(rosterAcks).where(eq(rosterAcks.crewId, c.id)),
      this.db.db.select().from(crewUnavailability).where(and(eq(crewUnavailability.crewId, c.id), eq(crewUnavailability.cancelled, false), gt(crewUnavailability.endAt, now))).orderBy(asc(crewUnavailability.startAt)),
      this.fatigue.list(p)
    ]);
    const since = ack[0]?.lastChangeId ?? 0;
    const ch = await this.db.db.select({ c: rosterChanges, f: flights }).from(rosterChanges).innerJoin(flights, eq(flights.id, rosterChanges.flightId))
      .where(and(eq(rosterChanges.crewId, c.id), gt(rosterChanges.id, since))).orderBy(asc(rosterChanges.id)).limit(200);
    return {
      crew: { id: c.id, name: c.name, rank: c.rank as RosterCrewRowDto['rank'], base: c.base, qualifications: c.qualifications },
      status: ftlStatus(violations), violations: violations.map(v => ({ ...v })),
      duties: shown.map(d => {
        const base = dutyDto(d, legs, fatigue);
        return {
          ...base,
          flights: base.legs.map(l => ({
            ...l,
            dispatch: (disp.find(x => x.flightId === l.flightId)?.status ?? 'NONE') as 'NONE' | 'OPEN' | 'RELEASED' | 'WITHDRAWN',
            crew: onboard.filter(o => o.a.flightId === l.flightId && !o.a.positioning).map(o => ({ name: o.c.name, rank: o.a.role }))
          }))
        };
      }),
      changes: ch.map((x): RosterChangeDto => ({ id: x.c.id, flightId: x.c.flightId, flightNo: x.f.flightNo, date: x.f.opDate, change: x.c.change as 'ADDED' | 'REMOVED', at: x.c.at.toISOString() })),
      away: away.map(a => unavailDto(a, new Map([[c.id, c.name]]))),
      fatigueReports: reports
    };
  }

  /** Acknowledge the roster changes seen, up to the given change. */
  async acknowledge(p: Principal, through: number) {
    await this.authz.check(p, this.hubRes(p), 'acknowledge');
    const c = await this.fatigue.mine(p);
    if (!c) throw new DomainError('NOT_CREW', 'Your account is not linked to a crew record', 422);
    await this.db.transaction(async () => {
      const [mx] = await this.db.db.select({ m: sql<string | null>`max(${rosterChanges.id})::text` }).from(rosterChanges).where(eq(rosterChanges.crewId, c.id));
      const last = Math.min(through, Number(mx?.m ?? 0));
      await this.db.db.insert(rosterAcks).values({ crewId: c.id, lastChangeId: last, acknowledgedAt: new Date() })
        .onConflictDoUpdate({ target: rosterAcks.crewId, set: { lastChangeId: sql`greatest(${rosterAcks.lastChangeId}, ${last})`, acknowledgedAt: new Date() } });
    });
    return { ok: true };
  }
}

const dayRe = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const buildSchema = z.object({ from: dayRe, to: dayRe });
const publishSchema = z.object({ from: dayRe, to: dayRe, note: z.string().trim().max(500).optional() });
const unavailSchema = z.object({
  crewId: z.string().min(2).max(40), kind: z.enum(['LEAVE', 'SICK', 'OFF', 'TRAINING']),
  start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }), note: z.string().trim().max(300).optional()
});
const fatigueSchema = z.object({
  kss: z.number().int().min(1).max(9), samnPerelli: z.number().int().min(1).max(7), sleepHours24: z.number().min(0).max(24).nullable().optional(),
  flightId: z.string().max(40).nullable().optional(), narrative: z.string().trim().min(10).max(4000)
});
const reviewSchema = z.object({ note: z.string().trim().min(3).max(2000) });
const ackSchema = z.object({ through: z.number().int().min(0) });
const pairingSchema = z.object({ name: z.string().trim().min(3).max(120), base: z.string().trim().toUpperCase().regex(/^[A-Z]{4}$/), flightIds: z.array(z.string().min(2).max(60)).min(1).max(20) });
const preferenceSchema = z.object({ crewId: z.string().min(2).max(40), kind: z.enum(['PREFER_OFF','PREFER_FLY','PREFER_EARLY','PREFER_LATE','AVOID_NIGHT']), startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), weight: z.number().int().min(1).max(5).default(3), note: z.string().trim().max(300).optional() });
const reserveSchema = z.object({ crewId: z.string().min(2).max(40), base: z.string().trim().toUpperCase().regex(/^[A-Z]{4}$/), start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }) });
const reserveCallSchema = z.object({ crewId: z.string().min(2).max(40), start: z.string().datetime({ offset: true }), flightId: z.string().min(2).max(60) });

@Controller('ops/roster')
export class RosterController {
  constructor(private readonly r: RosteringService) {}
  @Get() grid(@CurrentPrincipal() p: Principal, @Query('from') from?: string, @Query('to') to?: string) {
    const f = from ?? isoDay(new Date());
    return this.r.grid(p, f, to ?? isoDay(new Date(dayStart(f).getTime() + 6 * DAY)));
  }
  @Post('build') build(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(buildSchema)) b: z.infer<typeof buildSchema>) { return this.r.build(p, b); }
  @Post('runs/:id/accept') accept(@CurrentPrincipal() p: Principal, @Param('id') id: string) { return this.r.accept(p, id); }
  @Post('runs/:id/reject') reject(@CurrentPrincipal() p: Principal, @Param('id') id: string) { return this.r.reject(p, id); }
  @Post('publish') publish(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(publishSchema)) b: z.infer<typeof publishSchema>) { return this.r.publish(p, b); }
  @Post('unavailability') addAway(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(unavailSchema)) b: z.infer<typeof unavailSchema>) { return this.r.addUnavailability(p, b); }
  @Post('unavailability/:id/cancel') cancelAway(@CurrentPrincipal() p: Principal, @Param('id') id: string) { return this.r.cancelUnavailability(p, Number(id) || 0); }
  @Post('pairings') pairing(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(pairingSchema)) b: z.infer<typeof pairingSchema>) { return this.r.createPairing(p, b); }
  @Post('pairings/:id/approve') approvePairing(@CurrentPrincipal() p: Principal, @Param('id') id: string) { return this.r.approvePairing(p, id); }
  @Post('preferences') preference(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(preferenceSchema)) b: z.infer<typeof preferenceSchema>) { return this.r.addPreference(p, b); }
  @Post('preferences/:id/cancel') cancelPreference(@CurrentPrincipal() p: Principal, @Param('id') id: string) { return this.r.cancelPreference(p, Number(id) || 0); }
  @Post('reserves') reserve(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(reserveSchema)) b: z.infer<typeof reserveSchema>) { return this.r.addReserve(p, b); }
  @Post('reserves/call') callReserve(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(reserveCallSchema)) b: z.infer<typeof reserveCallSchema>) { return this.r.callReserve(p, b); }
}

@Controller('ops/fatigue')
export class FatigueController {
  constructor(private readonly f: FatigueService) {}
  @Get() list(@CurrentPrincipal() p: Principal) { return this.f.list(p); }
  @Post() submit(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(fatigueSchema)) b: z.infer<typeof fatigueSchema>) { return this.f.submit(p, b); }
  @Post(':id/review') review(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(reviewSchema)) b: z.infer<typeof reviewSchema>) { return this.f.review(p, Number(id) || 0, b.note); }
}

@Controller('crew/me')
export class CrewHubController {
  constructor(private readonly h: CrewHubService) {}
  @Get() me(@CurrentPrincipal() p: Principal) { return this.h.me(p); }
  @Post('acknowledge') ack(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(ackSchema)) b: z.infer<typeof ackSchema>) { return this.h.acknowledge(p, b.through); }
}

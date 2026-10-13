import { Body, Controller, ForbiddenException, Get, Inject, Injectable, Param, Post, Query } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { boolean, date, doublePrecision, integer, jsonb, numeric, pgSchema, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { DispatchBoardRowDto, DispatchDto, DispatchFuelDto, DispatchLoadDto, FlightDetailDto, OverflightPermitDto, ReleaseCheckDto } from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import {
  fuelPlan, icaoFlightPlan, lmcWithinTolerance, massAndBalance, permitCheck, releasable, tankering, type AircraftWeight, type TypeData
} from '@aeroos/ops-domain';
import { actorOf, CurrentPrincipal, type Principal } from '../../platform/auth/principal';
import { AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { ZodPipe } from '../../platform/http/http';
import { NotificationsService } from '../../platform/notifications/notifications.service';
import { FlightOpsService } from './flight-ops.service';
import { flightToDomain, flightToDto } from './ops.repository';
import { flights } from './ops.tables';
import { FlightWatchService } from './flight-watch.service';
import { MasterDataService } from '../compliance/master-data.service';
import { OperationalPlanningService } from './operational-planning.service';

const ops = pgSchema('ops');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const aircraftTypes = ops.table('aircraft_types', {
  operatorId: text('operator_id').notNull(), type: text('type').primaryKey(), icaoType: text('icao_type').notNull(), wake: text('wake').notNull(), seats: integer('seats').notNull(),
  mzfw: integer('mzfw').notNull(), mtow: integer('mtow').notNull(), mlw: integer('mlw').notNull(), maxFuel: integer('max_fuel').notNull(),
  lemac: doublePrecision('lemac').notNull(), mac: doublePrecision('mac').notNull(), fwdLimit: doublePrecision('fwd_limit').notNull(), aftLimit: doublePrecision('aft_limit').notNull(),
  crewArm: doublePrecision('crew_arm').notNull(), paxArm: doublePrecision('pax_arm').notNull(), holdFwdArm: doublePrecision('hold_fwd_arm').notNull(),
  holdAftArm: doublePrecision('hold_aft_arm').notNull(), fuelArm: doublePrecision('fuel_arm').notNull(), burnKgPerHour: integer('burn_kg_per_hour').notNull(),
  holdKgPerMin: integer('hold_kg_per_min').notNull(), cruiseKt: integer('cruise_kt').notNull()
});
export const aircraftWeights = ops.table('aircraft_weights', {
  tail: text('tail').primaryKey(), operatorId: text('operator_id').notNull(), basicEmptyKg: integer('basic_empty_kg').notNull(),
  basicArm: doublePrecision('basic_arm').notNull(), weighedOn: date('weighed_on', { mode: 'string' }).notNull()
});
export const runwayLimits = ops.table('runway_limits', {
  operatorId: text('operator_id').notNull(), airport: text('airport').notNull(), type: text('type').notNull(), rtowKg: integer('rtow_kg'), rlwKg: integer('rlw_kg'), note: text('note')
});
export const fuelPrices = ops.table('fuel_prices', {
  operatorId: text('operator_id').notNull(), station: text('station').notNull(), usdPerKg: numeric('usd_per_kg', { precision: 8, scale: 4 }).notNull(), asOf: date('as_of', { mode: 'string' }).notNull()
});
export const routes = ops.table('routes', {
  operatorId: text('operator_id').notNull(), dep: text('dep').notNull(), arr: text('arr').notNull(), route: text('route').notNull(), cruiseLevel: integer('cruise_level').notNull(), countries: text('countries').array().notNull()
});
export const permitRules = ops.table('permit_rules', {
  operatorId: text('operator_id').notNull(), country: text('country').primaryKey(), permitRequired: boolean('permit_required').notNull(), note: text('note')
});
export const overflightPermits = ops.table('overflight_permits', {
  id: serial('id').primaryKey(), operatorId: text('operator_id').notNull(), country: text('country').notNull(), number: text('number').notNull(),
  validFrom: date('valid_from', { mode: 'string' }).notNull(), validTo: date('valid_to', { mode: 'string' }).notNull(), types: text('types').array().notNull(),
  createdBy: text('created_by').notNull(), createdAt: ts('created_at').notNull().defaultNow()
});
export const dispatch = ops.table('dispatch', {
  flightId: text('flight_id').primaryKey(), operatorId: text('operator_id').notNull(), load: jsonb('load').$type<DispatchLoadDto | null>(),
  fuel: jsonb('fuel').$type<DispatchFuelDto | null>(), fpl: text('fpl'), fplFiledAt: ts('fpl_filed_at'), fplFiledBy: text('fpl_filed_by'),
  status: text('status').notNull(), releasedAt: ts('released_at'), releasedBy: text('released_by'),
  release: jsonb('release').$type<{ tow: number; pax: number; tail: string; etd: string; checks: ReleaseCheckDto[] } | null>(),
  lmc: jsonb('lmc').$type<{ at: string; by: string; change: string }[]>().notNull(), updatedAt: ts('updated_at').notNull().defaultNow(), version: integer('version').notNull()
});

type DispatchRow = typeof dispatch.$inferSelect;
const CHAIN = 'ops';
const day = (d: Date) => d.toISOString().slice(0, 10);
const country = (icao: string) => icao.slice(0, 2);
/** EU standard bag mass by flight kind: same ICAO country prefix = domestic; both European (E*, L*, GC) = Europe. */
const bagKind = (dep: string, arr: string) => (country(dep) === country(arr) ? 'DOMESTIC' as const
  : /^[EL]|^GC/.test(dep) && /^[EL]|^GC/.test(arr) ? 'EUROPE' as const : 'INTERCONTINENTAL' as const);

/**
 * Flight dispatch (ADR-0022): load sheet, fuel plan, tankering advice, ICAO flight plan, overflight permits and
 * the dispatch release, which requires every check to pass. A change after release within the LMC tolerance is
 * recorded on the load sheet; beyond it the release is withdrawn.
 */
@Injectable()
export class DispatchService {
  constructor(
    @Inject(DB_TOKEN.ops) private readonly db: ModuleDb,
    private readonly flightsSvc: FlightOpsService,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly flightWatch: FlightWatchService,
    private readonly masterData: MasterDataService,
    private readonly operationalPlanning: OperationalPlanningService
  ) {}

  private res(operatorId: string, id = '*') {
    return { kind: 'dispatch' as const, id, attr: { operatorId } };
  }

  private async typeData(operatorId: string, type: string): Promise<TypeData | null> {
    const [t] = await this.db.db.select().from(aircraftTypes).where(and(eq(aircraftTypes.operatorId, operatorId), eq(aircraftTypes.type, type)));
    return t ? { ...t, wake: t.wake as TypeData['wake'] } : null;
  }

  private async row(flightId: string, lock = false): Promise<DispatchRow | null> {
    const q = this.db.db.select().from(dispatch).where(eq(dispatch.flightId, flightId));
    const [r] = lock ? await q.for('update') : await q;
    return r ?? null;
  }

  /** Everything the dispatcher (and the crew's briefing package) needs, computed from the current data. */
  private async compute(p: Principal, detail: FlightDetailDto, r: DispatchRow | null) {
    const f = detail.flight;
    const [t, weights, limitsDep, limitsArr, route, prices, perms, ofp] = await Promise.all([
      this.typeData(p.operatorId, f.aircraftType),
      this.db.db.select().from(aircraftWeights).where(eq(aircraftWeights.tail, f.tail)),
      this.db.db.select().from(runwayLimits).where(and(eq(runwayLimits.operatorId, p.operatorId), eq(runwayLimits.airport, f.dep), eq(runwayLimits.type, f.aircraftType))),
      this.db.db.select().from(runwayLimits).where(and(eq(runwayLimits.operatorId, p.operatorId), eq(runwayLimits.airport, f.arr), eq(runwayLimits.type, f.aircraftType))),
      this.db.db.select().from(routes).where(and(eq(routes.operatorId, p.operatorId), eq(routes.dep, f.dep), eq(routes.arr, f.arr))),
      this.db.db.select().from(fuelPrices).where(and(eq(fuelPrices.operatorId, p.operatorId), inArray(fuelPrices.station, [f.dep, f.arr]))),
      this.db.db.select().from(overflightPermits).where(eq(overflightPermits.operatorId, p.operatorId)),
      this.operationalPlanning.currentOfp(p.operatorId, f.id)
    ]);
    const w = weights[0] ?? null;
    const rt = route[0] ?? null;
    // Trip time: scheduled block less taxi (10 min), at least 20 min. Alternate: the nearest one, at cruise speed + 10 min approach.
    const tripMinutes = Math.max(20, f.blockMinutes - 10);
    const alt = detail.alternates[0] ?? null;
    const alternateMinutes = alt && t ? Math.round((alt.distanceKm / (t.cruiseKt * 1.852)) * 60 + 10) : 30;
    const fuel = t && r?.fuel ? fuelPlan(t, { tripMinutes, alternateMinutes, taxi: r.fuel.taxi, extra: r.fuel.extra, block: r.fuel.block }) : null;
    const mb = t && w && r?.load ? massAndBalance(t, { tail: w.tail, basicEmptyKg: w.basicEmptyKg, basicArm: w.basicArm, weighedOn: w.weighedOn } satisfies AircraftWeight,
      { ...r.load, takeoffFuelKg: fuel ? fuel.block - fuel.taxi : 0, tripFuelKg: fuel?.trip ?? 0 },
      { bagKind: bagKind(f.dep, f.arr), rtow: limitsDep[0]?.rtowKg ?? null, rlw: limitsArr[0]?.rlwKg ?? null, now: new Date() }) : null;
    const priceDep = prices.find(x => x.station === f.dep), priceArr = prices.find(x => x.station === f.arr);
    const tank = t && mb && fuel && priceDep && priceArr ? tankering({
      priceDepPerKg: Number(priceDep.usdPerKg), priceArrPerKg: Number(priceArr.usdPerKg), flightMinutes: tripMinutes,
      landingMargin: mb.limits.lw - mb.lw, takeoffMargin: mb.limits.tow - mb.tow, tankMargin: t.maxFuel - (fuel.block - fuel.taxi),
      // Fuel needed for the return: roughly the same trip again.
      neededAtArrivalKg: fuel.trip
    }) : null;
    const message = t ? icaoFlightPlan({
      operatorIcao: p.operatorId, flightNo: f.flightNo, tail: f.tail, t, dep: f.dep, arr: f.arr, eobt: new Date(f.etd), tripMinutes,
      cruiseLevel: ofp?.cruiseLevel ?? rt?.cruiseLevel ?? 350, route: ofp?.route ?? rt?.route ?? 'DCT', alternates: ofp?.alternate ? [ofp.alternate] : alt ? [alt.icao] : []
    }) : '';
    const rules = rt ? await this.db.db.select().from(permitRules).where(and(eq(permitRules.operatorId, p.operatorId), inArray(permitRules.country, rt.countries))) : [];
    const permits = rt ? permitCheck(rt.countries.map(c => ({ code: c, permitRequired: rules.find(x => x.country === c)?.permitRequired ?? true })),
      perms.map(x => ({ country: x.country, number: x.number, validFrom: x.validFrom, validTo: x.validTo, types: x.types })), f.date, f.aircraftType) : [];

    const watch = await this.flightWatch.watch(p, f.id, ofp?.alternate ? [ofp.alternate] : alt ? [alt.icao] : []);
    const cabin = await this.operationalPlanning.cabinStatus(p.operatorId, f.id);
    const ofpCurrent = !!ofp && ofp.tail === f.tail && Math.abs(new Date(ofp.etd).getTime() - new Date(f.etd).getTime()) <= 60_000 && new Date(ofp.generatedAt).getTime() <= Date.now();
    const operating = detail.crew.filter(c => !c.positioning);
    const checks: ReleaseCheckDto[] = [
      { code: 'FLIGHT', ok: f.status === 'SCHEDULED' || f.status === 'DELAYED', message: f.status === 'SCHEDULED' || f.status === 'DELAYED' ? `${f.flightNo} ${f.status.toLowerCase()}` : `${f.flightNo} is ${f.status.toLowerCase()}` },
      { code: 'AIRCRAFT', ok: f.warnings.length === 0, message: f.warnings.length ? f.warnings.join('; ') : `${f.tail} airworthy and dispatchable` },
      { code: 'CREW', ok: operating.some(c => c.rank === 'CPT') && operating.some(c => c.rank === 'FO') && !operating.some(c => c.status === 'VIOLATION'),
        message: !operating.some(c => c.rank === 'CPT') || !operating.some(c => c.rank === 'FO') ? 'A captain and a first officer must be rostered'
          : operating.some(c => c.status === 'VIOLATION') ? `Flight-time limitation breached: ${operating.filter(c => c.status === 'VIOLATION').map(c => c.name).join(', ')}` : 'Crew legal (FTL)' },
      { code: 'WEIGHING', ok: !!w && !!t, message: !t ? `No type data for ${f.aircraftType}` : !w ? `No weighing record for ${f.tail}` : `Basic empty mass ${w.basicEmptyKg} kg (weighed ${w.weighedOn})` },
      { code: 'FUEL', ok: !!fuel && fuel.margin >= 0, message: !fuel ? 'Fuel plan not entered' : fuel.margin >= 0 ? `Block ${fuel.block} kg ≥ required ${fuel.required} kg` : `Block ${fuel.block} kg is ${-fuel.margin} kg short of the required ${fuel.required} kg` },
      { code: 'OFP_PROVIDER', ok: ofpCurrent && !!fuel && fuel.block >= (ofp?.blockFuelKg ?? Number.MAX_SAFE_INTEGER), message: !ofp ? 'No provider operational flight plan received' : !ofpCurrent ? 'Provider OFP is stale for the current tail or schedule' : !fuel ? 'Fuel plan not entered' : fuel.block < ofp.blockFuelKg ? `Block fuel ${fuel.block} kg is below provider OFP ${ofp.blockFuelKg} kg` : `${ofp.provider} OFP rev ${ofp.revision} current (${ofp.performanceRef}, nav ${ofp.navDataCycle})` },
      { code: 'CABIN_CREW', ok: !!cabin.requirement && cabin.missing.length === 0, message: !cabin.requirement ? `No cabin complement configured for ${f.aircraftType}` : cabin.missing.length ? `Cabin complement short: ${cabin.missing.map(x => `${x.count} ${x.role}`).join(', ')}` : 'Cabin complement assigned and legal' },
      { code: 'LOADSHEET', ok: !!mb && mb.findings.length === 0, message: !mb ? 'Load sheet not entered' : mb.findings.length ? mb.findings.join('; ') : `TOW ${mb.tow} kg, ${mb.towMac} %MAC, underload ${mb.underload} kg` },
      { code: 'FLIGHT_PLAN', ok: !!r?.fplFiledAt && r.fpl === message, message: !r?.fplFiledAt ? 'ICAO flight plan not filed' : r.fpl !== message ? 'The flight plan changed since it was filed: file it again' : `Filed ${r.fplFiledAt.toISOString().slice(11, 16)}Z` },
      { code: 'PERMITS', ok: !!rt && permits.every(x => x.ok), message: !rt ? `No route on file for ${f.dep}–${f.arr}` : permits.length === 0 ? 'No overflight permits required' : permits.map(x => (x.ok ? `${x.country}: ${x.permit}` : x.note)).join('; '), },
      ...watch.checks
    ];
    return { t, w, mb, fuel, tank, priceDep, priceArr, message, rt, permits, watch, ofp, cabin, checks, tripMinutes, alt, alternateMinutes };
  }

  /** Dispatch is worked for the operator you are acting for: another operator's flight is not found here. */
  private async ownFlight(p: Principal, flightId: string, lock = false) {
    const q = this.db.db.select({ operatorId: flights.operatorId, status: flights.status }).from(flights).where(eq(flights.id, flightId));
    const [f] = lock ? await q.for('update') : await q;
    if (!f || f.operatorId !== p.operatorId) throw new DomainError('FLIGHT_NOT_FOUND', `Flight ${flightId} not found for ${p.operatorId}`, 404);
    return f;
  }

  async package(p: Principal, flightId: string): Promise<DispatchDto> {
    await this.ownFlight(p, flightId);
    const can = await this.authz.decide(p, this.res(p.operatorId, flightId), ['read', 'prepare', 'release']);
    if (!can.read) throw new ForbiddenException('You are not permitted to see dispatch');
    const detail = await this.flightsSvc.detail(p, flightId);
    let r = await this.row(flightId);
    const c = await this.compute(p, detail, r);
    // A release stands only while every check still passes before departure (a new MEL item, an FTL breach…):
    // otherwise it is withdrawn for good and must be redone — it does not come back when the problem clears.
    const preDeparture = detail.flight.status === 'SCHEDULED' || detail.flight.status === 'DELAYED';
    if (r?.status === 'RELEASED' && preDeparture && !releasable(c.checks)) {
      const failed = c.checks.filter(x => !x.ok).map(x => `${x.code}: ${x.message}`).join('; ');
      await this.db.transaction(async () => {
        const changed = await this.db.db.update(dispatch).set({ status: 'WITHDRAWN', updatedAt: new Date(), version: r!.version + 1,
          lmc: [...r!.lmc, { at: new Date().toISOString(), by: 'system:dispatch', change: `Release withdrawn: ${failed}` }] })
          .where(and(eq(dispatch.flightId, flightId), eq(dispatch.status, 'RELEASED'), eq(dispatch.version, r!.version))).returning({ id: dispatch.flightId });
        if (!changed.length) return;
        await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: 'system:dispatch', action: 'dispatch.withdrawn', entityType: 'flight', entityId: flightId, data: { failed: c.checks.filter(x => !x.ok) } });
        await this.notifications.raise(this.db, { operatorId: p.operatorId, actor: 'system:dispatch', severity: 'red', link: `/ops/dispatch?flight=${flightId}`,
          title: `${detail.flight.flightNo} dispatch release withdrawn`, body: failed });
      });
      r = await this.row(flightId);
    }
    const status = r?.status ?? 'OPEN';
    return {
      flight: detail.flight, status: status as DispatchDto['status'],
      type: c.t ? { type: c.t.type, icaoType: c.t.icaoType, seats: c.t.seats, mzfw: c.t.mzfw, mtow: c.t.mtow, mlw: c.t.mlw, maxFuel: c.t.maxFuel, fwdLimit: c.t.fwdLimit, aftLimit: c.t.aftLimit } : null,
      weighing: c.w ? { basicEmptyKg: c.w.basicEmptyKg, weighedOn: c.w.weighedOn } : null,
      load: r?.load ?? null, fuelInput: r?.fuel ?? null, massBalance: c.mb,
      fuel: c.fuel ? { ...c.fuel, tripMinutes: c.tripMinutes, alternateIcao: c.alt?.icao ?? null, alternateMinutes: c.alternateMinutes } : null,
      tankering: c.tank ? { ...c.tank, priceDep: c.priceDep ? Number(c.priceDep.usdPerKg) : null, priceArr: c.priceArr ? Number(c.priceArr.usdPerKg) : null } : null,
      flightPlan: { message: c.message, filedAt: r?.fplFiledAt?.toISOString() ?? null, filedBy: r?.fplFiledBy ?? null, current: !!r?.fplFiledAt && r.fpl === c.message },
      route: c.rt ? { route: c.rt.route, cruiseLevel: c.rt.cruiseLevel, countries: c.rt.countries } : null,
      permits: c.permits, flightWatch: c.watch, ofp: c.ofp, cabin: c.cabin, checks: c.checks,
      release: status === 'RELEASED' && r?.release && r.releasedAt ? { at: r.releasedAt.toISOString(), by: r.releasedBy ?? '', tow: r.release.tow, pax: r.release.pax } : null,
      lmc: r?.lmc ?? [], version: r?.version ?? 0, permissions: { prepare: can.prepare, release: can.release }
    };
  }

  /** Insert-or-lock the dispatch row of a flight of this operator. */
  private async lockRow(p: Principal, flightId: string): Promise<{ row: DispatchRow; created: boolean }> {
    const [f] = await this.db.db.select({ operatorId: flights.operatorId }).from(flights).where(eq(flights.id, flightId));
    if (!f || f.operatorId !== p.operatorId) throw new DomainError('FLIGHT_NOT_FOUND', `Flight ${flightId} not found`, 404);
    const ins = await this.db.db.insert(dispatch).values({ flightId, operatorId: f.operatorId, status: 'OPEN', lmc: [], version: 1 }).onConflictDoNothing().returning({ id: dispatch.flightId });
    return { row: (await this.row(flightId, true))!, created: ins.length > 0 };
  }

  /** Optimistic concurrency: the version the client saw, unless the record did not exist yet. */
  private checkVersion(l: { row: DispatchRow; created: boolean }, version: number, flightNo: string) {
    if (!l.created && version !== l.row.version) throw new DomainError('CHANGED', `Dispatch for ${flightNo} was changed by someone else — reload`, 409);
  }

  /**
   * Save load or fuel. After a release the new figures are compared with the released ones: within the LMC
   * tolerance the change is recorded as a last-minute change; beyond it the release is withdrawn.
   */
  private async save(p: Principal, flightId: string, version: number, patch: Partial<Pick<DispatchRow, 'load' | 'fuel'>>, what: string): Promise<DispatchDto> {
    await this.authz.check(p, this.res(p.operatorId, flightId), 'prepare');
    await this.masterData.assertEffective(p.operatorId, ['ops.aircraft_types','ops.aircraft_weights','ops.runway_limits','ops.routes_permits','camo.mel','compliance.ftl']);
    await this.db.transaction(async () => {
      // The flight row is locked first, so a delay or tail swap cannot slip in between reading and saving.
      const fl = await this.ownFlight(p, flightId, true);
      if (fl.status !== 'SCHEDULED' && fl.status !== 'DELAYED') throw new DomainError('FLIGHT_STATE', `The flight is ${fl.status.toLowerCase()}: dispatch is closed`, 409);
      const detail = await this.flightsSvc.detail(p, flightId);
      const l = await this.lockRow(p, flightId);
      this.checkVersion(l, version, detail.flight.flightNo);
      const r = l.row;
      const next = { ...r, ...patch };
      const c = await this.compute(p, detail, next);
      let status = r.status, lmc = r.lmc;
      if (r.status === 'RELEASED' && r.release) {
        const pax = next.load ? next.load.adults + next.load.children + next.load.infants : 0;
        const tow = c.mb?.tow ?? 0;
        // A last-minute change keeps the release only if the flight is still releasable and the change is small.
        if (releasable(c.checks) && lmcWithinTolerance({ tow: r.release.tow, pax: r.release.pax }, { tow, pax })) {
          lmc = [...lmc, { at: new Date().toISOString(), by: actorOf(p), change: `${what}: TOW ${r.release.tow} → ${tow} kg, ${r.release.pax} → ${pax} pax` }];
        } else {
          status = 'WITHDRAWN';
          await this.notifications.raise(this.db, { operatorId: p.operatorId, actor: 'system:dispatch', severity: 'red', link: `/ops/dispatch?flight=${flightId}`,
            title: `${detail.flight.flightNo} dispatch release withdrawn`,
            body: releasable(c.checks) ? `${what} changed beyond the last-minute-change tolerance — a new load sheet and release are needed.`
              : `After the ${what} change: ${c.checks.filter(x => !x.ok).map(x => x.message).join('; ')}` });
        }
      }
      await this.db.db.update(dispatch).set({ ...patch, status, lmc, updatedAt: new Date(), version: r.version + 1 }).where(eq(dispatch.flightId, flightId));
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: `dispatch.${what}`, entityType: 'flight', entityId: flightId,
        data: { ...patch, status, massBalance: c.mb ? { tow: c.mb.tow, zfw: c.mb.zfw, towMac: c.mb.towMac, findings: c.mb.findings } : null, fuel: c.fuel } });
    });
    return this.package(p, flightId);
  }

  saveLoad(p: Principal, flightId: string, load: DispatchLoadDto, version: number) { return this.save(p, flightId, version, { load }, 'load'); }
  saveFuel(p: Principal, flightId: string, fuel: DispatchFuelDto, version: number) { return this.save(p, flightId, version, { fuel }, 'fuel'); }

  /** Record the ICAO flight plan as filed (sent to the ATS reporting office / IFPS by the operator's AFTN gateway). */
  async fileFlightPlan(p: Principal, flightId: string): Promise<DispatchDto> {
    await this.authz.check(p, this.res(p.operatorId, flightId), 'prepare');
    await this.db.transaction(async () => {
      const fl = await this.ownFlight(p, flightId, true);
      if (fl.status !== 'SCHEDULED' && fl.status !== 'DELAYED') throw new DomainError('FLIGHT_STATE', `The flight is ${fl.status.toLowerCase()}: dispatch is closed`, 409);
      const detail = await this.flightsSvc.detail(p, flightId);
      const r = (await this.lockRow(p, flightId)).row;
      const c = await this.compute(p, detail, r);
      if (!c.message) throw new DomainError('NO_TYPE_DATA', `No type data for ${detail.flight.aircraftType}`, 422);
      await this.db.db.update(dispatch).set({ fpl: c.message, fplFiledAt: new Date(), fplFiledBy: actorOf(p), updatedAt: new Date(), version: r.version + 1 }).where(eq(dispatch.flightId, flightId));
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'dispatch.fpl_filed', entityType: 'flight', entityId: flightId, data: { fpl: c.message } });
    });
    return this.package(p, flightId);
  }

  async release(p: Principal, flightId: string, version: number): Promise<DispatchDto> {
    await this.authz.check(p, this.res(p.operatorId, flightId), 'release');
    await this.masterData.assertEffective(p.operatorId, ['ops.aircraft_types','ops.aircraft_weights','ops.runway_limits','ops.routes_permits','camo.mel','compliance.ftl']);
    await this.db.transaction(async () => {
      await this.ownFlight(p, flightId, true);
      const detail = await this.flightsSvc.detail(p, flightId);
      const l = await this.lockRow(p, flightId);
      this.checkVersion(l, version, detail.flight.flightNo);
      const r = l.row;
      if (r.status === 'RELEASED') throw new DomainError('ALREADY_RELEASED', `${detail.flight.flightNo} is already released`, 409);
      const c = await this.compute(p, detail, r);
      if (!releasable(c.checks)) throw new DomainError('NOT_RELEASABLE', c.checks.filter(x => !x.ok).map(x => `${x.code}: ${x.message}`).join(' · '), 422);
      const pax = r.load ? r.load.adults + r.load.children + r.load.infants : 0;
      await this.db.db.update(dispatch).set({ status: 'RELEASED', releasedAt: new Date(), releasedBy: actorOf(p), release: { tow: c.mb!.tow, pax, tail: detail.flight.tail, etd: new Date(detail.flight.etd).toISOString(), checks: c.checks },
        lmc: [...r.lmc, { at: new Date().toISOString(), by: actorOf(p), change: 'Released' }],
        updatedAt: new Date(), version: r.version + 1 }).where(eq(dispatch.flightId, flightId));
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'dispatch.released', entityType: 'flight', entityId: flightId,
        data: { flightNo: detail.flight.flightNo, tail: detail.flight.tail, tow: c.mb!.tow, towMac: c.mb!.towMac, block: c.fuel!.block, required: c.fuel!.required, checks: c.checks } });
    });
    return this.package(p, flightId);
  }

  /** The day's flights with their dispatch state. */
  async board(p: Principal, dayIso: string): Promise<DispatchBoardRowDto[]> {
    await this.authz.check(p, this.res(p.operatorId), 'read');
    const from = new Date(`${dayIso}T00:00:00Z`), to = new Date(from.getTime() + 86_400_000);
    if (Number.isNaN(from.getTime())) throw new DomainError('DATE', 'day must be yyyy-mm-dd', 422);
    const fl = await this.db.db.select().from(flights).where(and(eq(flights.operatorId, p.operatorId), gte(flights.etd, from), lt(flights.etd, to))).orderBy(asc(flights.etd));
    const rows = fl.length ? await this.db.db.select().from(dispatch).where(inArray(dispatch.flightId, fl.map(f => f.id))) : [];
    return fl.map(f => {
      const r = rows.find(x => x.flightId === f.id);
      const ready = r ? [r.load, r.fuel, r.fplFiledAt].filter(Boolean).length : 0;
      return { flight: flightToDto(flightToDomain(f)), status: (r?.status ?? 'NONE') as DispatchBoardRowDto['status'], ready: r?.status === 'RELEASED' ? 3 : ready, total: 3 };
    });
  }

  /* ------------------------------------------------------------------ overflight permits and fuel prices */

  async permits(p: Principal): Promise<OverflightPermitDto[]> {
    await this.authz.check(p, this.res(p.operatorId), 'read');
    const rows = await this.db.db.select().from(overflightPermits).where(eq(overflightPermits.operatorId, p.operatorId)).orderBy(asc(overflightPermits.validTo));
    const today = Date.parse(`${day(new Date())}T00:00:00Z`);
    return rows.map(r => ({ id: r.id, country: r.country, number: r.number, validFrom: r.validFrom, validTo: r.validTo, types: r.types,
      expiresInDays: Math.round((Date.parse(`${r.validTo}T00:00:00Z`) - today) / 86_400_000) }));
  }

  async addPermit(p: Principal, b: { country: string; number: string; validFrom: string; validTo: string; types: string[] }): Promise<OverflightPermitDto[]> {
    await this.authz.check(p, this.res(p.operatorId), 'manage_reference');
    if (b.validFrom > b.validTo) throw new DomainError('DATES', 'The permit ends before it starts', 422);
    await this.db.transaction(async () => {
      await this.db.db.insert(overflightPermits).values({ operatorId: p.operatorId, ...b, createdBy: actorOf(p) });
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'permit.recorded', entityType: 'overflight_permit', entityId: b.number, data: b });
    });
    return this.permits(p);
  }

  async prices(p: Principal) {
    await this.authz.check(p, this.res(p.operatorId), 'read');
    return (await this.db.db.select().from(fuelPrices).where(eq(fuelPrices.operatorId, p.operatorId)).orderBy(asc(fuelPrices.station))).map(r => ({ station: r.station, usdPerKg: Number(r.usdPerKg), asOf: r.asOf }));
  }

  async setPrice(p: Principal, b: { station: string; usdPerKg: number }) {
    await this.authz.check(p, this.res(p.operatorId), 'manage_reference');
    await this.db.transaction(async () => {
      await this.db.db.insert(fuelPrices).values({ operatorId: p.operatorId, station: b.station, usdPerKg: String(b.usdPerKg), asOf: day(new Date()) })
        .onConflictDoUpdate({ target: [fuelPrices.operatorId, fuelPrices.station], set: { usdPerKg: String(b.usdPerKg), asOf: day(new Date()) } });
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'fuel_price.set', entityType: 'station', entityId: b.station, data: b });
    });
    return this.prices(p);
  }
}

const ver = z.number().int().min(0);
const n = (max: number) => z.number().int().min(0).max(max);
const loadSchema = z.object({
  load: z.object({ flightCrew: n(4).refine(x => x >= 2, 'At least two flight crew'), cabinCrew: n(12), adults: n(500), children: n(200), infants: n(100), bags: n(1000), holdFwdKg: n(60000), holdAftKg: n(60000) }),
  version: ver
});
const fuelSchema = z.object({ fuel: z.object({ block: n(200000), taxi: n(2000).default(200), extra: n(50000).default(0) }), version: ver });
const versionSchema = z.object({ version: ver });
const permitSchema = z.object({ country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/), number: z.string().trim().min(3).max(60),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), types: z.array(z.string().min(2).max(40)).max(10).default([]) });
const priceSchema = z.object({ station: z.string().trim().toUpperCase().regex(/^[A-Z]{4}$/), usdPerKg: z.number().positive().max(20) });

@Controller('ops/dispatch')
export class DispatchController {
  constructor(private readonly d: DispatchService) {}

  @Get() board(@CurrentPrincipal() p: Principal, @Query('day') dayIso?: string) { return this.d.board(p, dayIso ?? day(new Date())); }
  @Get('permits') permits(@CurrentPrincipal() p: Principal) { return this.d.permits(p); }
  @Post('permits') addPermit(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(permitSchema)) b: z.infer<typeof permitSchema>) { return this.d.addPermit(p, b); }
  @Get('fuel-prices') prices(@CurrentPrincipal() p: Principal) { return this.d.prices(p); }
  @Post('fuel-prices') setPrice(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(priceSchema)) b: z.infer<typeof priceSchema>) { return this.d.setPrice(p, b); }
  @Get(':flightId') pkg(@CurrentPrincipal() p: Principal, @Param('flightId') id: string) { return this.d.package(p, id); }
  @Post(':flightId/load') load(@CurrentPrincipal() p: Principal, @Param('flightId') id: string, @Body(new ZodPipe(loadSchema)) b: z.infer<typeof loadSchema>) { return this.d.saveLoad(p, id, b.load, b.version); }
  @Post(':flightId/fuel') fuel(@CurrentPrincipal() p: Principal, @Param('flightId') id: string, @Body(new ZodPipe(fuelSchema)) b: z.infer<typeof fuelSchema>) { return this.d.saveFuel(p, id, b.fuel, b.version); }
  @Post(':flightId/flight-plan') fpl(@CurrentPrincipal() p: Principal, @Param('flightId') id: string) { return this.d.fileFlightPlan(p, id); }
  @Post(':flightId/release') release(@CurrentPrincipal() p: Principal, @Param('flightId') id: string, @Body(new ZodPipe(versionSchema)) b: z.infer<typeof versionSchema>) { return this.d.release(p, id, b.version); }
}

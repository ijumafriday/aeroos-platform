import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { AirportDto, FlightDto, FlightStatus } from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import { blockMinutes, cabinOf, type Flight, type FlightWithActuals } from '@aeroos/ops-domain';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { airports, crewAssignments, crewMembers, crewRecoveryRuns, flights, maintenanceSlots, movements, recoveryRuns, standby, tailAirworthiness, tailMel } from './ops.tables';

export type MaintenanceSlot = typeof maintenanceSlots.$inferSelect;

type FlightRow = typeof flights.$inferSelect;

/** Flights always carry their actual times (null until a movement message reports them). */
export const flightToDomain = (r: FlightRow): FlightWithActuals => ({
  id: r.id, operatorId: r.operatorId, flightNo: r.flightNo, date: r.opDate, dep: r.dep, arr: r.arr, std: r.std, sta: r.sta,
  etd: r.etd, eta: r.eta, tail: r.tail, aircraftType: r.aircraftType, status: r.status as FlightStatus,
  delayMinutes: r.delayMinutes, delayReason: r.delayReason, version: r.version,
  offBlock: r.offBlock, airborne: r.airborne, touchdown: r.touchdown, onBlock: r.onBlock, delayCodes: r.delayCodes, actualArr: r.actualArr, divertingTo: r.divertingTo, bookedPax: r.bookedPax
});

const actualsOf = (f: Flight) => {
  const a = f as Partial<FlightWithActuals>;
  return {
    actuals: { offBlock: a.offBlock?.toISOString() ?? null, airborne: a.airborne?.toISOString() ?? null, touchdown: a.touchdown?.toISOString() ?? null, onBlock: a.onBlock?.toISOString() ?? null },
    delayCodes: a.delayCodes ?? [],
    actualArr: f.actualArr ?? null,
    divertingTo: f.divertingTo ?? null
  };
};

export const flightToDto = (f: Flight, warnings: string[] = []): FlightDto => ({
  id: f.id, flightNo: f.flightNo, date: f.date, dep: f.dep, arr: f.arr, std: f.std.toISOString(), sta: f.sta.toISOString(),
  etd: f.etd.toISOString(), eta: f.eta.toISOString(), tail: f.tail, aircraftType: f.aircraftType, status: f.status,
  delayMinutes: f.delayMinutes, delayReason: f.delayReason, blockMinutes: blockMinutes(f), warnings, version: f.version, ...actualsOf(f),
  load: { bookedPax: f.bookedPax ?? 0, seats: cabinOf(f.aircraftType).seats, jumpSeats: cabinOf(f.aircraftType).jumpSeats }
});

@Injectable()
export class OpsRepository {
  constructor(@Inject(DB_TOKEN.ops) private readonly db: ModuleDb) {}

  /* ---------------------------------------------------------- airports */

  private airportCache: { at: number; list: AirportDto[] } | null = null;

  /** IATA → ICAO, for movement messages (which name stations by IATA code). */
  async icaoOf(iata: string | null | undefined): Promise<string | null> {
    if (!iata) return null;
    if (iata.length === 4) return (await this.airports()).some(a => a.icao === iata) ? iata : null;
    return (await this.airports()).find(a => a.iata === iata)?.icao ?? null;
  }

  async airports(): Promise<AirportDto[]> {
    if (this.airportCache && Date.now() - this.airportCache.at < 300_000) return this.airportCache.list;
    const rows = await this.db.db.select().from(airports).orderBy(asc(airports.icao));
    const list = rows.map(r => ({ icao: r.icao, iata: r.iata, name: r.name, timeZone: r.timeZone, lat: r.lat, lon: r.lon, base: r.isBase }));
    this.airportCache = { at: Date.now(), list };
    return list;
  }

  /** Diversion alternates near the destination — PostGIS geography distance on the WGS-84 spheroid. */
  async alternates(icao: string, radiusKm: number, limit = 5) {
    const r = await this.db.db.execute<{ icao: string; iata: string; name: string; distance_km: number }>(sql`
      select a.icao, a.iata, a.name, round((ST_Distance(a.location, d.location) / 1000)::numeric, 0)::float8 as distance_km
      from ops.airports a, ops.airports d
      where d.icao = ${icao} and a.icao <> d.icao and ST_DWithin(a.location, d.location, ${radiusKm * 1000})
      order by ST_Distance(a.location, d.location)
      limit ${limit}`);
    return r.rows.map(x => ({ icao: x.icao, iata: x.iata, name: x.name, distanceKm: Number(x.distance_km) }));
  }

  /* ---------------------------------------------------------- flights */

  async flightsBetween(operatorId: string, from: Date, to: Date): Promise<Flight[]> {
    const rows = await this.db.db.select().from(flights)
      .where(and(eq(flights.operatorId, operatorId), lt(flights.etd, to), gte(flights.eta, from)))
      .orderBy(asc(flights.etd));
    return rows.map(flightToDomain);
  }

  async rotation(tail: string, date: string): Promise<Flight[]> {
    const rows = await this.db.db.select().from(flights)
      .where(and(eq(flights.tail, tail), sql`${flights.opDate} between (${date}::date - 1) and (${date}::date + 1)`))
      .orderBy(asc(flights.etd));
    return rows.map(flightToDomain);
  }

  async flight(id: string, opts: { lock?: boolean } = {}): Promise<FlightWithActuals> {
    const q = this.db.db.select().from(flights).where(eq(flights.id, id)).limit(1);
    const [r] = opts.lock ? await q.for('update') : await q;
    if (!r) throw new DomainError('FLIGHT_NOT_FOUND', `Flight ${id} not found`, 404);
    return flightToDomain(r);
  }

  async flightsByIds(ids: string[], opts: { lock?: boolean } = {}): Promise<Flight[]> {
    if (!ids.length) return [];
    const q = this.db.db.select().from(flights).where(inArray(flights.id, ids));
    const rows = opts.lock ? await q.for('update') : await q;
    return rows.map(flightToDomain);
  }

  async updateFlight(f: Flight, expectedVersion: number) {
    const a = f as Partial<FlightWithActuals>;
    const r = await this.db.db.update(flights).set({
      etd: f.etd, eta: f.eta, tail: f.tail, status: f.status, delayMinutes: f.delayMinutes, delayReason: f.delayReason, version: f.version,
      ...(a.delayCodes !== undefined ? { offBlock: a.offBlock ?? null, airborne: a.airborne ?? null, touchdown: a.touchdown ?? null, onBlock: a.onBlock ?? null, delayCodes: a.delayCodes, actualArr: f.actualArr ?? null, divertingTo: f.divertingTo ?? null } : {})
    }).where(and(eq(flights.id, f.id), eq(flights.version, expectedVersion))).returning({ id: flights.id });
    if (!r.length) throw new DomainError('CONCURRENT_UPDATE', `${f.flightNo} was changed by someone else. Reload and try again.`, 409);
    await this.withdrawReleaseIfChanged(f);
  }

  /**
   * A dispatch release covers one aircraft at one off-block time: a tail swap, a cancellation or a new estimated
   * off-block time before departure withdraws it (load sheet, fuel and flight plan must be redone). Called in the
   * same transaction as every flight update.
   */
  private async withdrawReleaseIfChanged(f: Flight) {
    const reason = `${f.status === 'CANCELLED' ? 'cancelled' : 'flight changed'} (tail ${f.tail}, ETD ${f.etd.toISOString().slice(11, 16)}Z)`;
    await this.db.db.execute(sql`
      update ops.dispatch set status = 'WITHDRAWN', updated_at = now(), version = version + 1,
        lmc = lmc || jsonb_build_array(jsonb_build_object('at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'by', 'system:ops', 'change', ${`Release withdrawn: ${reason}`}::text))
      where flight_id = ${f.id} and status = 'RELEASED'
        and (release->>'tail' is distinct from ${f.tail} or ${f.status} = 'CANCELLED'
             or (${f.status} in ('SCHEDULED', 'DELAYED') and release->>'etd' is distinct from ${f.etd.toISOString()}))`);
  }

  async insertFlightsIfAbsent(list: (Omit<FlightRow, 'version' | 'delayMinutes' | 'delayReason' | 'status' | 'offBlock' | 'airborne' | 'touchdown' | 'onBlock' | 'delayCodes' | 'actualArr' | 'divertingTo' | 'bookedPax'> & { bookedPax?: number })[]) {
    if (!list.length) return 0;
    const r = await this.db.db.insert(flights).values(list.map(f => ({ ...f, status: 'SCHEDULED', delayMinutes: 0, delayReason: null, version: 1 })))
      .onConflictDoNothing().returning({ id: flights.id });
    return r.length;
  }

  /** Demo loads for flights created before booked_pax existed (0.7 and earlier): only rows still at 0. */
  async backfillDemoLoads(list: { id: string; bookedPax: number }[]) {
    for (const f of list) {
      if (f.bookedPax > 0) await this.db.db.update(flights).set({ bookedPax: f.bookedPax }).where(and(eq(flights.id, f.id), eq(flights.bookedPax, 0)));
    }
  }

  /* ---------------------------------------------------------- crew */

  async crew(operatorId: string) {
    return this.db.db.select().from(crewMembers).where(and(eq(crewMembers.operatorId, operatorId), eq(crewMembers.active, true))).orderBy(asc(crewMembers.id));
  }

  async crewMember(id: string, operatorId: string) {
    const [r] = await this.db.db.select().from(crewMembers).where(eq(crewMembers.id, id)).limit(1);
    if (!r || r.operatorId !== operatorId) throw new DomainError('CREW_NOT_FOUND', `Crew member ${id} not found`, 404);
    return r;
  }

  /** Assignments with their flights for some crew in [from, to). */
  async legsFor(crewIds: string[], from: Date, to: Date) {
    if (!crewIds.length) return [];
    const rows = await this.db.db.select({ a: crewAssignments, f: flights }).from(crewAssignments)
      .innerJoin(flights, eq(flights.id, crewAssignments.flightId))
      .where(and(inArray(crewAssignments.crewId, crewIds), gte(flights.std, from), lt(flights.std, to)));
    return rows.map(r => ({ crewId: r.a.crewId, role: r.a.role, dutyKey: r.a.dutyKey, positioning: r.a.positioning, flight: flightToDomain(r.f) }));
  }

  async crewOnFlights(flightIds: string[]) {
    if (!flightIds.length) return [];
    return this.db.db.select({ a: crewAssignments, c: crewMembers }).from(crewAssignments)
      .innerJoin(crewMembers, eq(crewMembers.id, crewAssignments.crewId))
      .where(inArray(crewAssignments.flightId, flightIds));
  }

  async insertCrewIfAbsent(list: (typeof crewMembers.$inferInsert)[]) {
    if (list.length) await this.db.db.insert(crewMembers).values(list).onConflictDoNothing();
  }

  /** True when any flight of the operator on that operating date already has crew (rostered, recovered or demo). */
  async dayHasCrew(operatorId: string, date: string) {
    const r = await this.db.db.execute<{ n: number }>(sql`
      select count(*)::int as n from ops.crew_assignments a join ops.flights f on f.id = a.flight_id
      where f.operator_id = ${operatorId} and f.op_date = ${date}::date and not a.positioning`);
    return Number(r.rows[0]?.n ?? 0) > 0;
  }

  /** Demo: link a crew record to a sign-in, a period of leave and one fatigue report (each only once). */
  async ensureCrewDemo(operatorId: string, link: { crewId: string; username: string }, leave: { crewId: string; start: Date; end: Date }) {
    await this.db.db.execute(sql`
      update ops.crew_members set username = ${link.username}
      where id = ${link.crewId} and operator_id = ${operatorId} and username is null
        and not exists (select 1 from ops.crew_members where username = ${link.username})`);
    await this.db.db.execute(sql`
      insert into ops.crew_unavailability (operator_id, crew_id, kind, start_at, end_at, note, created_by)
      select ${operatorId}::text, ${leave.crewId}::text, 'LEAVE', ${leave.start.toISOString()}::timestamptz, ${leave.end.toISOString()}::timestamptz, 'Annual leave (demo)', 'system:demo'
      where exists (select 1 from ops.crew_members where id = ${leave.crewId})
        and not exists (select 1 from ops.crew_unavailability where operator_id = ${operatorId})`);
    await this.db.db.execute(sql`
      insert into ops.fatigue_reports (operator_id, crew_id, kss, samn_perelli, sleep_hours_24, severity, narrative, reported_by, reported_at)
      select ${operatorId}::text, ${link.crewId}::text, 7, 5, 5.5, 'MODERATE',
        'Third early report in a row; struggled to stay alert on the last sector into Oslo. Hotel noise the night before.', ${link.username}::text, now() - interval '1 day'
      where exists (select 1 from ops.crew_members where id = ${link.crewId} and username = ${link.username})
        and not exists (select 1 from ops.fatigue_reports where operator_id = ${operatorId})`);
  }

  async insertAssignmentsIfAbsent(list: (typeof crewAssignments.$inferInsert)[]) {
    if (list.length) await this.db.db.insert(crewAssignments).values(list).onConflictDoNothing();
  }

  /* ---------------------------------------------------------- dispatch projection */

  async melByTail(): Promise<Map<string, (typeof tailMel.$inferSelect)[]>> {
    const rows = await this.db.db.select().from(tailMel).orderBy(asc(tailMel.deadline));
    const m = new Map<string, (typeof tailMel.$inferSelect)[]>();
    for (const r of rows) m.set(r.tail, [...(m.get(r.tail) ?? []), r]);
    return m;
  }

  async upsertMel(v: { melItemId: string; tail: string; melRef: string; category: string; deadline: Date }) {
    await this.db.db.insert(tailMel).values({ ...v, expired: false })
      .onConflictDoUpdate({ target: tailMel.melItemId, set: { deadline: v.deadline, updatedAt: new Date() } });
  }

  async extendMel(melItemId: string, deadline: Date) {
    await this.db.db.update(tailMel).set({ deadline, expired: false, updatedAt: new Date() }).where(eq(tailMel.melItemId, melItemId));
  }

  async expireMel(melItemId: string) {
    const r = await this.db.db.update(tailMel).set({ expired: true, updatedAt: new Date() }).where(eq(tailMel.melItemId, melItemId)).returning({ tail: tailMel.tail });
    return r[0]?.tail ?? null;
  }

  async closeMel(melItemId: string) {
    const r = await this.db.db.delete(tailMel).where(eq(tailMel.melItemId, melItemId)).returning({ tail: tailMel.tail });
    return r[0]?.tail ?? null;
  }

  async airworthiness(): Promise<Map<string, { airworthy: boolean; reasons: string[] }>> {
    const rows = await this.db.db.select().from(tailAirworthiness);
    return new Map(rows.map(r => [r.reg, { airworthy: r.airworthy, reasons: r.reasons }]));
  }

  async setAirworthiness(reg: string, airworthy: boolean, reasons: string[]) {
    await this.db.db.insert(tailAirworthiness).values({ reg, airworthy, reasons, updatedAt: new Date() })
      .onConflictDoUpdate({ target: tailAirworthiness.reg, set: { airworthy, reasons, updatedAt: new Date() } });
  }

  /** Planned maintenance for these tails only (the caller passes its operator's fleet). */
  async slotsBetween(tails: string[], from: Date, to: Date): Promise<MaintenanceSlot[]> {
    if (!tails.length) return [];
    return this.db.db.select().from(maintenanceSlots)
      .where(and(inArray(maintenanceSlots.tail, tails), lt(maintenanceSlots.plannedStart, to), gte(maintenanceSlots.plannedEnd, from), sql`${maintenanceSlots.status} <> 'COMPLETED'`));
  }

  async upsertSlot(v: Omit<MaintenanceSlot, 'updatedAt'>) {
    await this.db.db.insert(maintenanceSlots).values({ ...v, updatedAt: new Date() })
      .onConflictDoUpdate({ target: maintenanceSlots.wpId, set: { bay: v.bay, plannedStart: v.plannedStart, plannedEnd: v.plannedEnd, status: v.status, updatedAt: new Date() } });
  }

  async completeSlot(wpId: string) {
    await this.db.db.update(maintenanceSlots).set({ status: 'COMPLETED', updatedAt: new Date() }).where(eq(maintenanceSlots.wpId, wpId));
  }

  /** Flights whose simulated movement state is behind the clock — only those no movement message has reported. */
  async flightsToProgress(now: Date, departedAfterMs: number): Promise<string[]> {
    const rows = await this.db.db.select({ id: flights.id }).from(flights).where(and(
      inArray(flights.status, ['SCHEDULED', 'DELAYED', 'DEPARTED']),
      // Flights no message has reported; or reported off-blocks but no arrival message 3 h after ETA (lost AA/IN).
      sql`(${flights.offBlock} is null or (${flights.onBlock} is null and ${flights.eta} <= ${new Date(now.getTime() - 3 * 3_600_000)}))`,
      sql`(${flights.eta} <= ${now} or (${flights.status} <> 'DEPARTED' and ${flights.etd} <= ${new Date(now.getTime() - departedAfterMs)}))`
    )).orderBy(asc(flights.etd)).limit(500);
    return rows.map(r => r.id);
  }

  /* ---------------------------------------------------------- movement messages */

  /** Candidate flights for a message: flight number, UTC day of month, within ±3 days of now. */
  async flightsByNumber(flightNo: string, around: Date, operatorId?: string): Promise<FlightWithActuals[]> {
    const rows = await this.db.db.select().from(flights).where(and(eq(flights.flightNo, flightNo),
      operatorId ? eq(flights.operatorId, operatorId) : undefined,
      gte(flights.std, new Date(around.getTime() - 3 * 86_400_000)), lt(flights.std, new Date(around.getTime() + 3 * 86_400_000))));
    return rows.map(flightToDomain);
  }

  async logMovement(v: { operatorId: string; source: string; raw: string; flightId: string | null; status: 'APPLIED' | 'IGNORED' | 'REJECTED'; detail: string | null; receivedBy: string }) {
    await this.db.db.insert(movements).values(v);
  }

  /** Messages received for one operator (by its integration key or its controllers). */
  async movementLog(operatorId: string, flightId?: string, limit = 50) {
    const own = eq(movements.operatorId, operatorId);
    return this.db.db.select().from(movements)
      .where(flightId ? and(eq(movements.flightId, flightId), own) : own)
      .orderBy(sql`${movements.receivedAt} desc`).limit(limit);
  }

  /* ---------------------------------------------------------- recovery runs */

  async nextRunId() {
    const r = await this.db.db.execute<{ n: string }>(sql.raw(`select nextval('ops.recovery_seq')::text as n`));
    return `REC-${r.rows[0].n}`;
  }

  async insertRun(v: typeof recoveryRuns.$inferInsert) {
    await this.db.db.insert(recoveryRuns).values(v);
  }

  async run(id: string, opts: { lock?: boolean } = {}) {
    const q = this.db.db.select().from(recoveryRuns).where(eq(recoveryRuns.id, id)).limit(1);
    const [r] = opts.lock ? await q.for('update') : await q;
    if (!r) throw new DomainError('RUN_NOT_FOUND', `Recovery run ${id} not found`, 404);
    return r;
  }

  async runs(operatorId: string, limit = 10) {
    return this.db.db.select().from(recoveryRuns).where(eq(recoveryRuns.operatorId, operatorId)).orderBy(sql`${recoveryRuns.createdAt} desc`).limit(limit);
  }

  async updateRun(id: string, set: Partial<typeof recoveryRuns.$inferInsert>, expectStatus?: string) {
    const r = await this.db.db.update(recoveryRuns).set(set)
      .where(expectStatus ? and(eq(recoveryRuns.id, id), eq(recoveryRuns.status, expectStatus)) : eq(recoveryRuns.id, id))
      .returning({ id: recoveryRuns.id });
    return r.length > 0;
  }

  /* ---------------------------------------------------------- crew recovery */

  async insertStandbyIfAbsent(list: (typeof standby.$inferInsert)[]) {
    if (list.length) await this.db.db.insert(standby).values(list).onConflictDoNothing();
  }

  async standbyBetween(crewIds: string[], from: Date, to: Date) {
    if (!crewIds.length) return [];
    return this.db.db.select().from(standby).where(and(inArray(standby.crewId, crewIds), inArray(standby.status, ['AVAILABLE','CALLED']), lt(standby.startAt, to), gte(standby.endAt, from)));
  }

  /** Current crew on these flights (locked), for the stale check before re-crewing. */
  async assignmentsOn(flightIds: string[], opts: { lock?: boolean } = {}) {
    if (!flightIds.length) return [];
    const q = this.db.db.select().from(crewAssignments).where(inArray(crewAssignments.flightId, flightIds));
    return opts.lock ? q.for('update') : q;
  }

  /** Hand the operating legs of a duty from one crew member to another, under a new duty key. */
  async reassign(fromCrew: string, toCrew: string, flightIds: string[], dutyKey: string) {
    const r = await this.db.db.update(crewAssignments).set({ crewId: toCrew, dutyKey })
      .where(and(eq(crewAssignments.crewId, fromCrew), inArray(crewAssignments.flightId, flightIds), eq(crewAssignments.positioning, false)))
      .returning({ f: crewAssignments.flightId });
    if (r.length !== flightIds.length) throw new DomainError('CONCURRENT_UPDATE', `Crew on ${flightIds.join(', ')} changed meanwhile`, 409);
  }

  /** Drop a crew member's positioning rows in a duty from a given time on (after a hand-over they no longer apply). */
  async dropPositioning(crewId: string, dutyKey: string, flightIds: string[]) {
    if (!flightIds.length) return;
    await this.db.db.delete(crewAssignments).where(and(eq(crewAssignments.crewId, crewId), eq(crewAssignments.dutyKey, dutyKey),
      eq(crewAssignments.positioning, true), inArray(crewAssignments.flightId, flightIds)));
  }

  /** Serialise crew-recovery decisions per operator: two accepted runs must not book the same person twice. */
  async lockCrewRecovery(operatorId: string) {
    await this.db.db.execute(sql`select pg_advisory_xact_lock(hashtext(${'crew-recovery:' + operatorId}))`);
  }

  /** Book a crew member as a positioning passenger on these flights (part of a re-crewed duty). */
  async addPositioning(crewId: string, flightIds: string[], role: 'CPT' | 'FO', dutyKey: string) {
    if (!flightIds.length) return;
    await this.db.db.insert(crewAssignments).values(flightIds.map(flightId => ({ crewId, flightId, role, dutyKey, positioning: true })));
  }

  async nextCrewRunId() {
    const r = await this.db.db.execute<{ n: string }>(sql.raw(`select nextval('ops.crew_recovery_seq')::text as n`));
    return `CRW-${r.rows[0].n}`;
  }

  async insertCrewRun(v: typeof crewRecoveryRuns.$inferInsert) {
    await this.db.db.insert(crewRecoveryRuns).values(v);
  }

  async crewRun(id: string, opts: { lock?: boolean } = {}) {
    const q = this.db.db.select().from(crewRecoveryRuns).where(eq(crewRecoveryRuns.id, id)).limit(1);
    const [r] = opts.lock ? await q.for('update') : await q;
    if (!r) throw new DomainError('RUN_NOT_FOUND', `Crew recovery run ${id} not found`, 404);
    return r;
  }

  async crewRuns(operatorId: string, limit = 10) {
    return this.db.db.select().from(crewRecoveryRuns).where(eq(crewRecoveryRuns.operatorId, operatorId)).orderBy(sql`${crewRecoveryRuns.createdAt} desc`).limit(limit);
  }

  async updateCrewRun(id: string, set: Partial<typeof crewRecoveryRuns.$inferInsert>, expectStatus?: string) {
    const r = await this.db.db.update(crewRecoveryRuns).set(set)
      .where(expectStatus ? and(eq(crewRecoveryRuns.id, id), eq(crewRecoveryRuns.status, expectStatus)) : eq(crewRecoveryRuns.id, id))
      .returning({ id: crewRecoveryRuns.id });
    return r.length > 0;
  }
}

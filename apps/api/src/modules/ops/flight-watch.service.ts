import { Body, Controller, Get, Inject, Injectable, Param, Post } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { bigserial, boolean, integer, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { FlightWatchDto, FlowSlotDto, NotamDto, ReleaseCheckDto, WeatherReportDto } from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import { actorOf, CurrentPrincipal, type Principal } from '../../platform/auth/principal';
import { AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { ZodPipe } from '../../platform/http/http';
import { CHAIN } from './flight-ops.service';
import { flights } from './ops.tables';

const ops = pgSchema('ops');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const weatherReports = ops.table('weather_reports', {
  id: bigserial('id', { mode: 'number' }).primaryKey(), operatorId: text('operator_id').notNull(), station: text('station').notNull(), kind: text('kind').notNull(),
  issuedAt: ts('issued_at').notNull(), validFrom: ts('valid_from').notNull(), validTo: ts('valid_to').notNull(), raw: text('raw').notNull(),
  ceilingFt: integer('ceiling_ft'), visibilityM: integer('visibility_m'), windGustKt: integer('wind_gust_kt'), crosswindKt: integer('crosswind_kt'),
  thunderstorm: boolean('thunderstorm').notNull().default(false), sourceRef: text('source_ref').notNull(), receivedBy: text('received_by').notNull(), receivedAt: ts('received_at').notNull().defaultNow()
});
export const notams = ops.table('notams', {
  id: bigserial('id', { mode: 'number' }).primaryKey(), operatorId: text('operator_id').notNull(), station: text('station').notNull(), notamNo: text('notam_no').notNull(),
  startsAt: ts('starts_at').notNull(), endsAt: ts('ends_at').notNull(), category: text('category').notNull(), severity: text('severity').notNull(), text: text('text').notNull(),
  sourceRef: text('source_ref').notNull(), receivedBy: text('received_by').notNull(), receivedAt: ts('received_at').notNull().defaultNow(), cancelled: boolean('cancelled').notNull().default(false)
});
export const flowSlots = ops.table('flow_slots', {
  id: bigserial('id', { mode: 'number' }).primaryKey(), operatorId: text('operator_id').notNull(), flightId: text('flight_id').notNull(), ctot: ts('ctot').notNull(),
  toleranceBefore: integer('tolerance_before').notNull(), toleranceAfter: integer('tolerance_after').notNull(), sourceRef: text('source_ref').notNull(), status: text('status').notNull(),
  receivedBy: text('received_by').notNull(), receivedAt: ts('received_at').notNull().defaultNow()
});

const weatherDto = (r: typeof weatherReports.$inferSelect): WeatherReportDto => ({ id: r.id, station: r.station, kind: r.kind as WeatherReportDto['kind'], issuedAt: r.issuedAt.toISOString(), validFrom: r.validFrom.toISOString(), validTo: r.validTo.toISOString(), raw: r.raw, ceilingFt: r.ceilingFt, visibilityM: r.visibilityM, windGustKt: r.windGustKt, crosswindKt: r.crosswindKt, thunderstorm: r.thunderstorm, sourceRef: r.sourceRef });
const notamDto = (r: typeof notams.$inferSelect): NotamDto => ({ id: r.id, station: r.station, number: r.notamNo, startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString(), category: r.category as NotamDto['category'], severity: r.severity as NotamDto['severity'], text: r.text, sourceRef: r.sourceRef, cancelled: r.cancelled });
const slotDto = (r: typeof flowSlots.$inferSelect): FlowSlotDto => ({ id: r.id, flightId: r.flightId, ctot: r.ctot.toISOString(), toleranceBefore: r.toleranceBefore, toleranceAfter: r.toleranceAfter, sourceRef: r.sourceRef, status: r.status as FlowSlotDto['status'] });

/** Operational flight-watch data. AeroOS consumes provider/OCC observations with explicit provenance; it does not invent weather or NOTAMs. */
@Injectable()
export class FlightWatchService {
  constructor(@Inject(DB_TOKEN.ops) private readonly db: ModuleDb, private readonly authz: AuthzService, private readonly audit: AuditService) {}
  private res(p: Principal, id = '*') { return { kind: 'dispatch' as const, id, attr: { operatorId: p.operatorId } }; }

  async watch(p: Principal, flightId: string, extraStations: string[] = []): Promise<FlightWatchDto> {
    await this.authz.check(p, this.res(p, flightId), 'read');
    const [f] = await this.db.db.select().from(flights).where(and(eq(flights.id, flightId), eq(flights.operatorId, p.operatorId)));
    if (!f) throw new DomainError('FLIGHT_NOT_FOUND', `Flight ${flightId} not found`, 404);
    const stations = [...new Set([f.dep, f.arr, ...extraStations.map(x => x.trim().toUpperCase()).filter(Boolean)])];
    const windowFrom = new Date(f.etd.getTime() - 6 * 3_600_000), windowTo = new Date(f.eta.getTime() + 6 * 3_600_000);
    const [wx, ns, slots] = await Promise.all([
      this.db.db.select().from(weatherReports).where(and(eq(weatherReports.operatorId, p.operatorId), inArray(weatherReports.station, stations), lte(weatherReports.validFrom, windowTo), gte(weatherReports.validTo, windowFrom))).orderBy(desc(weatherReports.issuedAt)),
      this.db.db.select().from(notams).where(and(eq(notams.operatorId, p.operatorId), inArray(notams.station, stations), eq(notams.cancelled, false), lte(notams.startsAt, f.eta), gte(notams.endsAt, f.etd))).orderBy(desc(notams.startsAt)),
      this.db.db.select().from(flowSlots).where(and(eq(flowSlots.operatorId, p.operatorId), eq(flowSlots.flightId, flightId), eq(flowSlots.status, 'ACTIVE'))).orderBy(desc(flowSlots.receivedAt))
    ]);
    const weather = stations.map(station => {
      const metar = wx.find(x => x.station === station && x.kind === 'METAR') ?? null;
      const taf = wx.find(x => x.station === station && x.kind === 'TAF') ?? null;
      const findings: ReleaseCheckDto[] = [];
      const refTime = station === f.dep ? f.etd : f.eta;
      const now = new Date();
      const metarCurrent = !!metar && metar.issuedAt <= new Date(now.getTime() + 15 * 60_000) && metar.issuedAt >= new Date(now.getTime() - 2 * 3_600_000);
      findings.push({ code: `${station}_METAR`, ok: metarCurrent, message: !metar ? `${station}: no current METAR observation` : metarCurrent ? `${station}: METAR observation is current` : `${station}: latest METAR is older than the 2-hour briefing recency limit` });
      findings.push({ code: `${station}_TAF`, ok: !!taf && taf.validFrom <= refTime && taf.validTo >= refTime, message: !taf ? `${station}: no TAF covering the planned time` : taf.validFrom <= refTime && taf.validTo >= refTime ? `${station}: TAF valid at planned time` : `${station}: TAF does not cover planned time` });
      for (const r of [metar, taf].filter(Boolean) as typeof wx) {
        if (r.thunderstorm) findings.push({ code: `${station}_TS`, ok: false, message: `${station}: thunderstorm reported/forecast — dispatcher assessment required` });
        if (r.visibilityM !== null && r.visibilityM < 1500) findings.push({ code: `${station}_VIS`, ok: false, message: `${station}: visibility ${r.visibilityM} m below generic watch threshold 1500 m` });
        if (r.crosswindKt !== null && r.crosswindKt > 30) findings.push({ code: `${station}_XWIND`, ok: false, message: `${station}: crosswind ${r.crosswindKt} kt above generic watch threshold 30 kt` });
      }
      return { station, metar: metar ? weatherDto(metar) : null, taf: taf ? weatherDto(taf) : null, findings };
    });
    const activeNotams = ns.map(notamDto);
    const blocking = ns.filter(n => n.severity === 'CLOSED');
    const slot = slots[0] ? slotDto(slots[0]) : null;
    const coverageFailures = weather.flatMap(w => w.findings.filter(x => (x.code.endsWith('_METAR') || x.code.endsWith('_TAF')) && !x.ok));
    const weatherAdvisories = weather.flatMap(w => w.findings.filter(x => !(x.code.endsWith('_METAR') || x.code.endsWith('_TAF')) && !x.ok));
    const checks: ReleaseCheckDto[] = [
      { code: 'OPERATIONAL_WEATHER', ok: coverageFailures.length === 0, message: coverageFailures.length ? coverageFailures.map(x => x.message).join('; ') : `Departure and arrival weather briefing current${weatherAdvisories.length ? `; watch advisories: ${weatherAdvisories.map(x => x.message).join('; ')}` : ''}` },
      { code: 'NOTAM', ok: blocking.length === 0, message: blocking.length ? blocking.map(n => `${n.station} ${n.notamNo}: ${n.text}`).join('; ') : `${ns.length} active NOTAM(s), none marked CLOSED` },
      { code: 'FLOW_SLOT', ok: !slot || (f.etd >= new Date(new Date(slot.ctot).getTime() - slot.toleranceBefore * 60_000) && f.etd <= new Date(new Date(slot.ctot).getTime() + slot.toleranceAfter * 60_000)), message: !slot ? 'No active flow slot' : `CTOT ${slot.ctot.slice(11,16)}Z window -${slot.toleranceBefore}/+${slot.toleranceAfter} min` }
    ];
    return { flightId, generatedAt: new Date().toISOString(), weather, notams: activeNotams, slot, checks };
  }

  async recordWeather(p: Principal, b: { station: string; kind: 'METAR'|'TAF'; issuedAt: string; validFrom: string; validTo: string; raw: string; ceilingFt?: number|null; visibilityM?: number|null; windGustKt?: number|null; crosswindKt?: number|null; thunderstorm?: boolean; sourceRef: string }) {
    await this.authz.check(p, this.res(p), 'manage_reference');
    const dates = [new Date(b.issuedAt), new Date(b.validFrom), new Date(b.validTo)];
    if (dates.some(d => Number.isNaN(d.getTime())) || dates[1] > dates[2]) throw new DomainError('WEATHER_DATES', 'Weather validity dates are invalid', 422);
    return this.db.transaction(async () => {
      const [r] = await this.db.db.insert(weatherReports).values({ operatorId: p.operatorId, station: b.station, kind: b.kind, issuedAt: dates[0], validFrom: dates[1], validTo: dates[2], raw: b.raw, ceilingFt: b.ceilingFt ?? null, visibilityM: b.visibilityM ?? null, windGustKt: b.windGustKt ?? null, crosswindKt: b.crosswindKt ?? null, thunderstorm: b.thunderstorm ?? false, sourceRef: b.sourceRef, receivedBy: actorOf(p) }).returning();
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'flight_watch.weather_received', entityType: 'station', entityId: b.station, data: { id: r.id, kind: b.kind, sourceRef: b.sourceRef, issuedAt: b.issuedAt } });
      return weatherDto(r);
    });
  }

  async recordNotam(p: Principal, b: { station: string; number: string; startsAt: string; endsAt: string; category: NotamDto['category']; severity: NotamDto['severity']; text: string; sourceRef: string }) {
    await this.authz.check(p, this.res(p), 'manage_reference');
    const a = new Date(b.startsAt), z = new Date(b.endsAt); if (Number.isNaN(a.getTime()) || Number.isNaN(z.getTime()) || a >= z) throw new DomainError('NOTAM_DATES', 'NOTAM dates are invalid', 422);
    return this.db.transaction(async () => {
      const [r] = await this.db.db.insert(notams).values({ operatorId: p.operatorId, station: b.station, notamNo: b.number, startsAt: a, endsAt: z, category: b.category, severity: b.severity, text: b.text, sourceRef: b.sourceRef, receivedBy: actorOf(p), cancelled: false })
        .onConflictDoUpdate({ target: [notams.operatorId, notams.notamNo], set: { station: b.station, startsAt: a, endsAt: z, category: b.category, severity: b.severity, text: b.text, sourceRef: b.sourceRef, receivedBy: actorOf(p), receivedAt: new Date(), cancelled: false } }).returning();
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'flight_watch.notam_received', entityType: 'notam', entityId: b.number, data: { station: b.station, severity: b.severity, sourceRef: b.sourceRef } });
      return notamDto(r);
    });
  }

  async setSlot(p: Principal, flightId: string, b: { ctot: string; toleranceBefore?: number; toleranceAfter?: number; sourceRef: string }) {
    await this.authz.check(p, this.res(p, flightId), 'manage_reference');
    const [f] = await this.db.db.select({ id: flights.id }).from(flights).where(and(eq(flights.id, flightId), eq(flights.operatorId, p.operatorId))); if (!f) throw new DomainError('FLIGHT_NOT_FOUND', flightId, 404);
    const ctot = new Date(b.ctot); if (Number.isNaN(ctot.getTime())) throw new DomainError('CTOT', 'CTOT is invalid', 422);
    return this.db.transaction(async () => {
      await this.db.db.update(flowSlots).set({ status: 'CANCELLED' }).where(and(eq(flowSlots.operatorId, p.operatorId), eq(flowSlots.flightId, flightId), eq(flowSlots.status, 'ACTIVE')));
      const [r] = await this.db.db.insert(flowSlots).values({ operatorId: p.operatorId, flightId, ctot, toleranceBefore: b.toleranceBefore ?? 5, toleranceAfter: b.toleranceAfter ?? 10, sourceRef: b.sourceRef, status: 'ACTIVE', receivedBy: actorOf(p) }).returning();
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'flight_watch.slot_received', entityType: 'flight', entityId: flightId, data: { ctot: b.ctot, sourceRef: b.sourceRef } });
      return slotDto(r);
    });
  }
}

const icao = z.string().trim().toUpperCase().regex(/^[A-Z]{4}$/);
const dt = z.string().datetime({ offset: true });
const weatherSchema = z.object({ station: icao, kind: z.enum(['METAR','TAF']), issuedAt: dt, validFrom: dt, validTo: dt, raw: z.string().trim().min(4).max(8000), ceilingFt: z.number().int().min(0).max(60000).nullable().optional(), visibilityM: z.number().int().min(0).max(100000).nullable().optional(), windGustKt: z.number().int().min(0).max(250).nullable().optional(), crosswindKt: z.number().int().min(0).max(150).nullable().optional(), thunderstorm: z.boolean().optional(), sourceRef: z.string().trim().min(2).max(200) });
const notamSchema = z.object({ station: icao, number: z.string().trim().min(3).max(40), startsAt: dt, endsAt: dt, category: z.enum(['AIRPORT','RUNWAY','NAV','AIRSPACE','OTHER']), severity: z.enum(['INFO','RESTRICTED','CLOSED']), text: z.string().trim().min(3).max(8000), sourceRef: z.string().trim().min(2).max(200) });
const slotSchema = z.object({ ctot: dt, toleranceBefore: z.number().int().min(0).max(60).optional(), toleranceAfter: z.number().int().min(0).max(120).optional(), sourceRef: z.string().trim().min(2).max(200) });

@Controller('ops/flight-watch')
export class FlightWatchController {
  constructor(private readonly fw: FlightWatchService) {}
  @Get(':flightId') watch(@CurrentPrincipal() p: Principal, @Param('flightId') id: string) { return this.fw.watch(p, id); }
  @Post('weather') weather(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(weatherSchema)) b: z.infer<typeof weatherSchema>) { return this.fw.recordWeather(p, b); }
  @Post('notams') notam(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(notamSchema)) b: z.infer<typeof notamSchema>) { return this.fw.recordNotam(p, b); }
  @Post(':flightId/slot') slot(@CurrentPrincipal() p: Principal, @Param('flightId') id: string, @Body(new ZodPipe(slotSchema)) b: z.infer<typeof slotSchema>) { return this.fw.setSlot(p, id, b); }
}

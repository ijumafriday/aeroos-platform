import { Body, Controller, Get, Inject, Injectable, Logger, OnApplicationBootstrap, Param, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DamageChartDto, DamageDto, EngineDetailDto, EngineSummaryDto, HealthAlertDto } from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import {
  checkDamageInput, checkRepair, damageGrounding, engineAlerts, oilConsumption, requireUplift, type EngineAlert, type EngineLimits
} from '@aeroos/mro-domain';
import { actorOf, CurrentPrincipal, type Principal } from '../../platform/auth/principal';
import { AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { ZodPipe } from '../../platform/http/http';
import { NotificationsService } from '../../platform/notifications/notifications.service';
import { FleetQuery } from './camo.repository';
import {
  assessTail, engines, engineSnapshots, engineTypes, healthAlerts, limitsFor, oilUplifts, srmLimits, structuralDamage, toLimit, toState, type DamageRow
} from './health.tables';
import { ProgrammeService } from './programme.service';
import { MasterDataService } from '../compliance/master-data.service';

const CHAIN = 'camo';
const SUPPRESS_DAYS = 30;
/** A closed alert keeps the same condition quiet for 30 days, unless it escalates from amber to red. */
const suppressed = (closed: { closedAt: Date | null; level: string } | undefined, a: { level: string }) =>
  !!closed?.closedAt && Date.now() - closed.closedAt.getTime() < SUPPRESS_DAYS * 86_400_000 && !(a.level === 'RED' && closed.level !== 'RED');
type EngineRow = typeof engines.$inferSelect;
type AlertRow = typeof healthAlerts.$inferSelect;

const limitsOf = (t: typeof engineTypes.$inferSelect): EngineLimits => ({
  egtMarginAmber: t.egtMarginAmber, egtMarginRed: t.egtMarginRed, egtShift: t.egtShift, n2Shift: t.n2Shift, ffShift: t.ffShift, vibMax: t.vibMax,
  oilAlertQph: t.oilAlertQph, oilMaxQph: t.oilMaxQph
});
const alertDto = (r: AlertRow, active: boolean): HealthAlertDto => ({
  id: r.id, serial: r.serial, tail: r.tail, code: r.code, level: r.level as HealthAlertDto['level'], message: r.message, action: r.action,
  status: r.status as HealthAlertDto['status'], raisedAt: r.raisedAt.toISOString(), closedBy: r.closedBy, closedAt: r.closedAt?.toISOString() ?? null, closureNote: r.closureNote, active
});

/**
 * Engineering health (ADR-0024): engine condition trend monitoring and oil consumption with persisted alerts an
 * engineer closes with the action taken; the structural damage chart with SRM assessment, interactions,
 * engineering disposition, repairs and repeat inspections. Open damage beyond limits grounds the aircraft
 * through the airworthiness sweep.
 */
@Injectable()
export class HealthService implements OnApplicationBootstrap {
  private readonly log = new Logger('Health');
  constructor(
    @Inject(DB_TOKEN.camo) private readonly db: ModuleDb,
    private readonly fleet: FleetQuery,
    private readonly programme: ProgrammeService,
    private readonly masterData: MasterDataService,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService
  ) {}

  onApplicationBootstrap() {
    // alerts for data that arrived without going through the API (seed, bulk download), then hourly with the sweep
    setTimeout(() => void this.syncAll().catch(e => this.log.warn(`health sync: ${(e as Error).message}`)), 20_000).unref();
  }

  private engineRes(operatorId: string, id = '*') { return { kind: 'engine_health' as const, id, attr: { operatorId } }; }
  private damageRes(operatorId: string, id = '*') { return { kind: 'structural_damage' as const, id, attr: { operatorId } }; }

  /* ------------------------------------------------------------------ engines */

  private async engine(serial: string, operatorId: string): Promise<EngineRow> {
    const [e] = await this.db.db.select().from(engines).where(and(eq(engines.serial, serial), eq(engines.operatorId, operatorId)));
    if (!e) throw new DomainError('ENGINE_NOT_FOUND', `Engine ${serial} not found`, 404);
    return e;
  }

  /** Current conditions of one engine: trend + oil. */
  private async conditions(e: EngineRow, l: EngineLimits): Promise<{ alerts: EngineAlert[]; oilQph: number | null }> {
    const [snaps, oil] = await Promise.all([
      this.db.db.select().from(engineSnapshots).where(eq(engineSnapshots.serial, e.serial)).orderBy(desc(engineSnapshots.fh)).limit(200),
      this.db.db.select().from(oilUplifts).where(eq(oilUplifts.serial, e.serial)).orderBy(desc(oilUplifts.fh)).limit(60)
    ]);
    const o = oilConsumption(oil.map(u => ({ at: u.at, fh: u.fh, quarts: Number(u.quarts) })), l);
    return { alerts: [...engineAlerts(snaps, l), ...o.alerts], oilQph: o.current };
  }

  /** Open a persisted alert for each new condition (and notify once); keep level/message of open ones current. */
  async syncEngine(e: EngineRow, l: EngineLimits) {
    const { alerts } = await this.conditions(e, l);
    if (!alerts.length) return;
    await this.db.transaction(async () => {
      await this.db.db.execute(sql`select pg_advisory_xact_lock(hashtext(${'engine-health:' + e.serial}))`);
      const rows = await this.db.db.select().from(healthAlerts).where(eq(healthAlerts.serial, e.serial)).orderBy(desc(healthAlerts.closedAt));
      const open = rows.filter(r => r.status === 'OPEN');
      for (const a of alerts) {
        const cur = open.find(o => o.code === a.code);
        // an engineer's closure stands for 30 days unless the condition gets worse (amber → red)
        const closed = rows.find(r => r.status === 'CLOSED' && r.code === a.code);
        if (!cur && suppressed(closed, a)) continue;
        if (cur) {
          if (cur.level !== a.level || cur.message !== a.message) {
            await this.db.db.update(healthAlerts).set({ level: a.level, message: a.message, action: a.action, updatedAt: new Date() }).where(eq(healthAlerts.id, cur.id));
            if (a.level === 'RED' && cur.level !== 'RED') await this.notify(e, a);
          }
          continue;
        }
        const [ins] = await this.db.db.insert(healthAlerts).values({ operatorId: e.operatorId, serial: e.serial, tail: e.tail, code: a.code, level: a.level, message: a.message, action: a.action, status: 'OPEN' }).returning();
        await this.audit.record(this.db, CHAIN, { operatorId: e.operatorId, actor: 'system:ectm', action: 'engine.alert_raised', entityType: 'engine', entityId: e.serial, data: { id: ins.id, code: a.code, level: a.level, message: a.message } });
        await this.notify(e, a);
      }
    });
  }

  private async notify(e: EngineRow, a: EngineAlert) {
    await this.notifications.raise(this.db, {
      operatorId: e.operatorId, actor: 'system:ectm', severity: a.level === 'RED' ? 'red' : 'amber', link: `/camo/health?engine=${encodeURIComponent(e.serial)}`,
      title: `Engine ${e.serial}${e.tail ? ` (${e.tail} #${e.position})` : ''}: ${a.code.replace(/_/g, ' ').toLowerCase()}`, body: `${a.message}. ${a.action}.`
    });
  }

  async syncAll(): Promise<{ engines: number }> {
    const [list, types] = await Promise.all([this.db.db.select().from(engines), this.db.db.select().from(engineTypes)]);
    for (const e of list) {
      const t = types.find(x => x.engineType === e.engineType);
      if (t) await this.syncEngine(e, limitsOf(t));
    }
    return { engines: list.length };
  }

  private async summary(e: EngineRow, l: EngineLimits): Promise<EngineSummaryDto> {
    const [{ alerts, oilQph }, [last], rows] = await Promise.all([
      this.conditions(e, l),
      this.db.db.select().from(engineSnapshots).where(eq(engineSnapshots.serial, e.serial)).orderBy(desc(engineSnapshots.fh), desc(engineSnapshots.at)).limit(1),
      this.db.db.select().from(healthAlerts).where(eq(healthAlerts.serial, e.serial)).orderBy(desc(healthAlerts.closedAt))
    ]);
    const open = rows.filter(r => r.status === 'OPEN');
    const active = new Set<string>(alerts.map(a => a.code));
    // open persisted alerts first (still active or not), then conditions not yet persisted (the sync runs shortly)
    const list: HealthAlertDto[] = [
      ...open.map(r => alertDto(r, active.has(r.code))),
      ...alerts.filter(a => !open.some(o => o.code === a.code) && !suppressed(rows.find(r => r.status === 'CLOSED' && r.code === a.code), a)).map(a => ({ id: null, serial: e.serial, tail: e.tail, code: a.code, level: a.level, message: a.message, action: a.action,
        status: 'OPEN' as const, raisedAt: null, closedBy: null, closedAt: null, closureNote: null, active: true }))
    ];
    return {
      serial: e.serial, engineType: e.engineType, tail: e.tail, position: e.position,
      last: last ? { at: last.at.toISOString(), fh: last.fh, egtMargin: last.egtMargin, egtDev: last.egtDev, n2Dev: last.n2Dev, ffDevPct: last.ffDevPct, vib: last.vib } : null,
      oilQph: oilQph === null ? null : Math.round(oilQph * 1000) / 1000, alerts: list
    };
  }

  async fleetEngines(p: Principal): Promise<EngineSummaryDto[]> {
    await this.authz.check(p, this.engineRes(p.operatorId), 'read');
    const [list, types] = await Promise.all([
      this.db.db.select().from(engines).where(eq(engines.operatorId, p.operatorId)).orderBy(asc(engines.tail), asc(engines.position)),
      this.db.db.select().from(engineTypes)
    ]);
    const out: EngineSummaryDto[] = [];
    for (const e of list) {
      const t = types.find(x => x.engineType === e.engineType);
      if (t) out.push(await this.summary(e, limitsOf(t)));
    }
    const rank = (s: EngineSummaryDto) => (s.alerts.some(a => a.level === 'RED') ? 0 : s.alerts.length ? 1 : 2);
    return out.sort((a, b) => rank(a) - rank(b));
  }

  async engineDetail(p: Principal, serial: string): Promise<EngineDetailDto> {
    await this.authz.check(p, this.engineRes(p.operatorId, serial), 'read');
    const e = await this.engine(serial, p.operatorId);
    const [t] = await this.db.db.select().from(engineTypes).where(eq(engineTypes.engineType, e.engineType));
    const l = limitsOf(t);
    const [base, snaps, oil, history, perms] = await Promise.all([
      this.summary(e, l),
      this.db.db.select().from(engineSnapshots).where(eq(engineSnapshots.serial, serial)).orderBy(desc(engineSnapshots.fh)).limit(120),
      this.db.db.select().from(oilUplifts).where(eq(oilUplifts.serial, serial)).orderBy(desc(oilUplifts.fh)).limit(40),
      this.db.db.select().from(healthAlerts).where(and(eq(healthAlerts.serial, serial), eq(healthAlerts.status, 'CLOSED'))).orderBy(desc(healthAlerts.closedAt)).limit(30),
      this.authz.decide(p, this.engineRes(p.operatorId, serial), ['record_trend', 'record_oil', 'manage_alerts'])
    ]);
    const asc_ = [...oil].sort((a, b) => a.fh - b.fh);
    return {
      ...base, limits: l,
      snapshots: snaps.reverse().map(s => ({ at: s.at.toISOString(), fh: s.fh, egtMargin: s.egtMargin, egtDev: s.egtDev, n2Dev: s.n2Dev, ffDevPct: s.ffDevPct, vib: s.vib, source: s.source })),
      oil: asc_.map((u, i) => {
        const h = i > 0 ? u.fh - asc_[i - 1].fh : 0;
        return { at: u.at.toISOString(), fh: u.fh, quarts: Number(u.quarts), qph: h > 0 ? Math.round((Number(u.quarts) / h) * 1000) / 1000 : null, station: u.station, recordedBy: u.recordedBy };
      }),
      history: history.map(r => alertDto(r, false)),
      permissions: { recordTrend: perms.record_trend, recordOil: perms.record_oil, manageAlerts: perms.manage_alerts }
    };
  }

  async recordSnapshot(p: Principal, serial: string, b: { at?: string; fh: number; egtDev: number; n2Dev: number; ffDevPct: number; vib: number; egtMargin: number }) {
    await this.authz.check(p, this.engineRes(p.operatorId, serial), 'record_trend');
    await this.masterData.assertEffective(p.operatorId, ['camo.engine_limits']);
    const e = await this.engine(serial, p.operatorId);
    const at = b.at ? new Date(b.at) : new Date();
    if (at.getTime() > Date.now() + 3_600_000) throw new DomainError('FUTURE', 'The snapshot time is in the future', 422);
    if (e.tail) {
      const now = (await this.programme.tailStates(p.operatorId)).get(e.tail)?.counters.fh;
      if (now !== undefined && b.fh > now + 1) throw new DomainError('FH', `${b.fh} FH is more than ${e.tail}'s current ${now} FH`, 422);
    }
    await this.db.transaction(async () => {
      await this.db.db.insert(engineSnapshots).values({ serial, at, fh: b.fh, egtDev: b.egtDev, n2Dev: b.n2Dev, ffDevPct: b.ffDevPct, vib: b.vib, egtMargin: b.egtMargin, source: 'MANUAL', recordedBy: actorOf(p) });
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'engine.snapshot_recorded', entityType: 'engine', entityId: serial, data: b });
    });
    const [t] = await this.db.db.select().from(engineTypes).where(eq(engineTypes.engineType, e.engineType));
    await this.syncEngine(e, limitsOf(t));
    return this.engineDetail(p, serial);
  }

  /** Oil added on the line: hours come from the aircraft's counters at the time of the uplift. */
  async recordOil(p: Principal, serial: string, b: { quarts: number; station?: string }) {
    await this.authz.check(p, this.engineRes(p.operatorId, serial), 'record_oil');
    await this.masterData.assertEffective(p.operatorId, ['camo.engine_limits']);
    const e = await this.engine(serial, p.operatorId);
    if (!e.tail) throw new DomainError('NOT_INSTALLED', `Engine ${serial} is not installed`, 422);
    const fh = (await this.programme.tailStates(p.operatorId)).get(e.tail)?.counters.fh;
    if (fh === undefined) throw new DomainError('NO_COUNTERS', `No flight-hour counters for ${e.tail}`, 422);
    await this.db.transaction(async () => {
      await this.db.db.execute(sql`select pg_advisory_xact_lock(hashtext(${'engine-health:' + serial}))`);
      const [last] = await this.db.db.select({ fh: oilUplifts.fh }).from(oilUplifts).where(eq(oilUplifts.serial, serial)).orderBy(desc(oilUplifts.fh)).limit(1);
      requireUplift(b.quarts, fh, last?.fh ?? null);
      await this.db.db.insert(oilUplifts).values({ serial, tail: e.tail!, at: new Date(), fh, quarts: String(b.quarts), station: b.station ?? null, recordedBy: actorOf(p) });
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'engine.oil_uplift', entityType: 'engine', entityId: serial, data: { quarts: b.quarts, fh, station: b.station ?? null } });
    });
    const [t] = await this.db.db.select().from(engineTypes).where(eq(engineTypes.engineType, e.engineType));
    await this.syncEngine(e, limitsOf(t));
    return this.engineDetail(p, serial);
  }

  async closeAlert(p: Principal, id: number, note: string) {
    const [found] = await this.db.db.select({ serial: healthAlerts.serial }).from(healthAlerts).where(and(eq(healthAlerts.id, id), eq(healthAlerts.operatorId, p.operatorId)));
    if (!found) throw new DomainError('NOT_FOUND', `Alert ${id} not found`, 404);
    const serial = await this.db.transaction(async () => {
      // same lock order as the alert sync: engine lock, then the alert row
      await this.db.db.execute(sql`select pg_advisory_xact_lock(hashtext(${'engine-health:' + found.serial}))`);
      const [a] = await this.db.db.select().from(healthAlerts).where(and(eq(healthAlerts.id, id), eq(healthAlerts.operatorId, p.operatorId))).for('update');
      if (!a) throw new DomainError('NOT_FOUND', `Alert ${id} not found`, 404);
      await this.authz.check(p, this.engineRes(p.operatorId, a.serial), 'manage_alerts');
      if (a.status !== 'OPEN') throw new DomainError('CLOSED', 'The alert is already closed', 409);
      await this.db.db.update(healthAlerts).set({ status: 'CLOSED', closedBy: actorOf(p), closedAt: new Date(), closureNote: note.trim(), updatedAt: new Date() }).where(eq(healthAlerts.id, id));
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'engine.alert_closed', entityType: 'engine', entityId: a.serial, data: { id, code: a.code, note } });
      return a.serial;
    });
    return this.engineDetail(p, serial);
  }

  /* ------------------------------------------------------------------ structural damage */

  private async tailOf(p: Principal, reg: string) {
    const t = (await this.fleet.list(p.operatorId)).find(f => f.reg === reg);
    if (!t) throw new DomainError('TAIL_NOT_FOUND', `Aircraft ${reg} not found`, 404);
    return t;
  }

  private async fcOf(operatorId: string, reg: string): Promise<number> {
    const fc = (await this.programme.tailStates(operatorId)).get(reg)?.counters.fc;
    if (fc === undefined) throw new DomainError('NO_COUNTERS', `No flight-cycle counters for ${reg}`, 422);
    return fc;
  }

  /** Re-assess every damage on the aircraft (interactions change when damage is added, grows or is repaired). */
  private async reassess(tail: string, aircraftType: string, fc: number) {
    const rows = await this.db.db.select().from(structuralDamage).where(eq(structuralDamage.tail, tail)).orderBy(asc(structuralDamage.id)).for('update');
    const limits = await limitsFor(this.db, aircraftType);
    const a = assessTail(rows, limits);
    for (const r of rows) {
      const x = a.get(r.id);
      if (!x) continue;
      // keep a running repeat-inspection schedule; one that (re)starts — new damage, or back to allowable — counts from now
      const next = x.disposition === 'ALLOWABLE' && x.inspectFc ? (r.disposition === 'ALLOWABLE' && r.nextInspectionFc !== null ? r.nextInspectionFc : fc + x.inspectFc) : null;
      if (x.disposition !== r.disposition || x.reason !== r.reason || x.srmRef !== r.srmRef || next !== r.nextInspectionFc) {
        await this.db.db.update(structuralDamage).set({ disposition: x.disposition, reason: x.reason, srmRef: x.srmRef, nextInspectionFc: next, version: r.version + 1 }).where(eq(structuralDamage.id, r.id));
      }
    }
  }

  private dto(r: DamageRow, zoneName: string, fc: number): DamageDto {
    return {
      id: r.id, tail: r.tail, zone: r.zone, zoneName, side: r.side as DamageDto['side'], damageType: r.damageType as DamageDto['damageType'], xMm: r.xMm, yMm: r.yMm,
      lengthMm: r.lengthMm, widthMm: r.widthMm, depthMm: r.depthMm, description: r.description, foundAt: r.foundAt.toISOString(), foundFc: r.foundFc, foundBy: r.foundBy,
      disposition: r.disposition as DamageDto['disposition'], srmRef: r.srmRef, reason: r.reason, nextInspectionFc: r.nextInspectionFc,
      approvedData: r.approvedData, approvedBy: r.approvedBy,
      repair: r.repairKind ? { kind: r.repairKind as 'PERMANENT' | 'TEMPORARY', data: r.repairData ?? '', untilFc: r.repairUntilFc, untilDate: r.repairUntilDate, by: r.repairedBy ?? '', at: r.repairedAt?.toISOString() ?? '' } : null,
      grounding: damageGrounding(toState(r), fc, new Date()), version: r.version
    };
  }

  async chart(p: Principal, reg?: string): Promise<DamageChartDto> {
    await this.authz.check(p, this.damageRes(p.operatorId), 'read');
    const fleet = await this.fleet.list(p.operatorId);
    if (!fleet.length) throw new DomainError('NO_FLEET', 'No aircraft', 404);
    const t = reg ? await this.tailOf(p, reg) : fleet[0]; // ?tail= (empty) → the first aircraft
    const states = await this.programme.tailStates(p.operatorId);
    const fc = states.get(t.reg)?.counters.fc ?? 0;
    const [all, zones, perms] = await Promise.all([
      this.db.db.select().from(structuralDamage).where(inArray(structuralDamage.tail, fleet.map(f => f.reg))).orderBy(asc(structuralDamage.id)),
      this.db.db.selectDistinct({ zone: srmLimits.zone, name: srmLimits.zoneName }).from(srmLimits).where(eq(srmLimits.aircraftType, t.type)).orderBy(asc(srmLimits.zone)),
      this.authz.decide(p, this.damageRes(p.operatorId), ['record', 'approve_data', 'repair'])
    ]);
    const name = new Map(zones.map(z => [z.zone, z.name]));
    const now = new Date();
    // the same fresh assessment the airworthiness sweep uses (interactions, current SRM limits)
    const types = [...new Set(fleet.map(f => f.type))];
    const allLimits = types.length ? await this.db.db.select().from(srmLimits).where(inArray(srmLimits.aircraftType, types)) : [];
    const fresh = new Map<string, ReturnType<typeof assessTail>>(fleet.map(f => [f.reg, assessTail(all.filter(r => r.tail === f.reg), allLimits.filter(l => l.aircraftType === f.type).map(toLimit))]));
    const groundingOf = (r: DamageRow, tfc: number) => damageGrounding(toState(r, fresh.get(r.tail)?.get(r.id)), tfc, now);
    return {
      tail: t.reg, aircraftType: t.type, fc,
      tails: fleet.map(f => {
        const mine = all.filter(r => r.tail === f.reg);
        const tfc = states.get(f.reg)?.counters.fc ?? 0;
        // open: damage still needing action (beyond allowable and not permanently repaired)
        return { reg: f.reg, type: f.type, open: mine.filter(r => r.repairKind !== 'PERMANENT' && r.disposition !== 'ALLOWABLE').length, grounding: mine.filter(r => groundingOf(r, tfc)).length };
      }),
      zones, damages: all.filter(r => r.tail === t.reg).map(r => ({ ...this.dto(r, name.get(r.zone) ?? r.zone, fc), grounding: groundingOf(r, fc) })),
      permissions: { record: perms.record, approveData: perms.approve_data, repair: perms.repair }
    };
  }

  async recordDamage(p: Principal, b: { tail: string; zone: string; side: 'L' | 'R' | 'C'; damageType: DamageDto['damageType']; xMm: number; yMm: number; lengthMm: number; widthMm: number; depthMm: number; description: string }) {
    await this.authz.check(p, this.damageRes(p.operatorId), 'record');
    await this.masterData.assertEffective(p.operatorId, ['camo.srm_limits']);
    const t = await this.tailOf(p, b.tail);
    checkDamageInput(b);
    const fc = await this.fcOf(p.operatorId, t.reg);
    const limits = await limitsFor(this.db, t.type);
    if (!limits.some(l => l.zone === b.zone)) throw new DomainError('ZONE', `Zone ${b.zone} is not defined for the ${t.type}`, 422);
    const id = await this.db.transaction(async () => {
      await this.lockTail(t.reg);
      const r = await this.db.db.execute<{ n: string }>(sql`select nextval('camo.damage_seq')::text as n`);
      const id = `SD-${String(r.rows[0].n).padStart(4, '0')}`;
      await this.db.db.insert(structuralDamage).values({
        id, operatorId: p.operatorId, tail: t.reg, zone: b.zone, side: b.side, damageType: b.damageType, xMm: b.xMm, yMm: b.yMm, lengthMm: b.lengthMm, widthMm: b.widthMm,
        depthMm: b.depthMm, description: b.description.trim(), foundFc: fc, foundBy: actorOf(p), disposition: 'REFER', reason: 'not assessed yet'
      });
      await this.reassess(t.reg, t.type, fc);
      const [row] = await this.db.db.select().from(structuralDamage).where(eq(structuralDamage.id, id));
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'damage.recorded', entityType: 'aircraft', entityId: t.reg,
        data: { id, zone: b.zone, side: b.side, type: b.damageType, lengthMm: b.lengthMm, depthMm: b.depthMm, disposition: row.disposition, reason: row.reason } });
      if (row.disposition !== 'ALLOWABLE') {
        await this.notifications.raise(this.db, { operatorId: p.operatorId, actor: actorOf(p), severity: 'red', link: `/camo/health?tab=damage&tail=${encodeURIComponent(t.reg)}`,
          title: `${t.reg}: ${b.damageType.toLowerCase()} ${id} ${row.disposition === 'REFER' ? 'beyond SRM limits' : 'needs repair'}`, body: `${row.reason}. Not to fly until repaired.` });
      }
      return id;
    });
    await this.programme.sweepAirworthiness(p.operatorId, t.reg);
    return { id, chart: await this.chart(p, t.reg) };
  }

  /** All writes to one aircraft's damage chart are serialised (re-assessment touches every damage on it). */
  private async lockTail(tail: string) {
    await this.db.db.execute(sql`select pg_advisory_xact_lock(hashtext(${'damage:' + tail}))`);
  }

  private async damageRow(p: Principal, id: string) {
    const [t] = await this.db.db.select({ tail: structuralDamage.tail }).from(structuralDamage).where(and(eq(structuralDamage.id, id), eq(structuralDamage.operatorId, p.operatorId)));
    if (!t) throw new DomainError('DAMAGE_NOT_FOUND', `Damage ${id} not found`, 404);
    await this.lockTail(t.tail);
    const [r] = await this.db.db.select().from(structuralDamage).where(and(eq(structuralDamage.id, id), eq(structuralDamage.operatorId, p.operatorId))).for('update');
    if (!r) throw new DomainError('DAMAGE_NOT_FOUND', `Damage ${id} not found`, 404);
    return r;
  }

  /** Repeat inspection of an allowable damage: new measurements, re-assessed; the next inspection is set from today. */
  async inspect(p: Principal, id: string, b: { lengthMm: number; widthMm: number; depthMm: number; note: string; version: number }) {
    await this.authz.check(p, this.damageRes(p.operatorId, id), 'record');
    await this.masterData.assertEffective(p.operatorId, ['camo.srm_limits']);
    const tail = await this.db.transaction(async () => {
      const r = await this.damageRow(p, id);
      if (r.version !== b.version) throw new DomainError('CONCURRENT_UPDATE', `${id} changed meanwhile — reload`, 409);
      if (r.repairKind === 'PERMANENT') throw new DomainError('REPAIRED', `${id} is permanently repaired`, 409);
      checkDamageInput({ ...b, damageType: r.damageType as DamageDto['damageType'] });
      const t = await this.tailOf(p, r.tail);
      const fc = await this.fcOf(p.operatorId, r.tail);
      const grown = b.lengthMm > r.lengthMm || b.depthMm > r.depthMm || b.widthMm > r.widthMm;
      await this.db.db.update(structuralDamage).set({ lengthMm: b.lengthMm, widthMm: b.widthMm, depthMm: b.depthMm, nextInspectionFc: null, version: r.version + 1 }).where(eq(structuralDamage.id, id));
      // the next repeat inspection counts from this one
      const limits = await limitsFor(this.db, t.type);
      const insp = limits.find(l => l.zone === r.zone && l.damageType === r.damageType)?.inspectFc ?? null;
      if (insp) await this.db.db.update(structuralDamage).set({ nextInspectionFc: fc + insp }).where(eq(structuralDamage.id, id));
      await this.reassess(r.tail, t.type, fc);
      let [after] = await this.db.db.select().from(structuralDamage).where(eq(structuralDamage.id, id));
      if (grown && after.disposition === 'REFER' && after.approvedData) {
        // the approved repair data covered the smaller damage: engineering must approve data for the new size
        [after] = await this.db.db.update(structuralDamage).set({ approvedData: null, approvedBy: null, approvedAt: null, version: after.version + 1 }).where(eq(structuralDamage.id, id)).returning();
      }
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'damage.inspected', entityType: 'aircraft', entityId: r.tail,
        data: { id, before: { l: r.lengthMm, w: r.widthMm, d: r.depthMm }, after: { l: b.lengthMm, w: b.widthMm, d: b.depthMm }, grown, disposition: after.disposition, note: b.note } });
      if (after.disposition !== 'ALLOWABLE' && r.disposition === 'ALLOWABLE') {
        await this.notifications.raise(this.db, { operatorId: p.operatorId, actor: actorOf(p), severity: 'red', link: `/camo/health?tab=damage&tail=${encodeURIComponent(r.tail)}`,
          title: `${r.tail}: ${id} has grown beyond allowable limits`, body: `${after.reason}. Not to fly until repaired.` });
      }
      return r.tail;
    });
    await this.programme.sweepAirworthiness(p.operatorId, tail);
    return this.chart(p, tail);
  }

  /** Engineering disposition for damage beyond the SRM: the approved repair data (TC holder / DOA reference). */
  async approveData(p: Principal, id: string, b: { approvedData: string; version: number }) {
    await this.authz.check(p, this.damageRes(p.operatorId, id), 'approve_data');
    await this.masterData.assertEffective(p.operatorId, ['camo.srm_limits']);
    const tail = await this.db.transaction(async () => {
      const r = await this.damageRow(p, id);
      if (r.version !== b.version) throw new DomainError('CONCURRENT_UPDATE', `${id} changed meanwhile — reload`, 409);
      if (r.disposition !== 'REFER') throw new DomainError('NOT_REFER', `${id} is within the SRM: repair it per ${r.srmRef ?? 'the SRM'}`, 422);
      if (r.repairKind === 'PERMANENT') throw new DomainError('REPAIRED', `${id} is permanently repaired`, 409);
      await this.db.db.update(structuralDamage).set({ approvedData: b.approvedData.trim(), approvedBy: actorOf(p), approvedAt: new Date(), version: r.version + 1 }).where(eq(structuralDamage.id, id));
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'damage.repair_data_approved', entityType: 'aircraft', entityId: r.tail, data: { id, approvedData: b.approvedData } });
      return r.tail;
    });
    return this.chart(p, tail);
  }

  async repair(p: Principal, id: string, b: { kind: 'PERMANENT' | 'TEMPORARY'; dataRef: string; untilFc?: number | null; untilDate?: string | null; version: number }) {
    await this.authz.check(p, this.damageRes(p.operatorId, id), 'repair');
    await this.masterData.assertEffective(p.operatorId, ['camo.srm_limits']);
    const tail = await this.db.transaction(async () => {
      const r = await this.damageRow(p, id);
      if (r.version !== b.version) throw new DomainError('CONCURRENT_UPDATE', `${id} changed meanwhile — reload`, 409);
      const t = await this.tailOf(p, r.tail);
      const fc = await this.fcOf(p.operatorId, r.tail);
      const untilDate = b.untilDate ? new Date(`${b.untilDate}T23:59:59Z`) : null;
      checkRepair(toState(r), { kind: b.kind, dataRef: b.dataRef, untilFc: b.untilFc ?? null, untilDate }, fc, new Date());
      if (r.approvedBy && r.approvedBy === actorOf(p)) throw new DomainError('FOUR_EYES', 'The repair must be done by someone other than the engineer who approved the repair data', 422);
      if (r.disposition === 'ALLOWABLE' && b.kind === 'TEMPORARY') throw new DomainError('NOT_NEEDED', `${id} is allowable: a temporary repair is not needed`, 422);
      await this.db.db.update(structuralDamage).set({
        repairKind: b.kind, repairData: b.dataRef.trim(), repairUntilFc: b.kind === 'TEMPORARY' ? b.untilFc ?? null : null, repairUntilDate: b.kind === 'TEMPORARY' ? b.untilDate ?? null : null,
        repairedBy: actorOf(p), repairedAt: new Date(), nextInspectionFc: b.kind === 'PERMANENT' ? null : r.nextInspectionFc, version: r.version + 1
      }).where(eq(structuralDamage.id, id));
      await this.reassess(r.tail, t.type, fc);
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'damage.repaired', entityType: 'aircraft', entityId: r.tail,
        data: { id, kind: b.kind, dataRef: b.dataRef, untilFc: b.untilFc ?? null, untilDate: b.untilDate ?? null, fc } });
      return r.tail;
    });
    await this.programme.sweepAirworthiness(p.operatorId, tail);
    return this.chart(p, tail);
  }
}

const num = (min: number, max: number) => z.number().min(min).max(max);
const snapshotSchema = z.object({ at: z.string().datetime({ offset: true }).optional(), fh: num(0, 500000), egtDev: num(-100, 100), n2Dev: num(-10, 10), ffDevPct: num(-30, 30), vib: num(0, 20), egtMargin: num(-50, 200) });
const oilSchema = z.object({ quarts: num(0.1, 20), station: z.string().trim().toUpperCase().regex(/^[A-Z]{4}$/).optional() });
const closeSchema = z.object({ note: z.string().trim().min(5).max(2000) });
const dims = { lengthMm: num(0.1, 5000), widthMm: num(0, 5000), depthMm: num(0, 500) };
const damageSchema = z.object({
  tail: z.string().min(2).max(10), zone: z.string().regex(/^\d{3}$/), side: z.enum(['L', 'R', 'C']),
  damageType: z.enum(['DENT', 'SCRATCH', 'GOUGE', 'CORROSION', 'CRACK', 'LIGHTNING', 'DELAMINATION']),
  xMm: num(-100000, 100000), yMm: num(-100000, 100000), ...dims, description: z.string().trim().min(5).max(2000)
});
const ver = z.number().int().min(1);
const inspectSchema = z.object({ ...dims, note: z.string().trim().min(3).max(1000), version: ver });
const approveSchema = z.object({ approvedData: z.string().trim().min(5).max(300), version: ver });
const repairSchema = z.object({
  kind: z.enum(['PERMANENT', 'TEMPORARY']), dataRef: z.string().trim().min(5).max(300),
  untilFc: z.number().int().min(1).nullable().optional(), untilDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), version: ver
});

@Controller('camo/health')
export class HealthController {
  constructor(private readonly h: HealthService) {}
  @Get('engines') engines(@CurrentPrincipal() p: Principal) { return this.h.fleetEngines(p); }
  @Get('engines/:serial') engine(@CurrentPrincipal() p: Principal, @Param('serial') serial: string) { return this.h.engineDetail(p, serial); }
  @Post('engines/:serial/snapshots') snapshot(@CurrentPrincipal() p: Principal, @Param('serial') serial: string, @Body(new ZodPipe(snapshotSchema)) b: z.infer<typeof snapshotSchema>) { return this.h.recordSnapshot(p, serial, b); }
  @Post('engines/:serial/oil') oil(@CurrentPrincipal() p: Principal, @Param('serial') serial: string, @Body(new ZodPipe(oilSchema)) b: z.infer<typeof oilSchema>) { return this.h.recordOil(p, serial, b); }
  @Post('alerts/:id/close') close(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(closeSchema)) b: z.infer<typeof closeSchema>) { return this.h.closeAlert(p, Number(id) || 0, b.note); }
  @Get('damage') chart(@CurrentPrincipal() p: Principal, @Query('tail') tail?: string) { return this.h.chart(p, tail); }
  @Post('damage') record(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(damageSchema)) b: z.infer<typeof damageSchema>) { return this.h.recordDamage(p, b); }
  @Post('damage/:id/inspect') inspect(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(inspectSchema)) b: z.infer<typeof inspectSchema>) { return this.h.inspect(p, id, b); }
  @Post('damage/:id/approve-data') approve(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(approveSchema)) b: z.infer<typeof approveSchema>) { return this.h.approveData(p, id, b); }
  @Post('damage/:id/repair') repair(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(repairSchema)) b: z.infer<typeof repairSchema>) { return this.h.repair(p, id, b); }
}

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, gte, inArray, sql } from 'drizzle-orm';
import type { AircraftStatusDto, DueItemDto, EventEnvelope, ReliabilityDto, WorkPackageDto } from '@aeroos/contracts';
import { DAY_MS, DomainError } from '@aeroos/kernel';
import {
  createWorkPackage, defectRates, dueItem, freezeWorkPackage, llpNewPoint, parseWpSource, planWorkPackage, recordItemCompliance, releaseWorkPackage, setWorkPackagePlanning,
  utilisation, type Counters, type Requirement, type RequirementKind, type Utilisation, type WorkPackage
} from '@aeroos/mro-domain';
import { actorOf, type Principal } from '../../platform/auth/principal';
import { AuditQuery, AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { InboxService, OutboxService } from '../../platform/events/outbox';
import { NotificationsService } from '../../platform/notifications/notifications.service';
import { FleetQuery } from './camo.repository';
import { structuralGrounding } from './health.tables';
import { melItems } from './camo.tables';
import { aircraftCounters, airworthiness, alertLevels, components, compliance, hangarBays, requirements, requirementStart, utilisationLog, workPackages } from './programme.tables';
import { MasterDataService } from '../compliance/master-data.service';

const CHAIN = 'camo';
const OPEN_WP = ['DRAFT', 'PLANNED', 'RELEASED'];
const dueLink = (tail: string) => `/camo/programme?tail=${encodeURIComponent(tail)}`;

export interface TailState { reg: string; type: string; msn: string; counters: Counters; delivery: Date; util: Utilisation }

const toReq = (r: typeof requirements.$inferSelect): Requirement => ({
  id: r.id, kind: r.kind as RequirementKind, ref: r.ref, title: r.title, ata: r.ata, types: r.types, interval: r.interval, repetitive: r.repetitive,
  steps: r.steps, estimatedHours: r.estimatedHours, tools: r.tools, parts: r.parts
});

const wpToDomain = (r: typeof workPackages.$inferSelect): WorkPackage & { createdBy: string; createdAt: Date } => ({
  id: r.id, operatorId: r.operatorId, tail: r.tail, aircraftType: r.aircraftType, title: r.title, station: r.station, bay: r.bay,
  plannedStart: r.plannedStart, plannedEnd: r.plannedEnd, status: r.status as WorkPackage['status'], version: r.version,
  items: r.items.map(i => ({ ...i, complied: i.complied ? { at: new Date(i.complied.at), crsNumber: i.complied.crsNumber } : null })),
  checkType: r.checkType as WorkPackage['checkType'], priority: r.priority as WorkPackage['priority'], resourcePlan: r.resourcePlan, dependencies: r.dependencies,
  frozenAt: r.frozenAt, frozenBy: r.frozenBy, createdBy: r.createdBy, createdAt: r.createdAt
});

const wpDto = (w: ReturnType<typeof wpToDomain>): WorkPackageDto => ({
  id: w.id, tail: w.tail, aircraftType: w.aircraftType, title: w.title, station: w.station, bay: w.bay,
  plannedStart: w.plannedStart?.toISOString() ?? null, plannedEnd: w.plannedEnd?.toISOString() ?? null, status: w.status,
  checkType: w.checkType, priority: w.priority, resourcePlan: w.resourcePlan, dependencies: w.dependencies, frozenAt: w.frozenAt?.toISOString() ?? null, frozenBy: w.frozenBy,
  items: w.items.map(i => ({ ...i, complied: i.complied ? { at: i.complied.at.toISOString(), crsNumber: i.complied.crsNumber } : null })),
  createdBy: w.createdBy, createdAt: w.createdAt.toISOString()
});

/**
 * Continuing airworthiness depth: maintenance programme due list (tasks, ADs, life-limited parts),
 * counters fed by Flight Ops (`ops.flight.arrived`), compliance from AMO CRSs, work packages to AMO,
 * reliability, and the airworthiness state other modules react to (`camo.airworthiness.changed`).
 */
@Injectable()
export class ProgrammeService {
  constructor(
    private readonly masterData: MasterDataService,
    @Inject(DB_TOKEN.camo) private readonly db: ModuleDb,
    private readonly fleet: FleetQuery,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly auditQuery: AuditQuery,
    private readonly outbox: OutboxService,
    private readonly inbox: InboxService,
    private readonly notifications: NotificationsService
  ) {}

  private resource(kind: 'maintenance_programme' | 'work_package', operatorId: string, id = '*') {
    return { kind, id, attr: { operatorId } };
  }

  /* ------------------------------------------------------------------ counters */

  /**
   * Aircraft counters at an instant: baseline + flights arrived by then. Before the baseline (records that
   * predate this system) the counters are back-estimated from recent utilisation and marked `estimated`
   * — they err early, so anything counted from them falls due no later than it really would.
   */
  async countersAt(tail: string, at: Date): Promise<(Counters & { estimated: boolean }) | null> {
    const [b] = await this.db.db.select().from(aircraftCounters).where(eq(aircraftCounters.reg, tail));
    if (!b) return null;
    if (at.getTime() < b.baseAt.getTime()) {
      const days = (b.baseAt.getTime() - at.getTime()) / DAY_MS;
      const recent = await this.db.db.select().from(utilisationLog).where(and(eq(utilisationLog.tail, tail), gte(utilisationLog.arrivedAt, new Date(Date.now() - 30 * DAY_MS))));
      const u = utilisation(recent.map(x => ({ arrivedAt: x.arrivedAt, blockMinutes: x.blockMinutes })), new Date(), 30);
      // Higher assumed utilisation = lower start counters = earlier due: the safe side.
      const fhPerDay = Math.max(u.fhPerDay, 12), fcPerDay = Math.max(u.fcPerDay, 8);
      return { at, fh: Math.max(0, Math.round((b.baseFh - days * fhPerDay) * 10) / 10), fc: Math.max(0, Math.round(b.baseFc - days * fcPerDay)), estimated: true };
    }
    const r = await this.db.db.execute<{ minutes: string; cycles: string }>(sql`
      select coalesce(sum(block_minutes), 0)::text as minutes, count(*)::text as cycles from camo.utilisation
      where tail = ${tail} and arrived_at > ${b.baseAt} and arrived_at <= ${at}`);
    const row = r.rows[0];
    return { at, fh: Math.round((b.baseFh + Number(row.minutes) / 60) * 10) / 10, fc: b.baseFc + Number(row.cycles), estimated: false };
  }

  async tailStates(operatorId: string, now = new Date()): Promise<Map<string, TailState>> {
    const [fleet, base, sums, recent] = await Promise.all([
      this.fleet.list(operatorId),
      this.db.db.select().from(aircraftCounters),
      this.db.db.execute<{ tail: string; minutes: string; cycles: string }>(sql`
        select u.tail, coalesce(sum(u.block_minutes), 0)::text as minutes, count(*)::text as cycles
        from camo.utilisation u join camo.aircraft_counters c on c.reg = u.tail
        where u.arrived_at > c.base_at group by u.tail`),
      this.db.db.select().from(utilisationLog).where(gte(utilisationLog.arrivedAt, new Date(now.getTime() - 30 * DAY_MS)))
    ]);
    const baseBy = new Map<string, typeof aircraftCounters.$inferSelect>(base.map(b => [b.reg, b]));
    const sumBy = new Map<string, { fh: number; fc: number }>(sums.rows.map(r => [r.tail, { fh: Number(r.minutes) / 60, fc: Number(r.cycles) }]));
    const out = new Map<string, TailState>();
    for (const t of fleet) {
      const b = baseBy.get(t.reg);
      if (!b) continue;
      const add = sumBy.get(t.reg) ?? { fh: 0, fc: 0 };
      const util = utilisation(recent.filter(u => u.tail === t.reg).map(u => ({ arrivedAt: u.arrivedAt, blockMinutes: u.blockMinutes })), now, 30);
      out.set(t.reg, {
        reg: t.reg, type: t.type, msn: t.msn, delivery: new Date(`${b.deliveryDate}T00:00:00Z`),
        counters: { at: now, fh: Math.round((b.baseFh + add.fh) * 10) / 10, fc: b.baseFc + add.fc },
        // Until 30 days of utilisation exist, assume a typical day so forecasts are meaningful.
        util: util.fhPerDay > 0 ? util : { fhPerDay: 8, fcPerDay: 5 }
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------ due list */

  async evaluate(operatorId: string, onlyTail?: string): Promise<{ items: DueItemDto[]; tails: Map<string, TailState> }> {
    const now = new Date();
    const [tails, reqRows, comp, comps, wps, starts] = await Promise.all([
      this.tailStates(operatorId, now),
      this.db.db.select().from(requirements).where(and(eq(requirements.operatorId, operatorId), eq(requirements.active, true))),
      this.db.db.select().from(compliance).orderBy(desc(compliance.doneAt)),
      this.db.db.select().from(components).where(sql`${components.removedAt} is null`),
      this.db.db.select().from(workPackages).where(and(eq(workPackages.operatorId, operatorId), inArray(workPackages.status, OPEN_WP))),
      this.db.db.select().from(requirementStart)
    ]);
    const reqs = reqRows.map(toReq);
    // AD/SB applicability per aircraft, and where an incorporated directive starts counting.
    const onlyTails = new Map<string, Set<string>>(reqRows.filter(r => r.tails).map(r => [r.id, new Set<string>(r.tails!)]));
    const startOf = new Map<string, Counters>(starts.map(x => [`${x.requirementId}|${x.tail}`, { at: x.at, fh: x.fh, fc: x.fc }]));
    const last = new Map<string, typeof compliance.$inferSelect>();
    for (const c of comp) if (!last.has(`${c.requirementId}|${c.tail}`)) last.set(`${c.requirementId}|${c.tail}`, c);
    const inWp = new Map<string, string>();
    for (const w of wps) for (const i of w.items) if (!i.complied) inWp.set(`${i.requirementId}|${w.tail}`, w.id);

    const items: DueItemDto[] = [];
    for (const t of tails.values()) {
      if (onlyTail && t.reg !== onlyTail) continue;
      for (const r of reqs.filter(x => x.types.includes(t.type) && (!onlyTails.has(x.id) || onlyTails.get(x.id)!.has(t.reg)))) {
        if (r.kind === 'LLP') {
          for (const c of comps.filter(x => x.tail === t.reg && x.requirementId === r.id)) {
            const newPoint = llpNewPoint({ at: c.installedAt, fh: c.aircraftFhAtInstall, fc: c.aircraftFcAtInstall }, c.partTsnAtInstall, c.partCsnAtInstall);
            const d = dueItem(r, t.counters, newPoint, t.delivery, t.util, { dueSoonDays: 30 });
            items.push({
              ...d, tail: t.reg, ata: r.ata, interval: r.interval, next: { ...d.next, date: d.next.date?.toISOString() ?? null }, forecast: d.forecast?.toISOString() ?? null,
              lastDone: { at: c.installedAt.toISOString(), fh: c.aircraftFhAtInstall, fc: c.aircraftFcAtInstall, reference: `Installed ${c.partNo} s/n ${c.serial} (CSN ${c.partCsnAtInstall})` },
              wpId: inWp.get(`${r.id}|${t.reg}`) ?? null, component: { partNo: c.partNo, serial: c.serial, position: c.position }
            });
          }
          continue;
        }
        const l = last.get(`${r.id}|${t.reg}`) ?? null;
        const d = dueItem(r, t.counters, l ? { at: l.doneAt, fh: l.fh, fc: l.fc } : startOf.get(`${r.id}|${t.reg}`) ?? null, t.delivery, t.util, { dueSoonDays: 14, complied: !!l });
        items.push({
          ...d, tail: t.reg, ata: r.ata, interval: r.interval, next: { ...d.next, date: d.next.date?.toISOString() ?? null }, forecast: d.forecast?.toISOString() ?? null,
          lastDone: l ? { at: l.doneAt.toISOString(), fh: l.fh, fc: l.fc, reference: l.reference } : null,
          wpId: inWp.get(`${r.id}|${t.reg}`) ?? null, component: null
        });
      }
    }
    const rank: Record<string, number> = { OVERDUE: 0, IN_TOLERANCE: 1, DUE_SOON: 2, OK: 3, COMPLIED: 4 };
    items.sort((a, b) => rank[a.status] - rank[b.status] || (a.forecast ?? '9').localeCompare(b.forecast ?? '9'));
    return { items, tails };
  }

  async dueList(p: Principal, tail?: string): Promise<DueItemDto[]> {
    await this.authz.check(p, this.resource('maintenance_programme', p.operatorId), 'read');
    return (await this.evaluate(p.operatorId, tail)).items;
  }

  async fleetStatus(p: Principal): Promise<AircraftStatusDto[]> {
    await this.authz.check(p, this.resource('maintenance_programme', p.operatorId), 'read');
    const { items, tails } = await this.evaluate(p.operatorId);
    const fleet = await this.fleet.list(p.operatorId);
    const structural = await structuralGrounding(this.db, [...tails.values()].map(t => ({ reg: t.reg, type: t.type, fc: t.counters.fc })), new Date());
    return [...tails.values()].map(t => {
      const mine = items.filter(i => i.tail === t.reg);
      const reasons = [...this.groundingReasons(mine), ...(structural.get(t.reg) ?? [])];
      if (fleet.find(f => f.reg === t.reg)?.status === 'AOG') reasons.unshift('AOG');
      return {
        reg: t.reg, type: t.type, msn: t.msn, counters: { fh: t.counters.fh, fc: t.counters.fc, at: t.counters.at.toISOString() }, utilisation: t.util,
        airworthy: reasons.length === 0, reasons,
        due: { overdue: mine.filter(i => i.status === 'OVERDUE').length, inTolerance: mine.filter(i => i.status === 'IN_TOLERANCE').length, dueSoon: mine.filter(i => i.status === 'DUE_SOON').length }
      };
    });
  }

  private groundingReasons(items: DueItemDto[]): string[] {
    return items.filter(i => i.status === 'OVERDUE')
      .map(i => `${i.kind === 'AD' ? 'AD' : i.kind === 'LLP' ? 'Life limit' : 'Task'} ${i.ref} overdue`);
  }

  async reliability(p: Principal, windowDays = 90): Promise<ReliabilityDto> {
    await this.authz.check(p, this.resource('maintenance_programme', p.operatorId), 'read');
    const now = new Date();
    const from = new Date(now.getTime() - windowDays * DAY_MS);
    const [defects, levels, tails] = await Promise.all([
      this.db.db.select({ ata: melItems.ata, at: melItems.raisedAt }).from(melItems).where(and(eq(melItems.operatorId, p.operatorId), gte(melItems.raisedAt, from))),
      this.db.db.select().from(alertLevels).where(eq(alertLevels.operatorId, p.operatorId)),
      this.tailStates(p.operatorId, now)
    ]);
    // Flying hours of this operator's fleet only.
    const regs = [...tails.keys()];
    const util = regs.length
      ? await this.db.db.select({ minutes: sql<string>`coalesce(sum(${utilisationLog.blockMinutes}), 0)::text` }).from(utilisationLog)
        .where(and(gt(utilisationLog.arrivedAt, from), inArray(utilisationLog.tail, regs)))
      : [];
    // Until the window is covered by recorded utilisation, extrapolate from average utilisation.
    const recorded = Number(util[0]?.minutes ?? 0) / 60;
    const estimated = [...tails.values()].reduce((n, t) => n + t.util.fhPerDay * windowDays, 0);
    const fleetFh = Math.round(Math.max(recorded, estimated));
    const rates = defectRates(defects, fleetFh, now, windowDays, Object.fromEntries(levels.map(l => [l.ata, l.alertLevel])));
    return { windowDays, fleetFh, rates };
  }

  /* ------------------------------------------------------------------ airworthiness */

  /** Publish a change of airworthiness (overdue AD / task / life limit) once. Called after utilisation, compliance and hourly. */
  async sweepAirworthiness(operatorId: string, onlyTail?: string): Promise<{ changed: string[] }> {
    const { items, tails } = await this.evaluate(operatorId, onlyTail);
    const changed: string[] = [];
    // structural damage beyond limits and not repaired (or a lapsed temporary repair / repeat inspection) grounds too
    const structural = await structuralGrounding(this.db,
      [...tails.values()].filter(t => !onlyTail || t.reg === onlyTail).map(t => ({ reg: t.reg, type: t.type, fc: t.counters.fc })), new Date());
    for (const t of tails.values()) {
      if (onlyTail && t.reg !== onlyTail) continue;
      const reasons = [...this.groundingReasons(items.filter(i => i.tail === t.reg)), ...(structural.get(t.reg) ?? [])];
      const airworthy = reasons.length === 0;
      await this.db.transaction(async () => {
        const [prev] = await this.db.db.select().from(airworthiness).where(eq(airworthiness.reg, t.reg)).for('update');
        if (prev && prev.airworthy === airworthy && JSON.stringify(prev.reasons) === JSON.stringify(reasons)) return;
        if (!prev && airworthy) {
          await this.db.db.insert(airworthiness).values({ reg: t.reg, airworthy, reasons }).onConflictDoNothing();
          return; // first evaluation of a serviceable aircraft: nothing to announce
        }
        await this.db.db.insert(airworthiness).values({ reg: t.reg, airworthy, reasons, updatedAt: new Date() })
          .onConflictDoUpdate({ target: airworthiness.reg, set: { airworthy, reasons, updatedAt: new Date() } });
        await this.audit.record(this.db, CHAIN, { operatorId: operatorId,
          actor: 'system:camo', action: airworthy ? 'airworthiness.restored' : 'airworthiness.lost', entityType: 'aircraft', entityId: t.reg,
          data: { reasons, counters: { fh: t.counters.fh, fc: t.counters.fc } }
        });
        await this.outbox.add(this.db, { type: 'camo.airworthiness.changed', data: { tail: t.reg, airworthy, reasons } }, { operatorId, actor: 'system:camo' });
        await this.notifications.raise(this.db, {
          operatorId, actor: 'system:camo', severity: airworthy ? 'green' : 'red', link: dueLink(t.reg),
          title: airworthy ? `${t.reg} airworthy again` : `${t.reg} NOT AIRWORTHY`, body: airworthy ? 'All grounding items cleared.' : reasons.join('; ')
        });
        changed.push(t.reg);
      });
    }
    return { changed };
  }

  async sweepAll(): Promise<{ changed: string[] }> {
    const ops = await this.db.db.execute<{ operator_id: string }>(sql`select distinct operator_id from camo.fleet`);
    const changed: string[] = [];
    for (const o of ops.rows) changed.push(...(await this.sweepAirworthiness(o.operator_id)).changed);
    return { changed };
  }

  /** ops.flight.arrived → utilisation; then re-check that aircraft (cycle- or hour-limited items may fall due). */
  async onFlightArrived(env: EventEnvelope<'ops.flight.arrived'>) {
    const first = await this.inbox.once(this.db, 'camo.utilisation', env, async () => {
      // Flight hours = airborne time when the movement message reports it, else block time.
      await this.db.db.insert(utilisationLog).values({ flightId: env.data.flightId, tail: env.data.tail, arrivedAt: new Date(env.data.arrivedAt), blockMinutes: env.data.flightMinutes ?? env.data.blockMinutes })
        .onConflictDoNothing();
    });
    if (first) await this.sweepAirworthiness(env.operatorId, env.data.tail);
  }

  /* ------------------------------------------------------------------ work packages */

  /** Requirements of this operator's programme only: an id from another operator counts as unknown. */
  private async requirementsById(ids: string[], operatorId: string): Promise<Requirement[]> {
    if (!ids.length) return [];
    return (await this.db.db.select().from(requirements).where(and(inArray(requirements.id, ids), eq(requirements.operatorId, operatorId)))).map(toReq);
  }

  private async wp(id: string, opts: { lock?: boolean } = {}) {
    const q = this.db.db.select().from(workPackages).where(eq(workPackages.id, id)).limit(1);
    const [r] = opts.lock ? await q.for('update') : await q;
    if (!r) throw new DomainError('WP_NOT_FOUND', `Work package ${id} not found`, 404);
    return wpToDomain(r);
  }

  private async saveWp(w: WorkPackage, expectedVersion: number) {
    const r = await this.db.db.update(workPackages).set({
      bay: w.bay, plannedStart: w.plannedStart, plannedEnd: w.plannedEnd, status: w.status, version: w.version,
      checkType: w.checkType, priority: w.priority, resourcePlan: w.resourcePlan, dependencies: w.dependencies, frozenAt: w.frozenAt, frozenBy: w.frozenBy,
      items: w.items.map(i => ({ ...i, complied: i.complied ? { at: i.complied.at.toISOString(), crsNumber: i.complied.crsNumber } : null }))
    }).where(and(eq(workPackages.id, w.id), eq(workPackages.version, expectedVersion))).returning({ id: workPackages.id });
    if (!r.length) throw new DomainError('CONCURRENT_UPDATE', `${w.id} was changed by someone else. Reload and try again.`, 409);
  }

  async listWps(p: Principal): Promise<WorkPackageDto[]> {
    await this.authz.check(p, this.resource('work_package', p.operatorId), 'read');
    const rows = await this.db.db.select().from(workPackages).where(eq(workPackages.operatorId, p.operatorId)).orderBy(desc(workPackages.createdAt)).limit(100);
    return rows.map(r => wpDto(wpToDomain(r)));
  }

  async getWp(p: Principal, id: string) {
    const w = await this.wp(id);
    const allowed = await this.authz.decide(p, this.resource('work_package', w.operatorId, id), ['read', 'manage']);
    if (!allowed.read) throw new DomainError('WP_NOT_FOUND', `Work package ${id} not found`, 404);
    return { wp: wpDto(w), permissions: { manage: allowed.manage }, audit: await this.auditQuery.forEntity(p.operatorId, 'work_package', id) };
  }

  async createWp(p: Principal, body: { tail: string; requirementIds: string[]; title: string; station: string; checkType: WorkPackage['checkType']; priority: WorkPackage['priority'] }): Promise<WorkPackageDto> {
    await this.authz.check(p, this.resource('work_package', p.operatorId), 'manage');
    const tail = await this.fleet.get(body.tail);
    if (!tail || tail.operatorId !== p.operatorId) throw new DomainError('TAIL_UNKNOWN', `${body.tail} is not in the fleet`, 404);
    const reqs = await this.requirementsById(body.requirementIds, p.operatorId);
    if (reqs.length !== new Set(body.requirementIds).size) throw new DomainError('REQUIREMENT_UNKNOWN', 'One or more requirements do not exist');
    const open = await this.db.db.select().from(workPackages).where(and(eq(workPackages.tail, body.tail), inArray(workPackages.status, OPEN_WP)));
    const taken = reqs.filter(r => open.some(w => w.items.some(i => i.requirementId === r.id && !i.complied)));
    if (taken.length) throw new DomainError('ALREADY_PLANNED', `${taken.map(r => r.ref).join(', ')} already in an open work package for ${body.tail}`, 409);
    const actor = actorOf(p);
    return this.db.transaction(async () => {
      const r = await this.db.db.execute<{ n: string }>(sql.raw(`select nextval('camo.wp_seq')::text as n`));
      const w = createWorkPackage({ id: `WP-${r.rows[0].n}`, operatorId: p.operatorId, tail: tail.reg, aircraftType: tail.type, title: body.title, station: body.station, requirements: reqs, checkType: body.checkType, priority: body.priority });
      await this.db.db.insert(workPackages).values({
        id: w.id, operatorId: w.operatorId, tail: w.tail, aircraftType: w.aircraftType, title: w.title, station: w.station, status: w.status,
        items: w.items.map(i => ({ ...i, complied: null })), createdBy: actor, checkType: w.checkType, priority: w.priority, resourcePlan: w.resourcePlan, dependencies: w.dependencies, frozenAt: null, frozenBy: null, version: w.version
      });
      await this.audit.record(this.db, CHAIN, { operatorId: w.operatorId, actor, action: 'wp.created', entityType: 'work_package', entityId: w.id, data: { tail: w.tail, items: w.items.map(i => i.ref) } });
      return wpDto({ ...w, createdBy: actor, createdAt: new Date() });
    });
  }

  async planWp(p: Principal, id: string, body: { bay: string; start: string; end: string }): Promise<WorkPackageDto> {
    const w0 = await this.wp(id);
    await this.authz.check(p, this.resource('work_package', w0.operatorId, id), 'manage');
    const actor = actorOf(p);
    return this.db.transaction(async () => {
      const w = await this.wp(id, { lock: true });
      const [bay] = await this.db.db.select().from(hangarBays).where(and(eq(hangarBays.operatorId, w.operatorId), eq(hangarBays.station, w.station), eq(hangarBays.code, body.bay), eq(hangarBays.active, true))).limit(1);
      if (!bay) throw new DomainError('BAY_UNKNOWN', `${body.bay} is not an active configured bay at ${w.station}`, 404);
      const others = (await this.db.db.select().from(workPackages)
        .where(and(eq(workPackages.operatorId, w.operatorId), eq(workPackages.bay, body.bay), inArray(workPackages.status, OPEN_WP)))).map(wpToDomain);
      const r = planWorkPackage(w, { bay: body.bay, start: new Date(body.start), end: new Date(body.end) }, others);
      await this.saveWp(r.wp, w.version);
      await this.audit.record(this.db, CHAIN, { operatorId: w.operatorId, actor, action: 'wp.planned', entityType: 'work_package', entityId: id, data: { bay: body.bay, start: body.start, end: body.end } });
      await this.outbox.add(this.db, r.event, { operatorId: w.operatorId, actor });
      return wpDto({ ...r.wp, createdBy: w.createdBy, createdAt: w.createdAt });
    });
  }

  async listBays(p: Principal, station?: string) {
    await this.authz.check(p, this.resource('work_package', p.operatorId), 'read');
    const rows = await this.db.db.select().from(hangarBays).where(station ? and(eq(hangarBays.operatorId, p.operatorId), eq(hangarBays.station, station)) : eq(hangarBays.operatorId, p.operatorId)).orderBy(hangarBays.station, hangarBays.code);
    return rows.map(x => ({ id: x.id, station: x.station, code: x.code, name: x.name, active: x.active }));
  }

  async createBay(p: Principal, body: { station: string; code: string; name: string }) {
    await this.authz.check(p, this.resource('work_package', p.operatorId), 'manage'); const actor = actorOf(p);
    return this.db.transaction(async () => {
      const id = `${body.station}-${body.code}`.toUpperCase();
      const [row] = await this.db.db.insert(hangarBays).values({ id, operatorId: p.operatorId, station: body.station.toUpperCase(), code: body.code.toUpperCase(), name: body.name.trim(), active: true }).returning();
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor, action: 'hangar_bay.created', entityType: 'hangar_bay', entityId: id, data: { station: row.station, code: row.code, name: row.name } });
      return { id: row.id, station: row.station, code: row.code, name: row.name, active: row.active };
    });
  }

  async setBayActive(p: Principal, id: string, active: boolean) {
    await this.authz.check(p, this.resource('work_package', p.operatorId), 'manage'); const actor = actorOf(p);
    return this.db.transaction(async () => {
      const [row] = await this.db.db.update(hangarBays).set({ active }).where(and(eq(hangarBays.id, id), eq(hangarBays.operatorId, p.operatorId))).returning();
      if (!row) throw new DomainError('HANGAR_BAY_NOT_FOUND', `Hangar bay ${id} not found`, 404);
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor, action: active ? 'hangar_bay.activated' : 'hangar_bay.deactivated', entityType: 'hangar_bay', entityId: id, data: { station: row.station, code: row.code } });
      return { id: row.id, station: row.station, code: row.code, name: row.name, active: row.active };
    });
  }

  async setWpPlanning(p: Principal, id: string, body: { resources: WorkPackage['resourcePlan']; dependencies: WorkPackage['dependencies'] }): Promise<WorkPackageDto> {
    const w0 = await this.wp(id); await this.authz.check(p, this.resource('work_package', w0.operatorId, id), 'manage'); const actor = actorOf(p);
    return this.db.transaction(async () => {
      const w = await this.wp(id, { lock: true }); const next = setWorkPackagePlanning(w, body.resources, body.dependencies); await this.saveWp(next, w.version);
      await this.audit.record(this.db, CHAIN, { operatorId: w.operatorId, actor, action: 'wp.readiness_planned', entityType: 'work_package', entityId: id, data: { resources: next.resourcePlan, dependencies: next.dependencies } });
      return wpDto({ ...next, createdBy: w.createdBy, createdAt: w.createdAt });
    });
  }

  async freezeWp(p: Principal, id: string): Promise<WorkPackageDto> {
    const w0 = await this.wp(id); await this.authz.check(p, this.resource('work_package', w0.operatorId, id), 'manage'); const actor = actorOf(p);
    return this.db.transaction(async () => {
      const w = await this.wp(id, { lock: true }); const next = freezeWorkPackage(w, actor, new Date()); if (next === w) return wpDto(w);
      await this.saveWp(next, w.version); await this.audit.record(this.db, CHAIN, { operatorId: w.operatorId, actor, action: 'wp.scope_frozen', entityType: 'work_package', entityId: id, data: { resourcePlan: next.resourcePlan, dependencies: next.dependencies } });
      return wpDto({ ...next, createdBy: w.createdBy, createdAt: w.createdAt });
    });
  }

  async unfreezeWp(p: Principal, id: string, reason: string): Promise<WorkPackageDto> {
    const w0 = await this.wp(id); await this.authz.check(p, this.resource('work_package', w0.operatorId, id), 'manage'); const actor = actorOf(p);
    return this.db.transaction(async () => {
      const w = await this.wp(id, { lock: true }); if (w.status !== 'PLANNED') throw new DomainError('WP_NOT_EDITABLE', 'Only a planned, unreleased package can be unfrozen', 409);
      if (!w.frozenAt) throw new DomainError('WP_NOT_FROZEN', `${w.id} is not scope-frozen`, 409);
      const next = { ...w, frozenAt: null, frozenBy: null, version: w.version + 1 }; await this.saveWp(next, w.version);
      await this.audit.record(this.db, CHAIN, { operatorId: w.operatorId, actor, action: 'wp.scope_unfrozen', entityType: 'work_package', entityId: id, data: { reason } });
      return wpDto({ ...next, createdBy: w.createdBy, createdAt: w.createdAt });
    });
  }

  async releaseWp(p: Principal, id: string): Promise<WorkPackageDto> {
    await this.masterData.assertEffective(p.operatorId, ['camo.maintenance_programme']);
    const w0 = await this.wp(id);
    await this.authz.check(p, this.resource('work_package', w0.operatorId, id), 'manage');
    const actor = actorOf(p);
    const reqs = await this.requirementsById(w0.items.map(i => i.requirementId), w0.operatorId);
    return this.db.transaction(async () => {
      const w = await this.wp(id, { lock: true });
      const r = releaseWorkPackage(w, reqs);
      await this.saveWp(r.wp, w.version);
      await this.audit.record(this.db, CHAIN, { operatorId: w.operatorId, actor, action: 'wp.released', entityType: 'work_package', entityId: id, data: { items: w.items.map(i => i.ref), bay: w.bay } });
      await this.outbox.add(this.db, r.event, { operatorId: w.operatorId, actor });
      await this.outbox.add(this.db, { type: 'camo.wp.planned', data: { wpId: w.id, tail: w.tail, station: w.station, bay: w.bay ?? '', plannedStart: w.plannedStart!.toISOString(), plannedEnd: w.plannedEnd!.toISOString(), status: 'RELEASED' } },
        { operatorId: w.operatorId, actor });
      return wpDto({ ...r.wp, createdBy: w.createdBy, createdAt: w.createdAt });
    });
  }

  /** amo.crs.issued for a work-package item → compliance record at today's counters, package progress. */
  async onCrs(env: EventEnvelope<'amo.crs.issued'>) {
    if (env.data.sourceType !== 'WP') return;
    const src = parseWpSource(env.data.eoId);
    if (!src) return;
    let tail: string | null = null;
    await this.inbox.once(this.db, 'camo.wp-compliance', env, async () => {
      const w = await this.wp(src.wpId, { lock: true });
      const state = (await this.tailStates(w.operatorId)).get(w.tail);
      // Never mark the event processed without recording compliance: retry, then dead-letter.
      if (!state) throw new Error(`No aircraft counters for ${w.tail}; cannot record compliance for ${env.data.crsNumber}`);
      const at = new Date(env.occurredAt);
      const r = recordItemCompliance(w, src.requirementId, env.data.crsNumber, at);
      if (!r.changed) return;
      await this.saveWp(r.wp, w.version);
      const item = w.items.find(i => i.requirementId === src.requirementId)!;
      await this.db.db.insert(compliance).values({
        requirementId: src.requirementId, tail: w.tail, doneAt: at, fh: state.counters.fh, fc: state.counters.fc, reference: env.data.crsNumber, recordedBy: 'system:camo'
      }).onConflictDoNothing();
      await this.audit.record(this.db, CHAIN, { operatorId: w.operatorId,
        actor: 'system:camo', action: 'requirement.complied', entityType: 'work_package', entityId: w.id,
        data: { requirementId: src.requirementId, ref: item.ref, crsNumber: env.data.crsNumber, fh: state.counters.fh, fc: state.counters.fc, eventId: env.id }
      });
      await this.outbox.add(this.db, {
        type: 'camo.requirement.complied',
        data: { requirementId: src.requirementId, ref: item.ref, tail: w.tail, at: at.toISOString(), fh: state.counters.fh, fc: state.counters.fc, crsNumber: env.data.crsNumber }
      }, { operatorId: w.operatorId, actor: 'system:camo', correlationId: env.id });
      if (r.completed) {
        await this.outbox.add(this.db, r.completed, { operatorId: w.operatorId, actor: 'system:camo', correlationId: env.id });
        await this.notifications.raise(this.db, {
          operatorId: w.operatorId, actor: 'system:camo', severity: 'green', link: `/camo/programme?tail=${encodeURIComponent(w.tail)}`,
          title: `${w.id} completed — ${w.tail}`, body: `${w.items.length} item(s) certified; due list updated.`
        });
      }
      tail = w.tail;
    });
    if (tail) await this.sweepAirworthiness(env.operatorId, tail);
  }
}

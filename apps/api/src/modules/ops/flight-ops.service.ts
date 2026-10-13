import { Inject, Injectable } from '@nestjs/common';
import type { EventEnvelope, FlightChangeResultDto, FlightDetailDto, FlightDto, TailRowDto, TimelineDto, MelCategory } from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import { cancelFlight, changeTail, delayFlight, rotationIssues, type Flight, type FlightWithActuals } from '@aeroos/ops-domain';
import { CONFIG, type Config } from '../../config';
import { actorOf, type Principal } from '../../platform/auth/principal';
import { AuditQuery, AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { InboxService, OutboxService } from '../../platform/events/outbox';
import { NotificationsService } from '../../platform/notifications/notifications.service';
import { FleetQuery } from '../camo/camo.module';
import { CrewService, ftlStatus } from './crew.service';
import { flightToDto, OpsRepository, type MaintenanceSlot } from './ops.repository';

export const CHAIN = 'ops';
/** Operator minimum turnaround (single value in this release; per type/station later). */
export const MIN_TURN_MINUTES = 35;
const H = 3_600_000;
const DEPARTED_AFTER_MS = 10 * 60_000;
const link = (id: string) => `/ops/occ?flight=${encodeURIComponent(id)}`;
const hhmm = (d: Date) => d.toISOString().slice(11, 16);

export interface TailState { reg: string; type: string; dispatchable: boolean; reasons: string[]; mel: TailRowDto['mel'] }

/**
 * OCC flight operations. Same shape as every regulated flow: Cerbos for who may act, pure domain
 * functions for what happens, state + audit + outbox in one transaction. Airworthiness comes from
 * CAMO only through events (the tail_mel projection) and the exported FleetQuery.
 */
@Injectable()
export class FlightOpsService {
  constructor(
    @Inject(DB_TOKEN.ops) private readonly db: ModuleDb,
    private readonly repo: OpsRepository,
    private readonly fleet: FleetQuery,
    private readonly crew: CrewService,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly auditQuery: AuditQuery,
    private readonly outbox: OutboxService,
    private readonly inbox: InboxService,
    private readonly notifications: NotificationsService,
    @Inject(CONFIG) private readonly config: Config
  ) {}

  private resource(operatorId: string, id = '*') {
    return { kind: 'flight' as const, id, attr: { operatorId } };
  }

  /* ------------------------------------------------------------------ dispatch state */

  /** Dispatchability per tail: fleet status (CAMO) plus expired MEL items (projection). */
  async tails(operatorId: string, now = new Date()): Promise<Map<string, TailState>> {
    const [fleet, mel, airworthy] = await Promise.all([this.fleet.list(operatorId), this.repo.melByTail(), this.repo.airworthiness()]);
    const out = new Map<string, TailState>();
    for (const t of fleet) {
      const items = mel.get(t.reg) ?? [];
      const reasons: string[] = [];
      if (t.status === 'AOG') reasons.push('AOG (aircraft on ground)');
      const aw = airworthy.get(t.reg);
      if (aw && !aw.airworthy) reasons.push(...aw.reasons.map(r => `Not airworthy: ${r}`));
      for (const m of items) {
        if (m.expired || m.deadline.getTime() <= now.getTime()) reasons.push(`MEL ${m.melRef} (Cat ${m.category}) rectification interval expired`);
      }
      out.set(t.reg, {
        reg: t.reg, type: t.type, dispatchable: reasons.length === 0, reasons,
        mel: items.map(m => ({ id: m.melItemId, melRef: m.melRef, category: m.category as MelCategory, deadline: m.deadline.toISOString(), expired: m.expired || m.deadline.getTime() <= now.getTime() }))
      });
    }
    return out;
  }

  private warnings(flights: Flight[], tails: Map<string, TailState>, slots: MaintenanceSlot[] = []): Map<string, string[]> {
    const w = new Map<string, string[]>();
    const add = (id: string, m: string) => w.set(id, [...(w.get(id) ?? []), m]);
    const byTail = new Map<string, Flight[]>();
    for (const f of flights) byTail.set(f.tail, [...(byTail.get(f.tail) ?? []), f]);
    for (const [reg, list] of byTail) {
      for (const [id, issues] of rotationIssues(list, MIN_TURN_MINUTES)) issues.forEach(i => add(id, i));
      const t = tails.get(reg);
      for (const f of list) {
        if (f.status === 'CANCELLED' || f.status === 'ARRIVED' || f.status === 'DIVERTED') continue;
        if (t && !t.dispatchable) add(f.id, `${reg} not dispatchable: ${t.reasons.join('; ')}`);
        for (const m of slots.filter(x => x.tail === reg)) {
          if (m.plannedStart.getTime() < f.eta.getTime() && f.etd.getTime() < m.plannedEnd.getTime()) {
            add(f.id, `Planned maintenance ${m.wpId} at ${m.station}${m.bay ? ` (${m.bay})` : ''} ${m.plannedStart.toISOString().slice(11, 16)}–${m.plannedEnd.toISOString().slice(11, 16)}Z`);
          }
        }
        for (const m of t?.mel ?? []) {
          if (!m.expired && Date.parse(m.deadline) < f.eta.getTime()) add(f.id, `MEL ${m.melRef} (Cat ${m.category}) due ${m.deadline.slice(0, 16).replace('T', ' ')}Z — before this flight arrives`);
        }
      }
    }
    return w;
  }

  /* ------------------------------------------------------------------ queries */

  async timeline(p: Principal, from: Date, to: Date): Promise<TimelineDto> {
    await this.authz.check(p, this.resource(p.operatorId), 'read');
    if (to.getTime() - from.getTime() > 4 * 24 * H) throw new DomainError('WINDOW_TOO_LARGE', 'The timeline window is limited to 4 days');
    const [flights, tails] = await Promise.all([this.repo.flightsBetween(p.operatorId, from, to), this.tails(p.operatorId)]);
    const slots = await this.repo.slotsBetween([...tails.keys()], from, to);
    const w = this.warnings(flights, tails, slots);
    return {
      from: from.toISOString(), to: to.toISOString(),
      tails: [...tails.values()].map(t => ({ reg: t.reg, type: t.type, dispatchable: t.dispatchable, reasons: t.reasons, mel: t.mel })),
      flights: flights.map(f => flightToDto(f, w.get(f.id) ?? [])),
      maintenance: slots.map(m => ({ wpId: m.wpId, tail: m.tail, station: m.station, bay: m.bay, start: m.plannedStart.toISOString(), end: m.plannedEnd.toISOString(), status: m.status }))
    };
  }

  async detail(p: Principal, id: string): Promise<FlightDetailDto> {
    const f = await this.repo.flight(id);
    const allowed = await this.authz.decide(p, this.resource(f.operatorId, id), ['read', 'manage']);
    if (!allowed.read) throw new DomainError('FLIGHT_NOT_FOUND', `Flight ${id} not found`, 404);
    const [rotation, tails, crewRows, alternates, audit] = await Promise.all([
      this.repo.rotation(f.tail, f.date), this.tails(f.operatorId), this.repo.crewOnFlights([id]),
      this.repo.alternates(f.arr, 600), this.auditQuery.forEntity(p.operatorId, 'flight', id)
    ]);
    const w = this.warnings(rotation, tails, await this.repo.slotsBetween([...tails.keys()], new Date(f.etd.getTime() - 24 * H), new Date(f.eta.getTime() + 24 * H)));
    const ev = await this.crew.evaluate(f.operatorId, crewRows.map(r => r.c));
    return {
      flight: flightToDto(f, w.get(f.id) ?? []),
      rotation: rotation.map(x => flightToDto(x, w.get(x.id) ?? [])),
      crew: crewRows.map(r => ({ id: r.c.id, name: r.c.name, rank: r.a.role, status: ftlStatus(ev.get(r.c.id)!.violations), positioning: r.a.positioning })),
      alternates,
      permissions: { manage: allowed.manage },
      audit
    };
  }

  /* ------------------------------------------------------------------ actions */

  /**
   * Movement is simulated from estimated times until MVT/ACARS messages are integrated: a flight is
   * treated as off blocks 10 minutes after its ETD (see progress()).
   */
  private requireNotDeparted(f: Flight, now: Date) {
    if ((f as Partial<FlightWithActuals>).offBlock) {
      throw new DomainError('ALREADY_DEPARTED', `${f.flightNo} is off blocks; it can no longer be changed from the OCC`, 409);
    }
    if (this.config.MOVEMENT_SIMULATION && f.etd.getTime() + DEPARTED_AFTER_MS <= now.getTime()) {
      throw new DomainError('ALREADY_DEPARTED', `${f.flightNo} was due off-blocks at ${hhmm(f.etd)}Z; it can no longer be changed from the OCC`, 409);
    }
  }

  async delay(p: Principal, id: string, body: { delayMinutes: number; reason: string }): Promise<FlightChangeResultDto> {
    const current = await this.repo.flight(id);
    await this.authz.check(p, this.resource(current.operatorId, id), 'manage');
    const actor = actorOf(p);
    const result = await this.db.transaction(async () => {
      const f = await this.repo.flight(id, { lock: true });
      this.requireNotDeparted(f, new Date());
      const rotation = await this.repo.rotation(f.tail, f.date);
      const r = delayFlight(f, rotation, body.delayMinutes, body.reason, MIN_TURN_MINUTES);
      await this.repo.updateFlight(r.flight, f.version);
      for (const k of r.knockOn) await this.repo.updateFlight(k, rotation.find(x => x.id === k.id)!.version);
      await this.audit.record(this.db, CHAIN, { operatorId: f.operatorId,
        actor, action: 'flight.delayed', entityType: 'flight', entityId: id,
        data: { flightNo: f.flightNo, tail: f.tail, delayMinutes: body.delayMinutes, reason: body.reason, previousEtd: f.etd.toISOString(), etd: r.flight.etd.toISOString(),
          knockOn: r.knockOn.map(k => ({ id: k.id, flightNo: k.flightNo, delayMinutes: k.delayMinutes })) }
      });
      for (const k of r.knockOn) {
        await this.audit.record(this.db, CHAIN, { operatorId: k.operatorId, actor, action: 'flight.delayed', entityType: 'flight', entityId: k.id, data: { flightNo: k.flightNo, delayMinutes: k.delayMinutes, reason: k.delayReason, knockOnFrom: f.flightNo } });
      }
      await this.outbox.add(this.db, r.event, { operatorId: f.operatorId, actor });
      if (body.delayMinutes >= 60) {
        await this.notifications.raise(this.db, {
          operatorId: f.operatorId, actor, severity: 'amber', link: link(id),
          title: `${f.flightNo} ${f.dep}–${f.arr} delayed ${body.delayMinutes} min`,
          body: `${f.tail} · new ETD ${hhmm(r.flight.etd)}Z${r.knockOn.length ? ` · knock-on to ${r.knockOn.map(k => k.flightNo).join(', ')}` : ''} · ${body.reason}`
        });
      }
      return r;
    });
    return this.changeResult(current.operatorId, result.flight, result.knockOn);
  }

  async cancel(p: Principal, id: string, reason: string): Promise<FlightChangeResultDto> {
    const current = await this.repo.flight(id);
    await this.authz.check(p, this.resource(current.operatorId, id), 'manage');
    const actor = actorOf(p);
    const flight = await this.db.transaction(async () => {
      const f = await this.repo.flight(id, { lock: true });
      this.requireNotDeparted(f, new Date());
      const r = cancelFlight(f, reason);
      await this.repo.updateFlight(r.flight, f.version);
      await this.audit.record(this.db, CHAIN, { operatorId: f.operatorId, actor, action: 'flight.cancelled', entityType: 'flight', entityId: id, data: { flightNo: f.flightNo, tail: f.tail, reason } });
      await this.outbox.add(this.db, r.event, { operatorId: f.operatorId, actor });
      await this.notifications.raise(this.db, {
        operatorId: f.operatorId, actor, severity: 'red', link: link(id),
        title: `${f.flightNo} ${f.dep}–${f.arr} cancelled`, body: `${f.tail} · ${reason}`
      });
      return r.flight;
    });
    return this.changeResult(current.operatorId, flight, []);
  }

  async swapTail(p: Principal, id: string, tail: string): Promise<FlightChangeResultDto> {
    const current = await this.repo.flight(id);
    await this.authz.check(p, this.resource(current.operatorId, id), 'manage');
    const actor = actorOf(p);
    const target = (await this.tails(current.operatorId)).get(tail);
    if (!target) throw new DomainError('TAIL_UNKNOWN', `${tail} is not in the fleet`, 404);
    const flight = await this.db.transaction(async () => {
      const f = await this.repo.flight(id, { lock: true });
      this.requireNotDeparted(f, new Date());
      const r = changeTail(f, target);
      // Refuse a swap that would overlap another flight of the target tail.
      const targetRotation = (await this.repo.rotation(tail, f.date)).filter(x => x.id !== f.id);
      const issues = rotationIssues([...targetRotation, r.flight], MIN_TURN_MINUTES).get(f.id) ?? [];
      const overlap = issues.find(i => i.startsWith('Overlaps'));
      if (overlap) throw new DomainError('ROTATION_CONFLICT', `${tail}: ${overlap}`, 409);
      await this.repo.updateFlight(r.flight, f.version);
      await this.audit.record(this.db, CHAIN, { operatorId: f.operatorId, actor, action: 'flight.tail_changed', entityType: 'flight', entityId: id, data: { flightNo: f.flightNo, from: f.tail, to: tail, warnings: issues } });
      await this.outbox.add(this.db, r.event, { operatorId: f.operatorId, actor });
      return r.flight;
    });
    return this.changeResult(current.operatorId, flight, []);
  }

  private async changeResult(operatorId: string, flight: Flight, knockOn: Flight[]): Promise<FlightChangeResultDto> {
    const crewImpact = await this.crew.impact(operatorId, [flight.id, ...knockOn.map(k => k.id)]);
    return { flight: flightToDto(flight), knockOn: knockOn.map(k => flightToDto(k)), crewImpact };
  }

  /* ------------------------------------------------------------------ CAMO → dispatch projection */

  /** Keeps ops.tail_mel in step with CAMO. Replays from the beginning of the topic on first start. */
  async onCamoEvent(env: EventEnvelope) {
    if (env.type === 'camo.airworthiness.changed' || env.type.startsWith('camo.wp.')) return this.onCamoState(env);
    if (!env.type.startsWith('camo.mel.')) return;
    await this.inbox.once(this.db, 'ops.dispatch', env, async () => {
      const before = (await this.tails(env.operatorId)).get((env.data as { tail: string }).tail);
      switch (env.type) {
        case 'camo.mel.deferred': {
          const d = (env as EventEnvelope<'camo.mel.deferred'>).data;
          await this.repo.upsertMel({ melItemId: d.melItemId, tail: d.tail, melRef: d.melRef, category: d.category, deadline: new Date(d.deadline) });
          break;
        }
        case 'camo.mel.extended': {
          const d = (env as EventEnvelope<'camo.mel.extended'>).data;
          await this.repo.extendMel(d.melItemId, new Date(d.deadline));
          break;
        }
        case 'camo.mel.expired':
          await this.repo.expireMel((env as EventEnvelope<'camo.mel.expired'>).data.melItemId);
          break;
        case 'camo.mel.closed':
          await this.repo.closeMel((env as EventEnvelope<'camo.mel.closed'>).data.melItemId);
          break;
        default:
          return;
      }
      const after = (await this.tails(env.operatorId)).get((env.data as { tail: string }).tail);
      if (after && before && after.dispatchable !== before.dispatchable) {
        await this.outbox.add(this.db, { type: 'ops.dispatch.changed', data: { tail: after.reg, dispatchable: after.dispatchable, reasons: after.reasons } },
          { operatorId: env.operatorId, actor: 'system:ops', correlationId: env.id });
        if (!after.dispatchable) {
          await this.notifications.raise(this.db, {
            operatorId: env.operatorId, actor: 'system:ops', severity: 'red', link: '/ops/occ',
            title: `${after.reg} is no longer dispatchable`, body: `${after.reasons.join('; ')}. Its flights need recovery.`
          });
        }
      }
    });
  }

  /** Airworthiness and planned maintenance from CAMO. */
  private async onCamoState(env: EventEnvelope) {
    await this.inbox.once(this.db, 'ops.dispatch', env, async () => {
      if (env.type === 'camo.airworthiness.changed') {
        const d = (env as EventEnvelope<'camo.airworthiness.changed'>).data;
        await this.repo.setAirworthiness(d.tail, d.airworthy, d.reasons);
        await this.outbox.add(this.db, { type: 'ops.dispatch.changed', data: { tail: d.tail, dispatchable: d.airworthy, reasons: d.reasons } },
          { operatorId: env.operatorId, actor: 'system:ops', correlationId: env.id });
        if (!d.airworthy) {
          const affected = (await this.repo.flightsBetween(env.operatorId, new Date(), new Date(Date.now() + 48 * H))).filter(f => f.tail === d.tail && f.status !== 'CANCELLED');
          if (affected.length) {
            await this.notifications.raise(this.db, {
              operatorId: env.operatorId, actor: 'system:ops', severity: 'red', link: '/ops/occ',
              title: `${d.tail} grounded — ${affected.length} flight(s) need recovery`, body: `${d.reasons.join('; ')}. Run the recovery optimiser.`
            });
          }
        }
      } else if (env.type === 'camo.wp.planned') {
        const d = (env as EventEnvelope<'camo.wp.planned'>).data;
        await this.repo.upsertSlot({ wpId: d.wpId, tail: d.tail, station: d.station, bay: d.bay || null, plannedStart: new Date(d.plannedStart), plannedEnd: new Date(d.plannedEnd), status: d.status });
      } else if (env.type === 'camo.wp.completed') {
        await this.repo.completeSlot((env as EventEnvelope<'camo.wp.completed'>).data.wpId);
      }
    });
  }

  /**
   * Movement simulation (every 5 minutes, Temporal): SCHEDULED/DELAYED → DEPARTED 10 min after ETD,
   * → ARRIVED at ETA, announcing `ops.flight.arrived` so CAMO can count hours and cycles.
   * Replaced by MVT/ACARS messages when that integration is added.
   */
  async progress(now = new Date()): Promise<{ departed: number; arrived: number }> {
    if (!this.config.MOVEMENT_SIMULATION) return { departed: 0, arrived: 0 };
    const due = await this.repo.flightsToProgress(now, DEPARTED_AFTER_MS);
    let departed = 0;
    let arrived = 0;
    for (const id of due) {
      await this.db.transaction(async () => {
        const f = await this.repo.flight(id, { lock: true });
        if (f.status === 'CANCELLED' || f.status === 'ARRIVED' || f.status === 'DIVERTED') return;
        if (f.eta.getTime() <= now.getTime()) {
          const next: Flight = { ...f, status: 'ARRIVED', version: f.version + 1 };
          const out = f.offBlock ?? f.etd; // reported off-block, arrival message missing
          await this.repo.updateFlight(next, f.version);
          await this.outbox.add(this.db, {
            type: 'ops.flight.arrived',
            data: { flightId: f.id, flightNo: f.flightNo, tail: f.tail, blockMinutes: Math.round((f.eta.getTime() - out.getTime()) / 60_000), flightMinutes: null, arrivedAt: f.eta.toISOString(), source: 'SIMULATED' }
          }, { operatorId: f.operatorId, actor: 'system:ops-movement' });
          arrived++;
        } else if (f.status !== 'DEPARTED' && f.etd.getTime() + DEPARTED_AFTER_MS <= now.getTime()) {
          await this.repo.updateFlight({ ...f, status: 'DEPARTED', version: f.version + 1 }, f.version);
          departed++;
        }
      });
    }
    return { departed, arrived };
  }

  /** Read helper for other services in this module. */
  dto(f: Flight): FlightDto {
    return flightToDto(f);
  }
}

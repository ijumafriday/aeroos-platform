import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { ComponentDto, ComponentEventDto, ComponentHistoryDto, EventEnvelope } from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import { checkInstallation, lifeNow, removal, type ComponentEvent, type Installed, type RemovalReason } from '@aeroos/mro-domain';
import { actorOf, type Principal } from '../../platform/auth/principal';
import { AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { InboxService } from '../../platform/events/outbox';
import { NotificationsService } from '../../platform/notifications/notifications.service';
import { FleetQuery } from './camo.repository';
import { componentEvents, components, requirements } from './programme.tables';
import { ProgrammeService } from './programme.service';

const CHAIN = 'camo';

type CompRow = typeof components.$inferSelect;
type EventRow = typeof componentEvents.$inferSelect;

const installed = (c: CompRow): Installed => ({
  partNo: c.partNo, serial: c.serial, tail: c.tail, position: c.position, installedAt: c.installedAt,
  aircraftAtInstall: { fh: c.aircraftFhAtInstall, fc: c.aircraftFcAtInstall }, tsnAtInstall: c.partTsnAtInstall, csnAtInstall: c.partCsnAtInstall
});
const eventOf = (e: EventRow): ComponentEvent => ({
  partNo: e.partNo, serial: e.serial, type: e.type as ComponentEvent['type'], tail: e.tail, position: e.position, at: e.at, tsn: e.tsn, csn: e.csn,
  reason: e.reason as RemovalReason | null, reference: e.reference
});
const eventDto = (e: EventRow): ComponentEventDto => ({
  id: e.id, partNo: e.partNo, serial: e.serial, type: e.type as ComponentEventDto['type'], tail: e.tail, position: e.position, at: e.at.toISOString(),
  tsn: e.tsn, csn: e.csn, reason: e.reason as ComponentEventDto['reason'], reference: e.reference, recordedBy: e.recordedBy
});

/**
 * Tracked components (life-limited parts): what is installed where, with time and cycles since new that
 * follow the serial number; removals and installations as an append-only, back-to-birth history.
 */
@Injectable()
export class ComponentsService {
  constructor(
    @Inject(DB_TOKEN.camo) private readonly db: ModuleDb,
    private readonly fleet: FleetQuery,
    private readonly programme: ProgrammeService,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
    private readonly notifications: NotificationsService
  ) {}

  /** AMO scrapped and mutilated a part: its serial's history ends here, and it can never be installed again. */
  async onPartScrapped(env: EventEnvelope<'amo.part.scrapped'>) {
    const d = env.data;
    if (!d.serial) return; // unserialised stock: nothing to track per part
    await this.inbox.once(this.db, 'camo.components', env, async () => {
      const hist = await this.db.db.select().from(componentEvents).where(and(eq(componentEvents.partNo, d.partNo), eq(componentEvents.serial, d.serial!)))
        .orderBy(asc(componentEvents.at), asc(componentEvents.id));
      const last = hist[hist.length - 1];
      const own = await this.tailsOf(env.operatorId);
      const [fitted] = await this.db.db.select().from(components).where(and(eq(components.partNo, d.partNo), eq(components.serial, d.serial!), isNull(components.removedAt)));
      // A serial fitted to, or last recorded by, another operator is not this operator's to scrap: refuse to
      // record it (it would block that operator's part) and tell CAMO, without revealing the other fleet.
      if ((fitted && !own.has(fitted.tail)) || (last && last.operatorId !== env.operatorId)) {
        await this.audit.record(this.db, CHAIN, {
          operatorId: env.operatorId, actor: env.actor, action: 'component.scrap_not_recorded', entityType: 'component', entityId: `${d.partNo}/${d.serial}`,
          data: { ncrId: d.ncrId, reason: 'serial belongs to another operator\'s records' }
        });
        await this.notifications.raise(this.db, {
          operatorId: env.operatorId, actor: 'system:camo', severity: 'red', link: `/amo/ncr?ncr=${encodeURIComponent(d.ncrId)}`,
          title: `${d.partNo} s/n ${d.serial}: scrapping not recorded`, body: `The serial is in another operator's records. Check the part's identity and the NCR ${d.ncrId}.`
        });
        return;
      }
      await this.db.db.insert(componentEvents).values({
        operatorId: env.operatorId, partNo: d.partNo, serial: d.serial!, type: 'SCRAPPED', tail: fitted?.tail ?? last?.tail ?? '-', position: fitted?.position ?? last?.position ?? '-',
        at: new Date(d.at), tsn: last?.tsn ?? 0, csn: last?.csn ?? 0, reason: null, reference: `${d.ncrId} (${d.method})`, recordedBy: env.actor
      });
      await this.audit.record(this.db, CHAIN, {
        operatorId: env.operatorId, actor: env.actor, action: 'component.scrapped', entityType: 'component', entityId: `${d.partNo}/${d.serial}`,
        data: { ncrId: d.ncrId, method: d.method, installedOn: fitted?.tail ?? null }
      });
      if (fitted) {
        // A part recorded as fitted was scrapped: the records and the aircraft disagree — CAMO must resolve it now.
        await this.notifications.raise(this.db, {
          operatorId: env.operatorId, actor: 'system:camo', severity: 'red', link: `/camo/components?part=${encodeURIComponent(d.partNo)}&serial=${encodeURIComponent(d.serial!)}`,
          title: `Scrapped part recorded as fitted to ${fitted.tail}`, body: `${d.partNo} s/n ${d.serial} was scrapped under ${d.ncrId} but the records show it on ${fitted.tail} ${fitted.position}. Record its removal and check the aircraft.`
        });
      }
    });
  }

  private resource(operatorId: string) {
    return { kind: 'maintenance_programme' as const, id: '*', attr: { operatorId } };
  }

  private async tailsOf(operatorId: string) {
    return new Set((await this.fleet.list(operatorId)).map(f => f.reg));
  }

  async installed(p: Principal, tail?: string): Promise<ComponentDto[]> {
    await this.authz.check(p, this.resource(p.operatorId), 'read');
    const tails = [...(await this.tailsOf(p.operatorId))].filter(t => !tail || t === tail);
    if (!tails.length) return [];
    const [rows, states] = await Promise.all([
      this.db.db.select().from(components).where(and(inArray(components.tail, tails), isNull(components.removedAt))).orderBy(asc(components.tail), asc(components.position)),
      this.programme.tailStates(p.operatorId)
    ]);
    const reqs = await this.db.db.select().from(requirements).where(inArray(requirements.id, [...new Set(rows.map(r => r.requirementId)), '-']));
    const reqBy = new Map<string, typeof requirements.$inferSelect>(reqs.map(r => [r.id, r]));
    return rows.map(c => {
      const st = states.get(c.tail);
      const life = st ? lifeNow(installed(c), st.counters) : { tsn: c.partTsnAtInstall, csn: c.partCsnAtInstall };
      const r = reqBy.get(c.requirementId);
      const limit = r?.kind === 'LLP' ? { fh: r.interval.fh, fc: r.interval.fc } : null;
      return {
        id: c.id, tail: c.tail, position: c.position, partNo: c.partNo, serial: c.serial, requirementId: c.requirementId, requirementRef: r?.ref ?? c.requirementId,
        installedAt: c.installedAt.toISOString(), tsn: life.tsn, csn: life.csn, lifeLimit: limit,
        remaining: limit ? { fh: limit.fh !== undefined ? Math.round((limit.fh - life.tsn) * 10) / 10 : null, fc: limit.fc !== undefined ? limit.fc - life.csn : null } : null
      };
    });
  }

  /** Life-limited part requirements that apply to an aircraft (positions a part can be installed against). */
  async trackedRequirements(p: Principal, tail: string): Promise<{ id: string; ref: string; title: string; lifeLimit: { fh?: number; fc?: number }; installed: string | null }[]> {
    await this.authz.check(p, this.resource(p.operatorId), 'read');
    const t = (await this.fleet.list(p.operatorId)).find(f => f.reg === tail);
    if (!t) throw new DomainError('NOT_FOUND', `No aircraft ${tail}`, 404);
    const reqs = await this.db.db.select().from(requirements).where(and(eq(requirements.operatorId, p.operatorId), eq(requirements.kind, 'LLP'), eq(requirements.active, true)));
    const fitted = await this.db.db.select().from(components).where(and(eq(components.tail, tail), isNull(components.removedAt)));
    return reqs.filter(r => r.types.includes(t.type)).map(r => {
      const c = fitted.find(x => x.requirementId === r.id);
      return { id: r.id, ref: r.ref, title: r.title, lifeLimit: { fh: r.interval.fh, fc: r.interval.fc }, installed: c ? `${c.partNo} s/n ${c.serial}` : null };
    });
  }

  async history(p: Principal, partNo: string, serial: string): Promise<ComponentHistoryDto> {
    await this.authz.check(p, this.resource(p.operatorId), 'read');
    const events = await this.db.db.select().from(componentEvents)
      .where(and(eq(componentEvents.operatorId, p.operatorId), eq(componentEvents.partNo, partNo), eq(componentEvents.serial, serial))).orderBy(asc(componentEvents.at), asc(componentEvents.id));
    if (!events.length) throw new DomainError('NOT_FOUND', `No history for ${partNo} s/n ${serial}`, 404);
    const own = [...(await this.tailsOf(p.operatorId))];
    // Where it is now — only if on one of this operator's aircraft (another operator's fleet is not ours to show).
    const [cur] = own.length ? await this.db.db.select().from(components)
      .where(and(eq(components.partNo, partNo), eq(components.serial, serial), isNull(components.removedAt), inArray(components.tail, own))) : [];
    let life = { tsn: events[events.length - 1].tsn, csn: events[events.length - 1].csn };
    if (cur) {
      const st = (await this.programme.tailStates(p.operatorId)).get(cur.tail);
      if (st) life = lifeNow(installed(cur), st.counters);
    }
    return { partNo, serial, installed: cur ? { tail: cur.tail, position: cur.position } : null, ...life, events: events.map(eventDto) };
  }

  async remove(p: Principal, id: string, body: { reason: RemovalReason; reference: string }): Promise<ComponentHistoryDto> {
    await this.authz.check(p, this.resource(p.operatorId), 'record_component');
    const tails = await this.tailsOf(p.operatorId);
    const c = await this.db.transaction(async () => {
      const [c] = await this.db.db.select().from(components).where(eq(components.id, id)).for('update');
      if (!c || !tails.has(c.tail)) throw new DomainError('NOT_FOUND', `No component ${id}`, 404);
      if (c.removedAt) throw new DomainError('ALREADY_REMOVED', `${c.partNo} s/n ${c.serial} was already removed`, 409);
      const st = (await this.programme.tailStates(p.operatorId)).get(c.tail);
      if (!st) throw new DomainError('NO_COUNTERS', `${c.tail} has no counters`, 422);
      const ev = removal(installed(c), st.counters, body.reason, body.reference);
      await this.db.db.update(components).set({ removedAt: ev.at }).where(eq(components.id, id));
      await this.db.db.insert(componentEvents).values({ operatorId: p.operatorId, ...ev, recordedBy: actorOf(p) });
      await this.audit.record(this.db, CHAIN, {
        operatorId: p.operatorId, actor: actorOf(p), action: 'component.removed', entityType: 'component', entityId: `${c.partNo}/${c.serial}`,
        data: { tail: c.tail, position: c.position, tsn: ev.tsn, csn: ev.csn, reason: ev.reason, reference: ev.reference, aircraft: { fh: st.counters.fh, fc: st.counters.fc } }
      });
      return c;
    });
    await this.programme.sweepAirworthiness(p.operatorId, c.tail);
    return this.history(p, c.partNo, c.serial);
  }

  async install(p: Principal, body: { tail: string; position: string; requirementId: string; partNo: string; serial: string; tsn: number; csn: number; reference: string }): Promise<ComponentHistoryDto> {
    await this.authz.check(p, this.resource(p.operatorId), 'record_component');
    const fleet = await this.fleet.list(p.operatorId);
    const tail = fleet.find(f => f.reg === body.tail);
    if (!tail) throw new DomainError('NOT_FOUND', `No aircraft ${body.tail}`, 404);
    await this.db.transaction(async () => {
      const [req] = await this.db.db.select().from(requirements).where(and(eq(requirements.id, body.requirementId), eq(requirements.operatorId, p.operatorId)));
      if (!req || req.kind !== 'LLP') throw new DomainError('NOT_TRACKED', `${body.requirementId} is not a life-limited part requirement`, 422);
      if (!req.types.includes(tail.type)) throw new DomainError('WRONG_TYPE', `${req.ref} does not apply to ${tail.type}`, 422);
      const [occupied] = await this.db.db.select().from(components).where(and(eq(components.tail, body.tail), eq(components.requirementId, body.requirementId), isNull(components.removedAt))).for('update');
      if (occupied) throw new DomainError('POSITION_OCCUPIED', `${occupied.partNo} s/n ${occupied.serial} is installed for ${req.ref} on ${body.tail} — remove it first`, 409);
      const hist = await this.db.db.select().from(componentEvents).where(and(eq(componentEvents.partNo, body.partNo), eq(componentEvents.serial, body.serial)));
      // Across operators too: a serial cannot be on two aircraft, whoever operates them (also a unique index).
      const [elsewhere] = await this.db.db.select().from(components).where(and(eq(components.partNo, body.partNo), eq(components.serial, body.serial), isNull(components.removedAt)));
      if (elsewhere) throw new DomainError('STILL_INSTALLED', `${body.partNo} s/n ${body.serial} is still installed on ${elsewhere.tail}`, 409);
      checkInstallation(hist.map(eventOf), body, { fh: req.interval.fh, fc: req.interval.fc });
      const st = (await this.programme.tailStates(p.operatorId)).get(body.tail);
      if (!st) throw new DomainError('NO_COUNTERS', `${body.tail} has no counters`, 422);
      const id = `C-${randomUUID().slice(0, 8)}`;
      await this.db.db.insert(components).values({
        id, tail: body.tail, requirementId: body.requirementId, partNo: body.partNo, serial: body.serial, position: body.position, installedAt: st.counters.at,
        aircraftFhAtInstall: st.counters.fh, aircraftFcAtInstall: st.counters.fc, partTsnAtInstall: body.tsn, partCsnAtInstall: body.csn
      });
      await this.db.db.insert(componentEvents).values({
        operatorId: p.operatorId, partNo: body.partNo, serial: body.serial, type: 'INSTALLED', tail: body.tail, position: body.position, at: st.counters.at,
        tsn: body.tsn, csn: body.csn, reason: null, reference: body.reference.trim(), recordedBy: actorOf(p)
      });
      await this.audit.record(this.db, CHAIN, {
        operatorId: p.operatorId, actor: actorOf(p), action: 'component.installed', entityType: 'component', entityId: `${body.partNo}/${body.serial}`,
        data: { tail: body.tail, position: body.position, requirementId: body.requirementId, tsn: body.tsn, csn: body.csn, reference: body.reference.trim(), aircraft: { fh: st.counters.fh, fc: st.counters.fc } }
      });
    });
    await this.programme.sweepAirworthiness(p.operatorId, body.tail);
    return this.history(p, body.partNo, body.serial);
  }
}

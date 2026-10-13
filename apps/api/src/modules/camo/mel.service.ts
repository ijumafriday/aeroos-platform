import { Inject, Injectable } from '@nestjs/common';
import type { EventEnvelope, MelItemDto, PasskeyAssertionDto, PasskeyAssertionOptionsDto } from '@aeroos/contracts';
import { DomainError, sha256Hex } from '@aeroos/kernel';
import { approveExtension, closeDeferral, engineeringOrderForDeferral, linkEngineeringOrder, markExpired, raiseDeferral, type MelItem } from '@aeroos/mro-domain';
import { actorOf, type Principal } from '../../platform/auth/principal';
import { AuditQuery, AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { InboxService, OutboxService } from '../../platform/events/outbox';
import { NotificationsService } from '../../platform/notifications/notifications.service';
import { PasskeyService } from '../../platform/passkeys/passkeys.service';
import { ComplianceService } from '../compliance/compliance.module';
import { MasterDataService } from '../compliance/master-data.service';
import { FleetQuery, MelRepository, melToDto } from './camo.repository';

const CHAIN = 'camo';
const melResource = (m: Pick<MelItem, 'id' | 'operatorId' | 'status'>) => ({ kind: 'mel_item' as const, id: m.id, attr: { operatorId: m.operatorId, status: m.status } });
const link = (id: string) => `/camo/mel?item=${encodeURIComponent(id)}`;

/**
 * MEL deferrals: the reference implementation of how every regulated flow in AeroOS works.
 * 1. authorise with Cerbos (outside the transaction — no locks held during network calls)
 * 2. in one transaction on the module's own role: re-read with a row lock, apply the pure domain
 *    function (which consults the compliance engine), persist with a version check, append to the
 *    hash-chained audit log, and write events to the outbox
 * 3. other modules and workflows react to the events — never by reaching into CAMO's tables
 */
@Injectable()
export class MelService {
  constructor(
    @Inject(DB_TOKEN.camo) private readonly db: ModuleDb,
    private readonly repo: MelRepository,
    private readonly fleet: FleetQuery,
    private readonly compliance: ComplianceService,
    private readonly masterData: MasterDataService,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly auditQuery: AuditQuery,
    private readonly outbox: OutboxService,
    private readonly inbox: InboxService,
    private readonly notifications: NotificationsService,
    private readonly passkeys: PasskeyService
  ) {}

  async list(p: Principal, scope: 'open' | 'closed'): Promise<MelItemDto[]> {
    await this.authz.check(p, melResource({ id: '*', operatorId: p.operatorId, status: 'OPEN' }), 'read');
    const items = scope === 'open' ? await this.repo.list(p.operatorId, ['OPEN', 'EXPIRED']) : await this.repo.recentClosed(p.operatorId, 100);
    return items.map(melToDto);
  }

  async get(p: Principal, id: string) {
    const item = await this.repo.require(id);
    const allowed = await this.authz.decide(p, melResource(item), ['read', 'generate_eo', 'approve_extension']);
    if (!allowed.read) throw new DomainError('MEL_NOT_FOUND', `Deferral ${id} not found`, 404);
    const [audit, eo] = await Promise.all([this.auditQuery.forEntity(p.operatorId, 'mel_item', id), item.eoId ? this.repo.getEo(item.eoId) : Promise.resolve(null)]);
    const p0 = this.compliance.engine.profile(item.operatorId);
    return {
      item: melToDto(item),
      engineeringOrder: eo,
      audit,
      permissions: { generateEo: allowed.generate_eo, approveExtension: allowed.approve_extension },
      melEntry: p0.mel[item.melRef] ?? null
    };
  }

  async raise(p: Principal, body: { tail: string; melRef: string; description: string }): Promise<MelItemDto> {
    const tail = await this.fleet.get(body.tail);
    if (!tail) throw new DomainError('TAIL_UNKNOWN', `Aircraft ${body.tail} is not in the fleet`, 404);
    await this.authz.check(p, melResource({ id: 'new', operatorId: tail.operatorId, status: 'OPEN' }), 'raise');
    await this.masterData.assertEffective(tail.operatorId, ['camo.mel']);
    return this.raiseAs(actorOf(p), { operatorId: tail.operatorId, tail: tail.reg, aircraftType: tail.type, melRef: body.melRef, description: body.description, raisedAt: new Date() });
  }

  /** Shared by the API, the EFB integration and the demo seed. */
  async raiseAs(actor: string, i: { operatorId: string; tail: string; aircraftType: string; melRef: string; description: string; raisedAt: Date }): Promise<MelItemDto> {
    if (!actor.startsWith('system:seed')) await this.masterData.assertEffective(i.operatorId, ['camo.mel']);
    return this.db.transaction(async () => {
      const id = await this.repo.nextMelId();
      const { item, event } = raiseDeferral(this.compliance.engine, { id, ...i, raisedBy: actor });
      await this.repo.insert(item);
      await this.audit.record(this.db, CHAIN, { operatorId: i.operatorId,
        actor, action: 'mel.deferred', entityType: 'mel_item', entityId: id, rule: item.deadlineRule,
        data: { tail: item.tail, melRef: item.melRef, category: item.category, description: item.description, raisedAt: item.raisedAt.toISOString(), deadline: item.deadline.toISOString(), basis: item.deadlineBasis }
      });
      await this.outbox.add(this.db, event, { operatorId: item.operatorId, actor });
      if (item.category === 'A' || item.category === 'B') {
        await this.notifications.raise(this.db, {
          operatorId: item.operatorId, actor, severity: 'amber', link: link(id),
          title: `MEL Cat ${item.category} deferral — ${item.tail}`,
          body: `${id} · ${item.title}. Rectify by ${item.deadline.toISOString().slice(0, 16).replace('T', ' ')}Z.`
        });
      }
      return melToDto(item);
    });
  }

  async generateEngineeringOrder(p: Principal, id: string) {
    const current = await this.repo.require(id);
    await this.authz.check(p, melResource(current), 'generate_eo');
    const actor = actorOf(p);
    return this.db.transaction(async () => {
      const item = await this.repo.require(id, { lock: true });
      const eoId = await this.repo.nextEoId();
      const { eo, event } = engineeringOrderForDeferral(item, eoId, actor, new Date());
      const next = linkEngineeringOrder(item, eoId);
      await this.repo.insertEo(eo);
      await this.repo.update(next, item.version);
      await this.audit.record(this.db, CHAIN, { operatorId: item.operatorId,
        actor, action: 'eo.released', entityType: 'mel_item', entityId: id,
        data: { eoId, title: eo.title, trade: eo.trade, steps: eo.steps, estimatedHours: eo.estimatedHours }
      });
      await this.outbox.add(this.db, event, { operatorId: item.operatorId, actor });
      return { item: melToDto(next), engineeringOrderId: eoId };
    });
  }

  /** A passkey confirmation of an extension is bound to this item, its version, and the exact justification. */
  private extensionContext(id: string, version: number, justification: string) {
    return { melItemId: id, version, justificationSha256: sha256Hex(justification) };
  }

  async extensionChallenge(p: Principal, id: string, justification: string): Promise<PasskeyAssertionOptionsDto> {
    const item = await this.repo.require(id);
    await this.authz.check(p, melResource(item), 'approve_extension');
    return this.passkeys.assertionOptions(p, 'mel_extension', this.extensionContext(id, item.version, justification),
      `Extend MEL item ${id} (${item.tail}, ${item.melRef}, Cat ${item.category}) — "${justification.slice(0, 120)}"`);
  }

  async approveExtension(p: Principal, id: string, justification: string, passkey?: { challengeId: string; assertion: PasskeyAssertionDto }) {
    await this.masterData.assertEffective(p.operatorId, ['camo.mel']);
    const current = await this.repo.require(id);
    await this.authz.check(p, melResource(current), 'approve_extension');
    const confirmation = await this.passkeys.requireConfirmation(p, 'mel_extension', this.extensionContext(id, current.version, justification), passkey);
    const actor = actorOf(p);
    return this.db.transaction(async () => {
      const item = await this.repo.require(id, { lock: true });
      if (confirmation && item.version !== current.version) throw new DomainError('MEL_CHANGED', `${id} changed while you were confirming; approve again`, 409);
      const { item: next, event, decision } = approveExtension(this.compliance.engine, item, new Date());
      await this.repo.update(next, item.version);
      await this.audit.record(this.db, CHAIN, { operatorId: item.operatorId,
        actor, action: 'mel.extended', entityType: 'mel_item', entityId: id, rule: decision.rule,
        data: {
          justification, previousDeadline: item.deadline.toISOString(), newDeadline: next.deadline.toISOString(), basis: decision.basis,
          confirmation: confirmation ? { method: 'passkey', ...confirmation } : { method: 'session' },
          conditions: decision.value.allowed ? decision.value.conditions : []
        }
      });
      await this.outbox.add(this.db, event, { operatorId: item.operatorId, actor });
      await this.notifications.raise(this.db, {
        operatorId: item.operatorId, actor, severity: 'cyan', link: link(id),
        title: `Rectification interval extended — ${item.tail}`,
        body: `${id} now due ${next.deadline.toISOString().slice(0, 16).replace('T', ' ')}Z (${decision.rule}).`
      });
      return melToDto(next);
    });
  }

  /** Reaction to AMO certifying the rectification: the deferral closes, citing the CRS. */
  async closeFromCrs(env: EventEnvelope<'amo.crs.issued'>) {
    const found = await this.repo.byEoId(env.data.eoId);
    if (!found) return; // engineering order did not come from a MEL deferral
    await this.inbox.once(this.db, 'camo.mel-closure', env, async () => {
      const item = await this.repo.require(found.id, { lock: true });
      const { item: next, event } = closeDeferral(item, 'system:amo', env.data.crsNumber, new Date());
      if (!event) return;
      await this.repo.update(next, item.version);
      await this.audit.record(this.db, CHAIN, { operatorId: item.operatorId,
        actor: env.actor, action: 'mel.closed', entityType: 'mel_item', entityId: item.id,
        data: { crsNumber: env.data.crsNumber, taskCardId: env.data.taskCardId, certifiedBy: env.data.personnelId, eventId: env.id }
      });
      await this.outbox.add(this.db, event, { operatorId: item.operatorId, actor: 'system:camo', correlationId: env.id });
      await this.notifications.raise(this.db, {
        operatorId: item.operatorId, actor: 'system:camo', severity: 'green', link: link(item.id),
        title: `Deferral closed — ${item.tail}`,
        body: `${item.id} (${item.title}) rectified under ${env.data.crsNumber}.`
      });
    });
  }

  /**
   * Called by the Temporal escalation workflow at T-24h, T-6h and at the deadline.
   * Returns whether the workflow should keep watching this item.
   */
  async escalate(id: string, level: 'T-24h' | 'T-6h' | 'EXPIRED'): Promise<{ active: boolean }> {
    return this.db.transaction(async () => {
      const item = await this.repo.require(id, { lock: true });
      if (item.status !== 'OPEN') return { active: false };
      const actor = 'system:mel-escalation';
      if (level === 'EXPIRED') {
        const { item: next, event } = markExpired(item, new Date());
        if (!event) return { active: true }; // extended in the meantime
        await this.repo.update(next, item.version);
        await this.audit.record(this.db, CHAIN, { operatorId: item.operatorId, actor, action: 'mel.expired', entityType: 'mel_item', entityId: id, data: { deadline: item.deadline.toISOString() }, rule: item.deadlineRule });
        await this.outbox.add(this.db, event, { operatorId: item.operatorId, actor });
        await this.notifications.raise(this.db, {
          operatorId: item.operatorId, actor, severity: 'red', link: link(id),
          title: `MEL interval EXPIRED — ${item.tail} not dispatchable`,
          body: `${id} (${item.title}) passed its rectification deadline.`
        });
        return { active: false };
      }
      await this.audit.record(this.db, CHAIN, { operatorId: item.operatorId, actor, action: 'mel.escalated', entityType: 'mel_item', entityId: id, data: { level, deadline: item.deadline.toISOString() } });
      await this.notifications.raise(this.db, {
        operatorId: item.operatorId, actor, severity: level === 'T-6h' ? 'red' : 'amber', link: link(id),
        title: `MEL deferral due within ${level === 'T-6h' ? '6 hours' : '24 hours'} — ${item.tail}`,
        body: `${id} · ${item.title}${item.eoId ? ` · ${item.eoId} in work` : ' · no engineering order yet'}.`
      });
      return { active: true };
    });
  }

  countFor(operatorId: string) {
    return this.repo.count(operatorId);
  }
}

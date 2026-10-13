import { Body, Controller, Get, Inject, Injectable, Logger, Module, OnApplicationBootstrap, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { integer, jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';
import { TOPICS, type CertificationCheckDto, type DocumentDto, type EventEnvelope, type PasskeyAssertionDto, type PasskeyAssertionOptionsDto, type StampDto, type TaskCardDto, type Trade } from '@aeroos/contracts';
import { DomainError, sha256Hex } from '@aeroos/kernel';
import { CONFIG, type Config } from '../../config';
import { certificationCheck, issueCrs, signStep, taskCardFromEngineeringOrder, taskCardFromWorkPackageItem, type Stamp, type TaskCard } from '@aeroos/mro-domain';
import type { KeyService, SignatureEnvelope } from '@aeroos/signing';
import { actorOf, CurrentPrincipal, type Principal } from '../../platform/auth/principal';
import { AuditQuery, AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { KafkaService } from '../../platform/events/kafka.service';
import { InboxService, OutboxService } from '../../platform/events/outbox';
import { KEY_SERVICE } from '../../platform/keys/keys.provider';
import { NotificationsService } from '../../platform/notifications/notifications.service';
import { assertionSchema, PasskeyService } from '../../platform/passkeys/passkeys.service';
import { DocumentsService } from '../../platform/storage/documents.service';
import { ComplianceModule, ComplianceService } from '../compliance/compliance.module';
import { OrgModule, PersonnelQuery } from '../org/org.module';
import { NonconformityController, NonconformityService } from './nonconformity.service';
import { SupplyController, SupplyService } from './supply.service';
import { BillingController, BillingService } from './billing.service';
import { renderCrsPdf } from './crs-pdf';
import { StoresService } from './stores.service';
import { z } from 'zod';
import { ZodPipe } from '../../platform/http/http';
import { AmoSearch } from './amo.search';
import { SupplyLogisticsController, SupplyLogisticsService } from './supply-logistics.service';
import { FieldWorkController, FieldWorkService } from './field-work.service';
import { ProductionControlController, ProductionControlService } from './production.service';
import { WarehouseControlController, WarehouseControlService } from './warehouse-control.service';
import { AmoStockLotMigration } from './amo.migration';
import { MaintenanceControlController, MaintenanceControlService } from './maintenance-control.service';
import { SupplyControlController, SupplyControlService } from './supply-control.service';

/* ---------------------------------------------------------------- persistence */

const amo = pgSchema('amo');

interface StoredStamp { personnelId: string; name: string; licence: string; at: string; rule: string; via: string; signature: SignatureEnvelope; tools?: string[] }

export const taskCards = amo.table('task_cards', {
  id: text('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  tail: text('tail').notNull(),
  aircraftType: text('aircraft_type').notNull(),
  title: text('title').notNull(),
  ata: text('ata').notNull(),
  trade: text('trade').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  status: text('status').notNull(),
  steps: jsonb('steps').$type<{ n: number; text: string; stamp: StoredStamp | null }[]>().notNull(),
  crs: jsonb('crs').$type<(StoredStamp & { number: string }) | null>(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  version: integer('version').notNull(),
  crsDocumentId: text('crs_document_id'),
  requirements: jsonb('requirements').$type<{ tools: string[]; parts: { partNo: string; qty: number }[] }>().notNull()
});

const toStored = (s: Stamp): StoredStamp => ({ ...s, at: s.at.toISOString() });
const fromStored = (s: StoredStamp): Stamp => ({ ...s, at: new Date(s.at) });
const stampDto = (s: Stamp): StampDto => ({ ...s, at: s.at.toISOString() });

const toDomain = (r: typeof taskCards.$inferSelect): TaskCard => ({
  id: r.id, operatorId: r.operatorId, tail: r.tail, aircraftType: r.aircraftType, title: r.title, ata: r.ata,
  trade: r.trade as Trade, source: { type: r.sourceType as 'EO' | 'WP', id: r.sourceId }, status: r.status as TaskCard['status'],
  steps: r.steps.map(s => ({ n: s.n, text: s.text, stamp: s.stamp ? fromStored(s.stamp) : null })),
  crs: r.crs ? { ...fromStored(r.crs), number: r.crs.number } : null,
  createdAt: r.createdAt, version: r.version
});

type Extra = { crsDocumentId?: string | null; attachments?: DocumentDto[]; requirements?: TaskCardDto['requirements']; reservations?: TaskCardDto['reservations'] };

export const taskCardDto = (c: TaskCard, extra: Extra = {}): TaskCardDto => ({
  id: c.id, operatorId: c.operatorId, tail: c.tail, aircraftType: c.aircraftType, title: c.title, ata: c.ata, trade: c.trade,
  source: c.source, status: c.status,
  steps: c.steps.map(s => ({ n: s.n, text: s.text, stamp: s.stamp ? stampDto(s.stamp) : null })),
  crs: c.crs ? { ...stampDto(c.crs), number: c.crs.number, documentId: extra.crsDocumentId ?? null } : null,
  attachments: extra.attachments ?? [],
  requirements: extra.requirements ?? { tools: [], parts: [] },
  reservations: extra.reservations ?? [],
  createdAt: c.createdAt.toISOString()
});

@Injectable()
export class TaskCardRepository {
  constructor(@Inject(DB_TOKEN.amo) private readonly db: ModuleDb) {}

  async next(seq: 'task_card_seq' | 'crs_seq') {
    const r = await this.db.db.execute<{ n: string }>(sql.raw(`select nextval('amo.${seq}')::text as n`));
    return r.rows[0].n;
  }

  async get(id: string, opts: { lock?: boolean } = {}): Promise<TaskCard> {
    const q = this.db.db.select().from(taskCards).where(eq(taskCards.id, id)).limit(1);
    const [r] = opts.lock ? await q.for('update') : await q;
    if (!r) throw new DomainError('TASK_CARD_NOT_FOUND', `Task card ${id} not found`, 404);
    return toDomain(r);
  }

  async list(operatorId: string): Promise<{ card: TaskCard; crsDocumentId: string | null; requirements: TaskCardDto['requirements'] }[]> {
    const rows = await this.db.db.select().from(taskCards)
      .where(and(eq(taskCards.operatorId, operatorId), inArray(taskCards.status, ['OPEN', 'IN_PROGRESS', 'CERTIFIED'])))
      .orderBy(desc(taskCards.createdAt))
      .limit(200);
    return rows.map(r => ({ card: toDomain(r), crsDocumentId: r.crsDocumentId, requirements: r.requirements }));
  }

  async crsDocumentId(id: string): Promise<string | null> {
    const [r] = await this.db.db.select({ d: taskCards.crsDocumentId }).from(taskCards).where(eq(taskCards.id, id)).limit(1);
    return r?.d ?? null;
  }

  async requirements(id: string): Promise<TaskCardDto['requirements']> {
    const [r] = await this.db.db.select({ q: taskCards.requirements }).from(taskCards).where(eq(taskCards.id, id)).limit(1);
    return r?.q ?? { tools: [], parts: [] };
  }

  /** Set once; the CRS itself is immutable, so this does not bump the card version. */
  async setCrsDocument(id: string, documentId: string): Promise<boolean> {
    const r = await this.db.db.update(taskCards).set({ crsDocumentId: documentId })
      .where(and(eq(taskCards.id, id), sql`${taskCards.crsDocumentId} is null`)).returning({ id: taskCards.id });
    return r.length > 0;
  }

  /** Returns false if a card for this engineering order already exists (redelivered event). */
  async insertIfAbsent(c: TaskCard, requirements: TaskCardDto['requirements'] = { tools: [], parts: [] }): Promise<boolean> {
    const r = await this.db.db.insert(taskCards).values({
      id: c.id, operatorId: c.operatorId, tail: c.tail, aircraftType: c.aircraftType, title: c.title, ata: c.ata, trade: c.trade,
      sourceType: c.source.type, sourceId: c.source.id, status: c.status,
      steps: c.steps.map(s => ({ n: s.n, text: s.text, stamp: s.stamp ? toStored(s.stamp) : null })),
      crs: null, createdAt: c.createdAt, version: c.version, requirements
    }).onConflictDoNothing().returning({ id: taskCards.id });
    return r.length > 0;
  }

  async uncertifiedPredecessors(operatorId: string, wpId: string, requirementIds: string[]): Promise<string[]> {
    if (!requirementIds.length) return [];
    const sourceIds = requirementIds.map(r => `${wpId}/${r}`);
    const rows = await this.db.db.select({ sourceId: taskCards.sourceId, status: taskCards.status }).from(taskCards)
      .where(and(eq(taskCards.operatorId, operatorId), eq(taskCards.sourceType, 'WP'), inArray(taskCards.sourceId, sourceIds)));
    const certified = new Set(rows.filter(r => r.status === 'CERTIFIED').map(r => r.sourceId));
    return requirementIds.filter(r => !certified.has(`${wpId}/${r}`));
  }

  async update(c: TaskCard, expectedVersion: number) {
    const r = await this.db.db.update(taskCards).set({
      status: c.status,
      steps: c.steps.map(s => ({ n: s.n, text: s.text, stamp: s.stamp ? toStored(s.stamp) : null })),
      crs: c.crs ? { ...toStored(c.crs), number: c.crs.number } : null,
      version: c.version
    }).where(and(eq(taskCards.id, c.id), eq(taskCards.version, expectedVersion))).returning({ id: taskCards.id });
    if (!r.length) throw new DomainError('CONCURRENT_UPDATE', `Task card ${c.id} was changed by someone else. Reload and try again.`, 409);
  }
}

/* ---------------------------------------------------------------- service */

const CHAIN = 'amo';
const link = (id: string) => `/amo/task-cards?card=${encodeURIComponent(id)}`;

@Injectable()
export class TaskCardService {
  constructor(
    @Inject(DB_TOKEN.amo) private readonly db: ModuleDb,
    private readonly repo: TaskCardRepository,
    private readonly compliance: ComplianceService,
    private readonly personnel: PersonnelQuery,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly auditQuery: AuditQuery,
    private readonly outbox: OutboxService,
    private readonly inbox: InboxService,
    private readonly notifications: NotificationsService,
    private readonly documents: DocumentsService,
    private readonly stores: StoresService,
    @Inject(KEY_SERVICE) private readonly keys: KeyService,
    @Inject(CONFIG) private readonly config: Config,
    private readonly passkeys: PasskeyService
  ) {}

  /** Reaction to CAMO releasing a work package: one task card per item, parts reserved at the station. */
  async createFromWorkPackage(env: EventEnvelope<'camo.wp.released'>) {
    await this.inbox.once(this.db, 'amo.wp-cards', env, async () => {
      const created: string[] = [];
      for (const item of env.data.items) {
        const id = `TC-${await this.repo.next('task_card_seq')}`;
        const { card, event } = taskCardFromWorkPackageItem(env.data, item, env.operatorId, id, new Date());
        if (!(await this.repo.insertIfAbsent(card, { tools: item.tools, parts: item.parts, predecessors: item.predecessors }))) continue;
        await this.stores.reserve(env.operatorId, id, item.parts, env.data.station);
        await this.audit.record(this.db, CHAIN, { operatorId: env.operatorId,
          actor: 'system:amo', action: 'taskcard.created', entityType: 'task_card', entityId: id,
          data: { wpId: env.data.wpId, requirementId: item.requirementId, ref: item.ref, tail: card.tail, title: card.title, steps: item.steps, tools: item.tools, parts: item.parts, eventId: env.id }
        });
        await this.outbox.add(this.db, event, { operatorId: env.operatorId, actor: 'system:amo', correlationId: env.id });
        created.push(id);
      }
      if (created.length) {
        await this.notifications.raise(this.db, {
          operatorId: env.operatorId, actor: 'system:amo', severity: 'cyan', link: '/amo/task-cards',
          title: `${env.data.wpId} released to the hangar — ${env.data.tail}`, body: `${created.length} task card(s): ${env.data.items.map(i => i.ref).join(', ')}`
        });
      }
    });
  }

  /** Reaction to CAMO releasing an engineering order: issue the task card to the floor. */
  async createFromEngineeringOrder(env: EventEnvelope<'camo.eo.released'>) {
    await this.inbox.once(this.db, 'amo.taskcards', env, async () => {
      const id = `TC-${await this.repo.next('task_card_seq')}`;
      const { card, event } = taskCardFromEngineeringOrder(env.data, env.operatorId, id, new Date());
      if (!(await this.repo.insertIfAbsent(card))) return;
      await this.audit.record(this.db, CHAIN, { operatorId: env.operatorId,
        actor: 'system:amo', action: 'taskcard.created', entityType: 'task_card', entityId: id,
        data: { eoId: env.data.eoId, tail: card.tail, title: card.title, trade: card.trade, steps: card.steps.map(s => s.text), eventId: env.id }
      });
      await this.outbox.add(this.db, event, { operatorId: card.operatorId, actor: 'system:amo', correlationId: env.id });
      await this.notifications.raise(this.db, {
        operatorId: card.operatorId, actor: 'system:amo', severity: 'cyan', link: link(id),
        title: `Task card issued — ${card.tail}`, body: `${id} · ${card.title}`
      });
    });
  }

  private resource(c: TaskCard, licenceCovered: boolean) {
    return {
      kind: 'task_card' as const,
      id: c.id,
      attr: { operatorId: c.operatorId, status: c.status, licenceCovered, allStepsStamped: c.steps.every(s => !!s.stamp) }
    };
  }

  /** What the rulepack says about this user certifying this card, for the UI and for Cerbos. */
  private async check(p: Principal, card: TaskCard): Promise<CertificationCheckDto & { signer: Awaited<ReturnType<PersonnelQuery['signer']>> }> {
    const signer = await this.personnel.signer(p.username, card.operatorId);
    if (!signer) return { allowed: false, reason: 'You have no personnel record with certification privileges', via: null, rule: 'ORG', basis: 'Personnel record required', signer };
    const d = certificationCheck(this.compliance.engine, card, signer, new Date());
    if (d.value.allowed) {
      // Staff certify to the organisation's procedures: the current exposition and key procedures must have been read.
      const unread = await this.personnel.unreadForCertification(p.username, card.operatorId);
      if (unread.length) {
        return {
          allowed: false, signer, via: null, rule: 'Part-145 145.A.30(e) / 145.A.65(b)',
          reason: `Read and acknowledge ${unread.map(u => `${u.code} revision ${u.revision} (effective ${u.effectiveFrom})`).join(', ')} first — Organization → Document & Manual Control`,
          basis: 'Certifying staff must be familiar with the current exposition and procedures'
        };
      }
    }
    return { allowed: d.value.allowed, reason: d.value.allowed ? null : d.value.reason, via: d.value.allowed ? d.value.via : null, rule: d.rule, basis: d.basis, signer };
  }

  async list(p: Principal): Promise<TaskCardDto[]> {
    await this.authz.check(p, { kind: 'task_card', id: '*', attr: { operatorId: p.operatorId, status: 'OPEN', licenceCovered: false, allStepsStamped: false } }, 'read');
    return (await this.repo.list(p.operatorId)).map(r => taskCardDto(r.card, { crsDocumentId: r.crsDocumentId, requirements: r.requirements }));
  }

  async get(p: Principal, id: string) {
    const card = await this.repo.get(id);
    const r = await this.check(p, card);
    const check: CertificationCheckDto = { allowed: r.allowed, reason: r.reason, via: r.via, rule: r.rule, basis: r.basis };
    const allowed = await this.authz.decide(p, this.resource(card, check.allowed), ['read', 'sign_step', 'issue_crs']);
    if (!allowed.read) throw new DomainError('TASK_CARD_NOT_FOUND', `Task card ${id} not found`, 404);
    const [crsDocumentId, attachments, requirements, reservations] = await Promise.all([
      this.repo.crsDocumentId(id),
      this.documents.allFor(card.operatorId, 'task_card', [id]),
      this.repo.requirements(id),
      this.stores.reservationsFor(card.operatorId, id)
    ]);
    return {
      card: taskCardDto(card, { crsDocumentId, attachments, requirements, reservations }),
      certification: check,
      permissions: { signStep: allowed.sign_step, issueCrs: allowed.issue_crs },
      audit: await this.auditQuery.forEntity(p.operatorId, 'task_card', id)
    };
  }

  private async assertPredecessorsComplete(card: TaskCard) {
    if (card.source.type !== 'WP') return;
    const req = await this.repo.requirements(card.id);
    const predecessors = req.predecessors ?? [];
    if (!predecessors.length) return;
    const [wpId] = card.source.id.split('/');
    const pending = await this.repo.uncertifiedPredecessors(card.operatorId, wpId, predecessors);
    if (pending.length) throw new DomainError('WP_PREDECESSOR_OPEN', `Complete predecessor item(s) first: ${pending.join(', ')}`, 409);
  }

  private async assertExecutionEvidenceReady(card: TaskCard) {
    const r = await this.db.db.execute<{ record_type: string; result: string | null; inspected_by: string | null }>(sql`
      select record_type, result, inspected_by from amo.task_execution_records
      where operator_id=${card.operatorId} and task_card_id=${card.id}
      order by recorded_at
    `);
    const bad = r.rows.filter(x => x.result === 'FAIL' || x.result === 'REJECTED');
    if (bad.length) throw new DomainError('EXECUTION_EVIDENCE_REJECTED', `${bad.length} execution record(s) are failed/rejected`, 422);
    const reworkOpen = r.rows.filter(x => x.record_type === 'REWORK' && !x.inspected_by);
    if (reworkOpen.length) throw new DomainError('REWORK_INSPECTION_OPEN', 'Rework requires independent inspection before CRS', 422);
    const interruptions = r.rows.filter(x => x.record_type === 'INTERRUPTION').length;
    const resumes = r.rows.filter(x => x.record_type === 'RESUME').length;
    if (interruptions > resumes) throw new DomainError('TASK_INTERRUPTED', 'Task card has an unresolved interruption', 422);
  }

  /** What a stamp's passkey confirmation is bound to: this card, at this version, this step, these tools. */
  private stampContext(id: string, version: number, n: number, toolIds: string[]) {
    return { taskCardId: id, version, step: n, tools: [...toolIds].sort() };
  }

  async stampChallenge(p: Principal, id: string, n: number, toolIds: string[]): Promise<PasskeyAssertionOptionsDto> {
    const card = await this.repo.get(id);
    await this.assertPredecessorsComplete(card);
    const { signer, ...check } = await this.check(p, card);
    await this.authz.check(p, this.resource(card, check.allowed), 'sign_step');
    if (!signer) throw new DomainError('NO_PERSONNEL_RECORD', check.reason ?? 'No personnel record');
    const step = card.steps.find(s => s.n === n);
    if (!step) throw new DomainError('STEP_NOT_FOUND', `${id} has no step ${n}`, 404);
    return this.passkeys.assertionOptions(p, 'stamp', this.stampContext(id, card.version, n, toolIds),
      `Stamp step ${n} of ${id} (${card.tail}): ${step.text.slice(0, 120)}${toolIds.length ? ` · tools ${toolIds.join(', ')}` : ''}`);
  }

  async signStep(p: Principal, id: string, n: number, toolIds: string[] = [], passkey?: { challengeId: string; assertion: PasskeyAssertionDto }): Promise<TaskCardDto> {
    const current = await this.repo.get(id);
    await this.assertPredecessorsComplete(current);
    const { signer, ...check } = await this.check(p, current);
    await this.authz.check(p, this.resource(current, check.allowed), 'sign_step');
    if (!signer) throw new DomainError('NO_PERSONNEL_RECORD', check.reason ?? 'No personnel record');
    const confirmation = await this.passkeys.requireConfirmation(p, 'stamp', this.stampContext(id, current.version, n, toolIds), passkey);
    const actor = actorOf(p);
    return this.db.transaction(async () => {
      const card = await this.repo.get(id, { lock: true });
      if (confirmation && card.version !== current.version) throw new DomainError('CARD_CHANGED', `${id} changed while you were confirming; stamp again`, 409);
      const usedTools = await this.stores.toolsForSigning(card.operatorId, toolIds);
      const { card: next, event } = await signStep(this.compliance.engine, card, n, signer, new Date(), (payload, at) => this.keys.sign(payload, at), usedTools);
      const stamp = next.steps.find(s => s.n === n)!.stamp!;
      await this.repo.update(next, card.version);
      await this.audit.record(this.db, CHAIN, { operatorId: card.operatorId,
        actor, action: 'taskcard.step_signed', entityType: 'task_card', entityId: id, rule: stamp.rule,
        data: { step: n, text: next.steps[n - 1].text, personnelId: signer.personnelId, licence: signer.licenceNo, via: stamp.via, tools: stamp.tools ?? [], signature: stamp.signature, confirmation: confirmation ? { method: 'passkey', ...confirmation } : { method: 'session' } }
      });
      await this.outbox.add(this.db, event, { operatorId: card.operatorId, actor });
      return taskCardDto(next);
    });
  }

  /**
   * Step-up: releasing an aircraft is the most consequential signature in the system, so the
   * signer must have actually authenticated within the last few minutes (OIDC auth_time), not just
   * hold a still-valid session. The web app answers STEP_UP_REQUIRED with a forced re-login.
   */
  private requireRecentAuthentication(p: Principal) {
    const max = this.config.STEP_UP_MAX_AGE_SECONDS;
    if (max === 0) return;
    const age = p.authTime === null ? Infinity : Date.now() / 1000 - p.authTime;
    if (age > max) {
      throw new DomainError('STEP_UP_REQUIRED', `Confirm your identity to issue a CRS (sign in again; last sign-in ${Number.isFinite(age) ? `${Math.round(age / 60)} min` : 'unknown'} ago, limit ${Math.round(max / 60)} min)`, 422);
    }
  }

  /**
   * Passkey confirmation of a CRS: a single-use challenge bound to this card at this version. The signer's
   * eligibility is checked first, so nobody is asked to touch their key for a CRS they cannot issue.
   */
  async crsChallenge(p: Principal, id: string): Promise<PasskeyAssertionOptionsDto> {
    const card = await this.repo.get(id);
    await this.assertPredecessorsComplete(card);
    await this.assertExecutionEvidenceReady(card);
    const { signer, ...check } = await this.check(p, card);
    await this.authz.check(p, this.resource(card, check.allowed), 'issue_crs');
    if (!signer) throw new DomainError('NO_PERSONNEL_RECORD', check.reason ?? 'No personnel record');
    return this.passkeys.assertionOptions(p, 'crs', { taskCardId: id, version: card.version },
      `Certificate of release to service for ${card.tail} — ${card.title} (${id}), as ${signer.licenceNo ?? p.username}`);
  }

  async issueCrs(p: Principal, id: string, passkey?: { challengeId: string; assertion: PasskeyAssertionDto }): Promise<TaskCardDto> {
    const current = await this.repo.get(id);
    await this.assertPredecessorsComplete(current);
    await this.assertExecutionEvidenceReady(current);
    const { signer, ...check } = await this.check(p, current);
    await this.authz.check(p, this.resource(current, check.allowed), 'issue_crs');
    if (!signer) throw new DomainError('NO_PERSONNEL_RECORD', check.reason ?? 'No personnel record');
    // Step-up: a passkey confirmation of this exact card version, or (fallback) a fresh password sign-in.
    // Once a signer has a passkey, it is the only way: otherwise enrolling one would add no assurance.
    if (!passkey && (await this.passkeys.hasPasskey(p))) {
      throw new DomainError('PASSKEY_REQUIRED', 'You have a passkey: confirm this CRS with it (lost it? revoke it under Passkeys, then sign in again)', 422);
    }
    const evidence = passkey
      ? await this.passkeys.confirm(p, passkey.challengeId, 'crs', { taskCardId: id, version: current.version }, passkey.assertion)
      : (this.requireRecentAuthentication(p), null);
    const confirmation = evidence ? { method: 'passkey', ...evidence } : { method: 'password-reauthentication', authTime: p.authTime };
    const actor = actorOf(p);
    return this.db.transaction(async () => {
      const card = await this.repo.get(id, { lock: true });
      if (card.version !== current.version) throw new DomainError('CARD_CHANGED', `${id} changed while you were confirming; review it and confirm again`, 409);
      const crsNumber = `CRS-${await this.repo.next('crs_seq')}`;
      const { card: next, event } = await issueCrs(this.compliance.engine, card, signer, new Date(), crsNumber, (payload, at) => this.keys.sign(payload, at));
      await this.repo.update(next, card.version);
      const issued = await this.stores.issueFor(card.operatorId, card.id);
      await this.audit.record(this.db, CHAIN, { operatorId: card.operatorId,
        actor, action: 'crs.issued', entityType: 'task_card', entityId: id, rule: next.crs!.rule,
        data: { crsNumber, tail: card.tail, personnelId: signer.personnelId, licence: signer.licenceNo, via: next.crs!.via, signature: next.crs!.signature, source: card.source, partsIssued: issued, confirmation }
      });
      await this.outbox.add(this.db, event, { operatorId: card.operatorId, actor });
      await this.notifications.raise(this.db, {
        operatorId: card.operatorId, actor, severity: 'green', link: link(id),
        title: `${crsNumber} issued — ${card.tail}`, body: `${card.title} certified by ${signer.name} (${next.crs!.via}).`
      });
      return taskCardDto(next);
    });
  }
}

/* ---------------------------------------------------------------- CRS document */

@Injectable()
export class CrsDocumentService {
  constructor(
    @Inject(DB_TOKEN.amo) private readonly db: ModuleDb,
    private readonly repo: TaskCardRepository,
    private readonly compliance: ComplianceService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
    @Inject(KEY_SERVICE) private readonly keys: KeyService
  ) {}

  /**
   * Reaction to amo.crs.issued: render the CRS PDF, store it (idempotent per card), then link it
   * and record its hash in the AMO chain. Safe to redeliver at any point.
   */
  async attach(env: EventEnvelope<'amo.crs.issued'>) {
    const card = await this.repo.get(env.data.taskCardId);
    if (!card.crs) return;
    const bytes = await renderCrsPdf({
      operatorName: this.compliance.engine.profile(card.operatorId).name,
      card,
      publicKeyFingerprint: sha256Hex(await this.keys.publicKeyPem())
    });
    const doc = await this.documents.storeGenerated({
      operatorId: card.operatorId, ownerType: 'crs', ownerId: card.id, fileName: `${card.crs.number}-${card.tail}.pdf`,
      contentType: 'application/pdf', bytes, actor: 'system:amo'
    });
    await this.inbox.once(this.db, 'amo.crs-pdf', env, async () => {
      if (!(await this.repo.setCrsDocument(card.id, doc.id))) return;
      await this.audit.record(this.db, CHAIN, { operatorId: card.operatorId,
        actor: 'system:amo', action: 'crs.document_stored', entityType: 'task_card', entityId: card.id,
        data: { crsNumber: card.crs!.number, documentId: doc.id, sha256: doc.sha256, sizeBytes: doc.sizeBytes, eventId: env.id }
      });
    });
  }
}

/* ---------------------------------------------------------------- HTTP + events */

const signSchema = z.object({
  toolIds: z.array(z.string().min(1).max(40)).max(10).default([]),
  passkey: z.object({ challengeId: z.string().uuid(), assertion: assertionSchema }).optional()
});
const stampChallengeSchema = z.object({ toolIds: z.array(z.string().min(1).max(40)).max(10).default([]) });
const crsSchema = z.object({ passkey: z.object({ challengeId: z.string().uuid(), assertion: assertionSchema }).optional() }).optional().default({});
const receiveSchema = z.object({ partNo: z.string().min(1).max(40), location: z.string().length(4), qty: z.number().int().positive().max(100000), reference: z.string().trim().min(3).max(80) });

@Controller('amo')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Get('tools')
  tools(@CurrentPrincipal() p: Principal) {
    return this.stores.tools(p);
  }

  @Get('stores')
  stock(@CurrentPrincipal() p: Principal) {
    return this.stores.stock(p);
  }

  @Post('stores/receive')
  receive(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(receiveSchema)) body: z.infer<typeof receiveSchema>) {
    return this.stores.receive(p, body);
  }

  /** Hangar plan: work-package slots (projection of CAMO events). Default: today and the next 6 days. */
  @Get('hangar')
  async hangar(@CurrentPrincipal() p: Principal, @Query('from') from?: string, @Query('to') to?: string) {
    const f = from ? new Date(from) : new Date(Date.now() - 86_400_000);
    const t = to ? new Date(to) : new Date(Date.now() + 7 * 86_400_000);
    return (await this.stores.hangar(p, f, t)).map(s => ({ ...s, plannedStart: s.plannedStart?.toISOString() ?? null, plannedEnd: s.plannedEnd?.toISOString() ?? null, updatedAt: s.updatedAt.toISOString() }));
  }
}

@Controller('amo/task-cards')
export class TaskCardController {
  constructor(private readonly cards: TaskCardService) {}

  @Get()
  list(@CurrentPrincipal() p: Principal) {
    return this.cards.list(p);
  }

  @Get(':id')
  get(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.cards.get(p, id);
  }

  @Post(':id/steps/:n/sign/challenge')
  signChallenge(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Param('n', ParseIntPipe) n: number, @Body(new ZodPipe(stampChallengeSchema)) body: z.infer<typeof stampChallengeSchema>) {
    return this.cards.stampChallenge(p, id, n, body.toolIds);
  }

  @Post(':id/steps/:n/sign')
  sign(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Param('n', ParseIntPipe) n: number, @Body(new ZodPipe(signSchema)) body: z.infer<typeof signSchema>) {
    return this.cards.signStep(p, id, n, body.toolIds, body.passkey);
  }

  /** Start a passkey confirmation for this CRS (returns WebAuthn request options). */
  @Post(':id/crs/challenge')
  crsChallenge(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.cards.crsChallenge(p, id);
  }

  /** Issue the CRS: with { passkey: { challengeId, assertion } }, or without a body after a fresh sign-in. */
  @Post(':id/crs')
  crs(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(crsSchema)) body: z.infer<typeof crsSchema>) {
    return this.cards.issueCrs(p, id, body?.passkey);
  }
}

@Injectable()
export class AmoConsumers implements OnApplicationBootstrap {
  private readonly log = new Logger('AmoConsumers');

  constructor(private readonly kafka: KafkaService, private readonly cards: TaskCardService, private readonly crsDocs: CrsDocumentService, private readonly stores: StoresService,
    private readonly supply: SupplyService, private readonly production: ProductionControlService) {}

  onApplicationBootstrap() {
    this.kafka.start('amo.flight-hours', [TOPICS.ops], async env => {
      if (env.type === 'ops.flight.arrived') await this.supply.onFlightArrived(env as EventEnvelope<'ops.flight.arrived'>);
    });
    this.kafka.start('amo.taskcards', [TOPICS.camo], async env => {
      if (env.type === 'camo.eo.released') await this.cards.createFromEngineeringOrder(env as EventEnvelope<'camo.eo.released'>);
      if (env.type === 'camo.wp.released') { await this.cards.createFromWorkPackage(env as EventEnvelope<'camo.wp.released'>); await this.production.onWorkPackageReleased(env as EventEnvelope<'camo.wp.released'>); }
      if (env.type === 'camo.wp.completed') await this.production.onWorkPackageCompleted(env as EventEnvelope<'camo.wp.completed'>);
    });
    this.kafka.start('amo.hangar', [TOPICS.camo], async env => {
      if (env.type.startsWith('camo.wp.')) await this.stores.onWpEvent(env);
    });
    this.kafka.start('amo.crs-pdf', [TOPICS.amo], async env => {
      if (env.type === 'amo.crs.issued') await this.crsDocs.attach(env as EventEnvelope<'amo.crs.issued'>);
    });
    this.log.log('consumers started');
  }
}

@Module({
  imports: [ComplianceModule, OrgModule],
  providers: [TaskCardRepository, TaskCardService, CrsDocumentService, StoresService, NonconformityService, SupplyService, SupplyLogisticsService, BillingService, FieldWorkService, ProductionControlService, WarehouseControlService, MaintenanceControlService, SupplyControlService, AmoStockLotMigration, AmoConsumers, AmoSearch],
  controllers: [TaskCardController, FieldWorkController, StoresController, NonconformityController, SupplyController, SupplyLogisticsController, BillingController, ProductionControlController, WarehouseControlController, MaintenanceControlController, SupplyControlController],
  exports: [BillingService]
})
export class AmoModule {}

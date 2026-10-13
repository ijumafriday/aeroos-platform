import { Inject, Injectable } from '@nestjs/common';
import type {
  CurrencyDto, EventEnvelope, PersonnelDetailDto, PersonnelSummaryDto, TrainingCourse
} from '@aeroos/contracts';
import { addMonths } from '@aeroos/compliance';
import { DomainError } from '@aeroos/kernel';
import {
  currencyFacts, expireAuthorisation, governingAuthorisation, issueAuthorisation, lastContinuationTraining, nextExpiry, reachedLevel,
  reinstateAuthorisation, revokeAuthorisation, suspendAuthorisation, type Authorisation
} from '@aeroos/org-domain';
import { actorOf, type Principal } from '../../platform/auth/principal';
import { AuditQuery, AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { InboxService, OutboxService } from '../../platform/events/outbox';
import { NotificationsService } from '../../platform/notifications/notifications.service';
import { DocumentsService } from '../../platform/storage/documents.service';
import { ComplianceService } from '../compliance/compliance.module';
import { authToDto, licenceDto, OrgRepository, privilegeOf, trainingDto, trainingOf, type PersonFile } from './org.repository';

const CHAIN = 'org';
const link = (personnelId: string) => `/org/personnel?person=${encodeURIComponent(personnelId)}`;
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Organization Core — people, licences, training, company authorisations.
 * Same shape as every regulated flow: Cerbos for "may this person act", the pure domain function
 * plus the rulepack for "what the regulation allows", then state + audit + outbox in one transaction.
 */
@Injectable()
export class OrgService {
  constructor(
    @Inject(DB_TOKEN.org) private readonly db: ModuleDb,
    private readonly repo: OrgRepository,
    private readonly compliance: ComplianceService,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly auditQuery: AuditQuery,
    private readonly outbox: OutboxService,
    private readonly inbox: InboxService,
    private readonly notifications: NotificationsService,
    private readonly documents: DocumentsService
  ) {}

  private resource(operatorId: string, id: string, username: string) {
    return { kind: 'personnel' as const, id, attr: { operatorId, username } };
  }

  /* ------------------------------------------------------------------ queries */

  async list(p: Principal): Promise<PersonnelSummaryDto[]> {
    await this.authz.check(p, this.resource(p.operatorId, '*', ''), 'list');
    const now = new Date();
    const people = await this.repo.people(p.operatorId);
    const { privs, auths, training, work } = await this.repo.summaries(people.map(x => x.id), now);
    return people.map(person => {
      const mine = auths.filter(a => a.personnelId === person.id);
      const gov = governingAuthorisation(mine);
      const myPrivs = privs.filter(x => x.personnelId === person.id);
      const myTraining = trainingOf(training.filter(t => t.personnelId === person.id));
      const lastCt = lastContinuationTraining(myTraining, now);
      const certifying = myPrivs.length > 0 || mine.length > 0;
      const current = certifying
        ? this.compliance.engine.currency(person.operatorId, currencyFacts(work.filter(w => w.personnelId === person.id).map(w => w.workAt), myTraining, now)).value.current
        : null;
      const next = nextExpiry([
        ...(gov && gov.status !== 'REVOKED' ? [{ what: `Authorisation ${gov.reference}`, at: gov.validUntil }] : []),
        ...myPrivs.map(x => ({ what: `Licence ${x.category}`, at: x.validUntil })),
        ...(lastCt ? [{ what: 'Continuation training', at: addMonths(lastCt, 24) }] : [])
      ], now);
      return {
        id: person.id,
        username: person.username,
        name: person.name,
        licenceNo: person.licenceNo,
        status: person.active ? 'ACTIVE' : 'INACTIVE',
        authorisation: gov ? { reference: gov.reference, status: gov.status, validUntil: gov.validUntil.toISOString() } : null,
        nextExpiry: next ? { what: next.what, at: next.at.toISOString() } : null,
        current
      } satisfies PersonnelSummaryDto;
    });
  }

  private currency(operatorId: string, f: PersonFile, at: Date): CurrencyDto | null {
    if (!f.privs.length && !f.auths.length) return null; // not certifying staff
    const facts = currencyFacts(f.workDates, trainingOf(f.training), at);
    const d = this.compliance.engine.currency(operatorId, facts);
    return {
      current: d.value.current,
      reason: d.value.current ? null : d.value.reason,
      trainingDue: d.value.current ? d.value.trainingDue.toISOString() : null,
      experienceMonthsLast24: facts.experienceMonthsLast24,
      rule: d.rule,
      basis: d.basis
    };
  }

  async detail(p: Principal, id: string): Promise<PersonnelDetailDto & { audit: Awaited<ReturnType<AuditQuery['forEntity']>> }> {
    const person = await this.repo.requirePerson(id, p.operatorId);
    const allowed = await this.authz.decide(p, this.resource(person.operatorId, id, person.username), ['read', 'manage']);
    if (!allowed.read) throw new DomainError('PERSON_NOT_FOUND', `Personnel record ${id} not found`, 404);
    const now = new Date();
    const f = await this.repo.file(person, now);
    const docs = await this.documents.latestFor(person.operatorId, [
      ...f.privs.map(x => ({ type: 'licence', id: String(x.id) })),
      ...f.training.map(t => ({ type: 'training_record', id: t.id }))
    ]);
    const gov = governingAuthorisation(f.auths);
    const currency = this.currency(person.operatorId, f, now);
    const lastCt = lastContinuationTraining(trainingOf(f.training), now);
    const next = nextExpiry([
      ...(gov && gov.status !== 'REVOKED' ? [{ what: `Authorisation ${gov.reference}`, at: gov.validUntil }] : []),
      ...f.privs.map(x => ({ what: `Licence ${x.category}`, at: x.validUntil })),
      ...(lastCt ? [{ what: 'Continuation training', at: addMonths(lastCt, 24) }] : [])
    ], now);
    return {
      id: person.id,
      username: person.username,
      name: person.name,
      licenceNo: person.licenceNo,
      status: person.active ? 'ACTIVE' : 'INACTIVE',
      nextExpiry: next ? { what: next.what, at: next.at.toISOString() } : null,
      current: currency?.current ?? null,
      licences: f.privs.map(x => licenceDto(x, docs.get(`licence:${x.id}`)?.id ?? null)),
      training: f.training.map(t => trainingDto(t, docs.get(`training_record:${t.id}`)?.id ?? null)),
      authorisations: f.auths.map(authToDto),
      currency,
      permissions: { manage: allowed.manage },
      audit: await this.auditQuery.forEntity(p.operatorId, 'personnel', id)
    };
  }

  /* ------------------------------------------------------------------ authorisations */

  async issue(p: Principal, personnelId: string, body: { reference: string; aircraftTypes: string[]; validUntil: string }) {
    const person = await this.repo.requirePerson(personnelId, p.operatorId);
    await this.authz.check(p, this.resource(person.operatorId, personnelId, person.username), 'manage');
    const actor = actorOf(p);
    return this.db.transaction(async () => {
      const at = new Date();
      const f = await this.repo.file(person, at);
      const id = `AUT-${await this.repo.next('authorisation_seq')}`;
      const { authorisation, event } = issueAuthorisation(this.compliance.engine, {
        id, operatorId: person.operatorId, personnelId, reference: body.reference, aircraftTypes: body.aircraftTypes,
        validUntil: new Date(body.validUntil), issuedBy: actor, at, privileges: f.privs.map(privilegeOf),
        existing: f.auths.map(a => ({ reference: a.reference, status: a.status }))
      });
      await this.repo.insertAuthorisation(authorisation);
      await this.audit.record(this.db, CHAIN, { operatorId: person.operatorId,
        actor, action: 'authorisation.issued', entityType: 'personnel', entityId: personnelId, rule: authorisation.issueRule,
        data: { authorisationId: id, reference: authorisation.reference, aircraftTypes: authorisation.aircraftTypes, validUntil: authorisation.validUntil.toISOString() }
      });
      await this.outbox.add(this.db, event, { operatorId: person.operatorId, actor });
      await this.notifications.raise(this.db, {
        operatorId: person.operatorId, actor, severity: 'green', link: link(personnelId),
        title: `Authorisation ${authorisation.reference} issued`, body: `${person.name} · ${authorisation.aircraftTypes.join(', ')} · valid to ${day(authorisation.validUntil)}`
      });
      return authToDto(authorisation);
    });
  }

  async changeStatus(p: Principal, authorisationId: string, action: 'suspend' | 'reinstate' | 'revoke', reason: string) {
    const current = await this.repo.authorisation(authorisationId);
    const person = await this.repo.requirePerson(current.personnelId, p.operatorId);
    await this.authz.check(p, this.resource(person.operatorId, person.id, person.username), 'manage');
    const actor = actorOf(p);
    return this.db.transaction(async () => {
      const a = await this.repo.authorisation(authorisationId, { lock: true });
      const at = new Date();
      const r = action === 'suspend' ? suspendAuthorisation(a, actor, reason, at)
        : action === 'reinstate' ? reinstateAuthorisation(a, actor, reason, at)
          : revokeAuthorisation(a, actor, reason, at);
      await this.repo.updateAuthorisation(r.authorisation, a.version);
      await this.audit.record(this.db, CHAIN, { operatorId: person.operatorId,
        actor, action: `authorisation.${r.authorisation.status.toLowerCase()}`, entityType: 'personnel', entityId: person.id,
        data: { authorisationId, reference: a.reference, from: a.status, to: r.authorisation.status, reason: reason.trim() }
      });
      await this.outbox.add(this.db, r.event, { operatorId: person.operatorId, actor });
      await this.notifications.raise(this.db, {
        operatorId: person.operatorId, actor, severity: action === 'reinstate' ? 'green' : 'red', link: link(person.id),
        title: `Authorisation ${a.reference} ${r.authorisation.status.toLowerCase()}`,
        body: `${person.name}${action === 'reinstate' ? '' : ' may not certify'} · ${reason.trim()}`
      });
      return authToDto(r.authorisation);
    });
  }

  /* ------------------------------------------------------------------ training */

  async recordTraining(p: Principal, personnelId: string, body: { course: TrainingCourse; title: string; completedAt: string }) {
    const person = await this.repo.requirePerson(personnelId, p.operatorId);
    await this.authz.check(p, this.resource(person.operatorId, personnelId, person.username), 'manage');
    const completedAt = new Date(body.completedAt);
    if (completedAt.getTime() > Date.now()) throw new DomainError('FUTURE_DATE', 'Training cannot be recorded before it is completed');
    const actor = actorOf(p);
    return this.db.transaction(async () => {
      const id = `TR-${await this.repo.next('training_seq')}`;
      const t = { id, personnelId, course: body.course, title: body.title.trim(), completedAt, recordedBy: actor };
      await this.repo.insertTraining(t);
      await this.audit.record(this.db, CHAIN, { operatorId: person.operatorId,
        actor, action: 'training.recorded', entityType: 'personnel', entityId: personnelId,
        data: { trainingId: id, course: t.course, title: t.title, completedAt: completedAt.toISOString() }
      });
      await this.outbox.add(this.db, { type: 'org.training.recorded', data: { personnelId, course: t.course, completedAt: completedAt.toISOString() } },
        { operatorId: person.operatorId, actor });
      return trainingDto({ ...t, recordedAt: new Date() }, null);
    });
  }

  /* ------------------------------------------------------------------ reactions */

  /** Each signed task-card step is evidence of maintenance experience for 145.A.35(c). */
  async experienceFromStep(env: EventEnvelope<'amo.taskcard.step_signed'>) {
    await this.inbox.once(this.db, 'org.experience', env, async () => {
      const person = await this.repo.person(env.data.personnelId);
      if (!person) return;
      await this.repo.recordExperience({
        personnelId: person.id, workAt: new Date(env.occurredAt), sourceType: 'task_card_step',
        sourceId: `${env.data.taskCardId}#${env.data.step}`, detail: `${env.data.taskCardId} step ${env.data.step} · ${env.data.tail}`
      });
    });
  }

  /**
   * Hourly sweep (Temporal schedule): expire authorisations past their date and send the
   * T-90 / T-30 / T-7 / EXPIRED warnings for authorisations, licences and continuation training —
   * each warning exactly once per validity date. Returns counts for the workflow history.
   */
  async sweep(now = new Date()) {
    const counts = { expired: 0, warnings: 0 };
    for (const a of await this.repo.liveAuthorisations()) {
      if (await this.expireOne(a, now)) counts.expired++;
      else if (await this.warn('AUTHORISATION', a.id, a.personnelId, a.operatorId, `Authorisation ${a.reference}`, a.validUntil, now)) counts.warnings++;
    }
    for (const { p, person } of await this.repo.allPrivileges()) {
      if (await this.warn('LICENCE', String(p.id), person.id, person.operatorId, `${person.name}'s Part-66 ${p.category} licence`, p.validUntil, now)) counts.warnings++;
    }
    const byPerson = new Map<string, { operatorId: string; name: string; last: Date }>();
    for (const { t, person } of await this.repo.allTraining()) {
      if (t.course !== 'CONTINUATION' && t.course !== 'HUMAN_FACTORS') continue;
      const prev = byPerson.get(person.id);
      if (!prev || prev.last < t.completedAt) byPerson.set(person.id, { operatorId: person.operatorId, name: person.name, last: t.completedAt });
    }
    for (const [pid, v] of byPerson) {
      if (await this.warn('TRAINING', pid, pid, v.operatorId, `${v.name}'s continuation training`, addMonths(v.last, 24), now)) counts.warnings++;
    }
    return counts;
  }

  private async expireOne(current: Authorisation, now: Date): Promise<boolean> {
    if (current.validUntil.getTime() > now.getTime()) return false;
    return this.db.transaction(async () => {
      const a = await this.repo.authorisation(current.id, { lock: true });
      const r = expireAuthorisation(a, now);
      if (!r) return false;
      await this.repo.updateAuthorisation(r.authorisation, a.version);
      await this.audit.record(this.db, CHAIN, { operatorId: a.operatorId,
        actor: 'system:org-sweep', action: 'authorisation.expired', entityType: 'personnel', entityId: a.personnelId,
        data: { authorisationId: a.id, reference: a.reference, validUntil: a.validUntil.toISOString() }
      });
      await this.outbox.add(this.db, r.event, { operatorId: a.operatorId, actor: 'system:org-sweep' });
      await this.repo.claimNotice('AUTHORISATION', a.id, 'EXPIRED', a.validUntil);
      await this.notifications.raise(this.db, {
        operatorId: a.operatorId, actor: 'system:org-sweep', severity: 'red', link: link(a.personnelId),
        title: `Authorisation ${a.reference} expired`, body: 'The holder can no longer certify until a new authorisation is issued.'
      });
      return true;
    });
  }

  private async warn(subject: 'AUTHORISATION' | 'LICENCE' | 'TRAINING', subjectId: string, personnelId: string, operatorId: string, what: string, validUntil: Date, now: Date) {
    const level = reachedLevel(validUntil.getTime(), now.getTime());
    if (!level) return false;
    return this.db.transaction(async () => {
      if (!(await this.repo.claimNotice(subject, subjectId, level.level, validUntil))) return false;
      const actor = 'system:org-sweep';
      await this.outbox.add(this.db, {
        type: 'org.expiry.warning',
        data: { subject, subjectId, personnelId, level: level.level, expiresAt: validUntil.toISOString() }
      }, { operatorId, actor });
      await this.notifications.raise(this.db, {
        operatorId, actor, severity: level.severity, link: link(personnelId),
        title: level.level === 'EXPIRED' ? `${what} has expired` : `${what} expires in ${level.level.slice(2)} days or less`,
        body: `Valid until ${day(validUntil)}.`
      });
      return true;
    });
  }
}

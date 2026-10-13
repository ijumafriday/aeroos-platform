import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { CorrectiveActionDto, FindingDto, OccurrenceCategory, OccurrenceDto, QualityAuditDto } from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import {
  assessQualityRisk, closeFinding, closeOccurrence, completeAction, findingDue, morDeadline, morOverdue, qualityResponseWindowDays, risk, triage, verifyAction,
  type ActionStatus, type CorrectiveAction, type Finding, type FindingLevel, type Occurrence, type OccurrenceStatus, type Probability, type Severity
} from '@aeroos/org-domain';
import { actorOf, type Principal } from '../../platform/auth/principal';
import { AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { NotificationsService } from '../../platform/notifications/notifications.service';
import { correctiveActions, findings, occurrences, qualityAudits } from './org.tables';

const CHAIN = 'org';
const occLink = (id: string) => `/safety/reports?report=${encodeURIComponent(id)}`;
const auditLink = (id: string) => `/quality/audits?audit=${encodeURIComponent(id)}`;
const year = () => new Date().getUTCFullYear();
const pad = (n: string | number, w = 4) => String(n).padStart(w, '0');

type OccRow = typeof occurrences.$inferSelect;
type FindingRow = typeof findings.$inferSelect;
type ActionRow = typeof correctiveActions.$inferSelect;

const occDomain = (r: OccRow): Occurrence => ({
  id: r.id, status: r.status as OccurrenceStatus, reportedAt: r.reportedAt, mandatory: r.mandatory, authorityReportedAt: r.authorityReportedAt,
  probability: r.probability as Probability | null, severity: r.severity as Severity | null, investigator: r.investigator, findings: r.findings,
  residualProbability: r.residualProbability as Probability | null, residualSeverity: r.residualSeverity as Severity | null, version: r.version
});
const actionDomain = (r: ActionRow): CorrectiveAction => ({ id: r.id, owner: r.owner, status: r.status as ActionStatus, doneBy: r.doneBy, version: r.version });
const riskDto = (p: number | null, s: string | null) => (p && s ? { probability: p as Probability, severity: s as Severity, ...risk(p as Probability, s as Severity) } : null);
const today = () => new Date().toISOString().slice(0, 10);
const actionDto = (r: ActionRow): CorrectiveActionDto => ({
  id: r.id, sourceType: r.sourceType as CorrectiveActionDto['sourceType'], sourceId: r.sourceId, description: r.description, owner: r.owner, due: r.due,
  overdue: (r.status === 'OPEN' || r.status === 'DONE') && r.due < today(), status: r.status as ActionStatus, evidence: r.evidence, doneBy: r.doneBy,
  doneAt: r.doneAt?.toISOString() ?? null, verifiedBy: r.verifiedBy, verifiedAt: r.verifiedAt?.toISOString() ?? null, version: r.version
});

/**
 * Safety management (occurrence reports, risk, investigation) and the quality system (audits, findings) with
 * shared corrective actions (ADR-0020). Reporting is open to everyone and confidential on request (just culture):
 * a confidential reporter's name is visible only to the safety office and to themselves.
 */
@Injectable()
export class SafetyQualityService {
  constructor(
    @Inject(DB_TOKEN.org) private readonly db: ModuleDb,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService
  ) {}

  private occRes(operatorId: string, id = '*', reporter = '', investigator = '') {
    return { kind: 'occurrence' as const, id, attr: { operatorId, reporter, investigator } };
  }

  /** Investigators and action owners must be people of this operator (org.personnel). */
  private async requirePerson(username: string, operatorId: string) {
    const r = await this.db.db.execute<{ n: string }>(sql`select count(*)::text as n from org.personnel where username = ${username} and operator_id = ${operatorId} and active`);
    if (r.rows[0].n === '0') throw new DomainError('UNKNOWN_PERSON', `${username} is not on the personnel register of ${operatorId}`, 422);
  }
  private qaRes(operatorId: string, id = '*') {
    return { kind: 'quality_audit' as const, id, attr: { operatorId } };
  }
  private caRes(operatorId: string, sourceType: 'OCCURRENCE' | 'FINDING', id = '*', owner = '') {
    return { kind: sourceType === 'OCCURRENCE' ? 'safety_action' as const : 'quality_action' as const, id, attr: { operatorId, owner } };
  }

  private async actionsFor(type: 'OCCURRENCE' | 'FINDING', ids: string[]): Promise<ActionRow[]> {
    if (!ids.length) return [];
    return this.db.db.select().from(correctiveActions).where(and(eq(correctiveActions.sourceType, type), inArray(correctiveActions.sourceId, ids))).orderBy(asc(correctiveActions.id));
  }

  /* ------------------------------------------------------------------ occurrences */

  private occDto(r: OccRow, acts: ActionRow[], p: Principal, safetyOffice: boolean): OccurrenceDto {
    const showReporter = !r.confidential || safetyOffice || r.reportedBy === p.username;
    return {
      id: r.id, reportedAt: r.reportedAt.toISOString(), reportedBy: showReporter ? r.reportedBy : null, confidential: r.confidential,
      occurredAt: r.occurredAt.toISOString(), station: r.station, tail: r.tail, flightNo: r.flightNo, category: r.category as OccurrenceCategory,
      title: r.title, description: r.description, status: r.status as OccurrenceStatus, mandatory: r.mandatory,
      morDeadline: r.mandatory ? morDeadline(r).toISOString() : null, morOverdue: morOverdue(r, new Date()),
      authorityReportedAt: r.authorityReportedAt?.toISOString() ?? null, authorityRef: r.authorityRef,
      risk: riskDto(r.probability, r.severity), residualRisk: riskDto(r.residualProbability, r.residualSeverity),
      investigator: r.investigator, findings: r.findings, closedBy: r.closedBy, closedAt: r.closedAt?.toISOString() ?? null, version: r.version,
      actions: acts.filter(a => a.sourceId === r.id).map(actionDto), canManage: safetyOffice
    };
  }

  private async isSafetyOffice(p: Principal) {
    return (await this.authz.decide(p, this.occRes(p.operatorId), ['manage'])).manage;
  }

  async listOccurrences(p: Principal): Promise<OccurrenceDto[]> {
    const can = await this.authz.decide(p, this.occRes(p.operatorId), ['read', 'manage']);
    // Everyone sees their own reports; the safety office, auditors and accountable managers see all.
    const where = can.read ? eq(occurrences.operatorId, p.operatorId)
      : and(eq(occurrences.operatorId, p.operatorId), or(eq(occurrences.reportedBy, p.username), eq(occurrences.investigator, p.username)));
    const rows = await this.db.db.select().from(occurrences).where(where).orderBy(desc(occurrences.reportedAt)).limit(300);
    const acts = await this.actionsFor('OCCURRENCE', rows.map(r => r.id));
    return rows.map(r => this.occDto(r, acts, p, can.manage));
  }

  private async occ(id: string, lock = false): Promise<OccRow> {
    const q = this.db.db.select().from(occurrences).where(eq(occurrences.id, id));
    const [r] = lock ? await q.for('update') : await q;
    if (!r) throw new DomainError('NOT_FOUND', `No safety report ${id}`, 404);
    return r;
  }

  async getOccurrence(p: Principal, id: string): Promise<OccurrenceDto> {
    const r = await this.occ(id);
    await this.authz.check(p, this.occRes(r.operatorId, id, r.reportedBy, r.investigator ?? ''), 'read');
    return this.occDto(r, await this.actionsFor('OCCURRENCE', [id]), p, await this.isSafetyOffice(p));
  }

  async report(p: Principal, b: { occurredAt: string; station: string | null; tail: string | null; flightNo: string | null; category: OccurrenceCategory; title: string; description: string; confidential: boolean }): Promise<OccurrenceDto> {
    await this.authz.check(p, this.occRes(p.operatorId, '*', p.username), 'report');
    if (Date.parse(b.occurredAt) > Date.now() + 5 * 60_000) throw new DomainError('IN_FUTURE', 'The occurrence time is in the future', 422);
    const id = await this.db.transaction(async () => {
      const n = await this.db.db.execute<{ n: string }>(sql`select nextval('org.occurrence_seq')::text as n`);
      const id = `OR-${year()}-${pad(n.rows[0].n)}`;
      await this.db.db.insert(occurrences).values({
        id, operatorId: p.operatorId, reportedBy: p.username, confidential: b.confidential, occurredAt: new Date(b.occurredAt), station: b.station, tail: b.tail,
        flightNo: b.flightNo, category: b.category, title: b.title, description: b.description, status: 'REPORTED', mandatory: false, version: 1
      });
      // The audit trail records that a report was made, not by whom when it is confidential.
      await this.audit.record(this.db, CHAIN, {
        operatorId: p.operatorId, actor: b.confidential ? 'confidential-reporter' : actorOf(p), action: 'occurrence.reported', entityType: 'occurrence', entityId: id,
        data: { category: b.category, title: b.title, confidential: b.confidential }
      });
      // Notifications go to everyone in the operator: they say only that a report arrived, never what or by whom.
      await this.notifications.raise(this.db, {
        operatorId: p.operatorId, actor: 'system:safety', severity: 'amber', link: occLink(id),
        title: `New safety report ${id} awaiting triage`, body: 'Safety office: triage within 72 hours — it may be a mandatory occurrence report (EU 376/2014).'
      });
      return id;
    });
    return this.getOccurrence(p, id);
  }

  async triage(p: Principal, id: string, b: { mandatory: boolean; probability: Probability; severity: Severity; investigator: string | null; version: number }): Promise<OccurrenceDto> {
    const first = await this.occ(id);
    await this.authz.check(p, this.occRes(first.operatorId, id, first.reportedBy), 'manage');
    await this.db.transaction(async () => {
      const r = await this.occ(id, true);
      if (r.version !== b.version) throw new DomainError('CHANGED', `${id} was changed by someone else — reload`, 409);
      if (b.investigator) await this.requirePerson(b.investigator, r.operatorId);
      const next = triage(occDomain(r), b);
      await this.db.db.update(occurrences).set({ status: next.status, mandatory: next.mandatory, probability: next.probability, severity: next.severity, investigator: next.investigator,
        triagedBy: actorOf(p), triagedAt: new Date(), version: next.version }).where(eq(occurrences.id, id));
      await this.audit.record(this.db, CHAIN, {
        operatorId: r.operatorId, actor: actorOf(p), action: 'occurrence.triaged', entityType: 'occurrence', entityId: id,
        data: { mandatory: b.mandatory, risk: risk(b.probability, b.severity), investigator: b.investigator, status: next.status }
      });
    });
    return this.getOccurrence(p, id);
  }

  async recordMor(p: Principal, id: string, b: { authorityRef: string; reportedAt: string }): Promise<OccurrenceDto> {
    const first = await this.occ(id);
    await this.authz.check(p, this.occRes(first.operatorId, id, first.reportedBy), 'manage');
    await this.db.transaction(async () => {
      const r = await this.occ(id, true);
      if (!r.mandatory) throw new DomainError('NOT_MANDATORY', `${id} is not classified as a mandatory occurrence`, 422);
      if (r.authorityReportedAt) throw new DomainError('ALREADY_FILED', `${id} was reported to the authority as ${r.authorityRef}`, 409);
      await this.db.db.update(occurrences).set({ authorityReportedAt: new Date(b.reportedAt), authorityRef: b.authorityRef, version: r.version + 1 }).where(eq(occurrences.id, id));
      await this.audit.record(this.db, CHAIN, {
        operatorId: r.operatorId, actor: actorOf(p), action: 'occurrence.mor_filed', entityType: 'occurrence', entityId: id,
        data: { authorityRef: b.authorityRef, reportedAt: b.reportedAt, withinDeadline: Date.parse(b.reportedAt) <= morDeadline(r).getTime() }
      });
    });
    return this.getOccurrence(p, id);
  }

  async closeOccurrence(p: Principal, id: string, b: { residualProbability: Probability; residualSeverity: Severity; findings: string | null; version: number }): Promise<OccurrenceDto> {
    const first = await this.occ(id);
    await this.authz.check(p, this.occRes(first.operatorId, id, first.reportedBy), 'manage');
    await this.db.transaction(async () => {
      const r = await this.occ(id, true);
      if (r.version !== b.version) throw new DomainError('CHANGED', `${id} was changed by someone else — reload`, 409);
      const next = closeOccurrence(occDomain(r), b, (await this.actionsFor('OCCURRENCE', [id])).map(a => ({ status: a.status as ActionStatus })));
      await this.db.db.update(occurrences).set({ status: 'CLOSED', findings: next.findings, residualProbability: next.residualProbability, residualSeverity: next.residualSeverity,
        closedBy: actorOf(p), closedAt: new Date(), version: next.version }).where(eq(occurrences.id, id));
      await this.audit.record(this.db, CHAIN, {
        operatorId: r.operatorId, actor: actorOf(p), action: 'occurrence.closed', entityType: 'occurrence', entityId: id,
        data: { residualRisk: risk(b.residualProbability, b.residualSeverity), findings: next.findings }
      });
    });
    return this.getOccurrence(p, id);
  }

  /* ------------------------------------------------------------------ audits and findings */

  private findingDto(f: FindingRow, acts: ActionRow[]): FindingDto {
    return {
      id: f.id, auditId: f.auditId, level: f.level as FindingLevel, requirement: f.requirement, description: f.description,
      likelihood: f.likelihood, impact: f.impact, riskScore: f.riskScore, riskClass: f.riskClass as FindingDto['riskClass'],
      classificationBasis: f.classificationBasis, containmentAction: f.containmentAction, recurrence: f.recurrence,
      rootCause: f.rootCause, raisedBy: f.raisedBy, raisedAt: f.raisedAt.toISOString(), due: f.due.toISOString(), overdue: f.status === 'OPEN' && f.due.getTime() < Date.now(),
      status: f.status as FindingDto['status'], closedBy: f.closedBy, closedAt: f.closedAt?.toISOString() ?? null, version: f.version,
      actions: acts.filter(a => a.sourceId === f.id).map(actionDto)
    };
  }

  async listAudits(p: Principal): Promise<QualityAuditDto[]> {
    await this.authz.check(p, this.qaRes(p.operatorId), 'read');
    const audits = await this.db.db.select().from(qualityAudits).where(eq(qualityAudits.operatorId, p.operatorId)).orderBy(desc(qualityAudits.plannedFor));
    const fs = audits.length ? await this.db.db.select().from(findings).where(inArray(findings.auditId, audits.map(a => a.id))).orderBy(asc(findings.id)) : [];
    const acts = await this.actionsFor('FINDING', fs.map(f => f.id));
    return audits.map(a => ({
      id: a.id, title: a.title, area: a.area, reference: a.reference, plannedFor: a.plannedFor, leadAuditor: a.leadAuditor,
      status: a.status as QualityAuditDto['status'], closedAt: a.closedAt?.toISOString() ?? null,
      findings: fs.filter(f => f.auditId === a.id).map(f => this.findingDto(f, acts))
    }));
  }

  async planAudit(p: Principal, b: { title: string; area: string; reference: string; plannedFor: string }): Promise<QualityAuditDto[]> {
    await this.authz.check(p, this.qaRes(p.operatorId), 'manage');
    await this.db.transaction(async () => {
      const n = await this.db.db.execute<{ n: string }>(sql`select nextval('org.audit_seq')::text as n`);
      const id = `QA-${year()}-${pad(n.rows[0].n, 2)}`;
      await this.db.db.insert(qualityAudits).values({ id, operatorId: p.operatorId, ...b, leadAuditor: actorOf(p), status: 'PLANNED' });
      await this.audit.record(this.db, CHAIN, { operatorId: p.operatorId, actor: actorOf(p), action: 'quality_audit.planned', entityType: 'quality_audit', entityId: id, data: b });
    });
    return this.listAudits(p);
  }

  async raiseFinding(p: Principal, auditId: string, b: { level: FindingLevel; requirement: string; description: string; likelihood: number; impact: number; classificationBasis: string; containmentAction?: string | null; recurrence?: boolean }): Promise<QualityAuditDto[]> {
    const [a] = await this.db.db.select().from(qualityAudits).where(eq(qualityAudits.id, auditId));
    if (!a) throw new DomainError('NOT_FOUND', `No audit ${auditId}`, 404);
    await this.authz.check(p, this.qaRes(a.operatorId, auditId), 'manage');
    if (a.status === 'CLOSED') throw new DomainError('AUDIT_CLOSED', `${auditId} is closed`, 409);
    const assessed = assessQualityRisk(b.likelihood, b.impact);
    if ((assessed.classification === 'CRITICAL' || assessed.classification === 'HIGH') && (!b.containmentAction || b.containmentAction.trim().length < 10))
      throw new DomainError('CONTAINMENT_REQUIRED', 'High and critical findings require a documented containment action', 422);
    await this.db.transaction(async () => {
      const n = await this.db.db.execute<{ n: string }>(sql`select nextval('org.finding_seq')::text as n`);
      const id = `F-${pad(n.rows[0].n)}`;
      const now = new Date();
      const qaRisk = assessed;
      const levelDue = findingDue(b.level, now);
      const riskDue = new Date(now.getTime() + qualityResponseWindowDays(qaRisk.classification) * 86_400_000);
      const due = levelDue < riskDue ? levelDue : riskDue;
      await this.db.db.insert(findings).values({ id, auditId, operatorId: a.operatorId, level: b.level, requirement: b.requirement, description: b.description,
        likelihood: qaRisk.likelihood, impact: qaRisk.impact, riskScore: qaRisk.score, riskClass: qaRisk.classification,
        classificationBasis: b.classificationBasis.trim(), containmentAction: b.containmentAction?.trim() || null, recurrence: !!b.recurrence,
        raisedBy: actorOf(p), raisedAt: now, due, status: 'OPEN', version: 1 });
      if (a.status === 'PLANNED') await this.db.db.update(qualityAudits).set({ status: 'IN_PROGRESS' }).where(eq(qualityAudits.id, auditId));
      await this.audit.record(this.db, CHAIN, { operatorId: a.operatorId, actor: actorOf(p), action: 'finding.raised', entityType: 'finding', entityId: id,
        data: { auditId, level: b.level, requirement: b.requirement, likelihood: b.likelihood, impact: b.impact, riskClass: assessQualityRisk(b.likelihood, b.impact).classification, due: due.toISOString() } });
      await this.notifications.raise(this.db, {
        operatorId: a.operatorId, actor: 'system:quality', severity: assessQualityRisk(b.likelihood, b.impact).classification === 'CRITICAL' || b.level === 'LEVEL_1' ? 'red' : 'amber', link: auditLink(auditId),
        title: `${b.level.replace('_', ' ').toLowerCase()} finding ${id} (${b.requirement})`, body: `${b.description.slice(0, 140)} — corrective action due ${due.toISOString().slice(0, 10)}`
      });
    });
    return this.listAudits(p);
  }

  async listFindings(p: Principal): Promise<FindingDto[]> {
    await this.authz.check(p, this.qaRes(p.operatorId), 'read');
    const fs = await this.db.db.select().from(findings).where(eq(findings.operatorId, p.operatorId)).orderBy(desc(findings.raisedAt));
    const acts = await this.actionsFor('FINDING', fs.map(f => f.id));
    return fs.map(f => this.findingDto(f, acts));
  }

  async classifyFinding(p: Principal, findingId: string, b: { likelihood: number; impact: number; classificationBasis: string; containmentAction?: string | null; recurrence?: boolean }): Promise<FindingDto[]> {
    const [f] = await this.db.db.select().from(findings).where(and(eq(findings.id, findingId), eq(findings.operatorId, p.operatorId)));
    if (!f) throw new DomainError('NOT_FOUND', `No finding ${findingId}`, 404);
    await this.authz.check(p, this.qaRes(f.operatorId, f.auditId), 'manage');
    if (f.status === 'CLOSED') throw new DomainError('FINDING_CLOSED', `${findingId} is closed`, 409);
    const qaRisk = assessQualityRisk(b.likelihood, b.impact);
    if ((qaRisk.classification === 'CRITICAL' || qaRisk.classification === 'HIGH') && (!b.containmentAction || b.containmentAction.trim().length < 10))
      throw new DomainError('CONTAINMENT_REQUIRED', 'High and critical findings require a documented containment action', 422);
    const riskDue = new Date(Date.now() + qualityResponseWindowDays(qaRisk.classification) * 86_400_000);
    const due = f.due < riskDue ? f.due : riskDue;
    await this.db.db.update(findings).set({ likelihood: qaRisk.likelihood, impact: qaRisk.impact, riskScore: qaRisk.score, riskClass: qaRisk.classification,
      classificationBasis: b.classificationBasis.trim(), containmentAction: b.containmentAction?.trim() || null, recurrence: !!b.recurrence, due, version: f.version + 1 }).where(eq(findings.id, findingId));
    await this.audit.record(this.db, CHAIN, { operatorId: f.operatorId, actor: actorOf(p), action: 'finding.risk_classified', entityType: 'finding', entityId: findingId,
      data: { likelihood: qaRisk.likelihood, impact: qaRisk.impact, score: qaRisk.score, riskClass: qaRisk.classification, recurrence: !!b.recurrence } });
    return this.listFindings(p);
  }

  async setRootCause(p: Principal, findingId: string, rootCause: string): Promise<QualityAuditDto[]> {
    const [f] = await this.db.db.select().from(findings).where(eq(findings.id, findingId));
    if (!f) throw new DomainError('NOT_FOUND', `No finding ${findingId}`, 404);
    await this.authz.check(p, this.qaRes(f.operatorId, f.auditId), 'manage');
    if (f.status === 'CLOSED') throw new DomainError('FINDING_CLOSED', `${findingId} is closed`, 409);
    await this.db.transaction(async () => {
      const done = await this.db.db.update(findings).set({ rootCause, version: f.version + 1 })
        .where(and(eq(findings.id, findingId), eq(findings.version, f.version), eq(findings.status, 'OPEN'))).returning({ id: findings.id });
      if (!done.length) throw new DomainError('CHANGED', `${findingId} was changed by someone else — reload`, 409);
      await this.audit.record(this.db, CHAIN, { operatorId: f.operatorId, actor: actorOf(p), action: 'finding.root_cause', entityType: 'finding', entityId: findingId, data: { rootCause } });
    });
    return this.listAudits(p);
  }

  async closeFinding(p: Principal, findingId: string): Promise<QualityAuditDto[]> {
    const [first] = await this.db.db.select().from(findings).where(eq(findings.id, findingId));
    if (!first) throw new DomainError('NOT_FOUND', `No finding ${findingId}`, 404);
    await this.authz.check(p, this.qaRes(first.operatorId, first.auditId), 'manage');
    await this.db.transaction(async () => {
      const [f] = await this.db.db.select().from(findings).where(eq(findings.id, findingId)).for('update');
      const acts = await this.actionsFor('FINDING', [findingId]);
      if (f.level !== 'OBSERVATION' && !f.riskClass) throw new DomainError('QUALITY_RISK_CLASSIFICATION_REQUIRED', 'Classify the finding risk before closure', 422);
      if ((f.riskClass === 'CRITICAL' || f.riskClass === 'HIGH') && (!f.containmentAction || f.containmentAction.trim().length < 10)) throw new DomainError('CONTAINMENT_REQUIRED', 'High and critical findings require documented containment before closure', 422);
      const next: Finding = closeFinding({ id: f.id, level: f.level as FindingLevel, status: f.status as Finding['status'], raisedBy: f.raisedBy, rootCause: f.rootCause, version: f.version },
        acts.map(a => ({ status: a.status as ActionStatus })), actorOf(p));
      await this.db.db.update(findings).set({ status: next.status, closedBy: actorOf(p), closedAt: new Date(), version: next.version }).where(eq(findings.id, findingId));
      await this.audit.record(this.db, CHAIN, { operatorId: f.operatorId, actor: actorOf(p), action: 'finding.closed', entityType: 'finding', entityId: findingId,
        data: { level: f.level, actions: acts.map(a => a.id), onTime: Date.now() <= f.due.getTime() } });
      // An audit closes when its last finding does.
      const open = await this.db.db.select({ id: findings.id }).from(findings).where(and(eq(findings.auditId, f.auditId), eq(findings.status, 'OPEN')));
      if (!open.length) await this.db.db.update(qualityAudits).set({ status: 'CLOSED', closedAt: new Date() }).where(eq(qualityAudits.id, f.auditId));
    });
    return this.listAudits(p);
  }

  /* ------------------------------------------------------------------ corrective actions */

  async addAction(p: Principal, b: { sourceType: 'OCCURRENCE' | 'FINDING'; sourceId: string; description: string; owner: string; due: string }): Promise<CorrectiveActionDto> {
    let operatorId: string;
    if (b.sourceType === 'OCCURRENCE') {
      const o = await this.occ(b.sourceId);
      await this.authz.check(p, this.occRes(o.operatorId, o.id, o.reportedBy), 'manage');
      if (o.status === 'CLOSED') throw new DomainError('CLOSED', `${o.id} is closed`, 409);
      operatorId = o.operatorId;
    } else {
      const [f] = await this.db.db.select().from(findings).where(eq(findings.id, b.sourceId));
      if (!f) throw new DomainError('NOT_FOUND', `No finding ${b.sourceId}`, 404);
      await this.authz.check(p, this.qaRes(f.operatorId, f.auditId), 'manage');
      if (f.status === 'CLOSED') throw new DomainError('CLOSED', `${f.id} is closed`, 409);
      operatorId = f.operatorId;
    }
    if (b.due < today()) throw new DomainError('DUE_IN_PAST', 'The due date is in the past', 422);
    await this.requirePerson(b.owner, operatorId);
    const id = await this.db.transaction(async () => {
      const n = await this.db.db.execute<{ n: string }>(sql`select nextval('org.action_seq')::text as n`);
      const id = `CA-${pad(n.rows[0].n)}`;
      await this.db.db.insert(correctiveActions).values({ id, operatorId, sourceType: b.sourceType, sourceId: b.sourceId, description: b.description, owner: b.owner, due: b.due,
        status: 'OPEN', createdBy: actorOf(p), version: 1 });
      await this.audit.record(this.db, CHAIN, { operatorId, actor: actorOf(p), action: 'corrective_action.assigned', entityType: 'corrective_action', entityId: id, data: b });
      await this.notifications.raise(this.db, {
        operatorId, actor: b.sourceType === 'OCCURRENCE' ? 'system:safety' : 'system:quality', severity: 'amber', link: b.sourceType === 'OCCURRENCE' ? '/safety/actions' : '/quality/actions', title: `Corrective action ${id} assigned to ${b.owner}`,
        body: b.sourceType === 'FINDING' ? `${b.description.slice(0, 140)} — due ${b.due}` : `From a safety occurrence — details under Safety → Safety Actions. Due ${b.due}.`
      });
      return id;
    });
    return this.action(p, id);
  }

  private async actionRow(id: string, lock = false): Promise<ActionRow> {
    const q = this.db.db.select().from(correctiveActions).where(eq(correctiveActions.id, id));
    const [r] = lock ? await q.for('update') : await q;
    if (!r) throw new DomainError('NOT_FOUND', `No corrective action ${id}`, 404);
    return r;
  }

  private assertActionDomain(r: ActionRow, sourceType: 'OCCURRENCE' | 'FINDING') {
    if (r.sourceType !== sourceType) throw new DomainError('NOT_FOUND', `No corrective action ${r.id} in this domain`, 404);
  }

  async completeActionInDomain(p: Principal, id: string, sourceType: 'OCCURRENCE' | 'FINDING', evidence: string): Promise<CorrectiveActionDto> {
    this.assertActionDomain(await this.actionRow(id), sourceType);
    return this.completeAction(p, id, evidence);
  }

  async verifyActionInDomain(p: Principal, id: string, sourceType: 'OCCURRENCE' | 'FINDING', effective: boolean, note: string): Promise<CorrectiveActionDto> {
    this.assertActionDomain(await this.actionRow(id), sourceType);
    return this.verifyAction(p, id, effective, note);
  }

  /** Returned after the owner or the owning domain manager acted on it (both may read it). */
  async action(p: Principal, id: string): Promise<CorrectiveActionDto> {
    const r = await this.actionRow(id);
    const can = await this.authz.decide(p, this.caRes(r.operatorId, r.sourceType as 'OCCURRENCE' | 'FINDING', id, r.owner), ['read', 'complete', 'verify']);
    if (!can.read && !can.complete && !can.verify) throw new DomainError('NOT_FOUND', `No corrective action ${id}`, 404);
    return actionDto(r);
  }

  /** Domain-scoped action inbox: Safety never leaks Quality actions and vice versa. */
  async listActions(p: Principal, scope: 'mine' | 'open', sourceType: 'OCCURRENCE' | 'FINDING'): Promise<CorrectiveActionDto[]> {
    const can = await this.authz.decide(p, this.caRes(p.operatorId, sourceType), ['verify']);
    const base = and(eq(correctiveActions.operatorId, p.operatorId), eq(correctiveActions.sourceType, sourceType));
    const where = scope === 'open' && can.verify ? and(base, inArray(correctiveActions.status, ['OPEN', 'DONE']))
      : and(base, eq(correctiveActions.owner, p.username), inArray(correctiveActions.status, ['OPEN', 'DONE']));
    return (await this.db.db.select().from(correctiveActions).where(where).orderBy(asc(correctiveActions.due))).map(actionDto);
  }

  async completeAction(p: Principal, id: string, evidence: string): Promise<CorrectiveActionDto> {
    const first = await this.actionRow(id);
    const can = await this.authz.decide(p, this.caRes(first.operatorId, first.sourceType as 'OCCURRENCE' | 'FINDING', id, first.owner), ['complete', 'verify']);
    if (!can.complete) throw new DomainError('FORBIDDEN', `You are not permitted to complete ${id}`, 422);
    await this.db.transaction(async () => {
      const r = await this.actionRow(id, true);
      const next = completeAction(actionDomain(r), p.username, evidence, can.verify);
      await this.db.db.update(correctiveActions).set({ status: next.status, evidence: evidence.trim(), doneBy: next.doneBy, doneAt: new Date(), version: next.version }).where(eq(correctiveActions.id, id));
      await this.audit.record(this.db, CHAIN, { operatorId: r.operatorId, actor: actorOf(p), action: 'corrective_action.done', entityType: 'corrective_action', entityId: id, data: { evidence: evidence.trim() } });
    });
    return this.action(p, id);
  }

  async verifyAction(p: Principal, id: string, effective: boolean, note: string): Promise<CorrectiveActionDto> {
    const first = await this.actionRow(id);
    await this.authz.check(p, this.caRes(first.operatorId, first.sourceType as 'OCCURRENCE' | 'FINDING', id, first.owner), 'verify');
    await this.db.transaction(async () => {
      const r = await this.actionRow(id, true);
      const next = verifyAction(actionDomain(r), p.username, effective);
      await this.db.db.update(correctiveActions).set(effective
        ? { status: next.status, verifiedBy: p.username, verifiedAt: new Date(), version: next.version }
        : { status: next.status, doneBy: null, doneAt: null, version: next.version }).where(eq(correctiveActions.id, id));
      await this.audit.record(this.db, CHAIN, { operatorId: r.operatorId, actor: actorOf(p), action: effective ? 'corrective_action.verified' : 'corrective_action.reopened',
        entityType: 'corrective_action', entityId: id, data: { note, doneBy: r.doneBy } });
      if (!effective) {
        await this.notifications.raise(this.db, { operatorId: r.operatorId, actor: r.sourceType === 'OCCURRENCE' ? 'system:safety' : 'system:quality', severity: 'amber', link: r.sourceType === 'OCCURRENCE' ? '/safety/actions' : '/quality/actions',
          title: `${id} reopened — not effective`, body: note || 'The verification found the action not effective.' });
      }
    });
    return this.action(p, id);
  }
}

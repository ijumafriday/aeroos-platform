import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Authority, Privilege } from '@aeroos/compliance';
import type { AuthorisationDto, AuthorisationStatus, LicenceDto, TrainingCourse, TrainingRecordDto } from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import type { Signer } from '@aeroos/mro-domain';
import { currencyFacts, effective as effectiveRevision, governingAuthorisation, toCompanyAuthorisation, type Authorisation, type Revision, type TrainingRecord } from '@aeroos/org-domain';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { authorisations, controlledDocuments, documentReads, documentRevisions, experienceLog, expiryNotices, personnel, privileges, trainingRecords } from './org.tables';

/** Days after a revision becomes effective during which staff may still sign before acknowledging it. */
export const DOC_ACK_GRACE_DAYS = 14;

type AuthRow = typeof authorisations.$inferSelect;
type PersonRow = typeof personnel.$inferSelect;

export const authToDomain = (r: AuthRow): Authorisation => ({
  id: r.id, operatorId: r.operatorId, personnelId: r.personnelId, reference: r.reference, aircraftTypes: r.aircraftTypes,
  issuedAt: r.issuedAt, validUntil: r.validUntil, status: r.status as AuthorisationStatus, issueRule: r.issueRule,
  history: r.history.map(h => ({ at: new Date(h.at), action: h.action as Authorisation['history'][number]['action'], by: h.by, reason: h.reason })),
  version: r.version
});

export const authToDto = (a: Authorisation): AuthorisationDto => ({
  id: a.id, personnelId: a.personnelId, reference: a.reference, aircraftTypes: a.aircraftTypes, issuedAt: a.issuedAt.toISOString(),
  validUntil: a.validUntil.toISOString(), status: a.status, issueRule: a.issueRule,
  history: a.history.map(h => ({ at: h.at.toISOString(), action: h.action, by: h.by, reason: h.reason }))
});

const privilegeOf = (p: typeof privileges.$inferSelect): Privilege => ({
  authority: p.authority as Authority, category: p.category, typeRatings: p.typeRatings, validUntil: p.validUntil
});

/** Everything Org Core knows about one person, loaded in parallel. */
export interface PersonFile {
  person: PersonRow;
  privs: (typeof privileges.$inferSelect)[];
  auths: Authorisation[];
  training: (typeof trainingRecords.$inferSelect)[];
  workDates: Date[];
}

@Injectable()
export class OrgRepository {
  constructor(@Inject(DB_TOKEN.org) private readonly db: ModuleDb) {}

  async next(seq: 'authorisation_seq' | 'training_seq') {
    const r = await this.db.db.execute<{ n: string }>(sql.raw(`select nextval('org.${seq}')::text as n`));
    return r.rows[0].n;
  }

  async people(operatorId: string): Promise<PersonRow[]> {
    return this.db.db.select().from(personnel).where(and(eq(personnel.operatorId, operatorId), eq(personnel.active, true))).orderBy(asc(personnel.name));
  }

  async person(id: string): Promise<PersonRow | null> {
    const [r] = await this.db.db.select().from(personnel).where(eq(personnel.id, id)).limit(1);
    return r ?? null;
  }

  async requirePerson(id: string, operatorId: string): Promise<PersonRow> {
    const p = await this.person(id);
    if (!p || p.operatorId !== operatorId) throw new DomainError('PERSON_NOT_FOUND', `Personnel record ${id} not found`, 404);
    return p;
  }

  async file(person: PersonRow, at: Date): Promise<PersonFile> {
    const since = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 23, 1));
    const [privs, auths, training, work] = await Promise.all([
      this.db.db.select().from(privileges).where(eq(privileges.personnelId, person.id)).orderBy(asc(privileges.id)),
      this.db.db.select().from(authorisations).where(eq(authorisations.personnelId, person.id)).orderBy(desc(authorisations.issuedAt)),
      this.db.db.select().from(trainingRecords).where(eq(trainingRecords.personnelId, person.id)).orderBy(desc(trainingRecords.completedAt)),
      this.db.db.select({ workAt: experienceLog.workAt }).from(experienceLog)
        .where(and(eq(experienceLog.personnelId, person.id), gte(experienceLog.workAt, since)))
    ]);
    return { person, privs, auths: auths.map(authToDomain), training, workDates: work.map(w => w.workAt) };
  }

  /** Bulk loads for the personnel list (one query per table, not per person). */
  async summaries(ids: string[], at: Date) {
    if (!ids.length) {
      return {
        privs: [] as (typeof privileges.$inferSelect)[], auths: [] as Authorisation[],
        training: [] as (typeof trainingRecords.$inferSelect)[], work: [] as { personnelId: string; workAt: Date }[]
      };
    }
    const since = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 23, 1));
    const [privs, auths, training, work] = await Promise.all([
      this.db.db.select().from(privileges).where(inArray(privileges.personnelId, ids)),
      this.db.db.select().from(authorisations).where(inArray(authorisations.personnelId, ids)),
      this.db.db.select().from(trainingRecords).where(inArray(trainingRecords.personnelId, ids)),
      this.db.db.select({ personnelId: experienceLog.personnelId, workAt: experienceLog.workAt }).from(experienceLog)
        .where(and(inArray(experienceLog.personnelId, ids), gte(experienceLog.workAt, since)))
    ]);
    return { privs, auths: auths.map(authToDomain), training, work };
  }

  async authorisation(id: string, opts: { lock?: boolean } = {}): Promise<Authorisation> {
    const q = this.db.db.select().from(authorisations).where(eq(authorisations.id, id)).limit(1);
    const [r] = opts.lock ? await q.for('update') : await q;
    if (!r) throw new DomainError('AUTHORISATION_NOT_FOUND', `Authorisation ${id} not found`, 404);
    return authToDomain(r);
  }

  async liveAuthorisations(): Promise<Authorisation[]> {
    const rows = await this.db.db.select().from(authorisations).where(inArray(authorisations.status, ['ACTIVE', 'SUSPENDED']));
    return rows.map(authToDomain);
  }

  async insertAuthorisation(a: Authorisation) {
    await this.db.db.insert(authorisations).values({
      id: a.id, operatorId: a.operatorId, personnelId: a.personnelId, reference: a.reference, aircraftTypes: a.aircraftTypes,
      issuedAt: a.issuedAt, validUntil: a.validUntil, status: a.status, issueRule: a.issueRule,
      history: a.history.map(h => ({ at: h.at.toISOString(), action: h.action, by: h.by, reason: h.reason })), version: a.version
    });
  }

  async updateAuthorisation(a: Authorisation, expectedVersion: number) {
    const r = await this.db.db.update(authorisations).set({
      status: a.status,
      history: a.history.map(h => ({ at: h.at.toISOString(), action: h.action, by: h.by, reason: h.reason })),
      version: a.version
    }).where(and(eq(authorisations.id, a.id), eq(authorisations.version, expectedVersion))).returning({ id: authorisations.id });
    if (!r.length) throw new DomainError('CONCURRENT_UPDATE', `${a.reference} was changed by someone else. Reload and try again.`, 409);
  }

  async insertTraining(t: { id: string; personnelId: string; course: TrainingCourse; title: string; completedAt: Date; recordedBy: string }) {
    await this.db.db.insert(trainingRecords).values(t);
  }

  /** Idempotent: the same signed step recorded twice is one entry. */
  async recordExperience(e: { personnelId: string; workAt: Date; sourceType: string; sourceId: string; detail: string }) {
    await this.db.db.insert(experienceLog).values(e).onConflictDoNothing();
  }

  /** Returns true the first time a warning is recorded for this subject, level and validity date. */
  async claimNotice(subjectType: 'AUTHORISATION' | 'LICENCE' | 'TRAINING', subjectId: string, level: string, validUntil: Date): Promise<boolean> {
    const r = await this.db.db.insert(expiryNotices).values({ subjectType, subjectId, level, validUntil }).onConflictDoNothing()
      .returning({ level: expiryNotices.level });
    return r.length > 0;
  }

  async allPrivileges() {
    return this.db.db.select({ p: privileges, person: personnel }).from(privileges).innerJoin(personnel, eq(personnel.id, privileges.personnelId))
      .where(eq(personnel.active, true));
  }

  async allTraining() {
    return this.db.db.select({ t: trainingRecords, person: personnel }).from(trainingRecords).innerJoin(personnel, eq(personnel.id, trainingRecords.personnelId))
      .where(eq(personnel.active, true));
  }
}

export const licenceDto = (p: typeof privileges.$inferSelect, documentId: string | null): LicenceDto => ({
  id: String(p.id), authority: p.authority, category: p.category, typeRatings: p.typeRatings, validUntil: p.validUntil.toISOString(), documentId
});

export const trainingDto = (t: typeof trainingRecords.$inferSelect, documentId: string | null): TrainingRecordDto => ({
  id: t.id, course: t.course as TrainingCourse, title: t.title, completedAt: t.completedAt.toISOString(), recordedBy: t.recordedBy, documentId
});

export const trainingOf = (rows: (typeof trainingRecords.$inferSelect)[]): TrainingRecord[] =>
  rows.map(t => ({ course: t.course as TrainingCourse, completedAt: t.completedAt }));

/**
 * Public query surface of the Org module. Other modules use this — never the org tables —
 * to learn who a person is and what they may certify right now.
 */
@Injectable()
export class PersonnelQuery {
  constructor(private readonly repo: OrgRepository, @Inject(DB_TOKEN.org) private readonly db: ModuleDb) {}

  async byUsername(username: string, operatorId: string): Promise<PersonFile | null> {
    const [person] = await this.db.db.select().from(personnel)
      .where(and(eq(personnel.username, username), eq(personnel.operatorId, operatorId), eq(personnel.active, true)))
      .limit(1);
    return person ? this.repo.file(person, new Date()) : null;
  }

  /**
   * Controlled documents certifying staff must know (exposition, key procedures) whose effective revision this
   * user has not acknowledged, beyond the grace period after it became effective (145.A.30(e), 145.A.65(b)).
   */
  async unreadForCertification(username: string, operatorId: string, now = new Date(), graceDays = DOC_ACK_GRACE_DAYS): Promise<{ code: string; revision: number; effectiveFrom: string }[]> {
    const docs = await this.db.db.select().from(controlledDocuments)
      .where(and(eq(controlledDocuments.operatorId, operatorId), eq(controlledDocuments.requiredForCertification, true)));
    // Only documents distributed to certifying staff (they could not acknowledge anything else).
    docs.splice(0, docs.length, ...docs.filter(d => d.audience.includes('certifying_staff')));
    if (!docs.length) return [];
    const ids = docs.map(d => d.id);
    const [revs, reads] = await Promise.all([
      this.db.db.select().from(documentRevisions).where(inArray(documentRevisions.documentId, ids)),
      this.db.db.select().from(documentReads).where(and(inArray(documentReads.documentId, ids), eq(documentReads.username, username)))
    ]);
    const out: { code: string; revision: number; effectiveFrom: string }[] = [];
    for (const d of docs) {
      const cur = effectiveRevision(revs.filter(r => r.documentId === d.id).map(r => ({
        documentId: r.documentId, revision: r.revision, status: r.status as Revision['status'], summary: r.summary, effectiveFrom: r.effectiveFrom,
        authoredBy: r.authoredBy, approvedBy: r.approvedBy, approvedAt: r.approvedAt
      })), now);
      if (!cur?.effectiveFrom) continue;
      const graceEnds = Date.parse(`${cur.effectiveFrom}T00:00:00Z`) + graceDays * 86_400_000;
      if (now.getTime() < graceEnds) continue;
      if (!reads.some(r => r.revision === cur.revision)) out.push({ code: d.code, revision: cur.revision, effectiveFrom: cur.effectiveFrom });
    }
    return out;
  }

  /** Active personnel at a maintenance base; optional aircraft type requires an ACTIVE company authorisation. */
  async maintenancePersonnel(operatorId: string, base: string, aircraftType?: string): Promise<{ id: string; name: string; roleTitle: string | null; authorised: boolean }[]> {
    const people = await this.repo.people(operatorId);
    const atBase = people.filter(p => (p.base ?? '').toUpperCase() === base.toUpperCase());
    if (!aircraftType || !atBase.length) return atBase.map(p => ({ id: p.id, name: p.name, roleTitle: p.roleTitle, authorised: false }));
    const now = new Date();
    const ids = atBase.map(p => p.id);
    const auths = await this.db.db.select().from(authorisations).where(and(eq(authorisations.operatorId, operatorId), inArray(authorisations.personnelId, ids), eq(authorisations.status, 'ACTIVE'), gte(authorisations.validUntil, now)));
    const eligible = new Set(auths.filter(a => a.aircraftTypes.includes(aircraftType.toUpperCase())).map(a => a.personnelId));
    return atBase.map(p => ({ id: p.id, name: p.name, roleTitle: p.roleTitle, authorised: eligible.has(p.id) }));
  }

  async maintenancePerson(operatorId: string, personnelId: string): Promise<{ id: string; name: string; base: string | null; roleTitle: string | null } | null> {
    const p = await this.repo.person(personnelId);
    if (!p || p.operatorId !== operatorId || !p.active) return null;
    return { id: p.id, name: p.name, base: p.base, roleTitle: p.roleTitle };
  }

  /** Certification facts for an authenticated user: privileges, governing authorisation and currency. */
  async signer(username: string, operatorId: string): Promise<Signer | null> {
    const at = new Date();
    const f = await this.byUsername(username, operatorId);
    if (!f) return null;
    const c = currencyFacts(f.workDates, trainingOf(f.training), at);
    return {
      personnelId: f.person.id,
      name: f.person.name,
      licenceNo: f.person.licenceNo ?? '—',
      privileges: f.privs.map(privilegeOf),
      authorisation: toCompanyAuthorisation(governingAuthorisation(f.auths)),
      currency: { experienceMonthsLast24: c.experienceMonthsLast24, lastContinuationTraining: c.lastContinuationTraining }
    };
  }
}

export { privilegeOf };

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { ControlledDocumentDetailDto, ControlledDocumentDto, DocumentCategory, DocumentRevisionDto, RevisionStatus } from '@aeroos/contracts';
import { DomainError } from '@aeroos/kernel';
import { approveRevision, asOf, canAcknowledge, draftRevision, type Revision } from '@aeroos/org-domain';
import { actorOf, type Principal } from '../../platform/auth/principal';
import { AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { NotificationsService } from '../../platform/notifications/notifications.service';
import { DocumentsService } from '../../platform/storage/documents.service';
import { controlledDocuments, documentReads, documentRevisions } from './org.tables';

const CHAIN = 'org';
const link = (id: string) => `/org/documents?doc=${encodeURIComponent(id)}`;
export const revisionOwner = (documentId: string, revision: number) => `${documentId}:${revision}`;

type DocRow = typeof controlledDocuments.$inferSelect;
type RevRow = typeof documentRevisions.$inferSelect;

const revOf = (r: RevRow): Revision => ({
  documentId: r.documentId, revision: r.revision, status: r.status as RevisionStatus, summary: r.summary, effectiveFrom: r.effectiveFrom,
  authoredBy: r.authoredBy, approvedBy: r.approvedBy, approvedAt: r.approvedAt
});
const revDto = (r: RevRow): DocumentRevisionDto => ({
  revision: r.revision, status: r.status as RevisionStatus, summary: r.summary, effectiveFrom: r.effectiveFrom, authoredBy: r.authoredBy,
  authoredAt: r.authoredAt.toISOString(), approvedBy: r.approvedBy, approvedAt: r.approvedAt?.toISOString() ?? null,
  file: r.fileDocumentId && r.fileSha256 ? { documentId: r.fileDocumentId, sha256: r.fileSha256 } : null
});

/**
 * Document & manual control (ADR-0019): controlled documents, revisions approved by a second person and
 * effective on their date, and read-and-acknowledge by every role in the document's audience.
 */
@Injectable()
export class DocumentControlService {
  constructor(
    @Inject(DB_TOKEN.org) private readonly db: ModuleDb,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly documents: DocumentsService
  ) {}

  private resource(operatorId: string, id = '*') {
    return { kind: 'controlled_document' as const, id, attr: { operatorId } };
  }

  /** Persist the effective/superseded status as of now (revisions become effective on their date, not on a click). */
  private async settle(revs: RevRow[]): Promise<RevRow[]> {
    const now = new Date();
    const out: RevRow[] = [];
    const byDoc = new Map<string, RevRow[]>();
    for (const r of revs) byDoc.set(r.documentId, [...(byDoc.get(r.documentId) ?? []), r]);
    for (const list of byDoc.values()) {
      const settled = asOf(list.map(revOf), now);
      for (const r of list) {
        const s = settled.find(x => x.revision === r.revision)!.status;
        if (s !== r.status) {
          await this.db.db.update(documentRevisions).set({ status: s }).where(and(eq(documentRevisions.documentId, r.documentId), eq(documentRevisions.revision, r.revision)));
        }
        out.push({ ...r, status: s });
      }
    }
    return out;
  }

  private summarise(d: DocRow, revs: RevRow[], reads: { documentId: string; revision: number; username: string }[], p: Principal): ControlledDocumentDto {
    const mine = revs.filter(r => r.documentId === d.id);
    const eff = mine.find(r => r.status === 'EFFECTIVE') ?? null;
    const pending = mine.find(r => r.status === 'DRAFT' || r.status === 'APPROVED') ?? null;
    const effReads = eff ? reads.filter(x => x.documentId === d.id && x.revision === eff.revision) : [];
    return {
      id: d.id, code: d.code, title: d.title, category: d.category as DocumentCategory, owner: d.owner, audience: d.audience, requiredForCertification: d.requiredForCertification,
      effective: eff ? revDto(eff) : null, pending: pending ? revDto(pending) : null,
      mustRead: !!eff && d.audience.some(a => p.roles.includes(a)) && !effReads.some(x => x.username === p.username),
      readCount: effReads.length
    };
  }

  async list(p: Principal): Promise<ControlledDocumentDto[]> {
    await this.authz.check(p, this.resource(p.operatorId), 'read');
    const docs = await this.db.db.select().from(controlledDocuments).where(eq(controlledDocuments.operatorId, p.operatorId)).orderBy(asc(controlledDocuments.code));
    if (!docs.length) return [];
    const ids = docs.map(d => d.id);
    const revs = await this.settle(await this.db.db.select().from(documentRevisions).where(inArray(documentRevisions.documentId, ids)));
    const reads = await this.db.db.select({ documentId: documentReads.documentId, revision: documentReads.revision, username: documentReads.username })
      .from(documentReads).where(inArray(documentReads.documentId, ids));
    return docs.map(d => this.summarise(d, revs, reads, p));
  }

  private async doc(id: string): Promise<DocRow> {
    const [d] = await this.db.db.select().from(controlledDocuments).where(eq(controlledDocuments.id, id));
    if (!d) throw new DomainError('NOT_FOUND', `No controlled document ${id}`, 404);
    return d;
  }

  async get(p: Principal, id: string): Promise<ControlledDocumentDetailDto> {
    const d = await this.doc(id);
    await this.authz.check(p, this.resource(d.operatorId, id), 'read');
    const revs = await this.settle(await this.db.db.select().from(documentRevisions).where(eq(documentRevisions.documentId, id)).orderBy(asc(documentRevisions.revision)));
    const reads = await this.db.db.select().from(documentReads).where(eq(documentReads.documentId, id)).orderBy(asc(documentReads.readAt));
    const summary = this.summarise(d, revs, reads, p);
    const eff = summary.effective?.revision;
    return {
      ...summary, revisions: revs.map(revDto).reverse(),
      reads: reads.filter(r => r.revision === eff).map(r => ({ username: r.username, name: r.name, readAt: r.readAt.toISOString() }))
    };
  }

  async create(p: Principal, body: { code: string; title: string; category: DocumentCategory; audience: string[]; requiredForCertification: boolean }): Promise<ControlledDocumentDetailDto> {
    await this.authz.check(p, this.resource(p.operatorId), 'manage');
    if (body.requiredForCertification && !body.audience.includes('certifying_staff')) {
      throw new DomainError('AUDIENCE', 'A document certifying staff must have read has to be distributed to certifying staff', 422);
    }
    const id = `${p.operatorId}-${body.code}`;
    await this.db.transaction(async () => {
      const [exists] = await this.db.db.select({ id: controlledDocuments.id }).from(controlledDocuments).where(eq(controlledDocuments.id, id));
      if (exists) throw new DomainError('DUPLICATE', `${body.code} already exists`, 409);
      await this.db.db.insert(controlledDocuments).values({ id, operatorId: p.operatorId, code: body.code, title: body.title, category: body.category, owner: p.username, audience: body.audience, requiredForCertification: body.requiredForCertification });
      await this.audit.record(this.db, CHAIN, {
        operatorId: p.operatorId, actor: actorOf(p), action: 'controlled_document.created', entityType: 'controlled_document', entityId: id, data: body
      });
    });
    return this.get(p, id);
  }

  async draft(p: Principal, id: string, summary: string): Promise<ControlledDocumentDetailDto> {
    const d = await this.doc(id);
    await this.authz.check(p, this.resource(d.operatorId, id), 'manage');
    await this.db.transaction(async () => {
      await this.db.db.select().from(controlledDocuments).where(eq(controlledDocuments.id, id)).for('update'); // one draft at a time
      const existing = await this.db.db.select().from(documentRevisions).where(eq(documentRevisions.documentId, id));
      const r = draftRevision((await this.settle(existing)).map(revOf), id, summary, actorOf(p));
      await this.db.db.insert(documentRevisions).values({ documentId: id, revision: r.revision, operatorId: d.operatorId, status: 'DRAFT', summary: r.summary, authoredBy: r.authoredBy });
      await this.audit.record(this.db, CHAIN, {
        operatorId: d.operatorId, actor: actorOf(p), action: 'document_revision.drafted', entityType: 'controlled_document', entityId: id, data: { revision: r.revision, summary: r.summary }
      });
    });
    return this.get(p, id);
  }

  /**
   * The approver names the file they reviewed (its sha256); it must be the latest stored file of the revision
   * and uploaded by someone else — the approver can neither supply the content they approve nor approve a file
   * replaced after they looked at it.
   */
  async approve(p: Principal, id: string, revision: number, effectiveFrom: string, sha256: string): Promise<ControlledDocumentDetailDto> {
    const d = await this.doc(id);
    await this.authz.check(p, this.resource(d.operatorId, id), 'approve');
    const files = await this.documents.allFor(d.operatorId, 'manual_revision', [revisionOwner(id, revision)]);
    const file = files.filter(f => f.sha256).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
    if (file && file.sha256 !== sha256) throw new DomainError('FILE_CHANGED', 'The revision file changed since you opened it — review the latest file', 409);
    if (file && file.uploadedBy === actorOf(p)) throw new DomainError('FOUR_EYES', 'You uploaded this file; someone else must approve it', 422);
    await this.db.transaction(async () => {
      const [row] = await this.db.db.select().from(documentRevisions).where(and(eq(documentRevisions.documentId, id), eq(documentRevisions.revision, revision))).for('update');
      if (!row) throw new DomainError('NOT_FOUND', `${d.code} has no revision ${revision}`, 404);
      const now = new Date();
      const r = approveRevision(revOf(row), actorOf(p), effectiveFrom, now, !!file);
      await this.db.db.update(documentRevisions).set({ status: 'APPROVED', approvedBy: r.approvedBy, approvedAt: now, effectiveFrom, fileDocumentId: file!.id, fileSha256: file!.sha256 })
        .where(and(eq(documentRevisions.documentId, id), eq(documentRevisions.revision, revision)));
      await this.audit.record(this.db, CHAIN, {
        operatorId: d.operatorId, actor: actorOf(p), action: 'document_revision.approved', entityType: 'controlled_document', entityId: id,
        data: { revision, effectiveFrom, authoredBy: row.authoredBy, file: { documentId: file!.id, sha256: file!.sha256 } }
      });
      await this.notifications.raise(this.db, {
        operatorId: d.operatorId, actor: 'system:document-control', severity: 'amber', link: link(id),
        title: `${d.code} revision ${revision} — read and acknowledge`, body: `Effective ${effectiveFrom}: ${row.summary}`
      });
    });
    return this.get(p, id);
  }

  async acknowledge(p: Principal, id: string, revision: number): Promise<ControlledDocumentDetailDto> {
    const d = await this.doc(id);
    await this.authz.check(p, this.resource(d.operatorId, id), 'read');
    await this.db.transaction(async () => {
      const revs = await this.settle(await this.db.db.select().from(documentRevisions).where(eq(documentRevisions.documentId, id)));
      canAcknowledge(revs.map(revOf), revision, new Date(), d.audience, p.roles);
      const r = await this.db.db.insert(documentReads).values({ documentId: id, revision, username: p.username, name: p.name })
        .onConflictDoNothing().returning({ u: documentReads.username });
      if (r.length) {
        await this.audit.record(this.db, CHAIN, {
          operatorId: d.operatorId, actor: actorOf(p), action: 'document_revision.acknowledged', entityType: 'controlled_document', entityId: id,
          data: { revision, sha256: revs.find(x => x.revision === revision)?.fileSha256 ?? null }
        });
      }
    });
    return this.get(p, id);
  }
}

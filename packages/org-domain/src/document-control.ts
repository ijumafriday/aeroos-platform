import { DomainError } from '@aeroos/kernel';

/**
 * Document & manual control — the exposition (CAME / MOE), procedures and manuals the organisation works to
 * (Part-CAMO CAMO.A.300, Part-145 145.A.45/70, ORO.MLR.100). A revision is drafted with a summary of changes,
 * approved by someone other than its author, and becomes effective on its date; the previous revision is then
 * superseded. Everyone in the document's audience must read and acknowledge each effective revision.
 *
 *   DRAFT ──approve (≠ author)──▶ APPROVED ──effective date reached──▶ EFFECTIVE ──next one effective──▶ SUPERSEDED
 */
export type RevisionStatus = 'DRAFT' | 'APPROVED' | 'EFFECTIVE' | 'SUPERSEDED';

export interface Revision {
  documentId: string;
  revision: number;
  status: RevisionStatus;
  summary: string;
  effectiveFrom: string | null; // yyyy-mm-dd
  authoredBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export function draftRevision(existing: Revision[], documentId: string, summary: string, by: string): Revision {
  if (existing.some(r => r.status === 'DRAFT' || r.status === 'APPROVED')) {
    throw new DomainError('REVISION_PENDING', 'A revision is already in draft or awaiting its effective date', 409);
  }
  if (summary.trim().length < 10) throw new DomainError('SUMMARY_REQUIRED', 'Summarise what changed (10+ characters) — readers sign against it');
  const next = Math.max(0, ...existing.map(r => r.revision)) + 1;
  return { documentId, revision: next, status: 'DRAFT', summary: summary.trim(), effectiveFrom: null, authoredBy: by, approvedBy: null, approvedAt: null };
}

/** Approval by a second person; effective today or on a later date. */
export function approveRevision(r: Revision, by: string, effectiveFrom: string, now: Date, hasFile: boolean): Revision {
  if (r.status !== 'DRAFT') throw new DomainError('NOT_DRAFT', `Revision ${r.revision} is ${r.status.toLowerCase()}`, 409);
  if (r.authoredBy === by) throw new DomainError('FOUR_EYES', 'A revision must be approved by someone other than its author', 422);
  if (!hasFile) throw new DomainError('FILE_REQUIRED', 'Attach the revised document before approving it', 422);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || effectiveFrom < day(now)) throw new DomainError('EFFECTIVE_DATE', 'The effective date must be today or later', 422);
  return { ...r, status: 'APPROVED', approvedBy: by, approvedAt: now, effectiveFrom };
}

/**
 * Status of every revision as of `now`: the latest approved revision whose date has come is EFFECTIVE, older
 * approved/effective ones are SUPERSEDED. Pure — callers persist what changed.
 */
export function asOf(revisions: Revision[], now: Date): Revision[] {
  const today = day(now);
  const live = revisions.filter(r => (r.status === 'APPROVED' || r.status === 'EFFECTIVE' || r.status === 'SUPERSEDED') && r.effectiveFrom && r.effectiveFrom <= today);
  const current = live.sort((a, b) => b.revision - a.revision)[0];
  return revisions.map(r => {
    if (!current || !r.effectiveFrom || r.effectiveFrom > today || r.status === 'DRAFT') return r;
    if (r.revision === current.revision) return { ...r, status: 'EFFECTIVE' };
    if (r.revision < current.revision) return { ...r, status: 'SUPERSEDED' };
    return r;
  });
}

export const effective = (revisions: Revision[], now: Date) => asOf(revisions, now).find(r => r.status === 'EFFECTIVE') ?? null;

/** Readers acknowledge the effective revision only (not drafts, not superseded ones). */
export function canAcknowledge(revisions: Revision[], revision: number, now: Date, audience: string[], roles: string[]): void {
  const cur = effective(revisions, now);
  if (!cur || cur.revision !== revision) throw new DomainError('NOT_EFFECTIVE', `Revision ${revision} is not the effective revision`, 409);
  if (!audience.some(a => roles.includes(a))) throw new DomainError('NOT_IN_AUDIENCE', 'This document is not distributed to your role', 422);
}

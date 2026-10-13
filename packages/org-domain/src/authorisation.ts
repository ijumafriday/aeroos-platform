import { DomainError } from '@aeroos/kernel';
import type { CompanyAuthorisation, ComplianceEngine, Privilege } from '@aeroos/compliance';
import type { AuthorisationStatus, DomainEvent } from '@aeroos/contracts';

export interface AuthorisationHistoryEntry {
  at: Date;
  action: 'ISSUED' | 'SUSPENDED' | 'REINSTATED' | 'REVOKED' | 'EXPIRED';
  by: string;
  reason: string | null;
}

/**
 * A company certification authorisation (Part-145.A.35 / MOE 3.4). Issued by the quality
 * manager within the holder's licence scope; suspended or revoked for cause; expires on date.
 * REVOKED and EXPIRED are terminal — a new authorisation is issued instead of reviving an old one,
 * so the reference that appears on past CRSs always means what it meant then.
 */
export interface Authorisation {
  id: string;
  operatorId: string;
  personnelId: string;
  reference: string;
  aircraftTypes: string[];
  issuedAt: Date;
  validUntil: Date;
  status: AuthorisationStatus;
  issueRule: string;
  history: AuthorisationHistoryEntry[];
  version: number;
}

export interface IssueAuthorisationInput {
  id: string;
  operatorId: string;
  personnelId: string;
  reference: string;
  aircraftTypes: string[];
  validUntil: Date;
  issuedBy: string;
  at: Date;
  /** The holder's current licence privileges — scope is checked against them by the rulepack. */
  privileges: Privilege[];
  /** Authorisations the holder already has; at most one may be ACTIVE or SUSPENDED at a time. */
  existing: Pick<Authorisation, 'reference' | 'status'>[];
}

type Ev<T extends 'org.authorisation.issued' | 'org.authorisation.suspended' | 'org.authorisation.reinstated' | 'org.authorisation.revoked' | 'org.authorisation.expired'> = DomainEvent<T>;

export function issueAuthorisation(engine: ComplianceEngine, i: IssueAuthorisationInput): { authorisation: Authorisation; event: Ev<'org.authorisation.issued'> } {
  const reference = i.reference.trim();
  if (!reference) throw new DomainError('REFERENCE_REQUIRED', 'An authorisation reference is required');
  if (i.validUntil.getTime() <= i.at.getTime()) throw new DomainError('VALIDITY_IN_PAST', 'Valid-until must be in the future');
  const live = i.existing.find(a => a.status === 'ACTIVE' || a.status === 'SUSPENDED');
  if (live) throw new DomainError('AUTHORISATION_EXISTS', `Holder already has authorisation ${live.reference} (${live.status.toLowerCase()}); revoke it first`, 409);
  const types = [...new Set(i.aircraftTypes.map(t => t.trim()).filter(Boolean))];
  const scope = engine.authorisationScope(i.operatorId, { privileges: i.privileges, aircraftTypes: types, at: i.at });
  if (!scope.value.allowed) throw new DomainError('SCOPE_NOT_COVERED', `${scope.value.reason} (${scope.rule})`, 422);

  const authorisation: Authorisation = {
    id: i.id,
    operatorId: i.operatorId,
    personnelId: i.personnelId,
    reference,
    aircraftTypes: types,
    issuedAt: i.at,
    validUntil: i.validUntil,
    status: 'ACTIVE',
    issueRule: scope.rule,
    history: [{ at: i.at, action: 'ISSUED', by: i.issuedBy, reason: null }],
    version: 1
  };
  return {
    authorisation,
    event: { type: 'org.authorisation.issued', data: { authorisationId: i.id, personnelId: i.personnelId, reference, aircraftTypes: types, validUntil: i.validUntil.toISOString(), rule: scope.rule } }
  };
}

function requireReason(reason: string) {
  if (reason.trim().length < 5) throw new DomainError('REASON_REQUIRED', 'Give a reason (at least 5 characters) — it is part of the quality record');
  return reason.trim();
}

function transition(a: Authorisation, to: AuthorisationStatus, entry: AuthorisationHistoryEntry): Authorisation {
  return { ...a, status: to, history: [...a.history, entry], version: a.version + 1 };
}

export function suspendAuthorisation(a: Authorisation, by: string, reason: string, at: Date): { authorisation: Authorisation; event: Ev<'org.authorisation.suspended'> } {
  if (a.status !== 'ACTIVE') throw new DomainError('NOT_ACTIVE', `${a.reference} is ${a.status.toLowerCase()}, not active`, 409);
  const r = requireReason(reason);
  return {
    authorisation: transition(a, 'SUSPENDED', { at, action: 'SUSPENDED', by, reason: r }),
    event: { type: 'org.authorisation.suspended', data: { authorisationId: a.id, personnelId: a.personnelId, reference: a.reference, reason: r } }
  };
}

export function reinstateAuthorisation(a: Authorisation, by: string, reason: string, at: Date): { authorisation: Authorisation; event: Ev<'org.authorisation.reinstated'> } {
  if (a.status !== 'SUSPENDED') throw new DomainError('NOT_SUSPENDED', `${a.reference} is not suspended`, 409);
  if (a.validUntil.getTime() <= at.getTime()) throw new DomainError('EXPIRED', `${a.reference} has passed its validity date; issue a new authorisation`, 409);
  return {
    authorisation: transition(a, 'ACTIVE', { at, action: 'REINSTATED', by, reason: requireReason(reason) }),
    event: { type: 'org.authorisation.reinstated', data: { authorisationId: a.id, personnelId: a.personnelId, reference: a.reference } }
  };
}

export function revokeAuthorisation(a: Authorisation, by: string, reason: string, at: Date): { authorisation: Authorisation; event: Ev<'org.authorisation.revoked'> } {
  if (a.status === 'REVOKED' || a.status === 'EXPIRED') throw new DomainError('TERMINAL', `${a.reference} is already ${a.status.toLowerCase()}`, 409);
  const r = requireReason(reason);
  return {
    authorisation: transition(a, 'REVOKED', { at, action: 'REVOKED', by, reason: r }),
    event: { type: 'org.authorisation.revoked', data: { authorisationId: a.id, personnelId: a.personnelId, reference: a.reference, reason: r } }
  };
}

/** Called by the expiry workflow. Idempotent: returns null when there is nothing to do. */
export function expireAuthorisation(a: Authorisation, at: Date): { authorisation: Authorisation; event: Ev<'org.authorisation.expired'> } | null {
  if (a.status === 'REVOKED' || a.status === 'EXPIRED') return null;
  if (a.validUntil.getTime() > at.getTime()) return null;
  return {
    authorisation: transition(a, 'EXPIRED', { at, action: 'EXPIRED', by: 'system:expiry', reason: null }),
    event: { type: 'org.authorisation.expired', data: { authorisationId: a.id, personnelId: a.personnelId, reference: a.reference } }
  };
}

/** The shape the compliance engine checks at signing time. Anything not ACTIVE counts as suspended. */
export function toCompanyAuthorisation(a: Authorisation | null): CompanyAuthorisation | null {
  if (!a) return null;
  return { reference: a.reference, aircraftTypes: a.aircraftTypes, validUntil: a.validUntil, suspended: a.status !== 'ACTIVE' };
}

/** Pick the authorisation that governs certification today: the live one, else the most recent. */
export function governingAuthorisation(list: Authorisation[]): Authorisation | null {
  const live = list.find(a => a.status === 'ACTIVE' || a.status === 'SUSPENDED');
  if (live) return live;
  return [...list].sort((x, y) => y.issuedAt.getTime() - x.issuedAt.getTime())[0] ?? null;
}

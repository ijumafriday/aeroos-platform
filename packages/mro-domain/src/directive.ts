import { DomainError } from '@aeroos/kernel';
import type { Interval, Requirement } from './maintenance';

/**
 * Airworthiness directives (AD) and service bulletins (SB) — CAMO's intake of mandatory and optional
 * continuing-airworthiness information (Part-CAMO CAMO.A.315(b)(4), Part-M M.A.301(i), M.A.303).
 *
 *   RECEIVED ──evaluate──▶ EVALUATED ──incorporate (second person)──▶ INCORPORATED  → requirement on the due list
 *                     └──▶ NOT_APPLICABLE (no aircraft affected, with reasons)
 *                     └──▶ NOT_APPLICABLE_PENDING ──confirm (second person)──▶ NOT_APPLICABLE
 *                            (an AD whose published applicability was overridden away on some aircraft)
 *                     └──▶ REJECTED (SB only, with reason)        DEFERRED (SB only, with reason; can be re-evaluated)
 *   any of these ──a later revision is incorporated──▶ SUPERSEDED
 *
 * An AD that applies to any aircraft cannot be rejected or deferred. Applicability is decided per aircraft:
 * by type and MSN range automatically, then confirmed or overridden by the engineer with a reason
 * (e.g. "mod 12345 embodied at production"). Every way out of an AD's open state needs two people:
 * incorporation, or confirming that overridden aircraft are really not affected.
 */
export type DirectiveKind = 'AD' | 'SB';
export type DirectiveStatus = 'RECEIVED' | 'EVALUATED' | 'DEFERRED' | 'NOT_APPLICABLE_PENDING' | 'INCORPORATED' | 'NOT_APPLICABLE' | 'REJECTED' | 'SUPERSEDED';

/** States from which a directive can still be (re-)evaluated. */
export const OPEN_DIRECTIVE: DirectiveStatus[] = ['RECEIVED', 'EVALUATED', 'DEFERRED', 'NOT_APPLICABLE_PENDING'];
export type DirectiveDecision = 'COMPLY' | 'EMBODY' | 'DEFER' | 'REJECT' | 'NOT_APPLICABLE';

export interface MsnRange { from: string; to: string }

export interface Directive {
  id: string;
  operatorId: string;
  kind: DirectiveKind;
  ref: string;
  revision: string;
  authority: string;
  title: string;
  ata: string;
  types: string[];
  /** null = every MSN of the listed types. */
  msnRanges: MsnRange[] | null;
  effective: string; // yyyy-mm-dd
  action: string;
  interval: Interval;
  repetitive: boolean;
  estimatedHours: number;
  steps: string[];
  supersedes: string | null;
  status: DirectiveStatus;
  decision: DirectiveDecision | null;
  decisionReason: string | null;
  evaluatedBy: string | null;
  evaluatedAt: Date | null;
  incorporatedBy: string | null;
  incorporatedAt: Date | null;
  /** Second person confirming a "not applicable" decision that overrode published applicability. */
  confirmedBy: string | null;
  confirmedAt: Date | null;
  requirementId: string | null;
  version: number;
}

export interface TailApplicability { tail: string; applicable: boolean; reason: string; overridden: boolean }

const msnNumber = (s: string) => (/^\d+$/.test(s) ? Number(s) : null);

function inRange(msn: string, r: MsnRange): boolean {
  const n = msnNumber(msn), a = msnNumber(r.from), b = msnNumber(r.to);
  if (n !== null && a !== null && b !== null) return n >= a && n <= b;
  return msn >= r.from && msn <= r.to; // non-numeric serials: lexical, as published
}

/** Automatic applicability from type and MSN range, for every aircraft of the operator. */
export function applicability(d: Pick<Directive, 'types' | 'msnRanges'>, fleet: { reg: string; type: string; msn: string }[]): TailApplicability[] {
  return fleet.map(t => {
    if (!d.types.includes(t.type)) return { tail: t.reg, applicable: false, reason: `Type ${t.type} not listed`, overridden: false };
    if (d.msnRanges && !d.msnRanges.some(r => inRange(t.msn, r))) return { tail: t.reg, applicable: false, reason: `MSN ${t.msn} outside the published ranges`, overridden: false };
    return { tail: t.reg, applicable: true, reason: d.msnRanges ? `MSN ${t.msn} within the published ranges` : `All ${t.type}`, overridden: false };
  });
}

/** The engineer confirms or overrides per aircraft; every override needs a reason. */
export function applyOverrides(auto: TailApplicability[], overrides: { tail: string; applicable: boolean; reason: string }[]): TailApplicability[] {
  const byTail = new Map(overrides.map(o => [o.tail, o]));
  for (const o of overrides) {
    if (!auto.some(a => a.tail === o.tail)) throw new DomainError('UNKNOWN_TAIL', `${o.tail} is not in the fleet`);
    if (o.reason.trim().length < 5) throw new DomainError('OVERRIDE_REASON', `Give a reason for ${o.tail} (5+ characters)`);
  }
  return auto.map(a => {
    const o = byTail.get(a.tail);
    if (!o || o.applicable === a.applicable) return a;
    return { tail: a.tail, applicable: o.applicable, reason: o.reason.trim(), overridden: true };
  });
}

/** Record the engineering evaluation. Returns the new status. */
export function evaluate(
  d: Directive, decision: DirectiveDecision, reason: string | null, tails: TailApplicability[], by: string, at: Date
): Directive {
  if (!OPEN_DIRECTIVE.includes(d.status)) throw new DomainError('DIRECTIVE_CLOSED', `${d.ref} is ${d.status.toLowerCase().replace('_', ' ')}`, 409);
  const affected = tails.filter(t => t.applicable).length;
  const why = reason?.trim() || null;
  const need = (ok: boolean, code: string, msg: string) => { if (!ok) throw new DomainError(code, msg, 422); };
  switch (decision) {
    case 'NOT_APPLICABLE':
      need(affected === 0, 'STILL_APPLICABLE', `${affected} aircraft are still marked applicable — override them with a reason first`);
      need(!!why && why.length >= 5, 'REASON_REQUIRED', 'Say why it does not apply (5+ characters)');
      break;
    case 'COMPLY':
      need(d.kind === 'AD', 'WRONG_DECISION', 'Service bulletins are embodied, deferred or rejected');
      need(affected > 0, 'NOTHING_AFFECTED', 'No aircraft is affected: record it as not applicable');
      break;
    case 'EMBODY':
      need(d.kind === 'SB', 'WRONG_DECISION', 'An AD is complied with, not embodied');
      need(affected > 0, 'NOTHING_AFFECTED', 'No aircraft is affected: record it as not applicable');
      break;
    case 'DEFER':
    case 'REJECT':
      need(d.kind === 'SB', 'AD_MANDATORY', 'An applicable AD is mandatory: it cannot be deferred or rejected');
      need(!!why && why.length >= 10, 'REASON_REQUIRED', 'Give the engineering justification (10+ characters)');
      break;
  }
  // An AD closed as not applicable only because aircraft inside the published applicability were overridden
  // needs a second person to confirm it.
  const overriddenAway = tails.some(t => t.overridden && !t.applicable);
  const status: DirectiveStatus = decision === 'NOT_APPLICABLE' ? (d.kind === 'AD' && overriddenAway ? 'NOT_APPLICABLE_PENDING' : 'NOT_APPLICABLE')
    : decision === 'REJECT' ? 'REJECTED' : decision === 'DEFER' ? 'DEFERRED' : 'EVALUATED';
  return { ...d, status, decision, decisionReason: why, evaluatedBy: by, evaluatedAt: at, confirmedBy: null, confirmedAt: null, version: d.version + 1 };
}

/** Four-eyes: a second person puts an evaluated AD/SB into the maintenance programme. */
export function incorporate(d: Directive, requirementId: string, by: string, at: Date): Directive {
  if (d.status !== 'EVALUATED') throw new DomainError('NOT_EVALUATED', `${d.ref} must be evaluated (comply/embody) before it is incorporated`, 409);
  if (d.evaluatedBy === by) throw new DomainError('FOUR_EYES', 'The evaluation and the incorporation must be done by different people', 422);
  return { ...d, status: 'INCORPORATED', incorporatedBy: by, incorporatedAt: at, requirementId, version: d.version + 1 };
}

/** Second person confirms that an AD does not apply to aircraft its published applicability includes. */
export function confirmNotApplicable(d: Directive, by: string, at: Date): Directive {
  if (d.status !== 'NOT_APPLICABLE_PENDING') throw new DomainError('NOT_PENDING', `${d.ref} is not waiting for confirmation`, 409);
  if (d.evaluatedBy === by) throw new DomainError('FOUR_EYES', 'The evaluation and its confirmation must be done by different people', 422);
  return { ...d, status: 'NOT_APPLICABLE', confirmedBy: by, confirmedAt: at, version: d.version + 1 };
}

/** A later revision was incorporated: the earlier one stops being tracked, whatever state it was in. */
export function supersede(d: Directive): Directive {
  if (d.status === 'SUPERSEDED') return d;
  return { ...d, status: 'SUPERSEDED', version: d.version + 1 };
}

/**
 * Where a superseding repetitive AD starts counting on an aircraft: the earliest of its own effective-date
 * counters and the previous AD's last compliance (or start). Taking the earliest never makes an item due later — an
 * overdue earlier AD stays overdue under its replacement unless the new one's interval says otherwise.
 */
export function supersedingStart(own: { at: Date; fh: number; fc: number }, previous: { at: Date; fh: number; fc: number } | null) {
  if (!previous) return own;
  return { at: previous.at < own.at ? previous.at : own.at, fh: Math.min(own.fh, previous.fh), fc: Math.min(own.fc, previous.fc) };
}

/** The maintenance-programme requirement an incorporated directive becomes (tracked like any AD / task). */
export function toRequirement(d: Directive, id: string): Requirement {
  return {
    id, kind: d.kind, ref: d.revision ? `${d.ref} R${d.revision}` : d.ref, title: d.title, ata: d.ata, types: d.types,
    interval: d.kind === 'AD' ? { fh: d.interval.fh, fc: d.interval.fc, days: d.interval.days } : d.interval, // no tolerance on ADs
    repetitive: d.repetitive, steps: d.steps.length ? d.steps : [d.action], estimatedHours: d.estimatedHours, tools: [], parts: []
  };
}

/** Days from `now` to the effective date (negative = already effective). */
export const daysToEffective = (d: Pick<Directive, 'effective'>, now: Date) =>
  Math.ceil((Date.parse(`${d.effective}T00:00:00Z`) - now.getTime()) / 86_400_000);

import { DomainError } from '@aeroos/kernel';
import type { ActionStatus } from './corrective-action';

/**
 * Safety management: occurrence reporting, risk, investigation and closure (ORO.GEN.200, Part-CAMO CAMO.A.202,
 * Part-145 145.A.60/200 and Regulation (EU) 376/2014). Pure rules; the API persists.
 */

/* ------------------------------------------------------------------ risk (ICAO Doc 9859 5×5 matrix) */

/** 5 frequent · 4 occasional · 3 remote · 2 improbable · 1 extremely improbable */
export type Probability = 1 | 2 | 3 | 4 | 5;
/** A catastrophic · B hazardous · C major · D minor · E negligible */
export type Severity = 'A' | 'B' | 'C' | 'D' | 'E';
export type Tolerability = 'INTOLERABLE' | 'TOLERABLE' | 'ACCEPTABLE';

const INTOLERABLE = new Set(['5A', '5B', '5C', '4A', '4B', '3A']);
const TOLERABLE = new Set(['5D', '5E', '4C', '4D', '4E', '3B', '3C', '3D', '2A', '2B', '2C', '1A']);

export function risk(p: Probability, s: Severity): { index: string; tolerability: Tolerability } {
  if (![1, 2, 3, 4, 5].includes(p) || !['A', 'B', 'C', 'D', 'E'].includes(s)) throw new DomainError('RISK_INVALID', 'Probability 1–5 and severity A–E');
  const index = `${p}${s}`;
  return { index, tolerability: INTOLERABLE.has(index) ? 'INTOLERABLE' : TOLERABLE.has(index) ? 'TOLERABLE' : 'ACCEPTABLE' };
}

/* ------------------------------------------------------------------ occurrences */

export type OccurrenceStatus = 'REPORTED' | 'TRIAGED' | 'UNDER_INVESTIGATION' | 'CLOSED';

export interface Occurrence {
  id: string;
  status: OccurrenceStatus;
  reportedAt: Date;
  mandatory: boolean;
  authorityReportedAt: Date | null;
  probability: Probability | null;
  severity: Severity | null;
  investigator: string | null;
  findings: string | null;
  residualProbability: Probability | null;
  residualSeverity: Severity | null;
  version: number;
}

/** A mandatory occurrence report goes to the competent authority within 72 hours of becoming aware (376/2014 Art. 4(7)). */
export const MOR_DEADLINE_HOURS = 72;
export const morDeadline = (o: Pick<Occurrence, 'reportedAt'>) => new Date(o.reportedAt.getTime() + MOR_DEADLINE_HOURS * 3_600_000);
export function morOverdue(o: Pick<Occurrence, 'reportedAt' | 'mandatory' | 'authorityReportedAt'>, now: Date): boolean {
  return o.mandatory && !o.authorityReportedAt && now.getTime() > morDeadline(o).getTime();
}

/** The safety office classifies the report and assesses the risk. Not tolerable → investigation is required. */
export function triage(o: Occurrence, i: { mandatory: boolean; probability: Probability; severity: Severity; investigator: string | null }): Occurrence {
  if (o.status !== 'REPORTED' && o.status !== 'TRIAGED') throw new DomainError('OCCURRENCE_STATE', `${o.id} is ${o.status.toLowerCase().replace('_', ' ')}`, 409);
  const r = risk(i.probability, i.severity);
  if (r.tolerability !== 'ACCEPTABLE' && !i.investigator) {
    throw new DomainError('INVESTIGATION_REQUIRED', `Risk ${r.index} is ${r.tolerability.toLowerCase()}: assign an investigator`, 422);
  }
  return {
    ...o, mandatory: i.mandatory, probability: i.probability, severity: i.severity, investigator: i.investigator,
    status: i.investigator ? 'UNDER_INVESTIGATION' : 'TRIAGED', version: o.version + 1
  };
}

/**
 * Closure: risk assessed; MOR filed with the authority if mandatory; investigation findings recorded when one
 * was opened; every corrective action verified; and the residual risk after the actions not intolerable.
 */
export function closeOccurrence(
  o: Occurrence, i: { residualProbability: Probability; residualSeverity: Severity; findings: string | null }, actions: { status: ActionStatus }[]
): Occurrence {
  if (o.status === 'CLOSED') throw new DomainError('OCCURRENCE_STATE', `${o.id} is already closed`, 409);
  if (o.status === 'REPORTED' || o.probability === null) throw new DomainError('NOT_TRIAGED', 'Assess the risk before closing', 422);
  if (o.mandatory && !o.authorityReportedAt) throw new DomainError('MOR_NOT_FILED', 'A mandatory occurrence must be reported to the authority before closure', 422);
  const findings = i.findings?.trim() || o.findings;
  if (o.status === 'UNDER_INVESTIGATION' && (!findings || findings.length < 20)) throw new DomainError('FINDINGS_REQUIRED', 'Record the investigation findings (20+ characters)', 422);
  const open = actions.filter(a => a.status !== 'VERIFIED' && a.status !== 'CANCELLED');
  if (open.length) throw new DomainError('ACTIONS_OPEN', `${open.length} corrective action(s) not yet verified`, 422);
  if (risk(i.residualProbability, i.residualSeverity).tolerability === 'INTOLERABLE') throw new DomainError('RISK_INTOLERABLE', 'The residual risk is still intolerable: more action is needed', 422);
  return { ...o, status: 'CLOSED', findings: findings ?? null, residualProbability: i.residualProbability, residualSeverity: i.residualSeverity, version: o.version + 1 };
}

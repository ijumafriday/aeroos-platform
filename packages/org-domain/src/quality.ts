import { DomainError } from '@aeroos/kernel';
import type { ActionStatus } from './corrective-action';

/** Quality assurance and conformity rules: audits, findings, root cause and verified CAPA. */
export type FindingLevel = 'LEVEL_1' | 'LEVEL_2' | 'OBSERVATION';
export type FindingStatus = 'OPEN' | 'CLOSED';

export type QualityRiskClass = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export interface QualityRiskAssessment { likelihood: number; impact: number; score: number; classification: QualityRiskClass }

/**
 * Quality finding risk matrix. Likelihood and compliance/quality impact are each 1..5.
 * The matrix is deliberately separate from the SMS safety matrix: it prioritises assurance,
 * CAPA and surveillance response and does not substitute for operational safety risk assessment.
 */
export function assessQualityRisk(likelihood: number, impact: number): QualityRiskAssessment {
  if (!Number.isInteger(likelihood) || likelihood < 1 || likelihood > 5) throw new DomainError('QUALITY_LIKELIHOOD_INVALID', 'Likelihood must be an integer from 1 to 5', 422);
  if (!Number.isInteger(impact) || impact < 1 || impact > 5) throw new DomainError('QUALITY_IMPACT_INVALID', 'Impact must be an integer from 1 to 5', 422);
  const score = likelihood * impact;
  const classification: QualityRiskClass = score >= 20 ? 'CRITICAL' : score >= 12 ? 'HIGH' : score >= 6 ? 'MEDIUM' : 'LOW';
  return { likelihood, impact, score, classification };
}

export const qualityResponseWindowDays = (risk: QualityRiskClass): number =>
  risk === 'CRITICAL' ? 1 : risk === 'HIGH' ? 7 : risk === 'MEDIUM' ? 30 : 90;

/** Internal policy aligned with the authority's: level 1 within 7 days, level 2 within 90 days, observations 180. */
export const FINDING_DAYS: Record<FindingLevel, number> = { LEVEL_1: 7, LEVEL_2: 90, OBSERVATION: 180 };
export const findingDue = (level: FindingLevel, raisedAt: Date) => new Date(raisedAt.getTime() + FINDING_DAYS[level] * 86_400_000);

export interface Finding {
  id: string;
  level: FindingLevel;
  status: FindingStatus;
  raisedBy: string;
  rootCause: string | null;
  version: number;
}

/** A finding closes when its root cause is known and its corrective actions are verified (observations may have none). */
export function closeFinding(f: Finding, actions: { status: ActionStatus }[], by: string): Finding {
  if (f.status === 'CLOSED') throw new DomainError('FINDING_CLOSED', `${f.id} is already closed`, 409);
  if (f.level !== 'OBSERVATION') {
    if (!f.rootCause || f.rootCause.trim().length < 10) throw new DomainError('ROOT_CAUSE_REQUIRED', 'Record the root cause (10+ characters) before closure', 422);
    if (!actions.some(a => a.status === 'VERIFIED')) throw new DomainError('ACTION_REQUIRED', 'A level 1 or 2 finding needs at least one verified corrective action', 422);
  }
  const open = actions.filter(a => a.status !== 'VERIFIED' && a.status !== 'CANCELLED');
  if (open.length) throw new DomainError('ACTIONS_OPEN', `${open.length} corrective action(s) not yet verified`, 422);
  if (f.raisedBy === by && f.level === 'LEVEL_1') throw new DomainError('FOUR_EYES', 'A level 1 finding is closed by someone other than the auditor who raised it', 422);
  return { ...f, status: 'CLOSED', version: f.version + 1 };
}

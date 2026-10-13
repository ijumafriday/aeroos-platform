import { DomainError } from '@aeroos/kernel';

/** Shared action primitive. Ownership remains with the originating domain (Safety or Quality). */
export type ActionStatus = 'OPEN' | 'DONE' | 'VERIFIED' | 'CANCELLED';

export interface CorrectiveAction {
  id: string;
  owner: string;
  status: ActionStatus;
  doneBy: string | null;
  version: number;
}

export function completeAction(a: CorrectiveAction, by: string, evidence: string, isManager: boolean): CorrectiveAction {
  if (a.status !== 'OPEN') throw new DomainError('ACTION_STATE', `${a.id} is ${a.status.toLowerCase()}`, 409);
  if (a.owner !== by && !isManager) throw new DomainError('NOT_OWNER', `${a.id} is assigned to ${a.owner}`, 422);
  if (evidence.trim().length < 10) throw new DomainError('EVIDENCE_REQUIRED', 'Describe what was done and where the evidence is (10+ characters)', 422);
  return { ...a, status: 'DONE', doneBy: by, version: a.version + 1 };
}

/** Effectiveness is verified by someone other than the person who did the work; rejection reopens it. */
export function verifyAction(a: CorrectiveAction, by: string, effective: boolean): CorrectiveAction {
  if (a.status !== 'DONE') throw new DomainError('ACTION_STATE', `${a.id} is ${a.status.toLowerCase()}, not done`, 409);
  if (a.doneBy === by) throw new DomainError('FOUR_EYES', 'The effectiveness of an action is verified by someone other than who did it', 422);
  return { ...a, status: effective ? 'VERIFIED' : 'OPEN', doneBy: effective ? a.doneBy : null, version: a.version + 1 };
}

import type { CurrencyFacts } from '@aeroos/compliance';
import type { TrainingCourse } from '@aeroos/contracts';

export interface TrainingRecord {
  course: TrainingCourse;
  completedAt: Date;
}

/** "YYYY-MM" in UTC. Experience is counted in whole calendar months. */
export const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/**
 * Distinct calendar months with recorded maintenance experience in the 24 months ending at `at`
 * (the current month counts as the 24th).
 */
export function experienceMonthsLast24(workDates: Date[], at: Date): number {
  const earliest = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 23, 1));
  const months = new Set<string>();
  for (const d of workDates) {
    if (d.getTime() >= earliest.getTime() && d.getTime() <= at.getTime()) months.add(monthKey(d));
  }
  return months.size;
}

/** Continuation training includes human factors (AMC 145.A.35(d)); either course refreshes the cycle. */
const CONTINUATION: TrainingCourse[] = ['CONTINUATION', 'HUMAN_FACTORS'];

export function lastContinuationTraining(records: TrainingRecord[], at: Date): Date | null {
  const dates = records
    .filter(r => CONTINUATION.includes(r.course) && r.completedAt.getTime() <= at.getTime())
    .map(r => r.completedAt.getTime());
  return dates.length ? new Date(Math.max(...dates)) : null;
}

export function currencyFacts(workDates: Date[], training: TrainingRecord[], at: Date): CurrencyFacts {
  return { experienceMonthsLast24: experienceMonthsLast24(workDates, at), lastContinuationTraining: lastContinuationTraining(training, at), at };
}

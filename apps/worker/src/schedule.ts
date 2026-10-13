/**
 * Pure escalation scheduling, shared by the workflow and its unit tests.
 * Kept free of Temporal imports so it can be tested with the plain Node test runner.
 */
export type Level = 'T-24h' | 'T-6h' | 'EXPIRED';

const H = 3_600_000;
export const LEVELS: { level: Level; before: number }[] = [
  { level: 'T-24h', before: 24 * H },
  { level: 'T-6h', before: 6 * H },
  { level: 'EXPIRED', before: 0 }
];

/**
 * Given the deadline, the current time and what has been sent, decide what to do now:
 * send the most severe due escalation (marking lesser due ones as sent, so a deferral raised with
 * 4 hours left gets one "T-6h" alert, not two), or wait until the next threshold.
 */
export function plan(deadline: number, now: number, sent: ReadonlySet<Level>): { send: Level | null; markSent: Level[]; waitMs: number | null } {
  const due = LEVELS.filter(l => !sent.has(l.level) && now >= deadline - l.before);
  if (due.length) return { send: due[due.length - 1].level, markSent: due.map(l => l.level), waitMs: null };
  const next = LEVELS.find(l => !sent.has(l.level));
  return { send: null, markSent: [], waitMs: next ? Math.max(1, deadline - next.before - now) : null };
}

/** After an extension, thresholds that are in the future again become eligible. */
export function resetAfterExtension(deadline: number, now: number, sent: Set<Level>) {
  for (const l of LEVELS) if (now < deadline - l.before) sent.delete(l.level);
}

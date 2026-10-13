import { DAY_MS } from '@aeroos/kernel';
import type { Severity } from '@aeroos/contracts';

/**
 * Warning ladder for anything with a validity date (authorisations, licences, training).
 * Pure, so the hourly sweep and the UI agree on what "due" means.
 */
export const EXPIRY_LEVELS = [
  { level: 'T-90', beforeMs: 90 * DAY_MS, severity: 'cyan' as Severity },
  { level: 'T-30', beforeMs: 30 * DAY_MS, severity: 'amber' as Severity },
  { level: 'T-7', beforeMs: 7 * DAY_MS, severity: 'red' as Severity },
  { level: 'EXPIRED', beforeMs: 0, severity: 'red' as Severity }
] as const;

export type ExpiryLevel = (typeof EXPIRY_LEVELS)[number]['level'];

export interface ExpiryStep { level: ExpiryLevel; at: number; severity: Severity }

/**
 * For periodic sweeps: the most severe level already reached at `now`, or null if still outside
 * the T-90 window. The sweep sends it once (deduplicated by subject, level and validity date).
 */
export function reachedLevel(validUntilMs: number, nowMs: number): ExpiryStep | null {
  const passed = EXPIRY_LEVELS.filter(l => validUntilMs - l.beforeMs <= nowMs);
  const l = passed[passed.length - 1];
  return l ? { level: l.level, at: validUntilMs - l.beforeMs, severity: l.severity } : null;
}

/** The next validity date to watch, for dashboards ("next expiry"). */
export function nextExpiry(items: { what: string; at: Date }[], now: Date): { what: string; at: Date } | null {
  return items.filter(i => i.at.getTime() > now.getTime()).sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null;
}

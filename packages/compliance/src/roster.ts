import { DAY_MS, HOUR_MS } from '@aeroos/kernel';
import { zoneOffsetMinutes } from './time';
import type { DutyFact, DutyFacts, RosterViolation, RosterViolationCode } from './types';

/**
 * Authority-neutral mechanics of flight and duty time checks: windows, sums and rest gaps.
 * The limits themselves (and which windows exist) are passed in by each rulepack, so the numbers
 * and references stay in the rulepack where an auditor expects them.
 */

const MIN = 60_000;

export const sortDuties = (d: DutyFact[]) => [...d].sort((a, b) => a.report.getTime() - b.report.getTime());

/** Minutes of `pick` that fall inside [from, to), clipping duties that straddle the window edge. */
function minutesWithin(duties: DutyFact[], from: number, to: number, pick: 'duty' | 'flight'): number {
  let total = 0;
  for (const d of duties) {
    const start = d.report.getTime();
    const end = d.dutyEnd.getTime();
    const overlap = Math.max(0, Math.min(end, to) - Math.max(start, from));
    if (overlap <= 0) continue;
    if (pick === 'duty') total += overlap / MIN;
    else total += d.flightMinutes * (overlap / Math.max(1, end - start)); // flight time pro rata when clipped
  }
  return Math.round(total);
}

export interface WindowLimit {
  code: RosterViolationCode;
  pick: 'duty' | 'flight';
  /** Rolling window length; or 'calendar-year' for flight time in the calendar year of the duty. */
  window: number | 'calendar-year';
  limitMinutes: number;
  label: string;
  ref: string;
}

export function windowViolations(duties: DutyFact[], limits: WindowLimit[]): RosterViolation[] {
  const out: RosterViolation[] = [];
  for (const l of limits) {
    for (const d of duties) {
      const end = d.dutyEnd.getTime();
      const from = l.window === 'calendar-year' ? Date.UTC(new Date(end).getUTCFullYear(), 0, 1) : end - l.window;
      const actual = minutesWithin(duties, from, end, l.pick);
      if (actual > l.limitMinutes) {
        out.push({
          dutyId: d.id, code: l.code, severity: 'violation', ref: l.ref, limitMinutes: l.limitMinutes, actualMinutes: actual,
          message: `${l.label}: ${hm(actual)} exceeds ${hm(l.limitMinutes)}`
        });
        break; // the first duty that breaks a window is enough to report it
      }
    }
  }
  return out;
}

/** Rest before each duty: `minRest(prev, next)` returns the minimum in minutes for that gap. */
export function restViolations(duties: DutyFact[], minRest: (prev: DutyFact, next: DutyFact) => number, ref: string): RosterViolation[] {
  const out: RosterViolation[] = [];
  for (let i = 1; i < duties.length; i++) {
    const prev = duties[i - 1];
    const next = duties[i];
    const rest = Math.round((next.report.getTime() - prev.dutyEnd.getTime()) / MIN);
    const min = minRest(prev, next);
    if (rest < min) {
      out.push({
        dutyId: next.id, code: 'REST', severity: 'violation', ref, limitMinutes: min, actualMinutes: Math.max(0, rest),
        message: `Rest before duty ${next.id}: ${hm(Math.max(0, rest))} is less than the required ${hm(min)}${next.restAtHomeBase ? ' (home base)' : ' (away from base)'}`
      });
    }
  }
  return out;
}

/** FDP check using the rulepack's own max-FDP table; exceedance up to `discretionMinutes` is reported as discretion. */
export function fdpViolations(
  duties: DutyFact[], maxFdp: (f: DutyFacts) => number, discretionMinutes: number, ref: string
): RosterViolation[] {
  const out: RosterViolation[] = [];
  for (const d of duties) {
    const actual = Math.round((d.fdpEnd.getTime() - d.report.getTime()) / MIN);
    let max: number;
    try {
      max = maxFdp({ reportLocal: localTime(d.report, d.reportTimeZone), sectors: d.sectors, acclimatised: d.acclimatised });
    } catch (e) {
      out.push({ dutyId: d.id, code: 'FDP_UNSUPPORTED', severity: 'violation', ref, limitMinutes: null, actualMinutes: actual, message: `${(e as Error).message} — check this duty manually` });
      continue;
    }
    if (actual > max) {
      const over = actual - max;
      out.push({
        dutyId: d.id, code: 'FDP', severity: over <= discretionMinutes ? 'discretion' : 'violation', ref, limitMinutes: max, actualMinutes: actual,
        message: over <= discretionMinutes
          ? `FDP ${hm(actual)} exceeds the ${hm(max)} limit by ${hm(over)} — only within commander's discretion`
          : `FDP ${hm(actual)} exceeds the ${hm(max)} limit by ${hm(over)}`
      });
    }
  }
  return out;
}

export function localTime(t: Date, zone: string): { hour: number; minute: number } {
  const l = new Date(t.getTime() + zoneOffsetMinutes(t.getTime(), zone) * MIN);
  return { hour: l.getUTCHours(), minute: l.getUTCMinutes() };
}

export const hm = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
export const DAYS = (n: number) => n * DAY_MS;
export const HOURS = (n: number) => n * HOUR_MS;

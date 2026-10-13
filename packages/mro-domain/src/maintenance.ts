import { DAY_MS } from '@aeroos/kernel';

/**
 * Maintenance programme engine: one model for scheduled tasks (AMP), airworthiness directives (AD)
 * and life-limited parts (LLP). Each requirement has an interval in flight hours, flight cycles and/or
 * calendar days — "whichever comes first" — with optional approved tolerances.
 *
 * Life-limited parts use the same arithmetic: the "last done" point is the virtual moment the part was
 * new (aircraft counters at installation minus the part's own time/cycles since new), and the interval
 * is the life limit. One engine, one due list, one forecast.
 */

export type RequirementKind = 'TASK' | 'AD' | 'SB' | 'LLP';

export interface Interval {
  fh?: number;
  fc?: number;
  days?: number;
  /** Approved tolerance beyond the interval (AMP-defined); never applies to ADs or LLPs. */
  toleranceFh?: number;
  toleranceFc?: number;
  toleranceDays?: number;
}

export interface Requirement {
  id: string;
  kind: RequirementKind;
  ref: string;
  title: string;
  ata: string;
  types: string[];
  interval: Interval;
  /** Repetitive tasks/ADs re-arm after each compliance; one-time ADs and LLP replacements do not. */
  repetitive: boolean;
  steps: string[];
  estimatedHours: number;
  tools: string[];
  parts: { partNo: string; qty: number }[];
}

/** Aircraft counters at an instant (hours as decimals). */
export interface Counters { at: Date; fh: number; fc: number }

/** The point from which the next due is counted. Null = since aircraft new (zero counters at delivery). */
export type LastDone = Counters | null;

export interface Utilisation { fhPerDay: number; fcPerDay: number }

export type DueStatus = 'OK' | 'DUE_SOON' | 'IN_TOLERANCE' | 'OVERDUE' | 'COMPLIED';

export interface DueItem {
  requirementId: string;
  kind: RequirementKind;
  ref: string;
  title: string;
  status: DueStatus;
  next: { fh: number | null; fc: number | null; date: Date | null };
  remaining: { fh: number | null; fc: number | null; days: number | null };
  /** Which dimension comes first at the current utilisation. */
  limiting: 'FH' | 'FC' | 'DAYS' | null;
  /** Forecast date the item falls due (the earliest dimension), from average utilisation. */
  forecast: Date | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function dueItem(
  req: Requirement, current: Counters, lastDone: LastDone, delivery: Date, util: Utilisation,
  opts: { dueSoonDays: number; complied?: boolean } = { dueSoonDays: 14 }
): DueItem {
  const base = { requirementId: req.id, kind: req.kind, ref: req.ref, title: req.title };
  if (!req.repetitive && opts.complied) {
    return { ...base, status: 'COMPLIED', next: { fh: null, fc: null, date: null }, remaining: { fh: null, fc: null, days: null }, limiting: null, forecast: null };
  }
  const from = lastDone ?? { at: delivery, fh: 0, fc: 0 };
  const i = req.interval;
  const next = {
    fh: i.fh !== undefined ? round1(from.fh + i.fh) : null,
    fc: i.fc !== undefined ? Math.round(from.fc + i.fc) : null,
    date: i.days !== undefined ? new Date(from.at.getTime() + i.days * DAY_MS) : null
  };
  const remaining = {
    fh: next.fh !== null ? round1(next.fh - current.fh) : null,
    fc: next.fc !== null ? next.fc - current.fc : null,
    days: next.date !== null ? Math.floor((next.date.getTime() - current.at.getTime()) / DAY_MS) : null
  };
  // Days until due for each dimension, using average utilisation for hours and cycles.
  const inDays: [DueItem['limiting'], number][] = [];
  if (remaining.fh !== null) inDays.push(['FH', util.fhPerDay > 0 ? remaining.fh / util.fhPerDay : remaining.fh <= 0 ? remaining.fh : Infinity]);
  if (remaining.fc !== null) inDays.push(['FC', util.fcPerDay > 0 ? remaining.fc / util.fcPerDay : remaining.fc <= 0 ? remaining.fc : Infinity]);
  if (next.date !== null) inDays.push(['DAYS', (next.date.getTime() - current.at.getTime()) / DAY_MS]);
  inDays.sort((a, b) => a[1] - b[1]);
  const [limiting, days] = inDays[0] ?? [null, Infinity];

  const over = (rem: number | null, tol: number | undefined) => rem !== null && rem < 0 && (tol === undefined || req.kind !== 'TASK' || -rem > tol);
  const inTol = (rem: number | null) => rem !== null && rem < 0;
  let status: DueStatus = 'OK';
  if (over(remaining.fh, i.toleranceFh) || over(remaining.fc, i.toleranceFc) || over(remaining.days, i.toleranceDays)) status = 'OVERDUE';
  else if (inTol(remaining.fh) || inTol(remaining.fc) || inTol(remaining.days)) status = 'IN_TOLERANCE';
  else if (days <= opts.dueSoonDays) status = 'DUE_SOON';

  return {
    ...base, status, next, remaining, limiting,
    forecast: Number.isFinite(days) ? new Date(current.at.getTime() + Math.max(0, days) * DAY_MS) : null
  };
}

/** Average daily utilisation over a window, from completed flights (block hours, one cycle each). */
export function utilisation(flights: { arrivedAt: Date; blockMinutes: number }[], now: Date, windowDays = 30): Utilisation {
  const from = now.getTime() - windowDays * DAY_MS;
  const recent = flights.filter(f => f.arrivedAt.getTime() > from && f.arrivedAt.getTime() <= now.getTime());
  const fh = recent.reduce((n, f) => n + f.blockMinutes / 60, 0);
  return { fhPerDay: round1(fh / windowDays), fcPerDay: round1(recent.length / windowDays) };
}

/** For a part installed with its own time/cycles since new: the virtual "new" point on the aircraft's counters. */
export function llpNewPoint(aircraftAtInstall: Counters, partTsn: number, partCsn: number): Counters {
  return { at: aircraftAtInstall.at, fh: round1(aircraftAtInstall.fh - partTsn), fc: aircraftAtInstall.fc - partCsn };
}

/** Requirements whose state makes the aircraft unairworthy (ATA-independent). */
export const grounding = (items: DueItem[]) => items.filter(d => d.status === 'OVERDUE');

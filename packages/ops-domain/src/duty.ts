import type { DutyFact } from '@aeroos/compliance';
import { isLive, type Flight } from './flight';

const MIN = 60_000;

/** Operator FTL scheme values (ORO.FTL.105 definitions; scheme-specific report/post-flight times). */
export interface DutyScheme {
  reportBeforeMinutes: number;
  postFlightMinutes: number;
  homeBase: string;
  zoneOf(icao: string): string;
}

export const DEFAULT_SCHEME: Omit<DutyScheme, 'homeBase' | 'zoneOf'> = { reportBeforeMinutes: 60, postFlightMinutes: 30 };

/** `positioning`: carried as a passenger at the operator's behest (deadhead) — duty, not a sector (ORO.FTL.105, .220). */
export interface CrewLeg { dutyKey: string; flight: Flight; positioning?: boolean }
export interface Duty extends DutyFact { legs: Flight[] }

/**
 * Build duty periods from the legs a crew member is rostered on. Legs are grouped by duty key
 * (one pairing day); cancelled legs do not count. Times follow the *estimated* schedule, so a delay
 * immediately shows its effect on FDP and rest.
 */
export function buildDuties(legs: CrewLeg[], scheme: DutyScheme): Duty[] {
  const groups = new Map<string, CrewLeg[]>();
  for (const l of legs) {
    if (!isLive(l.flight)) continue;
    groups.set(l.dutyKey, [...(groups.get(l.dutyKey) ?? []), l]);
  }
  const duties: Duty[] = [];
  for (const [key, group] of groups) {
    const seq = group.sort((a, b) => a.flight.etd.getTime() - b.flight.etd.getTime());
    const operating = seq.filter(l => !l.positioning).map(l => l.flight);
    const first = seq[0].flight;
    const last = seq[seq.length - 1].flight;
    // ORO.FTL.220: positioning before operating counts as FDP (not as a sector); positioning after the last
    // operating sector is duty but not FDP.
    const lastOperating = operating[operating.length - 1] ?? last;
    const report = new Date(first.etd.getTime() - scheme.reportBeforeMinutes * MIN);
    const postFlightEnd = lastOperating.eta.getTime() + scheme.postFlightMinutes * MIN;
    duties.push({
      id: key,
      report,
      fdpEnd: lastOperating.eta,
      dutyEnd: new Date(Math.max(postFlightEnd, last.eta.getTime())),
      sectors: operating.length,
      flightMinutes: operating.reduce((n, f) => n + Math.round((f.eta.getTime() - f.etd.getTime()) / MIN), 0),
      reportTimeZone: scheme.zoneOf(first.dep),
      acclimatised: true,
      restAtHomeBase: first.dep === scheme.homeBase,
      legs: seq.map(l => l.flight)
    });
  }
  return duties.sort((a, b) => a.report.getTime() - b.report.getTime());
}

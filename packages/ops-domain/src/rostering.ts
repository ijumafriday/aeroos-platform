import { DomainError } from '@aeroos/kernel';
import type { DutyFact } from '@aeroos/compliance';
import { buildDuties, type CrewLeg, type Duty, type DutyScheme } from './duty';
import { typeRating, type CrewRecord, type CrewRosterLeg, type RosterJudge } from './crew-recovery';
import type { Flight } from './flight';

/**
 * Rostering: cut unrostered flights into pairings (one duty each, base to base), assign a captain and a first
 * officer to each so that every crew member's roster stays within the flight-time limitations (the rulepack
 * judges), respecting leave and days off, spreading the flying fairly and avoiding fatiguing duties.
 * Rosters are published at least 14 days ahead (ORO.FTL.110(b)); later changes are shown to the crew member
 * until acknowledged.
 */

const MIN = 60_000, H = 3_600_000;

/* ------------------------------------------------------------------ pairings */

export interface Pairing { key: string; date: string; tail: string; aircraftType: string; base: string; legs: Flight[]; dutyNos?: number[] }

/**
 * Cut each aircraft's day into duties: a duty starts where the aircraft is and ends on a leg arriving back there,
 * cut when the next leg departs 90 minutes or more later or the duty would pass 9 hours. Legs that never get
 * back to the start of the duty stay together (night stop) and are listed for manual planning.
 */
export function pairings(flights: Flight[]): Pairing[] {
  const live = flights.filter(f => f.status !== 'CANCELLED');
  const byTailDay = new Map<string, Flight[]>();
  for (const f of live) byTailDay.set(`${f.date}|${f.tail}`, [...(byTailDay.get(`${f.date}|${f.tail}`) ?? []), f]);
  const out: Pairing[] = [];
  for (const [k, legs] of [...byTailDay.entries()].sort()) {
    const [date, tail] = k.split('|');
    legs.sort((a, b) => a.etd.getTime() - b.etd.getTime());
    let cur: Flight[] = [];
    let n = 0;
    const flush = () => {
      if (!cur.length) return;
      out.push({ key: `${date}-${tail}-P${++n}`, date, tail, aircraftType: cur[0].aircraftType, base: cur[0].dep, legs: cur });
      cur = [];
    };
    for (let i = 0; i < legs.length; i++) {
      const f = legs[i];
      cur.push(f);
      const next = legs[i + 1];
      const backAtStart = f.arr === cur[0].dep;
      const gap = next ? next.etd.getTime() - f.eta.getTime() : Infinity;
      const span = next ? next.eta.getTime() - cur[0].etd.getTime() : 0;
      if (backAtStart && (gap >= 90 * MIN || span > 9 * H)) flush();
    }
    flush();
  }
  return out;
}

/* ------------------------------------------------------------------ fatigue */

export type FatigueBand = 'LOW' | 'MODERATE' | 'HIGH';

const localHour = (d: Date, tz: string) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  return Number(parts.find(p => p.type === 'hour')!.value) + Number(parts.find(p => p.type === 'minute')!.value) / 60;
};

/** Minutes of [start, end] inside the window of circadian low (02:00–05:59 local, ORO.FTL.105). */
export function woclMinutes(start: Date, end: Date, tz: string): number {
  let m = 0;
  for (let t = start.getTime(); t < end.getTime(); t += 15 * MIN) {
    const h = localHour(new Date(t), tz);
    if (h >= 2 && h < 6) m += 15;
  }
  return m;
}

/**
 * A simple, transparent fatigue index for planning (0–100) — NOT a validated biomathematical model: it ranks
 * duties so the planner and the fatigue safety action group can see which ones to look at. Points for WOCL
 * encroachment, early starts, long FDPs, many sectors, short preceding rest and consecutive early starts.
 */
export function fatigueScore(d: DutyFact, prev: DutyFact | null): { score: number; band: FatigueBand; reasons: string[] } {
  const reasons: string[] = [];
  let s = 0;
  const report = localHour(d.report, d.reportTimeZone);
  const wocl = woclMinutes(d.report, d.dutyEnd, d.reportTimeZone);
  if (wocl > 0) { s += Math.min(30, Math.round(wocl / 4)); reasons.push(`${wocl} min in the window of circadian low`); }
  if (report >= 5 && report < 7) { s += 12; reasons.push('early start (before 07:00)'); }
  const fdpH = (d.fdpEnd.getTime() - d.report.getTime()) / H;
  if (fdpH > 10) { s += Math.round((fdpH - 10) * 8) + 10; reasons.push(`long flight duty period (${fdpH.toFixed(1)} h)`); }
  if (d.sectors > 4) { s += (d.sectors - 4) * 6; reasons.push(`${d.sectors} sectors`); }
  if (prev) {
    const rest = (d.report.getTime() - prev.dutyEnd.getTime()) / H;
    if (rest < 12) { s += 15; reasons.push(`only ${rest.toFixed(1)} h rest before`); }
    const prevReport = localHour(prev.report, prev.reportTimeZone);
    if (prevReport < 7 && report < 7 && rest < 30) { s += 10; reasons.push('consecutive early starts'); }
  }
  const score = Math.min(100, s);
  return { score, band: score >= 60 ? 'HIGH' : score >= 30 ? 'MODERATE' : 'LOW', reasons };
}

/** Fatigue of each duty in a roster, in time order. */
export function rosterFatigue(duties: Duty[]): Map<string, ReturnType<typeof fatigueScore>> {
  const sorted = [...duties].sort((a, b) => a.report.getTime() - b.report.getTime());
  return new Map(sorted.map((d, i) => [d.id, fatigueScore(d, sorted[i - 1] ?? null)]));
}

/* ------------------------------------------------------------------ roster builder */

/** STANDBY: a standby shift — the crew member is the cover for the day of operation, not available to roster. */
export type UnavailabilityKind = 'LEAVE' | 'SICK' | 'OFF' | 'TRAINING' | 'STANDBY';
export interface Unavailability { crewId: string; kind: UnavailabilityKind; start: Date; end: Date }

export interface RosterAssignment { pairingKey: string; flightIds: string[]; dutyNos?: number[]; crewId: string; role: 'CPT' | 'FO'; fatigue: number; note: string }
export interface Unfilled { pairingKey: string; role: 'CPT' | 'FO'; reason: string }

/**
 * Greedy, chronological: each pairing, captain then first officer, goes to the eligible crew member with the
 * least flying in the period, with a penalty for fatiguing duties and for FTL discretion. Eligible means: rank,
 * type rating, based where the pairing starts and ends, not on leave/sick/off/training, not already flying then,
 * and a roster that stays legal with the pairing added (the rulepack judges the whole roster).
 */
export function buildRoster(
  ps: Pairing[], crew: CrewRecord[], rosters: Map<string, CrewRosterLeg[]>, away: Unavailability[],
  scheme: (base: string) => DutyScheme, judge: RosterJudge,
  preferenceCost: (crew: CrewRecord, pairing: Pairing) => number = () => 0
): { assignments: RosterAssignment[]; unfilled: Unfilled[] } {
  const own = new Map<string, CrewLeg[]>([...crew.map(c => [c.id, [...(rosters.get(c.id) ?? [])]] as [string, CrewLeg[]])]);
  // fairness counts flying inside the period being rostered (not history, which would favour crew who never fly)
  const pStart = Math.min(...ps.map(p => p.legs[0].etd.getTime())) - 24 * H, pEnd = Math.max(...ps.map(p => p.legs[p.legs.length - 1].eta.getTime())) + 24 * H;
  const flown = new Map<string, number>(crew.map(c => [c.id, (rosters.get(c.id) ?? [])
    .filter(l => !l.positioning && l.flight.etd.getTime() >= pStart && l.flight.etd.getTime() < pEnd)
    .reduce((n, l) => n + (l.flight.eta.getTime() - l.flight.etd.getTime()) / MIN, 0)]));
  const assignments: RosterAssignment[] = [];
  const unfilled: Unfilled[] = [];
  for (const p of [...ps].sort((a, b) => a.legs[0].etd.getTime() - b.legs[0].etd.getTime())) {
    const first = p.legs[0], last = p.legs[p.legs.length - 1];
    for (const role of ['CPT', 'FO'] as const) {
      if (last.arr !== first.dep) { unfilled.push({ pairingKey: p.key, role, reason: `Ends away from ${first.dep} (night stop): plan it by hand` }); continue; }
      const sch0 = scheme(first.dep);
      const dutyStart = new Date(first.etd.getTime() - sch0.reportBeforeMinutes * MIN);
      const dutyEnd = new Date(last.eta.getTime() + sch0.postFlightMinutes * MIN);
      let best: { c: CrewRecord; cost: number; fatigue: number; note: string } | null = null;
      const why = new Map<string, number>();
      const reject = (r: string) => why.set(r, (why.get(r) ?? 0) + 1);
      for (const c of crew) {
        if (c.rank !== role) continue;
        if (!c.qualifications.includes(typeRating(p.aircraftType))) { reject('type rating'); continue; }
        if (c.base !== first.dep) { reject('base'); continue; }
        if (away.some(a => a.crewId === c.id && a.start.getTime() < dutyEnd.getTime() && a.end.getTime() > dutyStart.getTime())) { reject('leave / days off / standby'); continue; }
        const mine = own.get(c.id)!;
        if (mine.some(l => l.flight.etd.getTime() < dutyEnd.getTime() && l.flight.eta.getTime() > dutyStart.getTime())) { reject('already flying'); continue; }
        const keys = p.legs.map((_, i) => `${p.key}:${c.id}:D${p.dutyNos?.[i] ?? 1}`);
        const duties = buildDuties([...mine, ...p.legs.map((f, i) => ({ dutyKey: keys[i], flight: f }))], scheme(c.base));
        const v = judge(duties);
        if (v.status === 'VIOLATION') { reject('flight-time limitations'); continue; }
        const pairingDuties = duties.filter(d => d.id.startsWith(`${p.key}:${c.id}:D`));
        const fat = pairingDuties.length ? Math.max(...pairingDuties.map(d => rosterFatigue(duties).get(d.id)?.score ?? 0)) : 0;
        const cost = flown.get(c.id)! + fat * 3 + (v.status === 'DISCRETION' ? 600 : 0) + preferenceCost(c, p);
        if (!best || cost < best.cost || (cost === best.cost && c.id < best.c.id)) {
          best = { c, cost, fatigue: fat, note: v.status === 'DISCRETION' ? `commander's discretion: ${v.message ?? ''}` : '' };
        }
      }
      if (!best) {
        unfilled.push({ pairingKey: p.key, role, reason: why.size ? `No eligible ${role}: ${[...why.entries()].map(([r, n]) => `${n} × ${r}`).join(', ')}` : `No ${role} in the crew list` });
        continue;
      }
      const keys = p.legs.map((_, i) => `${p.key}:${best.c.id}:D${p.dutyNos?.[i] ?? 1}`);
      own.get(best.c.id)!.push(...p.legs.map((f, i) => ({ dutyKey: keys[i], flight: f })));
      flown.set(best.c.id, flown.get(best.c.id)! + p.legs.reduce((n, f) => n + (f.eta.getTime() - f.etd.getTime()) / MIN, 0));
      assignments.push({ pairingKey: p.key, flightIds: p.legs.map(f => f.id), dutyNos: p.dutyNos, crewId: best.c.id, role, fatigue: best.fatigue, note: best.note });
    }
  }
  return { assignments, unfilled };
}

/* ------------------------------------------------------------------ publication */

/** ORO.FTL.110(b): rosters are published at least 14 days in advance. */
export const PUBLISH_DAYS_AHEAD = 14;
export function publicationNotice(from: string, now: Date): string | null {
  const days = Math.floor((Date.parse(`${from}T00:00:00Z`) - Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000);
  if (days < 0) throw new DomainError('PERIOD_PAST', 'The roster period has already started', 422);
  return days < PUBLISH_DAYS_AHEAD ? `Published ${days} days ahead — less than the ${PUBLISH_DAYS_AHEAD} days ORO.FTL.110(b) requires; record why in the roster notes.` : null;
}

/* ------------------------------------------------------------------ fatigue reports */

/** Karolinska Sleepiness Scale 1 (extremely alert) – 9 (fighting sleep); Samn-Perelli 1 (fully alert) – 7 (exhausted). */
export function fatigueReportSeverity(kss: number, samnPerelli: number): 'LOW' | 'MODERATE' | 'HIGH' {
  if (!Number.isInteger(kss) || kss < 1 || kss > 9 || !Number.isInteger(samnPerelli) || samnPerelli < 1 || samnPerelli > 7) {
    throw new DomainError('FATIGUE_SCALE', 'KSS 1–9 and Samn-Perelli 1–7', 422);
  }
  return kss >= 8 || samnPerelli >= 6 ? 'HIGH' : kss >= 6 || samnPerelli >= 5 ? 'MODERATE' : 'LOW';
}

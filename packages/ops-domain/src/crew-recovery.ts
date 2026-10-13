import type { CrewRecoveryProblem, CrewRecoverySolution } from '@aeroos/contracts';
import { buildDuties, type CrewLeg, type Duty, type DutyScheme } from './duty';
import { cabinOf, canChange, type Flight } from './flight';

/**
 * Crew recovery. When a change makes a duty break a flight-time limitation, the remaining legs of
 * that duty need another crew member of the same rank and type rating. Legality of every
 * (duty, candidate) pair is decided here with the rulepack; the optimiser only chooses among legal
 * options. Each candidate takes at most one duty per run (two extra duties together need their own
 * check, which the next run does with the first one applied).
 */

const MIN = 60_000;
const H = 60 * MIN;
const MIN_REST_MS = 12 * H;

/** "B737-800", "B737 MAX 8" → B737; "A320neo" → A320; "A330-300" → A330; "DHC-8-400" → DHC8; "ATR 72-600" → ATR72. */
export function typeRating(aircraftType: string): string {
  const t = aircraftType.toUpperCase();
  if (/^DHC-?8/.test(t)) return 'DHC8';
  if (/^ATR\s?72/.test(t)) return 'ATR72';
  return t.replace(/[-\s].*$/, '').replace(/NEO$/, '');
}

export interface StandbyWindow { crewId: string; start: Date; end: Date }

export interface CrewCostModel { standby: number; reserve: number; discretion: number; positioning: number; uncovered: number }
export const DEFAULT_CREW_COSTS: CrewCostModel = { standby: 10, reserve: 40, discretion: 25, positioning: 15, uncovered: 1000 };

/** Minimum time between a positioning flight's arrival and the next departure the crew member operates or rides. */
export const MIN_CONNECT_MINUTES = 45;

export interface RosterJudge {
  /** Rulepack verdict for a candidate roster: worst severity found, and the first message. */
  (duties: Duty[]): { status: 'OK' | 'DISCRETION' | 'VIOLATION'; message: string | null };
}

export interface CrewRecord { id: string; name: string; rank: 'CPT' | 'FO' | 'SCCM' | 'CC'; base: string; qualifications: string[] }
export interface CrewRosterLeg extends CrewLeg { crewId: string; role: 'CPT' | 'FO' | 'SCCM' | 'CC' }

export interface CrewTaskInput {
  crew: CrewRecord & { rank: 'CPT' | 'FO' };
  dutyKey: string;
  legs: Flight[];
  reason: string;
}

/**
 * Airport standby (ORO.FTL.225(b)): the FDP counts from the start of the FDP, but the maximum FDP is
 * reduced by standby time beyond 4 hours, and standby counts in full as duty. Modelled by moving the
 * duty's report time back by the excess, which shortens the remaining FDP allowance by the same amount.
 */
export function withStandby(d: Duty, sby: StandbyWindow): Duty {
  const excess = Math.max(0, d.report.getTime() - sby.start.getTime() - 4 * H);
  return excess ? { ...d, report: new Date(d.report.getTime() - excess) } : d;
}

/**
 * Duties that must be re-crewed. For each duty with a 'violation' finding, the hand-over is placed as
 * late as possible: the shortest tail of the duty that leaves the original crew member's roster legal.
 * A legal hand-over at the crew member's base is preferred (nobody stranded); otherwise the latest one at
 * an outstation, where the replacement is positioned on the operator's own flights (see coverVerdict). If no hand-over point helps (a rest or
 * cumulative breach), the whole remaining duty is re-crewed.
 */
export function crewTasks(
  crew: CrewRecord[], rosters: Map<string, CrewRosterLeg[]>,
  violations: Map<string, { dutyId: string; severity: 'violation' | 'discretion'; message: string }[]>,
  now: Date, scheme: (base: string) => DutyScheme, judge: RosterJudge
): CrewTaskInput[] {
  const out: CrewTaskInput[] = [];
  for (const c of crew) {
    if (c.rank !== 'CPT' && c.rank !== 'FO') continue;
    const flightDeckCrew = c as CrewRecord & { rank: 'CPT' | 'FO' };
    const seen = new Set<string>();
    const own = rosters.get(c.id) ?? [];
    for (const v of violations.get(c.id) ?? []) {
      if (v.severity !== 'violation' || seen.has(v.dutyId)) continue;
      seen.add(v.dutyId);
      // Only operating legs are handed over; positioning legs of the duty are re-planned at acceptance.
      const duty = own.filter(l => l.dutyKey === v.dutyId && !l.positioning && l.flight.status !== 'CANCELLED').map(l => l.flight).sort((a, b) => a.etd.getTime() - b.etd.getTime());
      // Every leg from k on must still be changeable: you cannot hand over legs already flown.
      const handOvers = duty.map((_, k) => k).filter(k => duty.slice(k).every(f => canChange(f) && f.etd.getTime() > now.getTime()));
      if (!handOvers.length) continue;
      const legal = handOvers.filter(k => {
        // What the original crew member keeps: operating legs before k, and positioning legs of this duty before k.
        const handOverAt = duty[k].etd.getTime();
        const kept = own.filter(l => !duty.slice(k).some(f => f.id === l.flight.id) && !(l.positioning && l.dutyKey === v.dutyId && l.flight.etd.getTime() >= handOverAt));
        return judge(buildDuties(kept, scheme(c.base))).status !== 'VIOLATION';
      });
      // Prefer handing over at base (nobody is stranded, no positioning needed); else the latest outstation point.
      const atBase = legal.filter(k => duty[k].dep === c.base);
      const from = atBase.length ? atBase[atBase.length - 1] : legal.length ? legal[legal.length - 1] : handOvers[0];
      out.push({ crew: flightDeckCrew, dutyKey: v.dutyId, legs: duty.slice(from), reason: v.message });
    }
  }
  return out.sort((a, b) => a.legs[0].etd.getTime() - b.legs[0].etd.getTime());
}

/**
 * The latest flight of the operator's network that takes a crew member from `from` to `to` in time to
 * connect (MIN_CONNECT_MINUTES) for a departure at `by`, departing after `notBefore`. Null if none.
 */
export function positioningFlight(network: Flight[], from: string, to: string, by: Date, notBefore: Date, occupancy: Occupancy = new Map()): Flight | null {
  const ok = network.filter(f => f.status !== 'CANCELLED' && f.dep === from && f.arr === to && canChange(f) && seatFor(f, occupancy)
    && f.etd.getTime() >= notBefore.getTime() && f.eta.getTime() + MIN_CONNECT_MINUTES * MIN <= by.getTime());
  return ok.sort((x, y) => y.etd.getTime() - x.etd.getTime())[0] ?? null;
}

/** First flight home after `after` (positioning back to base), within 12 h, with a seat. Null if none. */
function homeFlight(network: Flight[], from: string, base: string, after: Date, occupancy: Occupancy): Flight | null {
  const ok = network.filter(f => f.status !== 'CANCELLED' && f.dep === from && f.arr === base && canChange(f) && seatFor(f, occupancy)
    && f.etd.getTime() >= after.getTime() + MIN_CONNECT_MINUTES * MIN && f.etd.getTime() <= after.getTime() + 12 * H);
  return ok.sort((x, y) => x.etd.getTime() - y.etd.getTime())[0] ?? null;
}

/* ------------------------------------------------------------------ seats for positioning crew */


/** Positioning crew already booked on each flight (flight id → count). */
export type Occupancy = Map<string, number>;

export function occupancyOf(legs: { flight: Flight; positioning?: boolean }[]): Occupancy {
  const m: Occupancy = new Map();
  for (const l of legs) if (l.positioning) m.set(l.flight.id, (m.get(l.flight.id) ?? 0) + 1);
  return m;
}

/** Where a further positioning crew member would sit: a free passenger seat, else a free jump seat, else nowhere. */
/** Seats (cabin + jump) still free for positioning crew on a flight. */
export function seatsLeft(f: Flight, occupancy: Occupancy): number {
  const c = cabinOf(f.aircraftType);
  return Math.max(0, Math.max(0, c.seats - (f.bookedPax ?? 0)) + c.jumpSeats - (occupancy.get(f.id) ?? 0));
}

export function seatFor(f: Flight, occupancy: Occupancy): 'cabin' | 'jump' | null {
  const c = cabinOf(f.aircraftType);
  const freeCabin = Math.max(0, c.seats - (f.bookedPax ?? 0));
  const taken = occupancy.get(f.id) ?? 0;
  if (taken < freeCabin) return 'cabin';
  if (taken < freeCabin + c.jumpSeats) return 'jump';
  return null;
}

/**
 * After an outstation hand-over the original crew member is away from base: position them home on the
 * first flight that keeps their roster legal (duty, not FDP, after the last operating sector). Null =
 * no such flight: they night-stop and the OCC sees it in the audit note.
 */
export function positionHome(
  task: { dutyKey: string; legs: Flight[] }, c: CrewRecord, own: CrewRosterLeg[], network: Flight[], scheme: (base: string) => DutyScheme, judge: RosterJudge,
  occupancy: Occupancy = new Map()
): Flight | null {
  const handOver = task.legs[0];
  if (!handOver || handOver.dep === c.base) return null;
  const kept = own.filter(l => !task.legs.some(x => x.id === l.flight.id)
    && !(l.positioning && l.dutyKey === task.dutyKey && l.flight.etd.getTime() >= handOver.etd.getTime()));
  const lastKept = kept.filter(l => l.dutyKey === task.dutyKey).sort((a, b) => b.flight.eta.getTime() - a.flight.eta.getTime())[0];
  const after = lastKept?.flight.eta ?? handOver.etd;
  const options = network.filter(f => f.status !== 'CANCELLED' && canChange(f) && f.dep === handOver.dep && f.arr === c.base && seatFor(f, occupancy)
    && f.etd.getTime() >= after.getTime() + MIN_CONNECT_MINUTES * MIN && !task.legs.some(x => x.id === f.id) && !own.some(l => l.flight.id === f.id))
    .sort((a, b) => a.etd.getTime() - b.etd.getTime());
  for (const f of options) {
    const duties = buildDuties([...kept, { dutyKey: task.dutyKey, flight: f, positioning: true }], scheme(c.base));
    if (judge(duties).status !== 'VIOLATION') return f;
  }
  return null;
}

export interface CoverVerdict {
  kind: 'STANDBY' | 'RESERVE';
  cost: number;
  ftl: 'OK' | 'DISCRETION';
  note: string;
  /** Flights the crew member rides as a passenger (out to the hand-over station, and home if possible). */
  positioning: Flight[];
}

/**
 * Can this crew member legally fly these legs as a new duty? The single legality test used both to
 * build the options and to re-check at acceptance. Null = not available or not legal.
 * If the legs start away from the crew member's base, they are positioned there on the operator's own
 * flights (and home again when a flight exists); positioning counts as FDP before operating, not as a sector.
 */
export function coverVerdict(
  task: { dutyKey: string; legs: Flight[] },
  c: CrewRecord,
  own: CrewRosterLeg[],
  windows: StandbyWindow[],
  scheme: (base: string) => DutyScheme,
  judge: RosterJudge,
  costs: CrewCostModel = DEFAULT_CREW_COSTS,
  network: Flight[] = [],
  now: Date = new Date(0),
  occupancy: Occupancy = new Map()
): CoverVerdict | null {
  const first = task.legs[0];
  const last = task.legs[task.legs.length - 1];
  if (!first || !c.qualifications.includes(typeRating(first.aircraftType))) return null;
  // Already on one of these legs (e.g. the other pilot) — never.
  if (own.some(l => task.legs.some(x => x.id === l.flight.id))) return null;
  if (judge(buildDuties(own, scheme(c.base))).status === 'VIOLATION') return null;
  const sch = scheme(c.base);
  const positioning: Flight[] = [];
  if (first.dep !== c.base) {
    const out = positioningFlight(network, c.base, first.dep, first.etd, new Date(now.getTime() + sch.reportBeforeMinutes * MIN), occupancy);
    if (!out) return null;
    positioning.push(out);
  }
  if (last.arr !== c.base) {
    const home = homeFlight(network, last.arr, c.base, last.eta, occupancy);
    if (home) positioning.push(home);
  }
  if (own.some(l => positioning.some(x => x.id === l.flight.id))) return null;
  const start = positioning[0] && positioning[0].etd < first.etd ? positioning[0] : first;
  const report = new Date(start.etd.getTime() - sch.reportBeforeMinutes * MIN);
  const sby = windows.find(s => s.start.getTime() <= report.getTime() && report.getTime() <= s.end.getTime());
  // Standby counts as duty: someone whose standby ended within the minimum rest (ORO.FTL.235, 12 h) is not available.
  if (!sby && windows.some(s => s.end.getTime() <= report.getTime() && report.getTime() - s.end.getTime() < MIN_REST_MS)) return null;
  const newKey = `${task.dutyKey}:cover:${c.id}`;
  const added: CrewLeg[] = [
    ...task.legs.map(f => ({ dutyKey: newKey, flight: f })),
    ...positioning.map(f => ({ dutyKey: newKey, flight: f, positioning: true }))
  ];
  const duties = buildDuties([...own, ...added], sch).map(d => (sby && d.id === newKey ? withStandby(d, sby) : d));
  const after = judge(duties);
  if (after.status === 'VIOLATION') return null;
  const notes = [sby
    ? `Airport standby ${sby.start.toISOString().slice(11, 16)}–${sby.end.toISOString().slice(11, 16)}Z`
    : 'Called out from reserve (not on standby)'];
  for (const p of positioning) notes.push(`positioning on ${p.flightNo} ${p.dep}–${p.arr}${seatFor(p, occupancy) === 'jump' ? ' (jump seat — flight full)' : ''}`);
  if (last.arr !== c.base && !positioning.some(p => p.dep === last.arr)) notes.push(`night stop at ${last.arr}`);
  if (after.status === 'DISCRETION' && after.message) notes.push(after.message);
  return {
    kind: sby ? 'STANDBY' : 'RESERVE',
    cost: (sby ? costs.standby : costs.reserve) + (after.status === 'DISCRETION' ? costs.discretion : 0) + positioning.length * costs.positioning,
    ftl: after.status,
    note: notes.join('; '),
    positioning
  };
}

export function buildCrewProblem(
  runId: string,
  tasks: CrewTaskInput[],
  pool: CrewRecord[],
  rosters: Map<string, CrewRosterLeg[]>,
  standby: StandbyWindow[],
  scheme: (base: string) => DutyScheme,
  judge: RosterJudge,
  costs: CrewCostModel = DEFAULT_CREW_COSTS,
  network: Flight[] = [],
  now: Date = new Date(0)
): CrewRecoveryProblem {
  const occupancy = occupancyOf([...rosters.values()].flat());
  const sbyBy = new Map<string, StandbyWindow[]>();
  for (const s of standby) sbyBy.set(s.crewId, [...(sbyBy.get(s.crewId) ?? []), s]);
  const taskCrew = new Set(tasks.map(t => t.crew.id));
  const problemTasks: CrewRecoveryProblem['tasks'] = [];
  const options: CrewRecoveryProblem['options'] = [];
  const used = new Map<string, CrewRecoveryProblem['candidates'][number]>();

  tasks.forEach((t, i) => {
    const id = `T${i + 1}`;
    const first = t.legs[0];
    const sch = scheme(t.crew.base);
    const report = new Date(first.etd.getTime() - sch.reportBeforeMinutes * MIN);
    problemTasks.push({
      id, crewId: t.crew.id, name: t.crew.name, rank: t.crew.rank, dutyKey: t.dutyKey,
      flightIds: t.legs.map(l => l.id), flightNos: t.legs.map(l => l.flightNo), report: report.toISOString(), reason: t.reason
    });
    for (const c of pool) {
      if (c.rank !== 'CPT' && c.rank !== 'FO') continue;
      if (c.id === t.crew.id || taskCrew.has(c.id) || c.rank !== t.crew.rank) continue;
      const v = coverVerdict({ dutyKey: t.dutyKey, legs: t.legs }, c, rosters.get(c.id) ?? [], sbyBy.get(c.id) ?? [], scheme, judge, costs, network, now, occupancy);
      if (!v) continue;
      const { kind, cost, ftl, note } = v;
      options.push({ taskId: id, crewId: c.id, cost, ftl, note, positioning: v.positioning.map(f => f.id) });
      if (!used.has(c.id)) used.set(c.id, { crewId: c.id, name: c.name, rank: c.rank, kind });
      else if (kind === 'STANDBY') used.get(c.id)!.kind = 'STANDBY';
    }
  });

  const flightIds = new Set(problemTasks.flatMap(t => t.flightIds));
  const snapshot = [...rosters.values()].flat().filter(l => flightIds.has(l.flight.id)).map(l => ({ flightId: l.flight.id, crewId: l.crewId }))
    .sort((a, b) => (a.flightId + a.crewId).localeCompare(b.flightId + b.crewId));
  // Each option was judged with the seats free now; the solver must not put more positioning crew on a
  // flight than it has seats left.
  const byId = new Map(network.map(f => [f.id, f]));
  const seats: Record<string, number> = {};
  for (const o of options) for (const fid of o.positioning ?? []) { const f = byId.get(fid); if (f) seats[fid] = seatsLeft(f, occupancy); }
  return { runId, uncoveredCost: costs.uncovered, tasks: problemTasks, candidates: [...used.values()], options, snapshot, seats };
}

export function crewObjective(p: CrewRecoveryProblem, assignments: CrewRecoverySolution['assignments']): number {
  const cost = new Map(p.options.map(o => [`${o.taskId}|${o.crewId}`, o.cost]));
  return assignments.reduce((n, a) => n + (cost.get(`${a.taskId}|${a.crewId}`) ?? 0), 0) + (p.tasks.length - assignments.length) * p.uncoveredCost;
}

/** Independent check of a solver result. Empty = valid. */
export function checkCrewSolution(p: CrewRecoveryProblem, s: CrewRecoverySolution): string[] {
  const issues: string[] = [];
  if (s.runId !== p.runId) issues.push(`Solution is for ${s.runId}, not ${p.runId}`);
  const options = new Set(p.options.map(o => `${o.taskId}|${o.crewId}`));
  const tasks = new Set<string>();
  const crew = new Set<string>();
  for (const a of s.assignments) {
    if (!options.has(`${a.taskId}|${a.crewId}`)) issues.push(`${a.crewId} is not a legal option for ${a.taskId}`);
    if (tasks.has(a.taskId)) issues.push(`${a.taskId} covered twice`);
    if (crew.has(a.crewId)) issues.push(`${a.crewId} used twice`);
    tasks.add(a.taskId);
    crew.add(a.crewId);
  }
  const pos = new Map(p.options.map(o => [`${o.taskId}|${o.crewId}`, o.positioning ?? []]));
  const riding = new Map<string, number>();
  for (const a of s.assignments) for (const f of pos.get(`${a.taskId}|${a.crewId}`) ?? []) riding.set(f, (riding.get(f) ?? 0) + 1);
  for (const [f, n] of riding) if (p.seats && f in p.seats && n > p.seats[f]) issues.push(`${n} positioning crew on ${f}, ${p.seats[f]} seat(s) left`);
  const obj = crewObjective(p, s.assignments);
  if (Math.abs(obj - s.objective) > 1e-6) issues.push(`Objective is ${obj}, solver said ${s.objective}`);
  return issues;
}

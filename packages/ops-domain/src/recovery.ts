import type { RecoveryChangeDto, RecoveryProblem, RecoverySolution } from '@aeroos/contracts';
import { blockMinutes, canChange, endStation, type Flight } from './flight';

/**
 * Contract between the OCC and the recovery optimiser (services/optimiser, Python + OR-Tools).
 * The TypeScript side builds the problem from the live schedule and independently re-checks any
 * solution before it is shown — the solver is never trusted blindly.
 */

const toMin = (d: Date) => Math.round(d.getTime() / 60_000);
const fromMin = (m: number) => new Date(m * 60_000);

export interface TailState { reg: string; type: string; dispatchable: boolean; base: string }

export function buildProblem(
  runId: string, flights: Flight[], tails: TailState[], window: { from: Date; to: Date },
  o: { minTurnMinutes: number; maxDelayMinutes: number; costs?: RecoveryProblem['costs'] }
): RecoveryProblem {
  const from = toMin(window.from);
  const tailTypes = new Set(tails.map(t => t.type));
  const inScope = flights.filter(f => tailTypes.has(f.aircraftType) && canChange(f) && toMin(f.etd) >= from && toMin(f.std) < toMin(window.to));
  const scopeIds = new Set(inScope.map(f => f.id));
  const types = new Set(inScope.map(f => f.aircraftType));
  return {
    runId,
    horizonStart: from,
    horizonEnd: toMin(window.to),
    minTurnMinutes: o.minTurnMinutes,
    maxDelayMinutes: o.maxDelayMinutes,
    costs: o.costs ?? { delayPerMinute: 1, cancel: 600, swap: 20 },
    tails: tails.filter(t => types.has(t.type)).map(t => {
      // Where is the aircraft, and when is it free, at the start of the window?
      const before = flights
        .filter(f => f.tail === t.reg && f.status !== 'CANCELLED' && !scopeIds.has(f.id) && toMin(f.etd) < from)
        .sort((a, b) => a.eta.getTime() - b.eta.getTime());
      const last = before[before.length - 1];
      return {
        reg: t.reg, type: t.type, dispatchable: t.dispatchable,
        location: last ? endStation(last) : t.base,
        availableFrom: Math.max(from, last ? toMin(last.eta) + o.minTurnMinutes : from)
      };
    }),
    flights: inScope.map(f => ({
      id: f.id, flightNo: f.flightNo, dep: f.dep, arr: f.arr, std: toMin(f.std), earliest: toMin(f.etd), blockMinutes: blockMinutes(f), tail: f.tail, type: f.aircraftType, version: f.version
    }))
  };
}

/** Independent feasibility check of a solver result. Empty list = feasible. */
export function checkSolution(p: RecoveryProblem, s: RecoverySolution): string[] {
  const issues: string[] = [];
  const tails = new Map(p.tails.map(t => [t.reg, t]));
  const flights = new Map(p.flights.map(f => [f.id, f]));
  const seen = new Set<string>();
  const byTail = new Map<string, { f: RecoveryProblem['flights'][number]; start: number }[]>();
  for (const a of s.assignments) {
    const f = flights.get(a.flightId);
    if (!f) { issues.push(`Unknown flight ${a.flightId}`); continue; }
    if (seen.has(f.id)) issues.push(`${f.flightNo} assigned twice`);
    seen.add(f.id);
    if (a.tail === null) continue; // cancelled
    const t = tails.get(a.tail);
    if (!t) { issues.push(`${f.flightNo} on unknown tail ${a.tail}`); continue; }
    if (t.type !== f.type) issues.push(`${f.flightNo} needs a ${f.type}, ${t.reg} is a ${t.type}`);
    if (!t.dispatchable) issues.push(`${f.flightNo} assigned to non-dispatchable ${t.reg}`);
    if (a.start === null || a.start < f.earliest) issues.push(`${f.flightNo} departs before its current ETD`);
    else if (a.start - f.std > Math.max(p.maxDelayMinutes, f.earliest - f.std)) issues.push(`${f.flightNo} delayed beyond ${p.maxDelayMinutes} min`);
    byTail.set(t.reg, [...(byTail.get(t.reg) ?? []), { f, start: a.start ?? f.earliest }]);
  }
  for (const f of p.flights) if (!seen.has(f.id)) issues.push(`${f.flightNo} missing from the solution`);
  for (const [reg, seq] of byTail) {
    const t = tails.get(reg)!;
    seq.sort((a, b) => a.start - b.start);
    let loc = t.location;
    let free = t.availableFrom;
    for (const { f, start } of seq) {
      if (f.dep !== loc) issues.push(`${reg} is at ${loc} but ${f.flightNo} departs ${f.dep}`);
      if (start < free) issues.push(`${f.flightNo} on ${reg} departs before the aircraft is ready`);
      loc = f.arr;
      free = start + f.blockMinutes + p.minTurnMinutes;
    }
  }
  return issues;
}

/** What the controller will see: one line per flight that changes. */
export function solutionChanges(p: RecoveryProblem, s: RecoverySolution): RecoveryChangeDto[] {
  const flights = new Map(p.flights.map(f => [f.id, f]));
  const out: RecoveryChangeDto[] = [];
  for (const a of s.assignments) {
    const f = flights.get(a.flightId)!;
    const base = { flightId: f.id, flightNo: f.flightNo, dep: f.dep, arr: f.arr, fromTail: f.tail };
    if (a.tail === null) {
      out.push({ ...base, kind: 'CANCEL', toTail: null, delayMinutes: 0, newEtd: null });
      continue;
    }
    const start = a.start ?? f.earliest;
    const delay = start - f.std;
    const swapped = a.tail !== f.tail;
    if (!swapped && start === f.earliest) continue; // unchanged from the current plan
    out.push({
      ...base, kind: swapped ? (delay > 0 ? 'SWAP_DELAY' : 'SWAP') : 'DELAY', toTail: a.tail, delayMinutes: delay,
      newEtd: fromMin(start).toISOString()
    });
  }
  return out.sort((x, y) => (flights.get(x.flightId)!.std - flights.get(y.flightId)!.std));
}

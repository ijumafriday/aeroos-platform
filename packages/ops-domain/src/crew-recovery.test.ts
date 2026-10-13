import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ComplianceEngine, defaultRegistry, type OperatorProfile } from '@aeroos/compliance';
import type { CrewRecoverySolution } from '@aeroos/contracts';
import {
  cabinOf, occupancyOf, seatFor,
  buildCrewProblem, buildDuties, checkCrewSolution, coverVerdict, crewObjective, crewTasks, positionHome, DEMO_CREW, DEMO_STANDBY_CREW, delayFlight, demoDay, demoStandby,
  typeRating, withStandby, type CrewRosterLeg, type Duty, type Flight, type RosterJudge
} from './index';

const NKX: OperatorProfile = { operatorId: 'NKX', name: 'Nordkapp Air', authority: 'EASA', melTimeZone: 'UTC', approvedTypes: [], mel: {} };
const engine = new ComplianceEngine(defaultRegistry({ allowDraft: false }), [NKX]);
const scheme = () => ({ reportBeforeMinutes: 60, postFlightMinutes: 30, homeBase: 'ENGM', zoneOf: (icao: string) => (icao.startsWith('E') ? 'Europe/Oslo' : 'Europe/London') });
const NOW = new Date('2026-10-08T00:00:00Z');
const judge: RosterJudge = (duties: Duty[]) => {
  const v = engine.rosterCheck('NKX', { duties }, NOW).value;
  const worst = v.find(x => x.severity === 'violation') ?? v[0];
  return { status: v.some(x => x.severity === 'violation') ? 'VIOLATION' : v.length ? 'DISCRETION' : 'OK', message: worst?.message ?? null };
};

function scenario(delayMinutes: number) {
  const dates = ['2026-10-07', '2026-10-08', '2026-10-09'];
  let flights: Flight[] = dates.flatMap(d => demoDay(d).flights.map(f => ({
    ...f, operatorId: 'NKX', etd: f.std, eta: f.sta, status: 'SCHEDULED' as const, delayMinutes: 0, delayReason: null, version: 1
  })));
  const ngx = flights.filter(f => f.tail === 'LN-NGX' && f.date === '2026-10-08');
  const r = delayFlight(ngx.find(f => f.flightNo === 'NK682')!, ngx, delayMinutes, '93 late inbound', 35);
  const changed = new Map([r.flight, ...r.knockOn].map(f => [f.id, f]));
  flights = flights.map(f => changed.get(f.id) ?? f);
  const byId = new Map(flights.map(f => [f.id, f]));
  const crew = [...DEMO_CREW, ...DEMO_STANDBY_CREW];
  const rosters = new Map<string, CrewRosterLeg[]>(crew.map(c => [c.id, []]));
  for (const a of dates.flatMap(d => demoDay(d).assignments)) rosters.get(a.crewId)!.push({ crewId: a.crewId, role: a.role, dutyKey: a.dutyKey, flight: byId.get(a.flightId)! });
  const violations = new Map(crew.map(c => [c.id, engine.rosterCheck('NKX', { duties: buildDuties(rosters.get(c.id)!, scheme()) }, NOW).value]));
  return { crew, rosters, violations, standby: dates.flatMap(demoStandby) };
}

describe('Crew recovery', () => {
  test('type ratings group aircraft variants', () => {
    assert.deepEqual(['B737-800', 'B737 MAX 8', 'A320neo', 'A330-300', 'DHC-8-400', 'ATR 72-600'].map(typeRating), ['B737', 'B737', 'A320', 'A330', 'DHC8', 'ATR72']);
  });

  test('airport standby beyond 4 h reduces the FDP allowance (ORO.FTL.225)', () => {
    const d = { id: 'x', report: new Date('2026-10-08T12:00:00Z') } as Duty;
    assert.equal(withStandby(d, { crewId: 'c', start: new Date('2026-10-08T10:00:00Z'), end: new Date('2026-10-08T20:00:00Z') }).report.toISOString(), '2026-10-08T12:00:00.000Z');
    assert.equal(withStandby(d, { crewId: 'c', start: new Date('2026-10-08T04:00:00Z'), end: new Date('2026-10-08T20:00:00Z') }).report.toISOString(), '2026-10-08T08:00:00.000Z');
  });

  test('no task when the delay stays within limits or discretion', () => {
    const s = scenario(150);
    assert.equal(crewTasks(s.crew, s.rosters, s.violations, NOW, scheme, judge).length, 0);
  });

  test('a 250-min delay: both pilots hand over at Oslo after the London turn, late standby covers, solution is checked', () => {
    const s = scenario(250);
    const tasks = crewTasks(s.crew, s.rosters, s.violations, NOW, scheme, judge);
    assert.equal(tasks.length, 2);
    for (const t of tasks) assert.deepEqual(t.legs.map(l => l.flightNo), ['NK651', 'NK652'], t.crew.id);
    const p = buildCrewProblem('CRW-1', tasks, s.crew, s.rosters, s.standby, scheme, judge);
    assert.deepEqual(p.tasks.map(t => t.rank).sort(), ['CPT', 'FO']);
    for (const t of p.tasks) {
      const opts = p.options.filter(o => o.taskId === t.id).sort((a, b) => a.cost - b.cost);
      assert.ok(opts.length > 1, `${t.id} has options`);
      assert.equal(opts[0].crewId, `${t.rank}-S2`, 'the late B737 standby is the cheapest legal cover');
      assert.ok(!opts.some(o => o.crewId.endsWith('-S1')), 'the early standby ended 1:45 before report: still in its rest period');
      assert.ok(opts.some(o => o.note.startsWith('Called out from reserve') && o.cost === 40), 'crew on a day off can be called out, at a higher cost');
      assert.ok(opts.every(o => o.crewId !== t.crewId));
      assert.ok(!opts.some(o => /S3|S4/.test(o.crewId)), 'A320 standby is not rated on the B737');
    }
    const best: CrewRecoverySolution['assignments'] = p.tasks.map(t => ({ taskId: t.id, crewId: `${t.rank}-S2` }));
    const sol: CrewRecoverySolution = { runId: 'CRW-1', solver: 'greedy', status: 'FEASIBLE', objective: crewObjective(p, best), wallSeconds: 0, assignments: best };
    assert.equal(sol.objective, 20);
    assert.deepEqual(checkCrewSolution(p, sol), []);
    assert.match(checkCrewSolution(p, { ...sol, assignments: [best[0], { ...best[1], crewId: best[0].crewId }], objective: 20 }).join(), /not a legal option|used twice/);
    assert.match(checkCrewSolution(p, { ...sol, assignments: [best[0]] }).join(), /Objective is 1010/);
    assert.ok(p.snapshot.length >= 4);
  });
});

describe('Positioning (deadheading) to an outstation hand-over', () => {
  const mk = (id: string, dep: string, arr: string, etd: string, eta: string): Flight => ({
    id, operatorId: 'NKX', flightNo: id, date: '2026-10-08', dep, arr, std: new Date(etd), sta: new Date(eta), etd: new Date(etd), eta: new Date(eta),
    tail: 'LN-ABC', aircraftType: 'B737-800', status: 'SCHEDULED', delayMinutes: 0, delayReason: null, version: 1
  });
  const task = { dutyKey: 'D1', legs: [mk('NK612', 'ENBR', 'ENGM', '2026-10-08T12:00:00Z', '2026-10-08T13:00:00Z')] };
  const reserve = { id: 'CPT-R', name: 'R', rank: 'CPT' as const, base: 'ENGM', qualifications: ['B737'] };
  const out = mk('NK611', 'ENGM', 'ENBR', '2026-10-08T09:00:00Z', '2026-10-08T10:00:00Z');

  test('positioning counts as FDP from its report time, but not as a sector', () => {
    const [d] = buildDuties([{ dutyKey: 'x', flight: out, positioning: true }, { dutyKey: 'x', flight: task.legs[0] }], scheme());
    assert.equal(d.sectors, 1);
    assert.equal(d.report.toISOString(), '2026-10-08T08:00:00.000Z');
    assert.equal(d.fdpEnd.toISOString(), '2026-10-08T13:00:00.000Z');
    assert.equal(d.flightMinutes, 60);
  });
  test('a reserve at the base is positioned on our own flight and the cost says so', () => {
    const v = coverVerdict(task, reserve, [], [], scheme, judge, undefined, [out], NOW);
    assert.ok(v);
    assert.deepEqual(v.positioning.map(f => f.id), ['NK611']);
    assert.equal(v.cost, 40 + 15);
    assert.match(v.note, /positioning on NK611 ENGM–ENBR/);
  });
  test('no flight that connects in time → no option', () => {
    const late = mk('NK613', 'ENGM', 'ENBR', '2026-10-08T10:30:00Z', '2026-10-08T11:30:00Z'); // 30 min connection < 45
    assert.equal(coverVerdict(task, reserve, [], [], scheme, judge, undefined, [late], NOW), null);
    assert.equal(coverVerdict(task, reserve, [], [], scheme, judge, undefined, [], NOW), null);
  });

  test('the original crew member handing over at the outstation is positioned home when that stays legal', () => {
    const inbound = mk('NK611', 'ENGM', 'ENBR', '2026-10-08T06:00:00Z', '2026-10-08T07:00:00Z');
    const back = mk('NK615', 'ENBR', 'ENGM', '2026-10-08T12:30:00Z', '2026-10-08T13:30:00Z');
    const original = { id: 'CPT-O', name: 'O', rank: 'CPT' as const, base: 'ENGM', qualifications: ['B737'] };
    const own = [inbound, task.legs[0]].map(f => ({ crewId: 'CPT-O', role: 'CPT' as const, dutyKey: 'D1', flight: f }));
    assert.equal(positionHome(task, original, own, [back, task.legs[0]], scheme, judge)?.id, 'NK615');
    assert.equal(positionHome({ ...task, legs: [inbound] }, original, own, [back], scheme, judge), null, 'hand-over at base: nothing to do');
  });

  test('seats: a full flight still takes positioning crew on its jump seats, then no more', () => {
    const full = { ...out, bookedPax: 186 }; // B737-800 cabin sold out, 2 jump seats
    assert.equal(seatFor(full, new Map()), 'jump');
    const v = coverVerdict(task, reserve, [], [], scheme, judge, undefined, [full], NOW);
    assert.ok(v);
    assert.match(v.note, /jump seat — flight full/);
    assert.equal(coverVerdict(task, reserve, [], [], scheme, judge, undefined, [full], NOW, new Map([['NK611', 2]])), null, 'both jump seats taken');
    const roomy = { ...out, bookedPax: 180 };
    assert.equal(seatFor(roomy, new Map([['NK611', 5]])), 'cabin');
    assert.equal(seatFor(roomy, new Map([['NK611', 6]])), 'jump');
    assert.equal(seatFor(roomy, new Map([['NK611', 8]])), null);
  });
  test('seats: positioning picks another flight when the latest one has no seat left', () => {
    const early = mk('NK609', 'ENGM', 'ENBR', '2026-10-08T07:00:00Z', '2026-10-08T08:00:00Z');
    const v = coverVerdict(task, reserve, [], [], scheme, judge, undefined, [{ ...out, bookedPax: 186 }, early], NOW, new Map([['NK611', 2]]));
    assert.deepEqual(v?.positioning.map(f => f.id), ['NK609']);
  });
  test('seats: positioning crew already rostered are counted', () => {
    const occ = occupancyOf([{ flight: out, positioning: true }, { flight: out, positioning: true }, { flight: out }]);
    assert.equal(occ.get('NK611'), 2);
  });
  test('demo loads are deterministic, 70–100 % with some flights sold out', () => {
    const day = demoDay('2026-10-08');
    assert.deepEqual(day.flights.map(f => f.bookedPax), demoDay('2026-10-08').flights.map(f => f.bookedPax));
    const seats = (t: string) => ({ 'B737-800': 186, 'B737 MAX 8': 189 } as Record<string, number>)[t];
    for (const f of day.flights) if (seats(f.aircraftType)) assert.ok(f.bookedPax >= Math.floor(seats(f.aircraftType) * 0.7) && f.bookedPax <= seats(f.aircraftType));
    const four = ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'].flatMap(d => demoDay(d).flights);
    assert.ok(four.some(f => f.bookedPax === cabinOf(f.aircraftType).seats), 'some flights sold out');
  });
  test('the solution check rejects more positioning crew than seats left', () => {
    const p = {
      runId: 'CRW-9', uncoveredCost: 1000, candidates: [], snapshot: [], seats: { NK611: 1 },
      tasks: [{ id: 'T1' }, { id: 'T2' }] as never,
      options: [
        { taskId: 'T1', crewId: 'R1', cost: 55, ftl: 'OK' as const, note: '', positioning: ['NK611'] },
        { taskId: 'T2', crewId: 'R2', cost: 55, ftl: 'OK' as const, note: '', positioning: ['NK611'] }
      ]
    };
    const s = { runId: 'CRW-9', solver: 'greedy' as const, status: 'FEASIBLE' as const, objective: 110, wallSeconds: 0, assignments: [{ taskId: 'T1', crewId: 'R1' }, { taskId: 'T2', crewId: 'R2' }] };
    assert.match(checkCrewSolution(p, s).join(), /2 positioning crew on NK611, 1 seat/);
    assert.deepEqual(checkCrewSolution({ ...p, seats: { NK611: 2 } }, s), []);
  });
});

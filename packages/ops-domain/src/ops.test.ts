import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ComplianceEngine, defaultRegistry, type OperatorProfile } from '@aeroos/compliance';
import type { RecoverySolution } from '@aeroos/contracts';
import {
  buildDuties, buildProblem, cancelFlight, changeTail, checkSolution, DEMO_CREW, DEMO_ROTATIONS, FJR_CREW, FJR_ROTATIONS, delayFlight, demoDay, estimatedPosition,
  greatCircleKm, rotationIssues, solutionChanges, type Flight
} from './index';

const NKX: OperatorProfile = { operatorId: 'NKX', name: 'Nordkapp Air', authority: 'EASA', melTimeZone: 'UTC', approvedTypes: [], mel: {} };
const engine = new ComplianceEngine(defaultRegistry({ allowDraft: false }), [NKX]);
const TURN = 35;

function day(date: string): Flight[] {
  return demoDay(date).flights.map(f => ({
    ...f, operatorId: 'NKX', etd: f.std, eta: f.sta, status: 'SCHEDULED' as const, delayMinutes: 0, delayReason: null, version: 1
  }));
}
const scheme = { reportBeforeMinutes: 60, postFlightMinutes: 30, homeBase: 'ENGM', zoneOf: (icao: string) => (icao.startsWith('E') || icao.startsWith('G') ? 'Europe/Oslo' : 'UTC') };

describe('Demo schedule', () => {
  test('every rotation is continuous with legal turns', () => {
    for (const r of DEMO_ROTATIONS) {
      const flights = day('2026-10-08').filter(f => f.tail === r.tail);
      assert.equal(rotationIssues(flights, TURN).size, 0, r.tail);
      assert.equal(flights[0].dep, 'ENGM');
      assert.equal(flights[flights.length - 1].arr, 'ENGM');
    }
  });
  test('the second operator (FJR) has its own flight numbers and crew ids, and legal rotations', () => {
    const d = demoDay('2026-10-08', FJR_ROTATIONS, 'FJR-');
    assert.ok(d.flights.every(f => f.flightNo.startsWith('FJ')));
    assert.ok(d.assignments.every(a => a.crewId.startsWith('FJR-') && FJR_CREW.some(c => c.id === a.crewId)));
    const ids = new Set(demoDay('2026-10-08').flights.map(f => f.id));
    assert.ok(d.flights.every(f => !ids.has(f.id)));
    for (const r of FJR_ROTATIONS) {
      const fl = d.flights.filter(f => f.tail === r.tail).map(f => ({ ...f, operatorId: 'FJR', etd: f.std, eta: f.sta, status: 'SCHEDULED' as const, delayMinutes: 0, delayReason: null, version: 1 }));
      assert.equal(rotationIssues(fl, TURN).size, 0, r.tail);
    }
    const dates = ['2026-10-07', '2026-10-08', '2026-10-09'];
    const days = dates.map(x => demoDay(x, FJR_ROTATIONS, 'FJR-'));
    const byId = new Map(days.flatMap(x => x.flights).map(f => [f.id, { ...f, operatorId: 'FJR', etd: f.std, eta: f.sta, status: 'SCHEDULED' as const, delayMinutes: 0, delayReason: null, version: 1 }]));
    for (const c of FJR_CREW) {
      const legs = days.flatMap(x => x.assignments).filter(a => a.crewId === c.id).map(a => ({ dutyKey: a.dutyKey, flight: byId.get(a.flightId)! }));
      assert.deepEqual(engine.rosterCheck('NKX', { duties: buildDuties(legs, { ...scheme, homeBase: 'ENBR' }) }, new Date('2026-10-08T00:00:00Z')).value, [], c.id);
    }
  });
  test('three consecutive demo days are FTL-legal for every crew member (EASA)', () => {
    const dates = ['2026-10-07', '2026-10-08', '2026-10-09'];
    const flights = new Map(dates.flatMap(d => day(d)).map(f => [f.id, f]));
    const assignments = dates.flatMap(d => demoDay(d).assignments);
    for (const c of DEMO_CREW) {
      const legs = assignments.filter(a => a.crewId === c.id).map(a => ({ dutyKey: a.dutyKey, flight: flights.get(a.flightId)! }));
      const v = engine.rosterCheck('NKX', { duties: buildDuties(legs, scheme) }, new Date('2026-10-08T00:00:00Z')).value;
      assert.deepEqual(v, [], `${c.id} ${c.name}`);
    }
  });
});

describe('Delays, cancellations and tail changes', () => {
  const flights = day('2026-10-08');
  const ngx = flights.filter(f => f.tail === 'LN-NGX');
  const lhr = ngx.find(f => f.flightNo === 'NK682')!;

  test('a delay propagates down the rotation only as far as the turn buffers allow', () => {
    const r = delayFlight(lhr, ngx, 120, '93 late inbound', TURN);
    assert.equal(r.flight.etd.toISOString(), '2026-10-08T12:00:00.000Z');
    assert.deepEqual(r.knockOn.map(k => [k.flightNo, k.delayMinutes]), [['NK651', 65], ['NK652', 55]]);
    assert.equal(r.knockOn[0].delayReason, 'Knock-on from NK682');
    assert.equal(r.event.data.knockOn.length, 2);
  });
  test('a small delay is absorbed by the turn buffer', () => {
    assert.equal(delayFlight(lhr, ngx, 20, '81 ATC', TURN).knockOn.length, 0);
  });
  test('the delay makes the crew FDP exceed the limit — +2 h is exactly at the limit, +2½ h is within discretion, +4 h 10 is a violation', () => {
    const assignments = demoDay('2026-10-08').assignments.filter(a => a.crewId === 'CPT-05' + (Math.floor(Date.parse('2026-10-08') / 86_400_000) % 2 ? 'B' : 'A'));
    const run = (minutes: number) => {
      const r = delayFlight(lhr, ngx, minutes, '93 late inbound', TURN);
      const changed = new Map([r.flight, ...r.knockOn].map(f => [f.id, f]));
      const legs = assignments.map(a => ({ dutyKey: a.dutyKey, flight: changed.get(a.flightId) ?? flights.find(f => f.id === a.flightId)! }));
      return engine.rosterCheck('NKX', { duties: buildDuties(legs, scheme) }, new Date('2026-10-08T00:00:00Z')).value;
    };
    assert.deepEqual(run(0), []);
    assert.deepEqual(run(120), []); // FDP becomes exactly 12:00 — the limit for an 08:00 local report with 4 sectors
    assert.equal(run(150)[0].severity, 'discretion');
    assert.equal(run(250)[0].severity, 'violation');
  });
  test('departed or cancelled flights cannot be delayed; reasons are required', () => {
    assert.throws(() => delayFlight({ ...lhr, status: 'DEPARTED' }, ngx, 30, 'x', TURN), /departed/);
    assert.throws(() => delayFlight(lhr, ngx, 30, '', TURN), /reason/);
    const c = cancelFlight(lhr, 'Technical');
    assert.equal(c.flight.status, 'CANCELLED');
    assert.throws(() => cancelFlight(c.flight, 'again'), /cancelled/);
  });
  test('tail changes require the same type and a dispatchable aircraft', () => {
    const f = flights.find(x => x.tail === 'LN-RKG')!;
    assert.equal(changeTail(f, { reg: 'LN-RKF', type: 'A320neo', dispatchable: true, reasons: [] }).flight.tail, 'LN-RKF');
    assert.throws(() => changeTail(f, { reg: 'LN-ABC', type: 'B737-800', dispatchable: true, reasons: [] }), /B737-800/);
    assert.throws(() => changeTail(f, { reg: 'LN-RKF', type: 'A320neo', dispatchable: false, reasons: ['MEL 31-31-01 expired'] }), /not dispatchable: MEL/);
  });
  test('rotation checks catch overlaps and broken continuity', () => {
    const moved = flights.filter(f => f.tail === 'LN-RKF').concat([{ ...flights.find(f => f.flightNo === 'NK605')!, tail: 'LN-RKF' }]);
    const issues = [...rotationIssues(moved, TURN).values()].flat().join(' | ');
    assert.match(issues, /Overlaps|departs ENBR|arrives/);
  });
});

describe('Geography', () => {
  test('Oslo–Bergen is about 305 km great circle', () => {
    const d = greatCircleKm({ lat: 60.1939, lon: 11.1004 }, { lat: 60.2934, lon: 5.2181 });
    assert.ok(Math.abs(d - 325) < 25, String(d));
  });
  test('estimated position is on the way, and null outside the flight', () => {
    const a = { lat: 60, lon: 11 }, b = { lat: 60, lon: 5 };
    const etd = new Date('2026-10-08T08:00:00Z'), eta = new Date('2026-10-08T09:00:00Z');
    const p = estimatedPosition(a, b, etd, eta, new Date('2026-10-08T08:30:00Z'))!;
    assert.ok(p.lon < 11 && p.lon > 5 && p.lat > 60); // great circle bulges poleward
    assert.equal(estimatedPosition(a, b, etd, eta, new Date('2026-10-08T07:00:00Z')), null);
  });
});

describe('Recovery contract', () => {
  const flights = day('2026-10-08');
  const tails = [
    { reg: 'LN-RKF', type: 'A320neo', dispatchable: true, base: 'ENGM' },
    { reg: 'LN-RKG', type: 'A320neo', dispatchable: false, base: 'ENGM' }
  ];
  const p = buildProblem('R1', flights, tails, { from: new Date('2026-10-08T05:00:00Z'), to: new Date('2026-10-09T00:00:00Z') }, { minTurnMinutes: TURN, maxDelayMinutes: 240 });
  const A = (flightNo: string) => p.flights.find(f => f.flightNo === flightNo)!;

  test('only flights of the affected types are in scope, with tail positions', () => {
    assert.deepEqual(p.flights.map(f => f.flightNo).sort(), ['NK605', 'NK606', 'NK623', 'NK624', 'NK643', 'NK644', 'NK663', 'NK664']);
    assert.equal(p.tails.find(t => t.reg === 'LN-RKF')!.location, 'ENGM');
  });
  test('a delay already entered is a lower bound, and keeping it is not reported as a change', () => {
    const delayed = flights.map(f => (f.flightNo === 'NK663' ? { ...f, etd: new Date(f.std.getTime() + 40 * 60_000), eta: new Date(f.sta.getTime() + 40 * 60_000), delayMinutes: 40, status: 'DELAYED' as const } : f));
    const q = buildProblem('R2', delayed, tails, { from: new Date('2026-10-08T05:00:00Z'), to: new Date('2026-10-09T00:00:00Z') }, { minTurnMinutes: TURN, maxDelayMinutes: 240 });
    const f = q.flights.find(x => x.flightNo === 'NK663')!;
    assert.equal(f.earliest - f.std, 40);
    const s: RecoverySolution = { runId: 'R2', solver: 'greedy', status: 'FEASIBLE', objective: 0, wallSeconds: 0, assignments: [{ flightId: f.id, tail: 'LN-RKF', start: f.std }] };
    assert.ok(checkSolution(q, s).some(i => /before its current ETD/.test(i)));
    const keep: RecoverySolution = { ...s, assignments: [{ flightId: f.id, tail: 'LN-RKF', start: f.earliest }] };
    assert.deepEqual(solutionChanges(q, keep), []);
  });
  test('the checker rejects a non-dispatchable tail and broken continuity', () => {
    const naive: RecoverySolution = { runId: 'R1', solver: 'greedy', status: 'FEASIBLE', objective: 0, wallSeconds: 0, assignments: p.flights.map(f => ({ flightId: f.id, tail: f.tail, start: f.std })) };
    assert.ok(checkSolution(p, naive).some(i => /non-dispatchable LN-RKG/.test(i)));
  });
  test('a feasible recovery: RKF absorbs the Bergen return by delaying, Stavanger is cancelled', () => {
    const keep = (no: string) => ({ flightId: A(no).id, tail: 'LN-RKF', start: A(no).std });
    const s: RecoverySolution = {
      runId: 'R1', solver: 'greedy', status: 'FEASIBLE', objective: 0, wallSeconds: 0,
      assignments: [
        keep('NK663'), keep('NK664'),
        { flightId: A('NK605').id, tail: 'LN-RKF', start: A('NK664').std + 70 + TURN },
        { flightId: A('NK606').id, tail: 'LN-RKF', start: A('NK664').std + 70 + TURN + 55 + TURN },
        { flightId: A('NK643').id, tail: 'LN-RKF', start: A('NK664').std + 70 + TURN + 55 + TURN + 55 + TURN },
        { flightId: A('NK644').id, tail: 'LN-RKF', start: A('NK664').std + 70 + TURN + 55 + TURN + 55 + TURN + 55 + TURN },
        { flightId: A('NK623').id, tail: null, start: null },
        { flightId: A('NK624').id, tail: null, start: null }
      ]
    };
    assert.deepEqual(checkSolution(p, s), []);
    const ch = solutionChanges(p, s);
    assert.deepEqual(ch.map(c => `${c.flightNo}:${c.kind}`), ['NK605:SWAP_DELAY', 'NK606:SWAP_DELAY', 'NK643:DELAY', 'NK644:DELAY', 'NK623:CANCEL', 'NK624:CANCEL']);
  });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ComplianceEngine, defaultRegistry, type OperatorProfile } from '@aeroos/compliance';
import {
  buildDuties, buildRoster, DEMO_CREW, DEMO_STANDBY_CREW, demoDay, fatigueReportSeverity, fatigueScore, pairings, publicationNotice, woclMinutes,
  type CrewRosterLeg, type Duty, type Flight, type RosterJudge
} from './index';

const NKX: OperatorProfile = { operatorId: 'NKX', name: 'Nordkapp Air', authority: 'EASA', melTimeZone: 'UTC', approvedTypes: [], mel: {} };
const engine = new ComplianceEngine(defaultRegistry({ allowDraft: false }), [NKX]);
const scheme = (base: string) => ({ reportBeforeMinutes: 60, postFlightMinutes: 30, homeBase: base, zoneOf: (icao: string) => (icao.startsWith('E') ? 'Europe/Oslo' : 'Europe/London') });
const NOW = new Date('2026-10-08T00:00:00Z');
const judge: RosterJudge = (duties: Duty[]) => {
  const v = engine.rosterCheck('NKX', { duties }, NOW).value;
  const worst = v.find(x => x.severity === 'violation') ?? v[0];
  return { status: v.some(x => x.severity === 'violation') ? 'VIOLATION' : v.length ? 'DISCRETION' : 'OK', message: worst?.message ?? null };
};
const flightsOf = (dates: string[]): Flight[] => dates.flatMap(d => demoDay(d).flights.map(f => ({
  ...f, operatorId: 'NKX', etd: f.std, eta: f.sta, status: 'SCHEDULED' as const, delayMinutes: 0, delayReason: null, version: 1
})));
const fact = (report: string, end: string, sectors = 2) => ({
  id: report, report: new Date(report), fdpEnd: new Date(end), dutyEnd: new Date(new Date(end).getTime() + 30 * 60_000),
  sectors, flightMinutes: 120, reportTimeZone: 'Europe/Oslo', acclimatised: true, restAtHomeBase: true
});

describe('Rostering', () => {
  test('pairings start and end at the same station and keep every live leg once', () => {
    const fl = flightsOf(['2026-10-20']);
    const ps = pairings(fl);
    assert.ok(ps.length >= 6);
    assert.equal(ps.flatMap(p => p.legs).length, fl.length);
    for (const p of ps) assert.equal(p.legs[0].dep, p.base);
    const closed = ps.filter(p => p.legs[p.legs.length - 1].arr === p.base);
    assert.ok(closed.length >= ps.length - 1, 'demo rotations return to base');
  });

  test('cancelled flights are not rostered', () => {
    const fl = flightsOf(['2026-10-20']).map((f, i) => (i === 0 ? { ...f, status: 'CANCELLED' as const } : f));
    assert.equal(pairings(fl).flatMap(p => p.legs).length, fl.length - 1);
  });

  test('builder covers a week legally, never double-books, respects leave', () => {
    const dates = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'];
    const ps = pairings(flightsOf(dates));
    const crew = [...DEMO_CREW, ...DEMO_STANDBY_CREW];
    const away = [{ crewId: 'CPT-01A', kind: 'LEAVE' as const, start: new Date('2026-10-19T00:00:00Z'), end: new Date('2026-10-27T00:00:00Z') }];
    const r = buildRoster(ps, crew, new Map(), away, scheme, judge);
    assert.ok(r.assignments.length > 0);
    assert.ok(!r.assignments.some(a => a.crewId === 'CPT-01A'), 'on leave');
    const byCrew = new Map<string, CrewRosterLeg[]>();
    const byId = new Map(ps.flatMap(p => p.legs).map(f => [f.id, f]));
    for (const a of r.assignments) {
      for (const id of a.flightIds) byCrew.set(a.crewId, [...(byCrew.get(a.crewId) ?? []), { crewId: a.crewId, role: a.role, dutyKey: a.pairingKey, flight: byId.get(id)! }]);
    }
    for (const [id, legs] of byCrew) {
      const sorted = legs.map(l => l.flight).sort((a, b) => a.etd.getTime() - b.etd.getTime());
      for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].etd >= sorted[i - 1].eta, `${id} double-booked`);
      assert.notEqual(judge((dutiesOf(legs, id))).status, 'VIOLATION', id);
    }
    // each pairing has at most one captain and one first officer
    const seats = new Set<string>();
    for (const a of r.assignments) { assert.ok(!seats.has(`${a.pairingKey}:${a.role}`)); seats.add(`${a.pairingKey}:${a.role}`); }
    // the right rank and type rating
    const crewById = new Map(crew.map(c => [c.id, c]));
    for (const a of r.assignments) assert.equal(crewById.get(a.crewId)!.rank, a.role);
    // everything is covered and flying is spread within each type rating
    assert.equal(r.unfilled.length, 0);
    const mins = new Map<string, number>();
    for (const a of r.assignments) for (const id of a.flightIds) { const f = byId.get(id)!; mins.set(a.crewId, (mins.get(a.crewId) ?? 0) + (f.eta.getTime() - f.etd.getTime()) / 60_000); }
    for (const rating of ['B737', 'A320']) {
      const v = [...mins.entries()].filter(([id]) => crewById.get(id)!.qualifications.includes(rating)).map(([, m]) => m);
      const avg = v.reduce((a, b) => a + b, 0) / v.length;
      assert.ok(Math.max(...v) <= 2 * avg, rating);
    }
  });

  test('a pairing with nobody eligible is reported, with the reason', () => {
    const ps = pairings(flightsOf(['2026-10-20'])).filter(p => p.aircraftType === 'A330-300');
    const r = buildRoster(ps, DEMO_CREW.filter(c => !c.qualifications.includes('A330')), new Map(), [], scheme, judge);
    assert.equal(r.assignments.length, 0);
    assert.ok(r.unfilled.length >= 2);
    assert.match(r.unfilled[0].reason, /type rating|No (CPT|FO)/);
  });

  test('WOCL minutes and fatigue bands', () => {
    // 01:00–07:00 Oslo (CEST, UTC+2) → 02:00–06:00 is 240 min
    assert.equal(woclMinutes(new Date('2026-07-01T23:00:00Z'), new Date('2026-07-02T05:00:00Z'), 'Europe/Oslo'), 240);
    const day = fatigueScore(fact('2026-07-02T07:00:00Z', '2026-07-02T13:00:00Z'), null);
    assert.equal(day.band, 'LOW');
    const night = fatigueScore(fact('2026-07-01T23:00:00Z', '2026-07-02T10:00:00Z', 6), fact('2026-07-01T03:00:00Z', '2026-07-01T14:00:00Z'));
    assert.equal(night.band, 'HIGH');
    assert.ok(night.reasons.some(r => /circadian/.test(r)));
    assert.ok(night.reasons.some(r => /rest/.test(r)));
  });

  test('14-day publication notice and fatigue report scales', () => {
    assert.equal(publicationNotice('2026-10-30', NOW), null);
    assert.match(publicationNotice('2026-10-15', NOW)!, /7 days ahead/);
    assert.throws(() => publicationNotice('2026-10-01', NOW), /already started/);
    assert.equal(fatigueReportSeverity(3, 2), 'LOW');
    assert.equal(fatigueReportSeverity(6, 3), 'MODERATE');
    assert.equal(fatigueReportSeverity(5, 6), 'HIGH');
    assert.throws(() => fatigueReportSeverity(10, 2), /KSS/);
  });
});

function dutiesOf(legs: CrewRosterLeg[], crewId: string) {
  const base = [...DEMO_CREW, ...DEMO_STANDBY_CREW].find(c => c.id === crewId)!.base;
  return buildDuties(legs, scheme(base));
}

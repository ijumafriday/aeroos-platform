/**
 * Golden tests: each case pins a regulatory outcome. When a rulepack version changes, these
 * tests are the evidence (for the compliance officer and the authority) of what changed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, ComplianceEngine, defaultRegistry, endOfCalendarDaysAfter, type OperatorProfile, type Privilege } from './index';

const iso = (d: Date) => d.toISOString();

const NKX: OperatorProfile = {
  operatorId: 'NKX',
  name: 'Nordkapp Air',
  authority: 'EASA',
  melTimeZone: 'UTC',
  approvedTypes: ['B737-800', 'A320neo'],
  mel: {
    '33-42-01': { ref: '33-42-01', ata: '33', title: 'Landing light', category: 'C', extensionPermitted: true },
    '21-51-02': { ref: '21-51-02', ata: '21', title: 'Pack flow control valve', category: 'B', extensionPermitted: true },
    '31-31-01': { ref: '31-31-01', ata: '31', title: 'FDR status', category: 'A', intervalHours: 24, extensionPermitted: false },
    '25-41-03': { ref: '25-41-03', ata: '25', title: 'Lavatory mirror', category: 'D', extensionPermitted: true },
    '36-11-04': { ref: '36-11-04', ata: '36', title: 'Bleed overtemp sensor', category: 'B', extensionPermitted: false }
  }
};
const OSLO: OperatorProfile = { ...NKX, operatorId: 'NKX-OSL', melTimeZone: 'Europe/Oslo' };
const US: OperatorProfile = { ...NKX, operatorId: 'USX', name: 'US carrier', authority: 'FAA' };

const engine = new ComplianceEngine(defaultRegistry({ allowDraft: false }), [NKX, OSLO, US]);
const devEngine = new ComplianceEngine(defaultRegistry({ allowDraft: true }), [NKX, US]);

describe('MEL rectification deadlines (EASA)', () => {
  const raised = new Date('2026-10-08T10:00:00Z');
  test('Cat B: 3 calendar days excluding the day of discovery', () => {
    assert.equal(iso(engine.deferralDeadline('NKX', '21-51-02', raised).value), '2026-10-12T00:00:00.000Z');
  });
  test('Cat C: 10 calendar days', () => {
    assert.equal(iso(engine.deferralDeadline('NKX', '33-42-01', raised).value), '2026-10-19T00:00:00.000Z');
  });
  test('Cat D: 120 calendar days', () => {
    assert.equal(iso(engine.deferralDeadline('NKX', '25-41-03', raised).value), '2027-02-06T00:00:00.000Z');
  });
  test('Cat A: interval from the MEL remarks', () => {
    assert.equal(iso(engine.deferralDeadline('NKX', '31-31-01', raised).value), '2026-10-09T10:00:00.000Z');
  });
  test('the decision records the rulepack version and basis', () => {
    const d = engine.deferralDeadline('NKX', '21-51-02', raised);
    assert.equal(d.rule, 'EASA@2026.1');
    assert.match(d.basis, /3 consecutive calendar days/);
  });
  test('calendar days follow the operator time zone', () => {
    // 22:30Z on 8 Oct is 00:30 on 9 Oct in Oslo (CEST), so the discovery day is 9 Oct local.
    assert.equal(iso(engine.deferralDeadline('NKX-OSL', '21-51-02', new Date('2026-10-08T22:30:00Z')).value), '2026-10-12T22:00:00.000Z');
  });
  test('calendar days stay correct across the end of daylight saving', () => {
    // Discovered 20 Oct (CEST); interval ends at local midnight 31 Oct, which is CET (UTC+1).
    assert.equal(iso(endOfCalendarDaysAfter(new Date('2026-10-20T08:00:00Z'), 10, 'Europe/Oslo')), '2026-10-30T23:00:00.000Z');
  });
  test('an item outside the operator MEL is rejected', () => {
    assert.throws(() => engine.deferralDeadline('NKX', '99-99-99', raised), /not in the approved MEL/);
  });
});

describe('MEL extensions (EASA)', () => {
  const raisedAt = new Date('2026-10-08T10:00:00Z');
  const deadline = new Date('2026-10-12T00:00:00Z');
  const base = { raisedAt, currentDeadline: deadline, originalDeadline: deadline, extensionsGranted: 0, requestedAt: new Date('2026-10-11T12:00:00Z') };

  test('a first extension before expiry adds at most the original interval', () => {
    const d = engine.extension('NKX', { ...base, ref: '21-51-02' });
    assert.equal(d.value.allowed, true);
    if (d.value.allowed) assert.equal(iso(d.value.newDeadline), new Date(deadline.getTime() + (deadline.getTime() - raisedAt.getTime())).toISOString());
  });
  test('a second extension is refused', () => {
    assert.equal(engine.extension('NKX', { ...base, ref: '21-51-02', extensionsGranted: 1 }).value.allowed, false);
  });
  test('Category A is never extendable', () => {
    const d = engine.extension('NKX', { ...base, ref: '31-31-01' });
    assert.deepEqual(d.value, { allowed: false, reason: 'Category A rectification intervals cannot be extended' });
  });
  test('the operator MEL can forbid extension for an item', () => {
    assert.equal(engine.extension('NKX', { ...base, ref: '36-11-04' }).value.allowed, false);
  });
  test('an extension after expiry is refused', () => {
    assert.equal(engine.extension('NKX', { ...base, ref: '21-51-02', requestedAt: new Date('2026-10-12T00:00:01Z') }).value.allowed, false);
  });
});

describe('Flight duty period (EASA ORO.FTL.205 Table 2)', () => {
  const at = new Date('2026-10-08T00:00:00Z');
  const fdp = (hour: number, minute: number, sectors: number) => engine.maxFdpMinutes('NKX', { reportLocal: { hour, minute }, sectors, acclimatised: true }, at).value;
  test('07:00 report, 2 sectors → 13:00', () => assert.equal(fdp(7, 0, 2), 780));
  test('07:00 report, 4 sectors → 12:00', () => assert.equal(fdp(7, 0, 4), 720));
  test('never below 9:00', () => assert.equal(fdp(7, 0, 10), 540));
  test('18:00 report, 3 sectors → 10:30', () => assert.equal(fdp(18, 0, 3), 630));
  test('05:20 report, 1 sector → 12:15', () => assert.equal(fdp(5, 20, 1), 735));
});

describe('Certification privileges', () => {
  const at = new Date('2026-10-08T12:00:00Z');
  const future = new Date('2028-01-01T00:00:00Z');
  const mwangi: Privilege[] = [
    { authority: 'EASA', category: 'B1.1', typeRatings: ['B737-800', 'A320neo'], validUntil: future },
    { authority: 'EASA', category: 'B2', typeRatings: ['B737-800'], validUntil: future }
  ];
  const auth = { reference: 'C-AUTH 145-112', aircraftTypes: ['B737-800', 'A320neo'], validUntil: future, suspended: false };

  test('B1 with the type rating may certify mechanical work', () => {
    const d = engine.canCertify('NKX', { privileges: mwangi, authorisation: auth, aircraftType: 'B737-800', trade: 'MECHANICAL', at });
    assert.equal(d.value.allowed, true);
  });
  test('avionics work needs B2 with the type rating', () => {
    const d = engine.canCertify('NKX', { privileges: mwangi, authorisation: auth, aircraftType: 'A320neo', trade: 'AVIONICS', at });
    assert.equal(d.value.allowed, false);
  });
  test('an expired licence cannot certify', () => {
    const expired = mwangi.map(p => ({ ...p, validUntil: new Date('2026-01-01T00:00:00Z') }));
    const d = engine.canCertify('NKX', { privileges: expired, authorisation: auth, aircraftType: 'B737-800', trade: 'MECHANICAL', at });
    assert.deepEqual(d.value, { allowed: false, reason: 'No valid Part-66 licence' });
  });
  test('a suspended company authorisation blocks certification', () => {
    const d = engine.canCertify('NKX', { privileges: mwangi, authorisation: { ...auth, suspended: true }, aircraftType: 'B737-800', trade: 'MECHANICAL', at });
    assert.equal(d.value.allowed, false);
  });
  test('types outside the organisation approval are refused', () => {
    const d = engine.canCertify('NKX', { privileges: mwangi, authorisation: auth, aircraftType: 'A330-300', trade: 'MECHANICAL', at });
    assert.equal(d.rule, 'OPERATOR');
  });
});

describe('Certifying staff currency (EASA 145.A.35)', () => {
  const at = new Date('2026-10-08T12:00:00Z');
  test('6 months experience and training within 24 months → current, with the next due date', () => {
    const d = engine.currency('NKX', { experienceMonthsLast24: 9, lastContinuationTraining: new Date('2025-03-15T00:00:00Z'), at });
    assert.deepEqual(d.value, { current: true, trainingDue: new Date('2027-03-15T00:00:00Z') });
    assert.equal(d.rule, 'EASA@2026.1');
  });
  test('fewer than 6 months of experience → not current', () => {
    const d = engine.currency('NKX', { experienceMonthsLast24: 5, lastContinuationTraining: new Date('2026-01-01T00:00:00Z'), at });
    assert.equal(d.value.current, false);
  });
  test('continuation training older than 24 months → not current', () => {
    const d = engine.currency('NKX', { experienceMonthsLast24: 12, lastContinuationTraining: new Date('2024-10-08T12:00:00Z'), at });
    assert.deepEqual(d.value, { current: false, reason: 'Continuation training expired on 2026-10-08' });
  });
  test('no training on record → not current', () => {
    assert.equal(engine.currency('NKX', { experienceMonthsLast24: 12, lastContinuationTraining: null, at }).value.current, false);
  });
  test('certification is refused when currency fails, even with a valid licence and authorisation', () => {
    const future = new Date('2028-01-01T00:00:00Z');
    const d = engine.canCertify('NKX', {
      privileges: [{ authority: 'EASA', category: 'B1.1', typeRatings: ['B737-800'], validUntil: future }],
      authorisation: { reference: 'C-AUTH 1', aircraftTypes: ['B737-800'], validUntil: future, suspended: false },
      aircraftType: 'B737-800', trade: 'MECHANICAL', at,
      currency: { experienceMonthsLast24: 2, lastContinuationTraining: new Date('2026-01-01T00:00:00Z'), at }
    });
    assert.equal(d.value.allowed, false);
    assert.match(d.basis, /145\.A\.35\(c\)/);
  });
  test('adding months clamps to the end of the month', () => {
    assert.equal(addMonths(new Date('2024-01-31T00:00:00Z'), 1).toISOString(), '2024-02-29T00:00:00.000Z');
  });
});

describe('Company authorisation scope', () => {
  const at = new Date('2026-10-08T12:00:00Z');
  const b1 = [{ authority: 'EASA' as const, category: 'B1.1', typeRatings: ['B737-800'], validUntil: new Date('2028-01-01T00:00:00Z') }];
  test('types covered by a valid Part-66 type rating may be authorised', () => {
    assert.equal(engine.authorisationScope('NKX', { privileges: b1, aircraftTypes: ['B737-800'], at }).value.allowed, true);
  });
  test('a type without a Part-66 type rating may not', () => {
    const d = engine.authorisationScope('NKX', { privileges: b1, aircraftTypes: ['B737-800', 'A320neo'], at });
    assert.deepEqual(d.value, { allowed: false, reason: 'No valid Part-66 type rating for A320neo' });
  });
  test('a type outside the organisation approval is refused before licence rules', () => {
    assert.equal(engine.authorisationScope('NKX', { privileges: b1, aircraftTypes: ['A330-300'], at }).rule, 'OPERATOR');
  });
  test('FAA scope needs an A or P rating but no type rating (draft)', () => {
    const faa = [{ authority: 'FAA' as const, category: 'A', typeRatings: [], validUntil: new Date('2030-01-01T00:00:00Z') }];
    assert.equal(devEngine.authorisationScope('USX', { privileges: faa, aircraftTypes: ['B737-800'], at }).value.allowed, true);
  });
});

describe('Flight and duty time limitations (EASA ORO.FTL)', () => {
  const at = new Date('2026-10-08T00:00:00Z');
  const H = 3_600_000;
  // A duty reporting at `report` (UTC; Oslo is UTC+2 in October), lasting `fdpH` hours of FDP + 30 min post-flight.
  const duty = (id: string, report: string, fdpH: number, o: Partial<{ sectors: number; flight: number; home: boolean; zone: string }> = {}) => {
    const r = new Date(report);
    return {
      id, report: r, fdpEnd: new Date(r.getTime() + fdpH * H), dutyEnd: new Date(r.getTime() + fdpH * H + 0.5 * H),
      sectors: o.sectors ?? 2, flightMinutes: o.flight ?? Math.round(fdpH * 60 * 0.7), reportTimeZone: o.zone ?? 'Europe/Oslo',
      acclimatised: true, restAtHomeBase: o.home ?? true
    };
  };
  const check = (duties: ReturnType<typeof duty>[]) => engine.rosterCheck('NKX', { duties }, at);

  test('a legal two-day pattern has no findings, and the decision names the rulepack', () => {
    const d = check([duty('D1', '2026-10-08T05:00:00Z', 10), duty('D2', '2026-10-09T05:00:00Z', 10)]);
    assert.deepEqual(d.value, []);
    assert.equal(d.rule, 'EASA@2026.1');
  });
  test('FDP limits use local report time: 07:00 Oslo (05:00Z), 2 sectors → 13:00', () => {
    const v = check([duty('D1', '2026-10-08T05:00:00Z', 14)]).value;
    assert.equal(v[0].code, 'FDP');
    assert.equal(v[0].limitMinutes, 780);
    assert.equal(v[0].severity, 'discretion'); // 1 h over: commander's discretion only
  });
  test('more than 2 h over the FDP limit is a violation, not discretion', () => {
    assert.equal(check([duty('D1', '2026-10-08T05:00:00Z', 15.5)]).value[0].severity, 'violation');
  });
  test('rest at home base: at least the preceding duty and at least 12 h', () => {
    const v = check([duty('D1', '2026-10-08T05:00:00Z', 10), duty('D2', '2026-10-08T21:00:00Z', 6)]).value;
    const rest = v.find(x => x.code === 'REST')!;
    assert.equal(rest.limitMinutes, 12 * 60);
    assert.equal(rest.actualMinutes, 5 * 60 + 30);
  });
  test('rest away from base: 10 h, but never less than the preceding duty', () => {
    const v = check([duty('D1', '2026-10-08T05:00:00Z', 11.5), duty('D2', '2026-10-08T22:00:00Z', 6, { home: false })]).value;
    assert.equal(v.find(x => x.code === 'REST')!.limitMinutes, 12 * 60); // preceding duty was 12:00
  });
  test('60 duty hours in any 7 consecutive days', () => {
    const days = Array.from({ length: 6 }, (_, i) => duty(`D${i}`, `2026-10-${String(8 + i).padStart(2, '0')}T05:00:00Z`, 11, { flight: 300 }));
    const v = check(days).value.find(x => x.code === 'DUTY_7D')!;
    assert.equal(v.limitMinutes, 3600);
    assert.equal(v.actualMinutes, 6 * 11.5 * 60);
    assert.equal(v.ref, 'ORO.FTL.210(a)(1)');
  });
  test('100 flight hours in 28 consecutive days', () => {
    const days = Array.from({ length: 13 }, (_, i) => duty(`D${i}`, new Date(Date.UTC(2026, 9, 1 + i * 2, 5)).toISOString(), 10, { flight: 480 }));
    assert.ok(check(days).value.some(x => x.code === 'FLIGHT_28D' && x.actualMinutes! > 6000));
  });
  test('non-acclimatised duties are flagged for a manual check, not silently passed', () => {
    const d = { ...duty('D1', '2026-10-08T05:00:00Z', 8), acclimatised: false };
    assert.equal(engine.rosterCheck('NKX', { duties: [d] }, at).value[0].code, 'FDP_UNSUPPORTED');
  });
  test('FAA (draft) requires 10 h rest regardless of the preceding duty', () => {
    const v = devEngine.rosterCheck('USX', { duties: [duty('D1', '2026-10-08T12:00:00Z', 11.5), duty('D2', '2026-10-09T10:30:00Z', 6)] }, at).value;
    assert.equal(v.filter(x => x.code === 'REST').length, 0); // 10 h 30 min rest is enough under 117.25(e) …
    const easa = engine.rosterCheck('NKX', { duties: [duty('D1', '2026-10-08T12:00:00Z', 11.5), duty('D2', '2026-10-09T10:30:00Z', 6)] }, at).value;
    assert.equal(easa.filter(x => x.code === 'REST').length, 1); // … but not under ORO.FTL.235 (12 h at home base)
  });
});

describe('Rulepack registry and FAA divergence', () => {
  test('draft rulepacks are refused outside development', () => {
    assert.throws(() => engine.deferralDeadline('USX', '21-51-02', new Date('2026-10-08T10:00:00Z')), /must be approved/);
  });
  test('FAA mechanics certify without aircraft type ratings (draft rulepack)', () => {
    const at = new Date('2026-10-08T12:00:00Z');
    const d = devEngine.canCertify('USX', {
      privileges: [{ authority: 'FAA', category: 'A', typeRatings: [], validUntil: new Date('2030-01-01T00:00:00Z') }],
      authorisation: { reference: 'CARRIER-AUTH-7', aircraftTypes: ['B737-800'], validUntil: new Date('2030-01-01T00:00:00Z'), suspended: false },
      aircraftType: 'B737-800', trade: 'MECHANICAL', at
    });
    assert.equal(d.value.allowed, true);
    assert.equal(d.rule, 'FAA@2026.1-draft');
  });
  test('FAA Part 117 and EASA ORO.FTL give different limits for the same duty', () => {
    const at = new Date('2026-10-08T00:00:00Z');
    const duty = { reportLocal: { hour: 7, minute: 0 }, sectors: 2, acclimatised: true };
    assert.equal(devEngine.maxFdpMinutes('NKX', duty, at).value, 780);
    assert.equal(devEngine.maxFdpMinutes('USX', duty, at).value, 840);
  });
  test('FAA allows no Category D extension (draft)', () => {
    const raisedAt = new Date('2026-10-08T10:00:00Z');
    const dl = new Date('2027-02-06T00:00:00Z');
    const d = devEngine.extension('USX', { ref: '25-41-03', raisedAt, currentDeadline: dl, originalDeadline: dl, extensionsGranted: 0, requestedAt: new Date('2026-12-01T00:00:00Z') });
    assert.equal(d.value.allowed, false);
  });
  test('past decisions can be replayed by exact rulepack id', () => {
    assert.equal(defaultRegistry({ allowDraft: false }).byId('EASA@2026.1').authority, 'EASA');
  });
});

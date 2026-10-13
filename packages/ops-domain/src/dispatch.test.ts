import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fuelPlan, icaoFlightPlan, lmcWithinTolerance, massAndBalance, permitCheck, releasable, tankering, type AircraftWeight, type LoadInput, type TypeData } from './index';

export const B738: TypeData = {
  type: 'B737-800', icaoType: 'B738', wake: 'M', seats: 186, mzfw: 62_732, mtow: 79_016, mlw: 66_361, maxFuel: 20_894,
  lemac: 16.0, mac: 3.96, fwdLimit: 8, aftLimit: 33, crewArm: 3.0, paxArm: 17.2, holdFwdArm: 11.0, holdAftArm: 23.5, fuelArm: 17.0,
  burnKgPerHour: 2_500, holdKgPerMin: 40, cruiseKt: 450
};
const LNABC: AircraftWeight = { tail: 'LN-ABC', basicEmptyKg: 41_800, basicArm: 17.0, weighedOn: '2024-03-01' };
const now = new Date('2026-10-09T05:00:00Z');
const load = (over: Partial<LoadInput> = {}): LoadInput => ({ flightCrew: 2, cabinCrew: 4, adults: 160, children: 6, infants: 2, bags: 120, holdFwdKg: 600, holdAftKg: 400, takeoffFuelKg: 6_000, tripFuelKg: 2_300, ...over });

describe('Dispatch: mass & balance', () => {
  test('standard masses, ZFW/TOW/LW and %MAC within limits', () => {
    const r = massAndBalance(B738, LNABC, load(), { bagKind: 'DOMESTIC', rtow: null, rlw: null, now });
    assert.equal(r.paxMass, 160 * 84 + 6 * 35);
    assert.equal(r.bagMass, 120 * 11);
    assert.ok(r.lwMac > 8 && r.lwMac < 33);
    assert.equal(r.dow, 41_800 + 2 * 85 + 4 * 75);
    assert.equal(r.tow, r.zfw + 6_000);
    assert.equal(r.lw, r.tow - 2_300);
    assert.deepEqual(r.findings, []);
    assert.ok(r.zfwMac > 8 && r.zfwMac < 33, `ZFW ${r.zfwMac} %MAC`);
    assert.ok(r.underload > 0);
  });
  test('a short runway (RTOW) and overload are found; cargo all forward moves the CG out', () => {
    const heavy = massAndBalance(B738, LNABC, load({ takeoffFuelKg: 14_000 }), { bagKind: 'EUROPE', rtow: 70_000, rlw: null, now });
    assert.equal(heavy.limits.towBy, 'RTOW');
    assert.ok(heavy.findings.some(f => /runway\/performance limit/.test(f)));
    const nose = massAndBalance(B738, LNABC, load({ adults: 20, children: 0, infants: 0, bags: 0, holdFwdKg: 8_000, holdAftKg: 0 }), { bagKind: 'DOMESTIC', rtow: null, rlw: null, now });
    assert.ok(nose.findings.some(f => /Centre of gravity/.test(f)), nose.findings.join('; '));
  });
  test('seats, infants and the 4-year reweighing', () => {
    const r = massAndBalance(B738, { ...LNABC, weighedOn: '2021-06-01' }, load({ adults: 185, children: 5, infants: 3 }), { bagKind: 'DOMESTIC', rtow: null, rlw: null, now });
    assert.ok(r.findings.some(f => /190 seated passengers/.test(f)));
    assert.ok(r.findings.some(f => /reweighing is overdue/.test(f)));
    assert.throws(() => massAndBalance(B738, LNABC, load({ flightCrew: 1 }), { bagKind: 'DOMESTIC', rtow: null, rlw: null, now }), /two flight crew/);
  });
});

describe('Dispatch: fuel, tankering, flight plan, permits, release', () => {
  test('basic fuel scheme: contingency is 5 % or 5 minutes holding, 30 minutes final reserve', () => {
    const f = fuelPlan(B738, { tripMinutes: 55, alternateMinutes: 35, block: 5_500 });
    assert.equal(f.trip, 2_292);
    assert.equal(f.contingency, 200); // 5 % of 2,292 = 115 < 5 × 40 = 200
    assert.equal(f.finalReserve, 1_200);
    assert.equal(f.required, 200 + 2_292 + 200 + 1_458 + 1_200);
    assert.equal(f.margin, 5_500 - f.required);
  });
  test('tankering pays only when the price gap beats the extra burn, within the landing margin', () => {
    assert.equal(tankering({ priceDepPerKg: 0.9, priceArrPerKg: 0.91, flightMinutes: 120, landingMargin: 5_000, takeoffMargin: 9_000, tankMargin: 10_000, neededAtArrivalKg: 6_000 }).worthIt, false);
    const t = tankering({ priceDepPerKg: 0.85, priceArrPerKg: 1.05, flightMinutes: 55, landingMargin: 2_345, takeoffMargin: 9_000, tankMargin: 10_000, neededAtArrivalKg: 6_000 });
    assert.equal(t.carryKg, 2_300);
    assert.ok(t.savingUsd > 0);
  });
  test('ICAO flight plan', () => {
    const fpl = icaoFlightPlan({ operatorIcao: 'NKX', flightNo: 'NK601', tail: 'LN-ABC', t: B738, dep: 'ENGM', arr: 'ENBR', eobt: new Date('2026-10-09T05:30:00Z'),
      tripMinutes: 55, cruiseLevel: 350, route: 'DCT', alternates: ['ENZV'] });
    assert.equal(fpl, '(FPL-NKX601-IS\n-B738/M-SDE2E3FGHIJ1RWY/LB1\n-ENGM0530\n-N0450F350 DCT\n-ENBR0055 ENZV\n-PBN/A1B1C1D1 DOF/261009 REG/LNABC)');
  });
  test('overflight permits and the release', () => {
    const route = [{ code: 'NO', permitRequired: false }, { code: 'MA', permitRequired: true }];
    assert.equal(permitCheck(route, [], '2026-10-09', 'B737-800')[0].ok, false);
    assert.equal(permitCheck(route, [{ country: 'MA', number: 'MA-OVF-2026-118', validFrom: '2026-01-01', validTo: '2026-12-31', types: [] }], '2026-10-09', 'B737-800')[0].ok, true);
    assert.equal(releasable([{ code: 'WB', ok: true, message: '' }, { code: 'FUEL', ok: false, message: 'short' }]), false);
    assert.equal(lmcWithinTolerance({ tow: 70_000, pax: 150 }, { tow: 70_400, pax: 155 }), true);
    assert.equal(lmcWithinTolerance({ tow: 70_000, pax: 150 }, { tow: 70_800, pax: 155 }), false);
  });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ComplianceEngine, defaultRegistry, type OperatorProfile } from '@aeroos/compliance';
import {
  allocate, createWorkPackage, defectRates, dueItem, freezeWorkPackage, llpNewPoint, planWorkPackage, recordItemCompliance, releaseWorkPackage, setWorkPackagePlanning,
  requireCalibrated, signStep, taskCardFromWorkPackageItem, utilisation, type Requirement, type Signer
} from './index';
import { LocalKeyService } from '@aeroos/signing';

const now = new Date('2026-10-08T12:00:00Z');
const delivery = new Date('2018-03-01T00:00:00Z');
const current = { at: now, fh: 21_450.5, fc: 14_210 };
const util = { fhPerDay: 9, fcPerDay: 6 };
const req = (over: Partial<Requirement>): Requirement => ({
  id: 'R1', kind: 'TASK', ref: 'AMP 32-110-01', title: 'Main gear lubrication', ata: '32', types: ['B737-800'], interval: { fh: 300, days: 60 },
  repetitive: true, steps: ['Lubricate per AMM 12-21-11'], estimatedHours: 1, tools: [], parts: [], ...over
});

describe('Due-list engine (whichever comes first)', () => {
  test('FH limits first at current utilisation, with a forecast date', () => {
    const d = dueItem(req({}), current, { at: new Date('2026-09-20T00:00:00Z'), fh: 21_200, fc: 14_050 }, delivery, util, { dueSoonDays: 14 });
    assert.equal(d.next.fh, 21_500);
    assert.equal(d.remaining.fh, 49.5);
    assert.equal(d.limiting, 'FH'); // 49.5 FH / 9 per day ≈ 5.5 days, before 42 calendar days
    assert.equal(d.status, 'DUE_SOON');
    assert.equal(d.forecast!.toISOString().slice(0, 13), '2026-10-14T00'); // 5.5 days after 8 Oct 12:00Z
  });
  test('calendar limit wins when the aircraft flies little', () => {
    const d = dueItem(req({}), current, { at: new Date('2026-08-12T00:00:00Z'), fh: 21_400, fc: 14_150 }, delivery, { fhPerDay: 0.5, fcPerDay: 0.3 }, { dueSoonDays: 14 });
    assert.equal(d.limiting, 'DAYS');
    assert.equal(d.remaining.days, 2); // due 11 Oct 00:00Z, 2½ days away (whole days, rounded down)
  });
  test('a task inside its approved tolerance is flagged, beyond it is overdue', () => {
    const r = req({ interval: { fh: 300, toleranceFh: 30 } });
    const last = (fh: number) => ({ at: new Date('2026-09-01T00:00:00Z'), fh, fc: 14_000 });
    assert.equal(dueItem(r, current, last(21_130), delivery, util).status, 'IN_TOLERANCE'); // 20.5 FH over
    assert.equal(dueItem(r, current, last(21_100), delivery, util).status, 'OVERDUE'); // 50.5 FH over
  });
  test('ADs never get a tolerance', () => {
    const ad = req({ kind: 'AD', ref: 'EASA AD 2026-0123', interval: { fc: 1500, toleranceFc: 100 } });
    assert.equal(dueItem(ad, current, { at: delivery, fh: 0, fc: 12_700 }, delivery, util).status, 'OVERDUE');
  });
  test('a complied one-time AD stays complied', () => {
    const ad = req({ kind: 'AD', repetitive: false, interval: { fc: 5000 } });
    assert.equal(dueItem(ad, current, null, delivery, util, { dueSoonDays: 14, complied: true }).status, 'COMPLIED');
  });
  test('never done: counted from delivery', () => {
    const d = dueItem(req({ interval: { fc: 20_000 } }), current, null, delivery, util);
    assert.equal(d.remaining.fc, 5_790);
  });
  test('life-limited part: a disk installed with 12 000 cycles since new on a 20 000-cycle limit', () => {
    const newPoint = llpNewPoint({ at: new Date('2024-01-10T00:00:00Z'), fh: 15_000, fc: 10_000 }, 18_000, 12_000);
    const d = dueItem(req({ kind: 'LLP', ref: 'LLP 72-HPT-1', repetitive: false, interval: { fc: 20_000 } }), current, newPoint, delivery, util);
    assert.equal(d.remaining.fc, 20_000 - (12_000 + 4_210)); // part CSN now = 16 210
    assert.equal(d.status, 'OK');
  });
  test('utilisation from completed flights', () => {
    const flights = Array.from({ length: 60 }, (_, i) => ({ arrivedAt: new Date(now.getTime() - i * 12 * 3_600_000), blockMinutes: 90 }));
    assert.deepEqual(utilisation(flights, now, 30), { fhPerDay: 3, fcPerDay: 2 });
  });
});

describe('Reliability', () => {
  test('defect rate per 1000 FH by ATA chapter against alert levels', () => {
    const defects = [{ ata: '21', at: now }, { ata: '21-51', at: now }, { ata: '33', at: now }, { ata: '33', at: new Date('2025-01-01') }];
    const r = defectRates(defects, 800, now, 90, { '21': 2.0 });
    assert.deepEqual(r[0], { ata: '21', defects: 2, ratePer1000Fh: 2.5, alertLevel: 2, alert: true });
    assert.equal(r.find(x => x.ata === '33')!.defects, 1);
  });
});

describe('Work packages: CAMO → AMO → CAMO', () => {
  const lube = req({});
  const ad = req({ id: 'R2', kind: 'AD', ref: 'EASA AD 2026-0123', title: 'Slat track inspection', ata: '27', interval: { fc: 1500 }, steps: ['Inspect slat tracks 2–5', 'Record findings'], tools: ['Borescope'], parts: [{ partNo: 'BACB30', qty: 4 }] });
  const wp = () => createWorkPackage({ id: 'WP-1', operatorId: 'NKX', tail: 'LN-ABC', aircraftType: 'B737-800', title: 'Night stop', station: 'ENGM', requirements: [lube, ad] });

  test('planning refuses a bay already booked in that period', () => {
    const other = { id: 'WP-0', bay: 'OSL-H2', plannedStart: new Date('2026-10-09T20:00:00Z'), plannedEnd: new Date('2026-10-10T04:00:00Z'), status: 'PLANNED' as const, tail: 'LN-ABD' };
    assert.throws(() => planWorkPackage(wp(), { bay: 'OSL-H2', start: new Date('2026-10-09T22:00:00Z'), end: new Date('2026-10-10T05:00:00Z') }, [other]), /booked for LN-ABD/);
    assert.equal(planWorkPackage(wp(), { bay: 'OSL-H1', start: new Date('2026-10-09T22:00:00Z'), end: new Date('2026-10-10T05:00:00Z') }, [other]).wp.status, 'PLANNED');
  });
  test('release requires slot, sufficient labour and frozen scope; dependency is carried to the floor', () => {
    assert.throws(() => releaseWorkPackage(wp(), [lube, ad]), /planned/);
    let planned = planWorkPackage(wp(), { bay: 'OSL-H1', start: now, end: new Date(now.getTime() + 8 * 3_600_000) }, []).wp;
    assert.throws(() => freezeWorkPackage(planned, 'user:planner', now), /Insufficient planned labour/);
    planned = setWorkPackagePlanning(planned, planned.resourcePlan.map(r => ({ ...r, availableHours: r.requiredHours })), [{ beforeRequirementId: 'R1', afterRequirementId: 'R2' }]);
    const frozen = freezeWorkPackage(planned, 'user:planner', now);
    const r = releaseWorkPackage(frozen, [lube, ad]);
    assert.equal(r.event.data.items.length, 2);
    assert.deepEqual(r.event.data.items[1].parts, [{ partNo: 'BACB30', qty: 4 }]);
    assert.deepEqual(r.event.data.items[1].predecessors, ['R1']);
    const card = taskCardFromWorkPackageItem(r.event.data, r.event.data.items[1], 'NKX', 'TC-1', now).card;
    assert.equal(card.source.id, 'WP-1/R2');
    assert.equal(card.trade, 'MECHANICAL');
  });
  test('the package completes when every item has a CRS; repeats are ignored', () => {
    let w = { ...wp(), status: 'RELEASED' as const };
    let r = recordItemCompliance(w, 'R1', 'CRS-1', now);
    assert.equal(r.completed, null);
    w = r.wp as typeof w;
    assert.equal(recordItemCompliance(w, 'R1', 'CRS-1', now).changed, false);
    r = recordItemCompliance(w, 'R2', 'CRS-2', now);
    assert.equal(r.wp.status, 'COMPLETED');
    assert.equal(r.completed!.type, 'camo.wp.completed');
  });
});

describe('Tools and stores', () => {
  test('an out-of-calibration tool is refused at signing (Part-145.A.40)', async () => {
    const NKX: OperatorProfile = { operatorId: 'NKX', name: 'N', authority: 'EASA', melTimeZone: 'UTC', approvedTypes: ['B737-800'], mel: {} };
    const engine = new ComplianceEngine(defaultRegistry({ allowDraft: false }), [NKX]);
    const keys = LocalKeyService.generate('k');
    const signer: Signer = {
      personnelId: 'P1', name: 'K', licenceNo: 'L',
      privileges: [{ authority: 'EASA', category: 'B1.1', typeRatings: ['B737-800'], validUntil: new Date('2030-01-01') }],
      authorisation: { reference: 'A', aircraftTypes: ['B737-800'], validUntil: new Date('2030-01-01'), suspended: false }
    };
    const card = { id: 'TC-1', operatorId: 'NKX', tail: 'LN-ABC', aircraftType: 'B737-800', title: 't', ata: '32', trade: 'MECHANICAL' as const, source: { type: 'WP' as const, id: 'WP-1/R1' }, steps: [{ n: 1, text: 's', stamp: null }], status: 'OPEN' as const, crs: null, createdAt: now, version: 1 };
    const sign = (p: unknown, at: Date) => keys.sign(p, at);
    await assert.rejects(signStep(engine, card, 1, signer, now, sign, [{ id: 'T-TQ-07', description: 'Torque wrench', calibrationDue: new Date('2026-10-01') }]), /145\.A\.40/);
    const ok = await signStep(engine, card, 1, signer, now, sign, [{ id: 'T-TQ-08', description: 'Torque wrench', calibrationDue: new Date('2027-01-01') }]);
    assert.deepEqual(ok.card.steps[0].stamp!.tools, ['T-TQ-08']);
    assert.deepEqual(requireCalibrated([], now).ids, []);
  });
  test('parts are allocated from the station first, shortages reported', () => {
    const r = allocate([{ partNo: 'BACB30', qty: 6 }, { partNo: 'O-RING', qty: 1 }], [
      { partNo: 'BACB30', location: 'BGO', qty: 10 }, { partNo: 'BACB30', location: 'OSL', qty: 4 }
    ], 'OSL');
    assert.deepEqual(r.allocations, [{ partNo: 'BACB30', location: 'OSL', qty: 4 }, { partNo: 'BACB30', location: 'BGO', qty: 2 }]);
    assert.deepEqual(r.shortages, [{ partNo: 'O-RING', missing: 1 }]);
  });
});

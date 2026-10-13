import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { acarsMovement, applyMovement, demoDay, matchesFlight, parseMvt, resolveTime, rotationIssues, stripTypeB, type FlightWithActuals } from './index';

const flight = (flightNo: string): FlightWithActuals => {
  const f = demoDay('2026-10-08').flights.find(x => x.flightNo === flightNo)!;
  return { ...f, operatorId: 'NKX', etd: f.std, eta: f.sta, status: 'SCHEDULED', delayMinutes: 0, delayReason: null, version: 1, offBlock: null, airborne: null, touchdown: null, onBlock: null, delayCodes: [] };
};

describe('IATA MVT parsing', () => {
  test('departure with airborne time, estimated arrival and delay codes', () => {
    const m = parseMvt('MVT\nNK682/08.LNNGX.LHR\nAD1012/1024 EA1220 OSL\nDL93/41/0005/0007\nSI LATE INBOUND');
    assert.equal(m.flightNo, 'NK682');
    assert.equal(m.day, 8);
    assert.equal(m.reg, 'LNNGX');
    assert.equal(m.offBlock, '1012');
    assert.equal(m.airborne, '1024');
    assert.equal(m.estimatedArrival, '1220');
    assert.equal(m.estimatedArrivalStation, 'OSL');
    assert.deepEqual(m.delays, [{ code: '93', minutes: 5 }, { code: '41', minutes: 7 }]);
    assert.equal(m.supplementary, 'LATE INBOUND');
  });
  test('arrival, correction, and estimated departure', () => {
    assert.equal(parseMvt('COR MVT\nNK682/08.LNNGX.OSL\nAA1215/1222').correction, true);
    assert.equal(parseMvt('NK601/08\nED080600').estimatedDeparture, '080600');
  });
  test('unreadable messages say which element failed', () => {
    assert.throws(() => parseMvt('MVT\nHELLO'), /flight line/);
    assert.throws(() => parseMvt('MVT\nNK682/08.LNNGX.LHR\nXX1200'), /Unknown element "XX1200"/);
    assert.throws(() => parseMvt('MVT\nNK682/08.LNNGX.LHR'), /no departure/);
  });
  test('times resolve to the nearest instant, across midnight', () => {
    assert.equal(resolveTime('2350', new Date('2026-10-09T00:10:00Z')).toISOString(), '2026-10-08T23:50:00.000Z');
    assert.equal(resolveTime('090015', new Date('2026-10-08T23:50:00Z')).toISOString(), '2026-10-09T00:15:00.000Z');
    assert.throws(() => resolveTime('2560', new Date()), /not a valid/);
  });
});

describe('Applying movements', () => {
  test('a departure MVT sets actuals, ETD/ETA, delay codes and publishes departed', () => {
    const f = flight('NK682'); // STD 10:00Z, block 120
    assert.ok(matchesFlight(f, { flightNo: 'NK682', day: 8 }));
    const r = applyMovement(f, parseMvt('MVT\nNK682/08.LNNGX.LHR\nAD1012/1024 EA1215 OSL\nDL93/0012'));
    assert.equal(r.flight.status, 'DEPARTED');
    assert.equal(r.flight.delayMinutes, 12);
    assert.equal(r.flight.eta.toISOString(), '2026-10-08T12:15:00.000Z');
    assert.equal(r.flight.delayReason, '93');
    assert.deepEqual(r.events.map(e => e.type), ['ops.flight.departed']);
  });
  test('the arrival publishes airborne time for CAMO flight hours', () => {
    const dep = applyMovement(flight('NK682'), parseMvt('MVT\nNK682/08.LNNGX.LHR\nAD1012/1024')).flight;
    const r = applyMovement(dep, parseMvt('MVT\nNK682/08.LNNGX.OSL\nAA1210/1218'));
    assert.equal(r.flight.status, 'ARRIVED');
    const arrived = r.events.find(e => e.type === 'ops.flight.arrived')!;
    assert.deepEqual({ block: arrived.data.blockMinutes, airborne: arrived.data.flightMinutes }, { block: 126, airborne: 106 });
  });
  test('ACARS OOOI works the same way; repeats are no-ops; conflicting times need a COR', () => {
    const out = applyMovement(flight('NK601'), acarsMovement({ flightNo: 'NK601', day: 8, reg: 'LN-ABC', event: 'OUT', time: '0535' }));
    assert.equal(out.flight.status, 'DEPARTED');
    assert.equal(applyMovement(out.flight, acarsMovement({ flightNo: 'NK601', day: 8, reg: 'LN-ABC', event: 'OUT', time: '0535' })).changed, false);
    assert.throws(() => applyMovement(out.flight, acarsMovement({ flightNo: 'NK601', day: 8, reg: 'LN-ABC', event: 'OUT', time: '0540' })), /COR MVT/);
    const cor = { ...parseMvt('COR MVT\nNK601/08.LNABC.OSL\nAD0540'), correction: true };
    assert.equal(applyMovement(out.flight, cor).flight.offBlock!.toISOString(), '2026-10-08T05:40:00.000Z');
  });
  test('a message for a different registration is refused', () => {
    assert.throws(() => applyMovement(flight('NK682'), parseMvt('MVT\nNK682/08.LNABC.LHR\nAD1012')), /planned on LN-NGX/);
  });
  test('an estimated departure before off-blocks becomes a delay', () => {
    const r = applyMovement(flight('NK682'), parseMvt('MVT\nNK682/08.LNNGX.LHR\nED081045\nDL89/0045'));
    assert.equal(r.flight.status, 'DELAYED');
    assert.equal(r.flight.delayMinutes, 45);
    assert.equal(r.events[0].type, 'ops.flight.delayed');
  });
});

describe('Movement safety', () => {
  test('actual times in the future are refused (10 min clock-skew tolerance)', () => {
    const f = flight('NK682');
    const m = parseMvt('MVT\nNK682/08.LNNGX.LHR\nAD1005/1015');
    assert.throws(() => applyMovement(f, m, new Date('2026-10-08T09:30:00Z')), /in the future/);
    assert.equal(applyMovement(f, m, new Date('2026-10-08T10:06:00Z')).flight.status, 'DEPARTED');
  });
});

describe('Movement after simulation', () => {
  test('a late departure message for a flight the simulation already landed keeps it ARRIVED and sends no second arrival', () => {
    const f = { ...flight('NK682'), status: 'ARRIVED' as const };
    const r = applyMovement(f, parseMvt('MVT\nNK682/08.LNNGX.LHR\nAD1004/1012'), new Date('2026-10-08T13:00:00Z'));
    assert.equal(r.flight.status, 'ARRIVED');
    assert.ok(!r.events.some(e => e.type === 'ops.flight.arrived' || e.type === 'ops.flight.departed'));
    assert.equal(r.flight.offBlock?.toISOString(), '2026-10-08T10:04:00.000Z');
  });
});

describe('Irregular movements', () => {
  const NOW = new Date('2026-10-09T00:00:00Z');
  const departed = () => applyMovement(flight('NK682'), parseMvt('MVT\nNK682/08.LNNGX.LHR\nAD1004/1012'), NOW).flight;

  test('an AA from another station is a diversion: DIVERTED, aircraft at the alternate, cycle still counted', () => {
    const m = { ...parseMvt('MVT\nNK682/08.LNNGX.BGO\nAA1150/1158\nSI WX OSL'), stationIcao: 'ENBR' };
    const r = applyMovement(departed(), m, NOW);
    assert.equal(r.flight.status, 'DIVERTED');
    assert.equal(r.flight.actualArr, 'ENBR');
    const div = r.events.find(e => e.type === 'ops.flight.diverted');
    assert.deepEqual(div && { kind: div.data.kind, station: div.data.station, planned: div.data.plannedArr }, { kind: 'DIVERSION', station: 'ENBR', planned: 'ENGM' });
    const arr = r.events.find(e => e.type === 'ops.flight.arrived');
    assert.equal(arr?.type === 'ops.flight.arrived' && arr.data.station, 'ENBR');
  });

  test('EA with another station announces the diversion before landing; an AA at the destination cancels it', () => {
    const announced = applyMovement(departed(), { ...parseMvt('MVT\nNK682/08.LNNGX.LHR\nEA1205 BGO'), stationIcao: 'EGLL', estimatedArrivalStationIcao: 'ENBR' }, NOW).flight;
    assert.equal(announced.divertingTo, 'ENBR');
    assert.equal(announced.actualArr, null);
    assert.equal(announced.status, 'DEPARTED');
    const landed = applyMovement(announced, { ...parseMvt('MVT\nNK682/08.LNNGX.OSL\nAA1201/1209'), stationIcao: 'ENGM' }, NOW).flight;
    assert.equal(landed.status, 'ARRIVED');
    assert.equal(landed.actualArr, null);
    assert.equal(landed.divertingTo, null);
  });

  test('a station-less arrival (ACARS IN) after an announced diversion confirms nothing: arrived as planned, announcement kept visible', () => {
    const announced = applyMovement(departed(), { ...parseMvt('MVT\nNK682/08.LNNGX.LHR\nEA1205 BGO'), estimatedArrivalStationIcao: 'ENBR' }, NOW).flight;
    const r = applyMovement(announced, acarsMovement({ flightNo: 'NK682', day: 8, reg: 'LN-NGX', event: 'IN', time: '1209' }), NOW);
    assert.equal(r.flight.status, 'ARRIVED');
    assert.equal(r.flight.actualArr, null);
    assert.equal(r.flight.divertingTo, 'ENBR');
    assert.ok(!r.events.some(e => e.type === 'ops.flight.diverted'));
    assert.equal(r.events.find(e => e.type === 'ops.flight.arrived')?.data.station, 'ENGM');
  });

  test('a confirmed diversion cannot be undone without COR; with COR it moves and is announced', () => {
    const div = applyMovement(departed(), { ...parseMvt('MVT\nNK682/08.LNNGX.BGO\nAA1150/1158'), stationIcao: 'ENBR' }, NOW).flight;
    assert.throws(() => applyMovement(div, { ...parseMvt('MVT\nNK682/08.LNNGX.OSL\nAA1150/1158'), stationIcao: 'ENGM' }, NOW), /COR MVT/);
    const cor = applyMovement(div, { ...parseMvt('COR MVT\nNK682/08.LNNGX.SVG\nAA1150/1158'), stationIcao: 'ENZV' }, NOW);
    assert.equal(cor.flight.actualArr, 'ENZV');
    assert.ok(cor.events.some(e => e.type === 'ops.flight.diverted' && e.data.station === 'ENZV'));
    assert.ok(!cor.events.some(e => e.type === 'ops.flight.arrived'), 'utilisation already booked');
  });

  test('a late AD after a station-less arrival still books the flight for CAMO (once)', () => {
    const inOnly = applyMovement(flight('NK682'), acarsMovement({ flightNo: 'NK682', day: 8, reg: 'LN-NGX', event: 'IN', time: '1215' }), NOW);
    assert.ok(!inOnly.events.some(e => e.type === 'ops.flight.arrived'));
    const late = applyMovement(inOnly.flight, parseMvt('MVT\nNK682/08.LNNGX.LHR\nAD1004/1012'), NOW);
    assert.equal(late.events.filter(e => e.type === 'ops.flight.arrived').length, 1);
    assert.equal(late.flight.status, 'ARRIVED');
    assert.equal(applyMovement(late.flight, parseMvt('MVT\nNK682/08.LNNGX.LHR\nAD1004/1012'), NOW).changed, false);
  });

  test('FR with touchdown only, then ACARS IN: labelled as a forced return', () => {
    const fr = applyMovement(departed(), { ...parseMvt('MVT\nNK682/08.LNNGX.LHR\nFR1040'), stationIcao: 'EGLL' }, NOW).flight;
    const r = applyMovement(fr, acarsMovement({ flightNo: 'NK682', day: 8, reg: 'LN-NGX', event: 'IN', time: '1047' }), NOW);
    assert.equal(r.flight.status, 'DIVERTED');
    assert.equal(r.events.find(e => e.type === 'ops.flight.diverted')?.data.kind, 'FORCED_RETURN');
  });

  test('FR: forced return lands the aircraft back at the departure station', () => {
    const r = applyMovement(departed(), { ...parseMvt('MVT\nNK682/08.LNNGX.LHR\nFR1040/1047\nSI BIRDSTRIKE'), stationIcao: 'EGLL' }, NOW);
    assert.equal(r.flight.status, 'DIVERTED');
    assert.equal(r.flight.actualArr, 'EGLL');
    assert.equal(r.events.find(e => e.type === 'ops.flight.diverted')?.data.kind, 'FORCED_RETURN');
  });

  test('RR: return to ramp puts the flight back at the gate as DELAYED with a fresh estimate; not allowed once airborne', () => {
    const out = applyMovement(flight('NK682'), parseMvt('MVT\nNK682/08.LNNGX.LHR\nAD1004'), NOW).flight;
    const r = applyMovement(out, parseMvt('MVT\nNK682/08.LNNGX.LHR\nRR1015\nDL41/0035'), NOW);
    assert.equal(r.flight.status, 'DELAYED');
    assert.equal(r.flight.offBlock, null);
    assert.equal(r.flight.etd.toISOString(), '2026-10-08T10:35:00.000Z');
    assert.ok(r.events.some(e => e.type === 'ops.flight.diverted' && e.data.kind === 'RETURN_TO_RAMP'));
    assert.throws(() => applyMovement(departed(), parseMvt('MVT\nNK682/08.LNNGX.LHR\nRR1020'), NOW), /forced return/);
    assert.equal(applyMovement(r.flight, parseMvt('MVT\nNK682/08.LNNGX.LHR\nRR1015\nDL41/0035'), NOW).changed, false, 'a repeated RR is ignored');
    const again = applyMovement(r.flight, parseMvt('MVT\nNK682/08.LNNGX.LHR\nAD1041/1050'), NOW);
    assert.equal(again.flight.status, 'DEPARTED');
    assert.ok(again.events.some(e => e.type === 'ops.flight.departed'));
  });

  test('the rotation is flagged when the aircraft is not where the next leg departs', () => {
    const r = applyMovement(departed(), { ...parseMvt('MVT\nNK682/08.LNNGX.BGO\nAA1150/1158'), stationIcao: 'ENBR' }, NOW).flight;
    const nextLeg = flight('NK651');
    const issues = rotationIssues([r, nextLeg], 35);
    assert.match(issues.get(nextLeg.id)!.join(), /LN-NGX is at ENBR after NK682 \(diverted\) but NK651 departs ENGM/);
  });
});

describe('Type B envelope', () => {
  test('addresses and originator line are removed, control characters and NNNN too', () => {
    const raw = '\x01QU OSLKKNK OSLOPNK\nLHRKKXH\n.LHRKKBA 081012\n\x02MVT\nNK682/08.LNNGX.LHR\nAD1004/1012\nNNNN\x03';
    assert.equal(stripTypeB(raw), 'MVT\nNK682/08.LNNGX.LHR\nAD1004/1012');
    assert.equal(parseMvt(stripTypeB(raw)).offBlock, '1004');
  });
  test('plain text passes through; an envelope without originator is refused', () => {
    assert.equal(stripTypeB('MVT\nNK682/08\nAD1004'), 'MVT\nNK682/08\nAD1004');
    assert.throws(() => stripTypeB('QU OSLKKNK\nMVT\nNK682/08\nAD1004'), /originator/);
  });
});

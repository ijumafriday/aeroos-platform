import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ComplianceEngine, defaultRegistry, type OperatorProfile } from '@aeroos/compliance';
import { LocalKeyService } from '@aeroos/signing';
import {
  approveExtension, closeDeferral, engineeringOrderForDeferral, issueCrs, linkEngineeringOrder, markExpired,
  raiseDeferral, signStep, taskCardFromEngineeringOrder, type Signer
} from './index';

const NKX: OperatorProfile = {
  operatorId: 'NKX', name: 'Nordkapp Air', authority: 'EASA', melTimeZone: 'UTC', approvedTypes: ['B737-800'],
  mel: {
    '33-42-01': { ref: '33-42-01', ata: '33', title: 'Landing light', category: 'C', extensionPermitted: true },
    '31-31-01': { ref: '31-31-01', ata: '31', title: 'FDR status', category: 'A', intervalHours: 24, extensionPermitted: false }
  }
};
const engine = new ComplianceEngine(defaultRegistry({ allowDraft: false }), [NKX]);
const keys = LocalKeyService.generate('test');
const sign = (p: unknown, at: Date) => keys.sign(p, at);
const t0 = new Date('2026-10-08T10:00:00Z');
const later = (h: number) => new Date(t0.getTime() + h * 3_600_000);
const future = new Date('2030-01-01T00:00:00Z');

const mwangi: Signer = {
  personnelId: 'P-4471', name: 'Kevin Mwangi', licenceNo: 'NO.66.4471',
  privileges: [{ authority: 'EASA', category: 'B1.1', typeRatings: ['B737-800'], validUntil: future }, { authority: 'EASA', category: 'B2', typeRatings: ['B737-800'], validUntil: future }],
  authorisation: { reference: 'C-AUTH 145-112', aircraftTypes: ['B737-800'], validUntil: future, suspended: false }
};
const unqualified: Signer = { ...mwangi, personnelId: 'P-0001', name: 'Trainee', privileges: [] };

const raise = (ref = '33-42-01') => raiseDeferral(engine, { id: 'DD-1', operatorId: 'NKX', tail: 'LN-ABC', aircraftType: 'B737-800', melRef: ref, description: 'LDG LIGHT L INOP', raisedBy: 'user:pilot', raisedAt: t0 });

describe('MEL deferral lifecycle', () => {
  test('raising uses the operator MEL and the rulepack deadline', () => {
    const { item, event } = raise();
    assert.equal(item.category, 'C');
    assert.equal(item.deadline.toISOString(), '2026-10-19T00:00:00.000Z');
    assert.equal(item.deadlineRule, 'EASA@2026.1');
    assert.equal(event.type, 'camo.mel.deferred');
  });

  test('an empty defect description is rejected', () => {
    assert.throws(() => raiseDeferral(engine, { id: 'X', operatorId: 'NKX', tail: 'LN-ABC', aircraftType: 'B737-800', melRef: '33-42-01', description: '  ', raisedBy: 'u', raisedAt: t0 }), /Describe the defect/);
  });

  test('an extension moves the deadline once and records the rule', () => {
    const { item } = raise();
    const r = approveExtension(engine, item, later(24));
    assert.equal(r.item.extensions, 1);
    assert.ok(r.item.deadline > item.deadline);
    assert.throws(() => approveExtension(engine, r.item, later(48)), /Only one extension/);
  });

  test('only one engineering order per deferral', () => {
    const { item } = raise();
    const linked = linkEngineeringOrder(item, 'EO-1');
    assert.throws(() => linkEngineeringOrder(linked, 'EO-2'), /already has engineering order/);
  });

  test('closing is idempotent for the same CRS and refuses a different one', () => {
    const { item } = raise();
    const closed = closeDeferral(item, 'system:amo', 'CRS-1', later(2));
    assert.equal(closed.item.status, 'CLOSED');
    assert.equal(closeDeferral(closed.item, 'system:amo', 'CRS-1', later(3)).event, null);
    assert.throws(() => closeDeferral(closed.item, 'system:amo', 'CRS-2', later(3)), /already closed/);
  });

  test('expiry only applies to open items past their deadline', () => {
    const { item } = raise('31-31-01');
    assert.equal(markExpired(item, later(23)).event, null);
    assert.equal(markExpired(item, later(24)).item.status, 'EXPIRED');
    const closed = closeDeferral(item, 'x', 'CRS-1', later(1)).item;
    assert.equal(markExpired(closed, later(30)).event, null);
  });
});

describe('Engineering order → task card → CRS', () => {
  const setup = () => {
    const { item } = raise();
    const { eo, event } = engineeringOrderForDeferral(item, 'EO-1', 'user:camo', later(1));
    return { item, eo, card: taskCardFromEngineeringOrder(event.data, 'NKX', 'TC-1', later(1)).card };
  };

  test('the engineering order derives its trade from the ATA chapter', () => {
    assert.equal(setup().eo.trade, 'AVIONICS');
  });

  test('a qualified engineer stamps steps with a verifiable signature', async () => {
    const { card } = setup();
    const r = await signStep(engine, card, 1, mwangi, later(2), sign);
    const stamp = r.card.steps[0].stamp!;
    assert.equal(r.card.status, 'IN_PROGRESS');
    assert.equal(stamp.rule, 'EASA@2026.1');
    assert.match(stamp.via, /B2/);
    const payload = { kind: 'STEP_STAMP', taskCardId: 'TC-1', tail: 'LN-ABC', step: 1, text: card.steps[0].text, personnelId: 'P-4471', licence: 'NO.66.4471', rule: 'EASA@2026.1', at: later(2).toISOString() };
    assert.equal(await keys.verify(payload, stamp.signature), true);
  });

  test('an unqualified person cannot stamp, with the rulepack reason', async () => {
    const { card } = setup();
    await assert.rejects(signStep(engine, card, 1, unqualified, later(2), sign), /No valid Part-66 licence/);
  });

  test('a licensed engineer who is not current (no recent experience) cannot stamp', async () => {
    const { card } = setup();
    const lapsed: Signer = { ...mwangi, currency: { experienceMonthsLast24: 3, lastContinuationTraining: new Date('2026-01-01T00:00:00Z') } };
    await assert.rejects(signStep(engine, card, 1, lapsed, later(2), sign), /3 month\(s\) of relevant maintenance experience/);
  });

  test('a step cannot be stamped twice', async () => {
    const { card } = setup();
    const r = await signStep(engine, card, 1, mwangi, later(2), sign);
    await assert.rejects(signStep(engine, r.card, 1, mwangi, later(3), sign), /already stamped/);
  });

  test('the CRS requires every step and then locks the card', async () => {
    let { card } = setup();
    await assert.rejects(issueCrs(engine, card, mwangi, later(3), 'CRS-1', sign), /must be stamped/);
    for (const s of card.steps) card = (await signStep(engine, card, s.n, mwangi, later(2), sign)).card;
    const r = await issueCrs(engine, card, mwangi, later(3), 'CRS-1', sign);
    assert.equal(r.card.status, 'CERTIFIED');
    assert.equal(r.event.data.eoId, 'EO-1');
    await assert.rejects(signStep(engine, r.card, 1, mwangi, later(4), sign), /already certified/);
  });

  test('no engineering order for a closed deferral', () => {
    const { item } = raise();
    const closed = closeDeferral(item, 'x', 'CRS-1', later(1)).item;
    assert.throws(() => engineeringOrderForDeferral(closed, 'EO-9', 'u', later(2)), /is closed/);
  });
});

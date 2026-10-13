import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ageing, ageBucket, applyPayment, canBook, cents, creditCheck, dueDate, overrun, priceLine, totals, transition, type CustomerTerms } from './index';

const T: CustomerTerms = { labourRate: 95, partsMarkupPct: 15, serviceMarkupPct: 10, vatPct: 25, paymentTermsDays: 30, creditLimit: 50000 };

describe('Third-party maintenance billing', () => {
  test('pricing: labour at the rate, parts and services marked up, half-up cents', () => {
    assert.equal(priceLine({ kind: 'LABOUR', description: 'A-check', qty: 12.5, unitCost: 0 }, T).amountCents, 118750);
    const part = priceLine({ kind: 'PART', description: 'Filter', qty: 3, unitCost: 10.005 }, T);
    assert.equal(part.unitPrice, 11.51);
    assert.equal(part.amountCents, 3453);
    assert.equal(priceLine({ kind: 'SERVICE', description: 'NDT', qty: 1, unitCost: 400 }, T).amountCents, 44000);
    assert.throws(() => priceLine({ kind: 'PART', description: 'x', qty: 0, unitCost: 1 }, T), /more than 0/);
    assert.equal(cents(0.125), 13);
    assert.equal(cents(-0.125), -13);
    assert.equal(cents(1.005), 101, 'float noise does not round a half cent down');
    assert.equal(cents(8.70 * 1.15), 1001);
  });

  test('totals and VAT', () => {
    const t = totals([priceLine({ kind: 'LABOUR', description: 'x', qty: 2, unitCost: 0 }, T), priceLine({ kind: 'PART', description: 'y', qty: 1, unitCost: 100 }, T)], 25);
    assert.deepEqual(t, { netCents: 30500, vatCents: 7625, totalCents: 38125, byKind: { LABOUR: 19000, PART: 11500, SERVICE: 0 } });
  });

  test('overrun over 10 % and the credit limit', () => {
    assert.equal(overrun(100000, 110000).over, false);
    assert.equal(overrun(100000, 110001).over, true);
    assert.equal(creditCheck(4000000, 1000000, 50000).ok, true);
    assert.match(creditCheck(4000001, 1000000, 50000).message, /Credit limit exceeded/);
  });

  test('order life cycle', () => {
    assert.equal(transition('QUOTED', 'APPROVED'), 'APPROVED');
    assert.throws(() => transition('QUOTED', 'INVOICED'), /cannot become invoiced/);
    assert.throws(() => canBook('QUOTED'), /cannot be booked/);
    assert.doesNotThrow(() => canBook('COMPLETED'));
  });

  test('receivables ageing and payments', () => {
    assert.equal(dueDate('2026-10-01', 30), '2026-10-31');
    assert.equal(ageBucket('2026-10-31', '2026-10-31'), 'CURRENT');
    assert.equal(ageBucket('2026-09-01', '2026-10-12'), 'D31_60');
    assert.deepEqual(ageing([{ dueDate: '2026-06-01', openCents: 500 }, { dueDate: '2026-11-01', openCents: 200 }, { dueDate: '2026-10-01', openCents: 0 }], '2026-10-12'),
      { CURRENT: 200, D1_30: 0, D31_60: 0, D61_90: 0, D90_PLUS: 500 });
    assert.deepEqual(applyPayment(10000, 0, 4000), { paidCents: 4000, status: 'PARTIALLY_PAID' });
    assert.deepEqual(applyPayment(10000, 4000, 6000), { paidCents: 10000, status: 'PAID' });
    assert.throws(() => applyPayment(10000, 4000, 6001), /still open/);
  });
});

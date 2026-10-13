import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, approvePo, coreOverdue, decideClaim, newPoStatus, pbhStatement, receiveAgainstPo, requireApprovedVendor, underWarranty, type PurchaseOrder } from './index';

const at = new Date('2026-10-09T08:00:00Z');
const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({ id: 'PO-1', partNo: 'FILTER-HYD-737', qty: 4, receivedQty: 0, unitPrice: 310, condition: 'NE', status: 'ISSUED', createdBy: 'user:storekeeper', approvedBy: null, version: 1, ...over });

describe('Supply chain', () => {
  test('approved supplier list', () => {
    assert.throws(() => requireApprovedVendor({ id: 'V', name: 'Acme', status: 'SUSPENDED', approvedUntil: '2027-01-01', warrantyMonths: 12 }, at), /suspended/);
    assert.throws(() => requireApprovedVendor({ id: 'V', name: 'Acme', status: 'APPROVED', approvedUntil: '2026-10-01', warrantyMonths: 12 }, at), /lapsed/);
    assert.doesNotThrow(() => requireApprovedVendor({ id: 'V', name: 'Acme', status: 'APPROVED', approvedUntil: '2027-01-01', warrantyMonths: 12 }, at));
  });
  test('orders at or above the threshold need a second person', () => {
    assert.equal(newPoStatus({ qty: 4, unitPrice: 310, condition: 'NE' }), 'ISSUED');
    assert.equal(newPoStatus({ qty: 1, unitPrice: 48000, condition: 'OH' }), 'PENDING_APPROVAL');
    assert.throws(() => newPoStatus({ qty: 1, unitPrice: 10, condition: 'AR' }), /as removed/);
    const p = po({ status: 'PENDING_APPROVAL', unitPrice: 48000, qty: 1 });
    assert.throws(() => approvePo(p, 'user:storekeeper'), /someone other/);
    assert.equal(approvePo(p, 'user:camo.manager').status, 'ISSUED');
  });
  test('receiving: certificate, condition, serials, no over-delivery', () => {
    const cert = { certificateType: 'FORM1' as const, certificateRef: 'F1-55120', condition: 'NE' as const, serials: [] };
    assert.throws(() => receiveAgainstPo(po({ status: 'PENDING_APPROVAL' }), { qty: 1, ...cert }, null), /not approved/);
    assert.throws(() => receiveAgainstPo(po(), { qty: 5, ...cert }, null), /4 still to receive/);
    assert.throws(() => receiveAgainstPo(po(), { qty: 1, ...cert, certificateType: 'COC' }, { standardPart: false }), /standard parts only/);
    assert.throws(() => receiveAgainstPo(po(), { qty: 1, ...cert, condition: 'AR' }, null), /quarantine/);
    assert.throws(() => receiveAgainstPo(po(), { qty: 2, ...cert, serials: ['A'] }, null), /2 serial/);
    const r = receiveAgainstPo(po(), { qty: 3, ...cert }, null);
    assert.equal(r.status, 'PARTIALLY_RECEIVED');
    assert.equal(receiveAgainstPo(r, { qty: 1, ...cert }, null).status, 'RECEIVED');
    assert.equal(receiveAgainstPo(po(), { qty: 1, ...cert, certificateType: 'COC' }, { standardPart: true }).status, 'PARTIALLY_RECEIVED');
  });
  test('warranty, claims, exchanges, PBH', () => {
    assert.equal(underWarranty(new Date('2026-01-15'), 12, at), true);
    assert.equal(underWarranty(new Date('2025-01-15'), 12, at), false);
    assert.throws(() => decideClaim('SUBMITTED', 'CREDITED', 100, 500), /accepted/);
    assert.throws(() => decideClaim('ACCEPTED', 'CREDITED', 900, 500), /Credit/);
    assert.equal(decideClaim('ACCEPTED', 'CREDITED', 400, 500).status, 'CREDITED');
    assert.equal(coreOverdue({ status: 'OPEN', coreDue: '2026-10-01' }, at), true);
    assert.equal(coreOverdue({ status: 'CORE_RETURNED', coreDue: '2026-10-01' }, at), false);
    assert.deepEqual(pbhStatement({ 'LN-ABD': 210.25, 'LN-ABC': 180 }, 95.5), {
      lines: [{ tail: 'LN-ABC', fh: 180, amount: 17190 }, { tail: 'LN-ABD', fh: 210.3, amount: 20078.88 }], total: 37268.88
    });
  });
  test('round 11 review: currency, splitting, condition, warranty dates, four-eyes on claims', () => {
    const cert = { certificateType: 'FORM1' as const, certificateRef: 'F1-55120', condition: 'NE' as const, serials: [] };
    // 4,900 in a currency worth 3.25 USD is 15,925 USD: needs approval.
    assert.equal(newPoStatus({ qty: 1, unitPrice: 4900, condition: 'NE' }, { basePerUnit: 3.25 }), 'PENDING_APPROVAL');
    // Splitting: 3,000 now plus 2,500 ordered last week from the same supplier for the same part.
    assert.equal(newPoStatus({ qty: 1, unitPrice: 3000, condition: 'NE' }, { basePerUnit: 1, recentOpenBase: 2500 }), 'PENDING_APPROVAL');
    assert.throws(() => newPoStatus({ qty: 1, unitPrice: 10, condition: 'NE' }, { basePerUnit: 0 }), /exchange rate/);
    assert.throws(() => receiveAgainstPo(po(), { qty: 1, ...cert, condition: 'SV' }, null), /ordered NE/);
    assert.equal(receiveAgainstPo({ ...po(), condition: 'SV' }, { qty: 1, ...cert, condition: 'OH' }, null).status, 'PARTIALLY_RECEIVED');
    assert.equal(addMonths('2026-08-31', 6), '2027-02-28');
    assert.equal(addMonths('2027-08-31', 6), '2028-02-29');
    assert.equal(underWarranty(new Date('2026-10-09T14:00:00Z'), 6, '2026-10-09'), true, 'same-day failure');
    assert.equal(underWarranty(new Date('2026-08-31T09:00:00Z'), 6, '2027-03-01'), false);
    assert.throws(() => decideClaim('SUBMITTED', 'ACCEPTED', null, 500, { claimant: 'user:storekeeper', by: 'user:storekeeper' }), /someone other/);
  });
});

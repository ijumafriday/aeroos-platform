import assert from 'node:assert/strict';
import test from 'node:test';
import { inventoryVariance, replenishmentProposal, supplierScore, warrantyEligible, weightedDemand } from './supply-control';

test('weighted demand remains explainable and rounds to units', () => {
  assert.equal(weightedDemand({ maintenance: 10, historical: 4, reliability: 2, fleet: 5, safetyStock: 3 }), 17);
});

test('replenishment orders to max in reorder multiples', () => {
  assert.deepEqual(replenishmentProposal({ onHand: 4, reserved: 2, inbound: 0, forecast: 3, policy: { minQty: 5, maxQty: 12, reorderQty: 4 } }), { projected: -1, recommendedQty: 16, reason: 'BELOW_MIN' });
});

test('supplier score blocks weak quality', () => {
  const s = supplierScore({ orders: 10, onTimeOrders: 10, acceptedReceipts: 8, rejectedReceipts: 2, avgLeadDays: 5, priceVariancePct: 0 });
  assert.equal(s.approvedForSource, false);
  assert.equal(s.grade, 'A');
});

test('supplier source approval requires actual order and quality evidence', () => {
  assert.equal(supplierScore({ orders: 0, onTimeOrders: 0, acceptedReceipts: 0, rejectedReceipts: 0, avgLeadDays: 0, priceVariancePct: 0 }).approvedForSource, false);
});

test('warranty entitlement checks period and covered failure', () => {
  assert.equal(warrantyEligible({ failedOn: '2026-05-01', startsOn: '2026-01-01', endsOn: '2026-12-31', failure: 'BEARING', coveredFailures: ['BEARING'] }).eligible, true);
  assert.equal(warrantyEligible({ failedOn: '2027-01-01', startsOn: '2026-01-01', endsOn: '2026-12-31', failure: 'BEARING', coveredFailures: ['*'] }).eligible, false);
});

test('inventory variance is counted minus expected', () => assert.equal(inventoryVariance(8, 6), -2));

import { DomainError } from '@aeroos/kernel';

export type DemandInputs = {
  maintenance: number;
  historical: number;
  reliability: number;
  fleet: number;
  safetyStock: number;
};

export function weightedDemand(i: DemandInputs): number {
  for (const [k, v] of Object.entries(i)) if (!Number.isFinite(v) || v < 0) throw new DomainError('FORECAST_INPUT', `${k} demand must be non-negative`, 422);
  // Planned maintenance is the strongest signal; historical/reliability/fleet signals keep the forecast explainable.
  const expected = i.maintenance + i.historical * 0.45 + i.reliability * 0.35 + i.fleet * 0.2 + i.safetyStock;
  return Math.max(0, Math.ceil(expected));
}

export type ReplenishmentPolicy = { minQty: number; maxQty: number; reorderQty: number };
export function replenishmentProposal(args: { onHand: number; reserved: number; inbound: number; forecast: number; policy: ReplenishmentPolicy }) {
  const { onHand, reserved, inbound, forecast, policy } = args;
  if ([onHand, reserved, inbound, forecast, policy.minQty, policy.maxQty, policy.reorderQty].some(v => !Number.isFinite(v) || v < 0)) {
    throw new DomainError('REPLENISHMENT_INPUT', 'Replenishment quantities must be non-negative', 422);
  }
  if (policy.maxQty < policy.minQty || policy.reorderQty <= 0) throw new DomainError('REPLENISHMENT_POLICY', 'Invalid min/max/reorder policy', 422);
  const projected = onHand - reserved + inbound - forecast;
  if (projected >= policy.minQty) return { projected, recommendedQty: 0, reason: 'ABOVE_MIN' as const };
  const gap = Math.max(0, policy.maxQty - projected);
  const lots = Math.ceil(gap / policy.reorderQty);
  return { projected, recommendedQty: lots * policy.reorderQty, reason: 'BELOW_MIN' as const };
}

export type SupplierMetrics = { orders: number; onTimeOrders: number; acceptedReceipts: number; rejectedReceipts: number; avgLeadDays: number; priceVariancePct: number };
export function supplierScore(m: SupplierMetrics) {
  if (m.orders < 0 || m.onTimeOrders < 0 || m.acceptedReceipts < 0 || m.rejectedReceipts < 0 || m.avgLeadDays < 0) throw new DomainError('SUPPLIER_METRICS', 'Supplier metrics cannot be negative', 422);
  const onTime = m.orders === 0 ? 1 : Math.min(1, m.onTimeOrders / m.orders);
  const totalReceipts = m.acceptedReceipts + m.rejectedReceipts;
  const quality = totalReceipts === 0 ? 1 : Math.min(1, m.acceptedReceipts / totalReceipts);
  const lead = Math.max(0, 1 - Math.min(1, m.avgLeadDays / 90));
  const commercial = Math.max(0, 1 - Math.min(1, Math.abs(m.priceVariancePct) / 25));
  const score = Math.round((onTime * 35 + quality * 40 + lead * 15 + commercial * 10) * 100) / 100;
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D';
  const qualityPpm = totalReceipts === 0 ? 0 : Math.round((m.rejectedReceipts / totalReceipts) * 1_000_000 * 100) / 100;
  return { score, grade: grade as 'A' | 'B' | 'C' | 'D', qualityPpm, approvedForSource: m.orders > 0 && totalReceipts > 0 && score >= 75 && quality >= 0.95 };
}

export function warrantyEligible(args: { failedOn: string; startsOn: string; endsOn: string; failure: string; coveredFailures: string[] }) {
  if (args.failedOn < args.startsOn || args.failedOn > args.endsOn) return { eligible: false, reason: 'OUTSIDE_PERIOD' as const };
  const covered = args.coveredFailures.map(x => x.trim().toUpperCase()).filter(Boolean);
  if (covered.length && !covered.includes('*') && !covered.includes(args.failure.trim().toUpperCase())) return { eligible: false, reason: 'FAILURE_NOT_COVERED' as const };
  return { eligible: true, reason: 'ENTITLED' as const };
}

export function inventoryVariance(expected: number, counted: number) {
  if (!Number.isInteger(expected) || !Number.isInteger(counted) || expected < 0 || counted < 0) throw new DomainError('COUNT_QTY', 'Inventory count quantities must be non-negative integers', 422);
  return counted - expected;
}

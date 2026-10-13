import { DomainError } from '@aeroos/kernel';

/**
 * Tools and parts on the hangar floor. Part-145.A.40: tools and equipment must be controlled and
 * calibrated; using an out-of-calibration tool for certified work is refused at the moment of signing.
 */
export interface Tool { id: string; description: string; calibrationDue: Date | null }

export function requireCalibrated(tools: Tool[], at: Date): { ids: string[]; rule: string } {
  const expired = tools.filter(t => t.calibrationDue && t.calibrationDue.getTime() <= at.getTime());
  if (expired.length) {
    throw new DomainError('TOOL_NOT_CALIBRATED',
      `${expired.map(t => `${t.id} (${t.description}) calibration expired ${t.calibrationDue!.toISOString().slice(0, 10)}`).join('; ')} — Part-145.A.40`, 422);
  }
  return { ids: tools.map(t => t.id), rule: 'Part-145.A.40' };
}

export interface StockLine { partNo: string; location: string; qty: number }
export interface Allocation { partNo: string; location: string; qty: number }

/** Reserve parts for a task card from the stock lines, preferring `prefer` (the station). Never partial per line. */
export function allocate(needs: { partNo: string; qty: number }[], stock: StockLine[], prefer: string): { allocations: Allocation[]; shortages: { partNo: string; missing: number }[] } {
  const allocations: Allocation[] = [];
  const shortages: { partNo: string; missing: number }[] = [];
  const free = stock.map(s => ({ ...s }));
  for (const n of needs) {
    if (n.qty <= 0) continue;
    let left = n.qty;
    const lines = free.filter(s => s.partNo === n.partNo && s.qty > 0).sort((a, b) => Number(b.location === prefer) - Number(a.location === prefer) || b.qty - a.qty);
    for (const l of lines) {
      if (left <= 0) break;
      const take = Math.min(left, l.qty);
      l.qty -= take;
      left -= take;
      allocations.push({ partNo: n.partNo, location: l.location, qty: take });
    }
    if (left > 0) shortages.push({ partNo: n.partNo, missing: left });
  }
  return { allocations, shortages };
}

import { DomainError } from '@aeroos/kernel';

/**
 * Supply chain for a Part-145 / CAMO organisation (145.A.42 acceptance of components, CAMO.A.315):
 * parts come only from approved suppliers, with the right release certificate, in a serviceable condition;
 * purchase orders above a threshold need a second person; imported parts sit in the bonded store until
 * customs clears them; warranty, exchanges (core returns) and power-by-the-hour contracts are tracked.
 */

/* ------------------------------------------------------------------ suppliers */

export type VendorApproval = 'PART_145' | 'PART_21G' | 'DISTRIBUTOR' | 'OEM';
export interface Vendor { id: string; name: string; status: 'APPROVED' | 'SUSPENDED'; approvedUntil: string; warrantyMonths: number }

/** Approved supplier list: suspended or lapsed suppliers cannot be ordered from or received from. */
export function requireApprovedVendor(v: Vendor, at: Date): void {
  if (v.status !== 'APPROVED') throw new DomainError('VENDOR_SUSPENDED', `${v.name} is suspended on the approved supplier list`, 422);
  if (v.approvedUntil < at.toISOString().slice(0, 10)) throw new DomainError('VENDOR_LAPSED', `${v.name}'s approval lapsed on ${v.approvedUntil} — re-audit before ordering or receiving`, 422);
}

/* ------------------------------------------------------------------ purchase orders */

export type Condition = 'NE' | 'NS' | 'OH' | 'SV' | 'AR';
export const CONDITION_NAMES: Record<Condition, string> = { NE: 'new', NS: 'new surplus', OH: 'overhauled', SV: 'serviceable', AR: 'as removed' };
export type PoStatus = 'PENDING_APPROVAL' | 'ISSUED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';

/**
 * Orders at or above this value need approval by a second person. It is in the base currency (USD): an order
 * in another currency is converted at the recorded reference rate, and recent open orders for the same part from
 * the same supplier are added, so neither a currency nor splitting an order gets round the limit.
 */
export const PO_APPROVAL_THRESHOLD = 5000;
export const BASE_CURRENCY = 'USD';

/** Condition ranking: an order is satisfied by the ordered condition or a better one, never a worse one. */
export const CONDITION_RANK: Record<Condition, number> = { NE: 5, NS: 4, OH: 3, SV: 2, AR: 0 };

export interface PurchaseOrder {
  id: string;
  partNo: string;
  qty: number;
  receivedQty: number;
  unitPrice: number;
  condition: Condition;
  status: PoStatus;
  createdBy: string;
  approvedBy: string | null;
  version: number;
}

export const poTotal = (po: Pick<PurchaseOrder, 'qty' | 'unitPrice'>) => Math.round(po.qty * po.unitPrice * 100) / 100;

export function newPoStatus(po: Pick<PurchaseOrder, 'qty' | 'unitPrice' | 'condition'>, fx: { basePerUnit: number; recentOpenBase?: number } = { basePerUnit: 1 }): PoStatus {
  if (po.condition === 'AR') throw new DomainError('CONDITION', 'Parts are not bought "as removed" for stock; order them overhauled, serviceable or new', 422);
  if (!(fx.basePerUnit > 0)) throw new DomainError('FX_RATE', 'No exchange rate for the order currency', 422);
  return poTotal(po) * fx.basePerUnit + (fx.recentOpenBase ?? 0) >= PO_APPROVAL_THRESHOLD ? 'PENDING_APPROVAL' : 'ISSUED';
}

export function approvePo(po: PurchaseOrder, by: string): PurchaseOrder {
  if (po.status !== 'PENDING_APPROVAL') throw new DomainError('PO_STATE', `${po.id} is ${po.status.toLowerCase().replace('_', ' ')}`, 409);
  if (po.createdBy === by) throw new DomainError('FOUR_EYES', 'A purchase order is approved by someone other than who raised it', 422);
  return { ...po, status: 'ISSUED', approvedBy: by, version: po.version + 1 };
}

/* ------------------------------------------------------------------ receiving (145.A.42 acceptance) */

export type CertificateType = 'FORM1' | 'FAA_8130_3' | 'COC';

export interface Receipt { qty: number; certificateType: CertificateType; certificateRef: string; condition: Condition; serials: string[] }

/**
 * Accept a delivery: the order must be open and not over-delivered; every part needs its release certificate
 * (EASA Form 1 or FAA 8130-3 — a certificate of conformity only for standard parts); a serialised part comes
 * with one serial per unit; "as removed" (unserviceable) parts are not accepted into stock.
 */
export function receiveAgainstPo(po: PurchaseOrder, r: Receipt, part: { standardPart: boolean } | null): PurchaseOrder {
  if (po.status !== 'ISSUED' && po.status !== 'PARTIALLY_RECEIVED') {
    throw new DomainError('PO_STATE', po.status === 'PENDING_APPROVAL' ? `${po.id} is not approved yet` : `${po.id} is ${po.status.toLowerCase().replace('_', ' ')}`, 409);
  }
  if (r.qty <= 0 || po.receivedQty + r.qty > po.qty) throw new DomainError('OVER_DELIVERY', `${po.id} has ${po.qty - po.receivedQty} still to receive`, 422);
  if (r.certificateRef.trim().length < 3) throw new DomainError('CERTIFICATE_REQUIRED', 'Enter the release certificate tracking number', 422);
  if (r.certificateType === 'COC' && !part?.standardPart) throw new DomainError('CERTIFICATE_TYPE', `${po.partNo} needs an EASA Form 1 or FAA 8130-3; a certificate of conformity is accepted for standard parts only`, 422);
  if (r.condition === 'AR') throw new DomainError('UNSERVICEABLE', 'An "as removed" part is not accepted into stock — quarantine it (NCR)', 422);
  if (CONDITION_RANK[r.condition] < CONDITION_RANK[po.condition]) {
    throw new DomainError('CONDITION_MISMATCH', `${po.id} ordered ${po.condition}; ${r.condition} was delivered — do not accept it, quarantine it (NCR) and take it up with the supplier`, 422);
  }
  if (r.serials.length && r.serials.length !== r.qty) throw new DomainError('SERIALS', `${r.qty} units need ${r.qty} serial numbers (${r.serials.length} given)`, 422);
  if (new Set(r.serials).size !== r.serials.length) throw new DomainError('SERIALS', 'Duplicate serial numbers in the delivery', 422);
  const receivedQty = po.receivedQty + r.qty;
  return { ...po, receivedQty, status: receivedQty === po.qty ? 'RECEIVED' : 'PARTIALLY_RECEIVED', version: po.version + 1 };
}

/* ------------------------------------------------------------------ warranty, exchanges, PBH */

/** yyyy-mm-dd plus whole months, clamped to the month's last day (31 Aug + 6 months = 28/29 Feb). */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12), nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** A failure is under warranty when it occurs on or after the day of receipt and within the warranty period (whole days). */
export function underWarranty(receivedAt: Date, warrantyMonths: number, failedAt: Date | string): boolean {
  const received = receivedAt.toISOString().slice(0, 10);
  const failed = typeof failedAt === 'string' ? failedAt : failedAt.toISOString().slice(0, 10);
  return failed >= received && failed <= addMonths(received, warrantyMonths);
}

export type ClaimStatus = 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'CREDITED';

export function decideClaim(status: ClaimStatus, decision: 'ACCEPTED' | 'REJECTED' | 'CREDITED', creditAmount: number | null, claimed: number,
  who?: { claimant: string; by: string }): { status: ClaimStatus } {
  if (who && who.claimant === who.by) throw new DomainError('FOUR_EYES', 'A warranty claim is decided and credited by someone other than who filed it', 422);
  if (decision === 'CREDITED') {
    if (status !== 'ACCEPTED') throw new DomainError('CLAIM_STATE', 'Only an accepted claim is credited', 409);
    if (creditAmount === null || creditAmount <= 0 || creditAmount > claimed) throw new DomainError('CREDIT', `Credit between 0 and the claimed ${claimed}`, 422);
  } else if (status !== 'SUBMITTED') throw new DomainError('CLAIM_STATE', `The claim is already ${status.toLowerCase()}`, 409);
  return { status: decision };
}

/** Exchange: the unserviceable core goes back to the supplier by the due date, or a penalty applies. */
export const coreOverdue = (e: { status: 'OPEN' | 'CORE_RETURNED'; coreDue: string }, now: Date) => e.status === 'OPEN' && e.coreDue < now.toISOString().slice(0, 10);

/** Power-by-the-hour: the monthly charge is the flight hours of the covered aircraft times the rate. */
export function pbhStatement(fhByTail: Record<string, number>, ratePerFh: number): { lines: { tail: string; fh: number; amount: number }[]; total: number } {
  const lines = Object.entries(fhByTail).sort(([a], [b]) => a.localeCompare(b)).map(([tail, fh]) => ({ tail, fh: Math.round(fh * 10) / 10, amount: Math.round(fh * ratePerFh * 100) / 100 }));
  return { lines, total: Math.round(lines.reduce((n, l) => n + l.amount, 0) * 100) / 100 };
}

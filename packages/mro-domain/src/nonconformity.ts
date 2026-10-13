import { DomainError } from '@aeroos/kernel';

/**
 * Non-conforming parts (Part-145 145.A.42): a suspect or unserviceable part is quarantined, a disposition is
 * decided, and a part that cannot be returned to service is scrapped — mutilated so it can never re-enter
 * the supply chain (145.A.42(d)), witnessed by a second person. A scrapped serial is never installed again.
 *
 *   QUARANTINED ──disposition──▶ SCRAP_PENDING ──mutilation witnessed (≠ disposer)──▶ CLOSED (scrapped)
 *                           └──▶ CLOSED (returned to vendor / returned to stock after repair or inspection)
 */
export type NcrStatus = 'QUARANTINED' | 'SCRAP_PENDING' | 'CLOSED';
export type Disposition = 'SCRAP' | 'RETURN_TO_VENDOR' | 'RETURN_TO_STOCK';

export interface Nonconformity {
  id: string;
  partNo: string;
  serial: string | null;
  qty: number;
  status: NcrStatus;
  disposition: Disposition | null;
  dispositionedBy: string | null;
  version: number;
}

export function dispose(n: Nonconformity, d: Disposition, reason: string, by: string, releaseRef: string | null): Nonconformity {
  if (n.status !== 'QUARANTINED') throw new DomainError('NCR_STATE', `${n.id} is ${n.status.toLowerCase().replace('_', ' ')}`, 409);
  if (reason.trim().length < 10) throw new DomainError('REASON_REQUIRED', 'Give the engineering reason for the disposition (10+ characters)', 422);
  if (d === 'RETURN_TO_STOCK' && (!releaseRef || releaseRef.trim().length < 3)) {
    throw new DomainError('RELEASE_REQUIRED', 'A part returns to stock only with a release certificate (repair or inspection) reference', 422);
  }
  return { ...n, disposition: d, dispositionedBy: by, status: d === 'SCRAP' ? 'SCRAP_PENDING' : 'CLOSED', version: n.version + 1 };
}

export function witnessMutilation(n: Nonconformity, by: string, method: string): Nonconformity {
  if (n.status !== 'SCRAP_PENDING') throw new DomainError('NCR_STATE', `${n.id} is not awaiting scrapping`, 409);
  if (n.dispositionedBy === by) throw new DomainError('FOUR_EYES', 'Mutilation is witnessed by someone other than who decided the scrapping', 422);
  if (method.trim().length < 5) throw new DomainError('METHOD_REQUIRED', 'Describe how the part was mutilated (cut, crushed, drilled…)', 422);
  return { ...n, status: 'CLOSED', version: n.version + 1 };
}

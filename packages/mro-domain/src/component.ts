import { DomainError } from '@aeroos/kernel';
import type { Counters } from './maintenance';

/**
 * Component (rotable / life-limited part) history, back to birth. Time and cycles since new travel with
 * the serial number from aircraft to shop to aircraft; they can never go down. Every installation and
 * removal is an event carrying TSN/CSN at that moment, so the life of a part is reconstructable from
 * its history alone (Part-CAMO CAMO.A.315, M.A.305(d) component records).
 */
export type ComponentEventType = 'INSTALLED' | 'REMOVED' | 'SCRAPPED';
export type RemovalReason = 'UNSERVICEABLE' | 'SCHEDULED' | 'ROBBERY' | 'LIFE_LIMIT' | 'OTHER';

export interface ComponentEvent {
  partNo: string;
  serial: string;
  type: ComponentEventType;
  tail: string;
  position: string;
  at: Date;
  tsn: number;
  csn: number;
  reason: RemovalReason | null;
  reference: string;
}

export interface Installed {
  partNo: string;
  serial: string;
  tail: string;
  position: string;
  installedAt: Date;
  aircraftAtInstall: { fh: number; fc: number };
  tsnAtInstall: number;
  csnAtInstall: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** TSN/CSN now (or at removal): what it had at installation plus what the aircraft flew since. */
export function lifeNow(c: Installed, aircraft: Counters): { tsn: number; csn: number } {
  const fh = aircraft.fh - c.aircraftAtInstall.fh, fc = aircraft.fc - c.aircraftAtInstall.fc;
  if (fh < 0 || fc < 0) throw new DomainError('COUNTERS_BACKWARDS', `${c.tail} counters are below those at installation of ${c.partNo} s/n ${c.serial}`);
  return { tsn: round1(c.tsnAtInstall + fh), csn: c.csnAtInstall + fc };
}

export function removal(c: Installed, aircraft: Counters, reason: RemovalReason, reference: string): ComponentEvent {
  if (reference.trim().length < 3) throw new DomainError('REFERENCE_REQUIRED', 'Give the removal reference (task card, CRS or work order)');
  return { partNo: c.partNo, serial: c.serial, type: 'REMOVED', tail: c.tail, position: c.position, at: aircraft.at, ...lifeNow(c, aircraft), reason, reference: reference.trim() };
}

/**
 * Check an installation against the serial's history: the declared TSN/CSN must be at least what it
 * had at its last removal (time cannot be lost — that is how life-limited parts are "laundered"), the part
 * must not still be installed elsewhere, and a part with no history must come with its release
 * certificate reference.
 */
export function checkInstallation(
  history: ComponentEvent[], i: { partNo: string; serial: string; tsn: number; csn: number; reference: string },
  lifeLimit?: { fh?: number; fc?: number }
): { previous: ComponentEvent | null } {
  if (i.tsn < 0 || i.csn < 0) throw new DomainError('LIFE_NEGATIVE', 'TSN and CSN cannot be negative');
  const mine = history.filter(e => e.partNo === i.partNo && e.serial === i.serial).sort((a, b) => a.at.getTime() - b.at.getTime());
  const last = mine[mine.length - 1] ?? null;
  if (mine.some(e => e.type === 'SCRAPPED')) throw new DomainError('SCRAPPED', `${i.partNo} s/n ${i.serial} was scrapped (${mine.find(e => e.type === 'SCRAPPED')!.reference}) — it can never be installed`, 422);
  if (last?.type === 'INSTALLED') throw new DomainError('STILL_INSTALLED', `${i.partNo} s/n ${i.serial} is still installed on ${last.tail} (${last.position}) — record its removal first`, 409);
  if (last && (i.tsn < last.tsn || i.csn < last.csn)) {
    throw new DomainError('LIFE_REDUCED', `${i.partNo} s/n ${i.serial} left ${last.tail} with TSN ${last.tsn} / CSN ${last.csn}; it cannot be installed with less`, 422);
  }
  if (!last && i.reference.trim().length < 3) throw new DomainError('CERTIFICATE_REQUIRED', 'A part with no history needs its release certificate (EASA Form 1 / FAA 8130-3) reference');
  if (lifeLimit?.fc !== undefined && i.csn >= lifeLimit.fc) throw new DomainError('LIFE_EXPIRED', `${i.partNo} s/n ${i.serial} has reached its life limit (${i.csn} / ${lifeLimit.fc} FC)`, 422);
  if (lifeLimit?.fh !== undefined && i.tsn >= lifeLimit.fh) throw new DomainError('LIFE_EXPIRED', `${i.partNo} s/n ${i.serial} has reached its life limit (${i.tsn} / ${lifeLimit.fh} FH)`, 422);
  return { previous: last };
}

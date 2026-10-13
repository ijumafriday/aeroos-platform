import { DomainError } from '@aeroos/kernel';

/**
 * Structural damage (the "dent & buckle" chart): every damage found on the airframe is recorded with its
 * position and size and assessed against the Structural Repair Manual allowable limits for that zone:
 *  - ALLOWABLE  within allowable damage limits: no repair, possibly a repeat inspection;
 *  - REPAIR     beyond allowable but within the SRM repair limits: repair per the SRM before flight
 *               (or a time-limited temporary repair);
 *  - REFER      beyond the SRM: repair data approved under Part-21 (TC holder / DOA) needed — 21.A.433, M.A.304.
 * Damages close to each other interact and are assessed as one. Cracks are never allowable.
 * The limits in the demo data are illustrative; an operator loads the values from its SRM.
 */

export type DamageType = 'DENT' | 'SCRATCH' | 'GOUGE' | 'CORROSION' | 'CRACK' | 'LIGHTNING' | 'DELAMINATION';
export type DamageDisposition = 'ALLOWABLE' | 'REPAIR' | 'REFER';
export const DAMAGE_TYPES: DamageType[] = ['DENT', 'SCRATCH', 'GOUGE', 'CORROSION', 'CRACK', 'LIGHTNING', 'DELAMINATION'];

export interface SrmLimit {
  zone: string; damageType: DamageType; srmRef: string;
  /** null: not applicable for this damage type (e.g. depth for a crack). */
  allowableDepthMm: number | null; allowableLengthMm: number | null;
  repairableDepthMm: number | null; repairableLengthMm: number | null;
  /** Two damages closer than this (edge to edge) interact. */
  minSpacingMm: number;
  /** Repeat inspection of allowable damage, flight cycles (null: none). */
  inspectFc: number | null;
}

export interface Damage {
  id: string; zone: string; side: 'L' | 'R' | 'C'; damageType: DamageType;
  /** Position on the zone's reference grid: x (e.g. body station) and y (e.g. stringer/water line), mm. */
  xMm: number; yMm: number;
  lengthMm: number; widthMm: number; depthMm: number;
}

export interface Assessment { disposition: DamageDisposition; srmRef: string | null; reason: string; inspectFc: number | null }

const RANK: Record<DamageDisposition, number> = { ALLOWABLE: 0, REPAIR: 1, REFER: 2 };
export const worseDisposition = (a: DamageDisposition, b: DamageDisposition): DamageDisposition => (RANK[a] >= RANK[b] ? a : b);

const within = (v: number, lim: number | null) => lim === null || v <= lim;

export function assessDamage(d: Pick<Damage, 'zone' | 'damageType' | 'lengthMm' | 'depthMm'>, limits: SrmLimit[]): Assessment {
  const l = limits.find(x => x.zone === d.zone && x.damageType === d.damageType);
  if (!l) return { disposition: 'REFER', srmRef: null, reason: `No SRM limits for ${d.damageType.toLowerCase()} in zone ${d.zone}`, inspectFc: null };
  const size = `${d.lengthMm} mm long, ${d.depthMm} mm deep`;
  const allowableDefined = l.allowableDepthMm !== null || l.allowableLengthMm !== null;
  if (d.damageType !== 'CRACK' && allowableDefined && within(d.depthMm, l.allowableDepthMm) && within(d.lengthMm, l.allowableLengthMm)) {
    return { disposition: 'ALLOWABLE', srmRef: l.srmRef, reason: `${size}: within allowable damage limits`, inspectFc: l.inspectFc };
  }
  const repairDefined = l.repairableDepthMm !== null || l.repairableLengthMm !== null;
  if (repairDefined && within(d.depthMm, l.repairableDepthMm) && within(d.lengthMm, l.repairableLengthMm)) {
    return { disposition: 'REPAIR', srmRef: l.srmRef, reason: `${size}: beyond allowable${d.damageType === 'CRACK' ? ' (cracks are never allowable)' : ''}, within SRM repair limits`, inspectFc: null };
  }
  return { disposition: 'REFER', srmRef: l.srmRef, reason: `${size}: beyond SRM limits — approved repair data needed from the TC holder / a DOA`, inspectFc: null };
}

/** Pairs of damages (same zone and side) closer than the stricter spacing limit, edge to edge. */
export function interactions(ds: Damage[], limits: SrmLimit[]): { a: string; b: string; gapMm: number; combined: Assessment }[] {
  const out: { a: string; b: string; gapMm: number; combined: Assessment }[] = [];
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      const a = ds[i], b = ds[j];
      if (a.zone !== b.zone || a.side !== b.side) continue;
      const centre = Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm);
      const gap = Math.max(0, centre - (a.lengthMm + b.lengthMm) / 2);
      const spacing = Math.max(...[a, b].map(d => limits.find(l => l.zone === d.zone && l.damageType === d.damageType)?.minSpacingMm ?? 0));
      if (gap >= spacing) continue;
      // assessed as one damage spanning both: each damage's own type limits with its own depth over the combined
      // length; the worse result counts (depths of different damage types are not mixed)
      const length = Math.round(centre + (a.lengthMm + b.lengthMm) / 2);
      const ra = assessDamage({ zone: a.zone, damageType: a.damageType, lengthMm: length, depthMm: a.depthMm }, limits);
      const rb = assessDamage({ zone: b.zone, damageType: b.damageType, lengthMm: length, depthMm: b.depthMm }, limits);
      const combined = RANK[ra.disposition] >= RANK[rb.disposition] ? ra : rb;
      out.push({ a: a.id, b: b.id, gapMm: Math.round(gap), combined: { ...combined, reason: `Interacts with the other damage (${Math.round(gap)} mm apart, less than ${spacing} mm): assessed together — ${combined.reason}` } });
    }
  }
  return out;
}

/** Each damage's disposition including interactions. */
export function assessAll(ds: Damage[], limits: SrmLimit[]): Map<string, Assessment> {
  const m = new Map(ds.map(d => [d.id, assessDamage(d, limits)]));
  for (const x of interactions(ds, limits)) {
    for (const id of [x.a, x.b]) {
      const cur = m.get(id)!;
      if (RANK[x.combined.disposition] > RANK[cur.disposition]) m.set(id, { ...x.combined, inspectFc: null });
    }
  }
  return m;
}

/* ------------------------------------------------------------------ status and airworthiness */

export interface DamageState {
  id: string; disposition: DamageDisposition;
  repair: null | { kind: 'PERMANENT' | 'TEMPORARY'; untilFc: number | null; untilDate: Date | null };
  /** Allowable damage with a repeat inspection: next inspection due at this aircraft FC. */
  nextInspectionFc: number | null;
  /** REFER: approved repair data recorded (engineering disposition). */
  approvedData: string | null;
}

/** Why an open damage grounds the aircraft (empty when it does not). */
export function damageGrounding(d: DamageState, fc: number, now: Date): string | null {
  if (d.repair?.kind === 'PERMANENT') return null;
  if (d.repair?.kind === 'TEMPORARY') {
    if ((d.repair.untilFc !== null && fc >= d.repair.untilFc) || (d.repair.untilDate !== null && now >= d.repair.untilDate)) return `${d.id}: temporary repair expired`;
    return null;
  }
  if (d.disposition === 'REPAIR') return `${d.id}: damage beyond allowable limits, not repaired`;
  if (d.disposition === 'REFER') return `${d.id}: damage beyond SRM limits, not repaired`;
  if (d.nextInspectionFc !== null && fc >= d.nextInspectionFc) return `${d.id}: repeat inspection overdue`;
  return null;
}

export interface RepairInput { kind: 'PERMANENT' | 'TEMPORARY'; dataRef: string; untilFc?: number | null; untilDate?: Date | null }

/** A repair needs data that covers the damage: the SRM for REPAIR, approved data for REFER; temporary repairs are time-limited. */
export function checkRepair(d: DamageState, r: RepairInput, fc: number, now: Date) {
  if (d.repair?.kind === 'PERMANENT') throw new DomainError('REPAIRED', `${d.id} is already permanently repaired`, 409);
  if (!r.dataRef.trim()) throw new DomainError('REPAIR_DATA', 'Name the repair data (SRM chapter / approved repair reference)', 422);
  if (d.disposition === 'REFER' && !d.approvedData) {
    throw new DomainError('REPAIR_DATA', `${d.id} is beyond the SRM: engineering must record the approved repair data first`, 422);
  }
  if (r.kind === 'TEMPORARY') {
    const untilFc = r.untilFc ?? null, untilDate = r.untilDate ?? null;
    if (untilFc === null && untilDate === null) throw new DomainError('TEMPORARY_LIMIT', 'A temporary repair needs a limit (flight cycles or a date)', 422);
    if ((untilFc !== null && untilFc <= fc) || (untilDate !== null && untilDate <= now)) throw new DomainError('TEMPORARY_LIMIT', 'The temporary repair limit is already reached', 422);
  }
}

export function checkDamageInput(d: Pick<Damage, 'lengthMm' | 'widthMm' | 'depthMm' | 'damageType'>) {
  for (const [k, v] of [['length', d.lengthMm], ['width', d.widthMm], ['depth', d.depthMm]] as const) {
    if (!(v >= 0) || v > 5000) throw new DomainError('DAMAGE_SIZE', `${k} must be 0–5000 mm`, 422);
  }
  if (d.lengthMm === 0) throw new DomainError('DAMAGE_SIZE', 'Length must be more than 0 mm', 422);
}

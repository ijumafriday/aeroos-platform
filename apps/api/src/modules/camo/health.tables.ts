import { eq, inArray } from 'drizzle-orm';
import { bigserial, date, doublePrecision, integer, numeric, pgSchema, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { assessAll, damageGrounding, type Assessment, type Damage, type DamageState, type DamageType, type SrmLimit } from '@aeroos/mro-domain';
import type { ModuleDb } from '../../platform/database/module-db';

const camo = pgSchema('camo');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const engineTypes = camo.table('engine_types', {
  engineType: text('engine_type').primaryKey(), egtMarginAmber: doublePrecision('egt_margin_amber').notNull(), egtMarginRed: doublePrecision('egt_margin_red').notNull(),
  egtShift: doublePrecision('egt_shift').notNull(), n2Shift: doublePrecision('n2_shift').notNull(), ffShift: doublePrecision('ff_shift').notNull(),
  vibMax: doublePrecision('vib_max').notNull(), oilAlertQph: doublePrecision('oil_alert_qph').notNull(), oilMaxQph: doublePrecision('oil_max_qph').notNull()
});
export const engines = camo.table('engines', {
  serial: text('serial').primaryKey(), operatorId: text('operator_id').notNull(), engineType: text('engine_type').notNull(), tail: text('tail'), position: integer('position')
});
export const engineSnapshots = camo.table('engine_snapshots', {
  id: bigserial('id', { mode: 'number' }).primaryKey(), serial: text('serial').notNull(), at: ts('at').notNull(), fh: doublePrecision('fh').notNull(),
  egtDev: doublePrecision('egt_dev').notNull(), n2Dev: doublePrecision('n2_dev').notNull(), ffDevPct: doublePrecision('ff_dev_pct').notNull(),
  vib: doublePrecision('vib').notNull(), egtMargin: doublePrecision('egt_margin').notNull(), source: text('source').notNull(), recordedBy: text('recorded_by').notNull()
});
export const oilUplifts = camo.table('oil_uplifts', {
  id: serial('id').primaryKey(), serial: text('serial').notNull(), tail: text('tail').notNull(), at: ts('at').notNull(), fh: doublePrecision('fh').notNull(),
  quarts: numeric('quarts', { precision: 4, scale: 1 }).notNull(), station: text('station'), recordedBy: text('recorded_by').notNull()
});
export const healthAlerts = camo.table('health_alerts', {
  id: serial('id').primaryKey(), operatorId: text('operator_id').notNull(), serial: text('serial').notNull(), tail: text('tail'), code: text('code').notNull(),
  level: text('level').notNull(), message: text('message').notNull(), action: text('action').notNull(), status: text('status').notNull(),
  raisedAt: ts('raised_at').notNull().defaultNow(), updatedAt: ts('updated_at').notNull().defaultNow(),
  closedBy: text('closed_by'), closedAt: ts('closed_at'), closureNote: text('closure_note')
});
export const srmLimits = camo.table('srm_limits', {
  aircraftType: text('aircraft_type').notNull(), zone: text('zone').notNull(), zoneName: text('zone_name').notNull(), damageType: text('damage_type').notNull(),
  srmRef: text('srm_ref').notNull(), allowableDepthMm: doublePrecision('allowable_depth_mm'), allowableLengthMm: doublePrecision('allowable_length_mm'),
  repairableDepthMm: doublePrecision('repairable_depth_mm'), repairableLengthMm: doublePrecision('repairable_length_mm'),
  minSpacingMm: doublePrecision('min_spacing_mm').notNull(), inspectFc: integer('inspect_fc')
});
export const structuralDamage = camo.table('structural_damage', {
  id: text('id').primaryKey(), operatorId: text('operator_id').notNull(), tail: text('tail').notNull(), zone: text('zone').notNull(), side: text('side').notNull(),
  damageType: text('damage_type').notNull(), xMm: doublePrecision('x_mm').notNull(), yMm: doublePrecision('y_mm').notNull(),
  lengthMm: doublePrecision('length_mm').notNull(), widthMm: doublePrecision('width_mm').notNull(), depthMm: doublePrecision('depth_mm').notNull(),
  description: text('description').notNull(), foundAt: ts('found_at').notNull().defaultNow(), foundFc: integer('found_fc').notNull(), foundBy: text('found_by').notNull(),
  disposition: text('disposition').notNull(), srmRef: text('srm_ref'), reason: text('reason').notNull(), nextInspectionFc: integer('next_inspection_fc'),
  approvedData: text('approved_data'), approvedBy: text('approved_by'), approvedAt: ts('approved_at'),
  repairKind: text('repair_kind'), repairData: text('repair_data'), repairUntilFc: integer('repair_until_fc'), repairUntilDate: date('repair_until_date', { mode: 'string' }),
  repairedBy: text('repaired_by'), repairedAt: ts('repaired_at'), version: integer('version').notNull().default(1)
});

export type DamageRow = typeof structuralDamage.$inferSelect;

export const toLimit = (r: typeof srmLimits.$inferSelect): SrmLimit => ({
  zone: r.zone, damageType: r.damageType as DamageType, srmRef: r.srmRef, allowableDepthMm: r.allowableDepthMm, allowableLengthMm: r.allowableLengthMm,
  repairableDepthMm: r.repairableDepthMm, repairableLengthMm: r.repairableLengthMm, minSpacingMm: r.minSpacingMm, inspectFc: r.inspectFc
});
export const toDamage = (r: DamageRow): Damage => ({
  id: r.id, zone: r.zone, side: r.side as Damage['side'], damageType: r.damageType as DamageType, xMm: r.xMm, yMm: r.yMm, lengthMm: r.lengthMm, widthMm: r.widthMm, depthMm: r.depthMm
});
export const toState = (r: DamageRow, a?: Assessment): DamageState => ({
  id: r.id, disposition: (a?.disposition ?? r.disposition) as DamageState['disposition'],
  repair: r.repairKind ? { kind: r.repairKind as 'PERMANENT' | 'TEMPORARY', untilFc: r.repairUntilFc, untilDate: r.repairUntilDate ? new Date(`${r.repairUntilDate}T23:59:59Z`) : null } : null,
  nextInspectionFc: r.nextInspectionFc, approvedData: r.approvedData
});

/**
 * Damages still physically present and assessable: everything except permanently repaired damage (a permanent
 * repair restores the structure, so it no longer interacts with new damage).
 */
export const assessable = (rows: DamageRow[]) => rows.filter(r => r.repairKind !== 'PERMANENT');

/** Fresh assessments (interactions included) per damage of one aircraft. */
export function assessTail(rows: DamageRow[], limits: SrmLimit[]): Map<string, Assessment> {
  return assessAll(assessable(rows).map(toDamage), limits);
}

/** Grounding reasons from structural damage per aircraft (empty list: none). Used by the airworthiness sweep. */
export async function structuralGrounding(db: ModuleDb, tails: { reg: string; type: string; fc: number }[], now: Date): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(tails.map(t => [t.reg, []]));
  if (!tails.length) return out;
  const rows = await db.db.select().from(structuralDamage).where(inArray(structuralDamage.tail, tails.map(t => t.reg)));
  if (!rows.length) return out;
  const types = [...new Set(tails.map(t => t.type))];
  const limits = await db.db.select().from(srmLimits).where(inArray(srmLimits.aircraftType, types));
  for (const t of tails) {
    const mine = rows.filter(r => r.tail === t.reg);
    if (!mine.length) continue;
    const a = assessTail(mine, limits.filter(l => l.aircraftType === t.type).map(toLimit));
    for (const r of mine) {
      const g = damageGrounding(toState(r, a.get(r.id)), t.fc, now);
      if (g) out.get(t.reg)!.push(g);
    }
  }
  return out;
}

export async function limitsFor(db: ModuleDb, aircraftType: string): Promise<SrmLimit[]> {
  return (await db.db.select().from(srmLimits).where(eq(srmLimits.aircraftType, aircraftType))).map(toLimit);
}

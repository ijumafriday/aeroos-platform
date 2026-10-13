import { DomainError } from '@aeroos/kernel';
import type { DomainEvent, Trade } from '@aeroos/contracts';
import { tradeForAta } from './engineering-order';
import type { Requirement } from './maintenance';

export type WpStatus = 'DRAFT' | 'PLANNED' | 'RELEASED' | 'COMPLETED' | 'CANCELLED';
export type WpCheckType = 'LINE' | 'A_CHECK' | 'C_CHECK' | 'ENGINE' | 'MOD' | 'OTHER';
export type WpPriority = 'NORMAL' | 'HIGH' | 'AOG';
export interface WpResourcePlan { trade: Trade; requiredHours: number; availableHours: number }
export interface WpDependency { beforeRequirementId: string; afterRequirementId: string }
export interface WpItem { requirementId: string; ref: string; title: string; ata: string; complied: { at: Date; crsNumber: string } | null }

export interface WorkPackage {
  id: string;
  operatorId: string;
  tail: string;
  aircraftType: string;
  title: string;
  station: string;
  bay: string | null;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  status: WpStatus;
  items: WpItem[];
  checkType: WpCheckType;
  priority: WpPriority;
  resourcePlan: WpResourcePlan[];
  dependencies: WpDependency[];
  frozenAt: Date | null;
  frozenBy: string | null;
  version: number;
}

export function requiredLabour(requirements: Requirement[]): WpResourcePlan[] {
  const totals = new Map<Trade, number>();
  for (const r of requirements) {
    const trade = tradeForAta(r.ata);
    totals.set(trade, Math.round(((totals.get(trade) ?? 0) + r.estimatedHours) * 10) / 10);
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([trade, requiredHours]) => ({ trade, requiredHours, availableHours: 0 }));
}

export function validateDependencies(itemIds: string[], dependencies: WpDependency[]): void {
  const ids = new Set(itemIds);
  const graph = new Map<string, string[]>();
  for (const d of dependencies) {
    if (d.beforeRequirementId === d.afterRequirementId) throw new DomainError('WP_DEPENDENCY_SELF', 'An item cannot depend on itself');
    if (!ids.has(d.beforeRequirementId) || !ids.has(d.afterRequirementId)) throw new DomainError('WP_DEPENDENCY_UNKNOWN', 'Dependencies must reference items in this work package');
    graph.set(d.beforeRequirementId, [...(graph.get(d.beforeRequirementId) ?? []), d.afterRequirementId]);
  }
  const visiting = new Set<string>(), done = new Set<string>();
  const visit = (id: string) => {
    if (done.has(id)) return;
    if (visiting.has(id)) throw new DomainError('WP_DEPENDENCY_CYCLE', `Work-package dependency cycle includes ${id}`, 409);
    visiting.add(id);
    for (const n of graph.get(id) ?? []) visit(n);
    visiting.delete(id); done.add(id);
  };
  for (const id of ids) visit(id);
}

export function createWorkPackage(i: { id: string; operatorId: string; tail: string; aircraftType: string; title: string; station: string; requirements: Requirement[]; checkType?: WpCheckType; priority?: WpPriority }): WorkPackage {
  if (!i.requirements.length) throw new DomainError('WP_EMPTY', 'Select at least one due item for the work package');
  const wrongType = i.requirements.filter(r => !r.types.includes(i.aircraftType));
  if (wrongType.length) throw new DomainError('NOT_APPLICABLE', `${wrongType.map(r => r.ref).join(', ')} not applicable to ${i.aircraftType}`);
  return {
    id: i.id, operatorId: i.operatorId, tail: i.tail, aircraftType: i.aircraftType, title: i.title.trim() || `Work package ${i.tail}`,
    station: i.station, bay: null, plannedStart: null, plannedEnd: null, status: 'DRAFT', version: 1,
    items: i.requirements.map(r => ({ requirementId: r.id, ref: r.ref, title: r.title, ata: r.ata, complied: null })),
    checkType: i.checkType ?? 'LINE', priority: i.priority ?? 'NORMAL', resourcePlan: requiredLabour(i.requirements), dependencies: [], frozenAt: null, frozenBy: null
  };
}

/** Plan into a configured hangar slot. A bay holds one aircraft at a time. */
export function planWorkPackage(wp: WorkPackage, slot: { bay: string; start: Date; end: Date }, others: Pick<WorkPackage, 'id' | 'bay' | 'plannedStart' | 'plannedEnd' | 'status' | 'tail'>[]): {
  wp: WorkPackage; event: DomainEvent<'camo.wp.planned'>;
} {
  if (wp.status === 'COMPLETED' || wp.status === 'CANCELLED' || wp.status === 'RELEASED') throw new DomainError('WP_CLOSED', `${wp.id} is ${wp.status.toLowerCase()}`, 409);
  if (wp.frozenAt) throw new DomainError('WP_FROZEN', `${wp.id} is scope-frozen; unfreeze before replanning`, 409);
  if (slot.end.getTime() <= slot.start.getTime()) throw new DomainError('SLOT_INVALID', 'The slot must end after it starts');
  const clash = others.find(o => o.id !== wp.id && o.bay === slot.bay && o.status !== 'CANCELLED' && o.status !== 'COMPLETED' && o.plannedStart && o.plannedEnd &&
    o.plannedStart.getTime() < slot.end.getTime() && slot.start.getTime() < o.plannedEnd.getTime());
  if (clash) throw new DomainError('BAY_OCCUPIED', `${slot.bay} is booked for ${clash.tail} (${clash.id}) in that period`, 409);
  const next: WorkPackage = { ...wp, bay: slot.bay, plannedStart: slot.start, plannedEnd: slot.end, status: wp.status === 'DRAFT' ? 'PLANNED' : wp.status, version: wp.version + 1 };
  return { wp: next, event: { type: 'camo.wp.planned', data: { wpId: wp.id, tail: wp.tail, station: wp.station, bay: slot.bay, plannedStart: slot.start.toISOString(), plannedEnd: slot.end.toISOString(), status: next.status } } };
}

export function setWorkPackagePlanning(wp: WorkPackage, resourcePlan: WpResourcePlan[], dependencies: WpDependency[]): WorkPackage {
  if (wp.status === 'RELEASED' || wp.status === 'COMPLETED' || wp.status === 'CANCELLED') throw new DomainError('WP_CLOSED', `${wp.id} is ${wp.status.toLowerCase()}`, 409);
  if (wp.frozenAt) throw new DomainError('WP_FROZEN', `${wp.id} is scope-frozen`, 409);
  validateDependencies(wp.items.map(i => i.requirementId), dependencies);
  const requiredBy = new Map(wp.resourcePlan.map(r => [r.trade, r.requiredHours]));
  const seen = new Set<Trade>();
  const normalized: WpResourcePlan[] = resourcePlan.map(r => {
    if (seen.has(r.trade)) throw new DomainError('WP_RESOURCE_DUPLICATE', `${r.trade} appears more than once in the labour plan`);
    seen.add(r.trade);
    const requiredHours = requiredBy.get(r.trade) ?? 0;
    return { trade: r.trade, requiredHours, availableHours: Math.round(r.availableHours * 10) / 10 };
  });
  for (const [trade, requiredHours] of requiredBy) if (!seen.has(trade)) normalized.push({ trade, requiredHours, availableHours: 0 });
  return { ...wp, resourcePlan: normalized.sort((a,b) => a.trade.localeCompare(b.trade)), dependencies: [...dependencies], version: wp.version + 1 };
}

export function freezeWorkPackage(wp: WorkPackage, by: string, at: Date): WorkPackage {
  if (wp.status !== 'PLANNED') throw new DomainError('WP_NOT_PLANNED', `${wp.id} must be planned before scope freeze`, 409);
  if (wp.frozenAt) return wp;
  validateDependencies(wp.items.map(i => i.requirementId), wp.dependencies);
  const short = wp.resourcePlan.filter(r => r.availableHours < r.requiredHours);
  if (short.length) throw new DomainError('WP_LABOUR_SHORT', `Insufficient planned labour: ${short.map(r => `${r.trade} ${r.availableHours}/${r.requiredHours}h`).join(', ')}`, 409);
  return { ...wp, frozenAt: at, frozenBy: by, version: wp.version + 1 };
}

/** Release to the AMO: each item becomes a task card. */
export function releaseWorkPackage(wp: WorkPackage, requirements: Requirement[]): { wp: WorkPackage; event: DomainEvent<'camo.wp.released'> } {
  if (wp.status !== 'PLANNED') throw new DomainError('WP_NOT_PLANNED', `${wp.id} must be planned into a hangar slot before release (it is ${wp.status.toLowerCase()})`, 409);
  if (!wp.frozenAt) throw new DomainError('WP_NOT_FROZEN', `${wp.id} must pass readiness review and be scope-frozen before release`, 409);
  const byId = new Map(requirements.map(r => [r.id, r]));
  return {
    wp: { ...wp, status: 'RELEASED', version: wp.version + 1 },
    event: {
      type: 'camo.wp.released',
      data: {
        wpId: wp.id, tail: wp.tail, aircraftType: wp.aircraftType, title: wp.title, station: wp.station,
        checkType: wp.checkType === 'A_CHECK' ? 'A' : wp.checkType === 'C_CHECK' ? 'C' : 'OTHER',
        priority: wp.priority === 'NORMAL' ? 'ROUTINE' : wp.priority,
        items: wp.items.map(it => {
          const r = byId.get(it.requirementId)!;
          return { requirementId: r.id, ref: r.ref, title: r.title, ata: r.ata, trade: tradeForAta(r.ata), steps: r.steps, estimatedHours: r.estimatedHours, tools: r.tools, parts: r.parts,
            predecessors: wp.dependencies.filter(d => d.afterRequirementId === r.id).map(d => d.beforeRequirementId) };
        })
      }
    }
  };
}

/** A CRS arrived for one item. Completes the package when every item is certified. Idempotent per item. */
export function recordItemCompliance(wp: WorkPackage, requirementId: string, crsNumber: string, at: Date): { wp: WorkPackage; completed: DomainEvent<'camo.wp.completed'> | null; changed: boolean } {
  const item = wp.items.find(i => i.requirementId === requirementId);
  if (!item) throw new DomainError('WP_ITEM_UNKNOWN', `${requirementId} is not in ${wp.id}`, 404);
  if (item.complied) return { wp, completed: null, changed: false };
  const items = wp.items.map(i => (i.requirementId === requirementId ? { ...i, complied: { at, crsNumber } } : i));
  const done = items.every(i => i.complied);
  const next: WorkPackage = { ...wp, items, status: done ? 'COMPLETED' : wp.status, version: wp.version + 1 };
  return { wp: next, completed: done ? { type: 'camo.wp.completed', data: { wpId: wp.id, tail: wp.tail } } : null, changed: true };
}

export const wpItemSourceId = (wpId: string, requirementId: string) => `${wpId}/${requirementId}`;
export const parseWpSource = (sourceId: string) => { const [wpId, requirementId] = sourceId.split('/'); return requirementId ? { wpId, requirementId } : null; };

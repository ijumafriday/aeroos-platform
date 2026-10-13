import { DomainError } from '@aeroos/kernel';
import type { ComplianceEngine, Decision, ExtensionOutcome, MelCategory } from '@aeroos/compliance';
import type { DomainEvent } from '@aeroos/contracts';

export type MelStatus = 'OPEN' | 'CLOSED' | 'EXPIRED';

export interface MelItem {
  id: string;
  operatorId: string;
  tail: string;
  aircraftType: string;
  melRef: string;
  ata: string;
  category: MelCategory;
  title: string;
  description: string;
  raisedAt: Date;
  raisedBy: string;
  originalDeadline: Date;
  deadline: Date;
  deadlineRule: string;
  deadlineBasis: string;
  extensions: number;
  status: MelStatus;
  eoId: string | null;
  closedAt: Date | null;
  closedBy: string | null;
  closureRef: string | null;
  /** Optimistic concurrency token, incremented on every change. */
  version: number;
}

export interface RaiseDeferralInput {
  id: string;
  operatorId: string;
  tail: string;
  aircraftType: string;
  melRef: string;
  description: string;
  raisedBy: string;
  raisedAt: Date;
}

/** Raise a deferral against the operator's approved MEL. The deadline comes from the rulepack in force. */
export function raiseDeferral(engine: ComplianceEngine, i: RaiseDeferralInput): { item: MelItem; event: DomainEvent<'camo.mel.deferred'> } {
  if (!i.description.trim()) throw new DomainError('DESCRIPTION_REQUIRED', 'Describe the defect as written in the technical log');
  const d = engine.deferralDeadline(i.operatorId, i.melRef, i.raisedAt);
  const item: MelItem = {
    id: i.id,
    operatorId: i.operatorId,
    tail: i.tail,
    aircraftType: i.aircraftType,
    melRef: d.entry.ref,
    ata: d.entry.ata,
    category: d.entry.category,
    title: d.entry.title,
    description: i.description.trim(),
    raisedAt: i.raisedAt,
    raisedBy: i.raisedBy,
    originalDeadline: d.value,
    deadline: d.value,
    deadlineRule: d.rule,
    deadlineBasis: d.basis,
    extensions: 0,
    status: 'OPEN',
    eoId: null,
    closedAt: null,
    closedBy: null,
    closureRef: null,
    version: 1
  };
  return {
    item,
    event: { type: 'camo.mel.deferred', data: { melItemId: item.id, tail: item.tail, melRef: item.melRef, category: item.category, deadline: item.deadline.toISOString(), rule: item.deadlineRule } }
  };
}

function assertOpen(item: MelItem) {
  if (item.status === 'CLOSED') throw new DomainError('MEL_CLOSED', `${item.id} is already closed`, 409);
}

export function approveExtension(engine: ComplianceEngine, item: MelItem, at: Date): {
  item: MelItem; event: DomainEvent<'camo.mel.extended'>; decision: Decision<ExtensionOutcome>;
} {
  assertOpen(item);
  if (item.status === 'EXPIRED') throw new DomainError('MEL_EXPIRED', `${item.id} has expired and cannot be extended`, 409);
  const decision = engine.extension(item.operatorId, {
    ref: item.melRef,
    raisedAt: item.raisedAt,
    currentDeadline: item.deadline,
    originalDeadline: item.originalDeadline,
    extensionsGranted: item.extensions,
    requestedAt: at
  });
  if (!decision.value.allowed) throw new DomainError('EXTENSION_REFUSED', decision.value.reason);
  const next: MelItem = { ...item, deadline: decision.value.newDeadline, deadlineRule: decision.rule, deadlineBasis: decision.basis, extensions: item.extensions + 1, version: item.version + 1 };
  return {
    item: next,
    decision,
    event: { type: 'camo.mel.extended', data: { melItemId: item.id, tail: item.tail, deadline: next.deadline.toISOString(), rule: decision.rule } }
  };
}

export function linkEngineeringOrder(item: MelItem, eoId: string): MelItem {
  assertOpen(item);
  if (item.eoId) throw new DomainError('EO_EXISTS', `${item.id} already has engineering order ${item.eoId}`, 409);
  return { ...item, eoId, version: item.version + 1 };
}

/** Close the deferral when the rectification has been certified. Idempotent for the same closure reference. */
export function closeDeferral(item: MelItem, by: string, closureRef: string, at: Date): { item: MelItem; event: DomainEvent<'camo.mel.closed'> | null } {
  if (item.status === 'CLOSED') {
    if (item.closureRef === closureRef) return { item, event: null };
    throw new DomainError('MEL_CLOSED', `${item.id} was already closed by ${item.closureRef}`, 409);
  }
  const next: MelItem = { ...item, status: 'CLOSED', closedAt: at, closedBy: by, closureRef, version: item.version + 1 };
  return { item: next, event: { type: 'camo.mel.closed', data: { melItemId: item.id, tail: item.tail, closureRef } } };
}

/** Called by the escalation workflow at the deadline. No-op if the item was closed or extended in the meantime. */
export function markExpired(item: MelItem, at: Date): { item: MelItem; event: DomainEvent<'camo.mel.expired'> | null } {
  if (item.status !== 'OPEN' || at.getTime() < item.deadline.getTime()) return { item, event: null };
  return { item: { ...item, status: 'EXPIRED', version: item.version + 1 }, event: { type: 'camo.mel.expired', data: { melItemId: item.id, tail: item.tail } } };
}

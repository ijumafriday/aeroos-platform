import { DomainError } from '@aeroos/kernel';

export interface ConfigurationMsnRange { from: string; to: string }
export interface Effectivity { tails?: string[]; msnRanges?: ConfigurationMsnRange[] }
export interface ConfigurationPosition {
  id: string;
  code: string;
  parentId: string | null;
  ata: string;
  title: string;
  required: boolean;
  maxQty: number;
  effectivity: Effectivity;
}
export interface AllowablePart {
  positionId: string;
  partNo: string;
  requiredMods: string[];
}
export interface InstalledConfigurationItem {
  id: string;
  positionId: string;
  partNo: string;
  serial: string;
  mods: string[];
}
export interface ConfigurationIssue {
  code: 'REQUIRED_POSITION_EMPTY' | 'POSITION_OVERFILLED' | 'PART_NOT_ALLOWABLE' | 'REQUIRED_MOD_MISSING';
  positionId: string;
  itemId?: string;
  detail: string;
}

const naturalParts = (v: string) => v.split(/(\d+)/).filter(Boolean).map(x => /^\d+$/.test(x) ? Number(x) : x.toUpperCase());
export function compareMsn(a: string, b: string): number {
  const aa = naturalParts(a), bb = naturalParts(b);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    if (aa[i] === undefined) return -1;
    if (bb[i] === undefined) return 1;
    if (aa[i] === bb[i]) continue;
    if (typeof aa[i] === 'number' && typeof bb[i] === 'number') return (aa[i] as number) - (bb[i] as number);
    return String(aa[i]).localeCompare(String(bb[i]));
  }
  return 0;
}


export function assertEffectivityValid(effectivity: Effectivity): void {
  const tails = effectivity.tails?.filter(Boolean) ?? [];
  if (new Set(tails).size !== tails.length) throw new DomainError('EFFECTIVITY_DUPLICATE_TAIL', 'Effectivity tail list contains duplicates');
  for (const range of effectivity.msnRanges ?? []) {
    if (compareMsn(range.from, range.to) > 0) throw new DomainError('EFFECTIVITY_RANGE_INVALID', `MSN range ${range.from}–${range.to} is reversed`);
  }
}

export function effectivityMatches(effectivity: Effectivity, aircraft: { tail: string; msn: string }): boolean {
  const tails = effectivity.tails?.filter(Boolean) ?? [];
  const ranges = effectivity.msnRanges ?? [];
  if (!tails.length && !ranges.length) return true;
  if (tails.includes(aircraft.tail)) return true;
  return ranges.some(r => compareMsn(aircraft.msn, r.from) >= 0 && compareMsn(aircraft.msn, r.to) <= 0);
}

export function assertBaselineEditable(status: string) {
  if (status !== 'DRAFT') throw new DomainError('BASELINE_LOCKED', 'Only a draft configuration baseline can be changed', 409);
}

export function validateConfiguration(
  aircraft: { tail: string; msn: string },
  positions: ConfigurationPosition[],
  allowable: AllowablePart[],
  installed: InstalledConfigurationItem[]
): ConfigurationIssue[] {
  const issues: ConfigurationIssue[] = [];
  for (const p of positions.filter(x => effectivityMatches(x.effectivity, aircraft))) {
    const at = installed.filter(i => i.positionId === p.id);
    if (p.required && at.length === 0) issues.push({ code: 'REQUIRED_POSITION_EMPTY', positionId: p.id, detail: `${p.code} ${p.title} has no installed item` });
    if (at.length > p.maxQty) issues.push({ code: 'POSITION_OVERFILLED', positionId: p.id, detail: `${p.code} allows ${p.maxQty} item(s), found ${at.length}` });
    const allowed = allowable.filter(a => a.positionId === p.id);
    for (const item of at) {
      const rule = allowed.find(a => a.partNo === item.partNo);
      if (!rule) {
        issues.push({ code: 'PART_NOT_ALLOWABLE', positionId: p.id, itemId: item.id, detail: `${item.partNo} s/n ${item.serial} is not allowable at ${p.code}` });
        continue;
      }
      const missing = rule.requiredMods.filter(m => !item.mods.includes(m));
      if (missing.length) issues.push({ code: 'REQUIRED_MOD_MISSING', positionId: p.id, itemId: item.id, detail: `${item.partNo} s/n ${item.serial} is missing modification(s): ${missing.join(', ')}` });
    }
  }
  return issues;
}

export function assertNoPositionCycle(positions: Pick<ConfigurationPosition, 'id' | 'parentId'>[]) {
  const parent = new Map(positions.map(p => [p.id, p.parentId]));
  for (const p of positions) {
    const seen = new Set<string>();
    let at: string | null | undefined = p.id;
    while (at) {
      if (seen.has(at)) throw new DomainError('CONFIGURATION_CYCLE', `Configuration hierarchy contains a cycle at ${at}`, 409);
      seen.add(at);
      at = parent.get(at);
    }
  }
}

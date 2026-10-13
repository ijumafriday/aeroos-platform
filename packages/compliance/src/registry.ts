import type { Authority, Rulepack } from './types';
import { ruleId } from './types';
import { easaRulepack } from './rulepacks/easa';
import { faaRulepackDraft } from './rulepacks/faa';

/**
 * Holds every rulepack version ever approved. Rulepacks are never edited in place:
 * a regulatory change ships as a new version with a new effective date, so decisions made
 * last year can be replayed against the rules that applied last year.
 */
export class RulepackRegistry {
  private readonly packs: Rulepack[];

  constructor(packs: Rulepack[], private readonly opts: { allowDraft: boolean }) {
    const seen = new Set<string>();
    for (const p of packs) {
      const id = ruleId(p);
      if (seen.has(id)) throw new Error(`Duplicate rulepack ${id}`);
      seen.add(id);
    }
    this.packs = [...packs].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
  }

  /** The rulepack in force for `authority` at instant `at`. */
  resolve(authority: Authority, at: Date): Rulepack {
    const candidates = this.packs.filter(p =>
      p.authority === authority &&
      p.effectiveFrom.getTime() <= at.getTime() &&
      (p.status === 'approved' || this.opts.allowDraft)
    );
    const pack = candidates[candidates.length - 1];
    if (!pack) {
      const draftOnly = this.packs.some(p => p.authority === authority && p.status === 'draft');
      throw new Error(draftOnly
        ? `Only a draft ${authority} rulepack exists; it must be approved before use outside development`
        : `No ${authority} rulepack in force at ${at.toISOString()}`);
    }
    return pack;
  }

  /** Look up an exact version — used when replaying a past decision. */
  byId(id: string): Rulepack {
    const p = this.packs.find(x => ruleId(x) === id);
    if (!p) throw new Error(`Unknown rulepack ${id}`);
    return p;
  }

  list() {
    return this.packs.map(p => ({ id: ruleId(p), authority: p.authority, status: p.status, effectiveFrom: p.effectiveFrom.toISOString() }));
  }
}

/** The rulepacks shipped with this release. */
export function defaultRegistry(opts: { allowDraft: boolean }) {
  return new RulepackRegistry([
    easaRulepack('2026.1', '2026-01-01T00:00:00Z'),
    faaRulepackDraft('2026.1-draft', '2026-01-01T00:00:00Z')
  ], opts);
}

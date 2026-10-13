import { DomainError } from '@aeroos/kernel';
import type { RulepackRegistry } from './registry';
import type {
  CertificationFacts, CertificationOutcome, CurrencyFacts, CurrencyOutcome, Decision, DutyFacts, ExtensionOutcome, OperatorMelEntry,
  OperatorProfile, RosterFacts, RosterViolation, ScopeFacts
} from './types';

/**
 * The single entry point the application uses for regulated calculations.
 * It combines the authority rulepack in force with the operator's own approved data (its MEL,
 * time zone, approved types). Application code never branches on authority.
 */
export class ComplianceEngine {
  private readonly profiles = new Map<string, OperatorProfile>();

  constructor(private readonly registry: RulepackRegistry, profiles: OperatorProfile[] = []) {
    profiles.forEach(p => this.profiles.set(p.operatorId, p));
  }

  upsertProfile(p: OperatorProfile) {
    this.profiles.set(p.operatorId, p);
  }

  profile(operatorId: string): OperatorProfile {
    const p = this.profiles.get(operatorId);
    if (!p) throw new DomainError('OPERATOR_UNKNOWN', `No compliance profile for operator ${operatorId}`, 404);
    return p;
  }

  melEntry(operatorId: string, ref: string): OperatorMelEntry {
    const e = this.profile(operatorId).mel[ref];
    if (!e) throw new DomainError('MEL_ITEM_UNKNOWN', `MEL item ${ref} is not in the approved MEL of ${operatorId}`, 422);
    return e;
  }

  deferralDeadline(operatorId: string, ref: string, raisedAt: Date): Decision<Date> & { entry: OperatorMelEntry } {
    const p = this.profile(operatorId);
    const entry = this.melEntry(operatorId, ref);
    const pack = this.registry.resolve(p.authority, raisedAt);
    const d = pack.melDeadline({ category: entry.category, raisedAt, timeZone: p.melTimeZone, intervalHours: entry.intervalHours });
    return { ...d, entry };
  }

  extension(operatorId: string, args: {
    ref: string; raisedAt: Date; currentDeadline: Date; originalDeadline: Date; extensionsGranted: number; requestedAt: Date;
  }): Decision<ExtensionOutcome> {
    const p = this.profile(operatorId);
    const entry = this.melEntry(operatorId, args.ref);
    return this.registry.resolve(p.authority, args.requestedAt).melExtension({
      category: entry.category,
      raisedAt: args.raisedAt,
      currentDeadline: args.currentDeadline,
      originalDeadline: args.originalDeadline,
      extensionsGranted: args.extensionsGranted,
      entryExtensionPermitted: entry.extensionPermitted,
      requestedAt: args.requestedAt
    });
  }

  canCertify(operatorId: string, f: CertificationFacts): Decision<CertificationOutcome> {
    const p = this.profile(operatorId);
    if (!p.approvedTypes.includes(f.aircraftType)) {
      return { value: { allowed: false, reason: `${f.aircraftType} is not on ${p.name}'s approval` }, rule: 'OPERATOR', basis: 'Organisation approval scope' };
    }
    return this.registry.resolve(p.authority, f.at).canCertify(f);
  }

  currency(operatorId: string, f: CurrencyFacts): Decision<CurrencyOutcome> {
    return this.registry.resolve(this.profile(operatorId).authority, f.at).currency(f);
  }

  /** Scope check for issuing a company authorisation: organisation approval first, then the authority's licence rules. */
  authorisationScope(operatorId: string, f: ScopeFacts): Decision<{ allowed: true } | { allowed: false; reason: string }> {
    const p = this.profile(operatorId);
    const outside = f.aircraftTypes.filter(t => !p.approvedTypes.includes(t));
    if (outside.length) {
      return { value: { allowed: false, reason: `${outside.join(', ')} not on ${p.name}'s approval` }, rule: 'OPERATOR', basis: 'Organisation approval scope' };
    }
    if (f.aircraftTypes.length === 0) return { value: { allowed: false, reason: 'An authorisation must name at least one aircraft type' }, rule: 'OPERATOR', basis: 'Organisation approval scope' };
    return this.registry.resolve(p.authority, f.at).authorisationScope(f);
  }

  /** FTL check for one crew member, under the rulepack in force at the first duty in the plan. */
  rosterCheck(operatorId: string, f: RosterFacts, at: Date): Decision<RosterViolation[]> {
    return this.registry.resolve(this.profile(operatorId).authority, at).rosterCheck(f);
  }

  maxFdpMinutes(operatorId: string, f: DutyFacts, at: Date): Decision<number> {
    return this.registry.resolve(this.profile(operatorId).authority, at).maxFdpMinutes(f);
  }
}

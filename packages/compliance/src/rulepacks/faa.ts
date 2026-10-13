import { HOUR_MS } from '@aeroos/kernel';
import { endOfCalendarDaysAfter } from '../time';
import type {
  CertificationFacts, CertificationOutcome, CurrencyFacts, CurrencyOutcome, Decision, DeferralFacts, DutyFacts, ExtensionFacts,
  ExtensionOutcome, Rulepack, RosterFacts, RosterViolation, ScopeFacts
} from '../types';
import { DAYS as days, HOURS as hours, fdpViolations, restViolations, sortDuties, windowViolations } from '../roster';
import { addMonths } from '../time';
import { ruleId } from '../types';

/**
 * FAA rulepack — DRAFT.
 *
 * Present to prove the engine handles a structurally different authority (Part 117 duty tables,
 * A&P certificates without type ratings, MEL management programme extensions). It must be
 * validated line by line by a compliance officer before its status is set to 'approved'.
 * The registry refuses draft rulepacks outside development.
 */

const DAYS: Record<'B' | 'C' | 'D', number> = { B: 3, C: 10, D: 120 };

/**
 * 14 CFR Part 117 Table B — unaugmented FDP limits (hours) by scheduled start (acclimated)
 * and number of flight segments [1,2,3,4,5,6,7+]. DRAFT — verify against the current CFR.
 */
const TABLE_B: [number, number, number[]][] = [
  [0, 4 * 60, [9, 9, 9, 9, 9, 9, 9]],
  [4 * 60, 5 * 60, [10, 10, 10, 10, 9, 9, 9]],
  [5 * 60, 6 * 60, [12, 12, 12, 12, 11.5, 11, 10.5]],
  [6 * 60, 7 * 60, [13, 13, 12, 12, 11.5, 11, 10.5]],
  [7 * 60, 12 * 60, [14, 14, 13, 13, 12.5, 12, 11.5]],
  [12 * 60, 13 * 60, [13, 13, 13, 13, 12.5, 12, 11.5]],
  [13 * 60, 17 * 60, [12, 12, 12, 12, 11.5, 11, 10.5]],
  [17 * 60, 22 * 60, [12, 12, 11, 11, 10, 9, 9]],
  [22 * 60, 23 * 60, [11, 11, 10, 10, 9, 9, 9]],
  [23 * 60, 24 * 60, [10, 10, 10, 9, 9, 9, 9]]
];

const FAA_TRADE_RATINGS: Record<CertificationFacts['trade'], string[]> = {
  MECHANICAL: ['A'],
  STRUCTURES: ['A'],
  AVIONICS: ['A'],
  POWERPLANT: ['P']
};

export function faaRulepackDraft(version: string, effectiveFrom: string): Rulepack {
  const id = ruleId({ authority: 'FAA', version });
  const pack: Rulepack = {
    authority: 'FAA',
    version,
    effectiveFrom: new Date(effectiveFrom),
    status: 'draft',

    melDeadline(f: DeferralFacts): Decision<Date> {
      if (f.category === 'A') {
        if (!f.intervalHours) throw new Error('Category A items require the interval stated in the MEL remarks');
        return { value: new Date(f.raisedAt.getTime() + f.intervalHours * HOUR_MS), rule: id, basis: 'MEL preamble — Cat A per remarks' };
      }
      const days = DAYS[f.category];
      return {
        value: endOfCalendarDaysAfter(f.raisedAt, days, f.timeZone),
        rule: id,
        basis: `MEL preamble — Cat ${f.category}, ${days} consecutive calendar days excluding the day recorded`
      };
    },

    melExtension(f: ExtensionFacts): Decision<ExtensionOutcome> {
      const basis = 'MEL Management Program — continuing authorization for extensions (DRAFT)';
      if (f.category !== 'B' && f.category !== 'C') return { value: { allowed: false, reason: 'Only Category B and C items may be extended' }, rule: id, basis };
      if (!f.entryExtensionPermitted || f.extensionsGranted > 0) return { value: { allowed: false, reason: 'Extension not permitted for this deferral' }, rule: id, basis };
      if (f.requestedAt.getTime() >= f.currentDeadline.getTime()) return { value: { allowed: false, reason: 'Extension must be granted before expiry' }, rule: id, basis };
      const length = f.originalDeadline.getTime() - f.raisedAt.getTime();
      return {
        value: { allowed: true, newDeadline: new Date(f.currentDeadline.getTime() + length), conditions: ['Granted under the certificate holder’s MEL management program', 'Report to the FAA as the program requires'] },
        rule: id,
        basis
      };
    },

    maxFdpMinutes(f: DutyFacts): Decision<number> {
      if (!f.acclimatised) throw new Error('Part 117 non-acclimated adjustment is not implemented in this draft');
      const m = f.reportLocal.hour * 60 + f.reportLocal.minute;
      const row = TABLE_B.find(([a, b]) => m >= a && m < b)!;
      const hours = row[2][Math.min(f.sectors, 7) - 1];
      return { value: Math.round(hours * 60), rule: id, basis: '14 CFR 117 Table B — unaugmented (DRAFT)' };
    },

    canCertify(f: CertificationFacts): Decision<CertificationOutcome> {
      const basis = '14 CFR 65 / 121.378 — certificated mechanic with carrier authorization (DRAFT)';
      if (f.currency) {
        const c = pack.currency(f.currency);
        if (!c.value.current) return { value: { allowed: false, reason: c.value.reason }, rule: id, basis: c.basis };
      }
      const a = f.authorisation;
      if (!a || a.suspended || a.validUntil.getTime() <= f.at.getTime() || !a.aircraftTypes.includes(f.aircraftType)) {
        return { value: { allowed: false, reason: 'No valid carrier authorization for this aircraft type' }, rule: id, basis };
      }
      // FAA mechanic certificates carry ratings (A, P) but no aircraft type ratings.
      const want = FAA_TRADE_RATINGS[f.trade];
      const match = f.privileges.find(p => p.authority === 'FAA' && p.validUntil.getTime() > f.at.getTime() && want.includes(p.category));
      if (!match) return { value: { allowed: false, reason: `Requires an FAA mechanic certificate with ${want.join('/')} rating` }, rule: id, basis };
      return { value: { allowed: true, via: `FAA mechanic ${match.category} · ${a.reference}` }, rule: id, basis };
    },

    currency(f: CurrencyFacts): Decision<CurrencyOutcome> {
      // 14 CFR 65.83: 6 months as a mechanic within the preceding 24 months. Recurrent training interval
      // is set by the carrier's 121.375 programme; 24 months is a DRAFT placeholder for that programme value.
      const basis = '14 CFR 65.83 recent experience; 121.375 training programme (DRAFT)';
      if (f.experienceMonthsLast24 < 6) return { value: { current: false, reason: 'Fewer than 6 months as a mechanic in the preceding 24 months' }, rule: id, basis };
      if (!f.lastContinuationTraining) return { value: { current: false, reason: 'No recurrent training on record' }, rule: id, basis };
      const due = addMonths(f.lastContinuationTraining, 24);
      if (due.getTime() <= f.at.getTime()) return { value: { current: false, reason: 'Recurrent training overdue' }, rule: id, basis };
      return { value: { current: true, trainingDue: due }, rule: id, basis };
    },

    authorisationScope(f: ScopeFacts) {
      const basis = '14 CFR 65.85/65.87 — airframe/powerplant ratings; no aircraft type ratings (DRAFT)';
      const ok = f.privileges.some(p => p.authority === 'FAA' && p.validUntil.getTime() > f.at.getTime() && (p.category === 'A' || p.category === 'P'));
      return ok
        ? { value: { allowed: true as const }, rule: id, basis }
        : { value: { allowed: false as const, reason: 'Holder has no FAA mechanic certificate with an A or P rating' }, rule: id, basis };
    },
    rosterCheck(f: RosterFacts): Decision<RosterViolation[]> {
      const duties = sortDuties(f.duties);
      const violations = [
        // 117.19: FDP extension of up to 2 hours (pilot in command and certificate holder concur).
        ...fdpViolations(duties, x => pack.maxFdpMinutes(x).value, 120, '14 CFR 117.13 Table B / 117.19 (DRAFT)'),
        // 117.25(e): 10 consecutive hours of rest immediately before the FDP.
        ...restViolations(duties, () => 10 * 60, '14 CFR 117.25(e) (DRAFT)'),
        ...windowViolations(duties, [
          { code: 'DUTY_7D', pick: 'duty', window: hours(168), limitMinutes: 60 * 60, label: 'FDP in 168 consecutive hours', ref: '14 CFR 117.23(c)(1) (DRAFT)' },
          { code: 'DUTY_28D', pick: 'duty', window: hours(672), limitMinutes: 190 * 60, label: 'FDP in 672 consecutive hours', ref: '14 CFR 117.23(c)(2) (DRAFT)' },
          { code: 'FLIGHT_28D', pick: 'flight', window: hours(672), limitMinutes: 100 * 60, label: 'Flight time in 672 consecutive hours', ref: '14 CFR 117.23(b)(1) (DRAFT)' },
          { code: 'FLIGHT_12M', pick: 'flight', window: days(365), limitMinutes: 1000 * 60, label: 'Flight time in 365 consecutive days', ref: '14 CFR 117.23(b)(2) (DRAFT)' }
        ])
      ];
      // DRAFT simplification: Part 117 counts FDP (not total duty) in 117.23(c); duties here are measured report → duty end.
      return { value: violations, rule: id, basis: '14 CFR 117 — FDP, rest and cumulative limits (DRAFT)' };
    }
  };
  return pack;
}

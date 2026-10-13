import { HOUR_MS } from '@aeroos/kernel';
import { endOfCalendarDaysAfter } from '../time';
import type {
  CertificationFacts, CertificationOutcome, CurrencyFacts, CurrencyOutcome, Decision, DeferralFacts, DutyFacts, ExtensionFacts,
  ExtensionOutcome, Rulepack, RosterFacts, RosterViolation, ScopeFacts
} from '../types';
import { DAYS as days, fdpViolations, restViolations, sortDuties, windowViolations } from '../roster';
import { addMonths } from '../time';
import { ruleId } from '../types';

const DAYS: Record<'B' | 'C' | 'D', number> = { B: 3, C: 10, D: 120 };

/**
 * EASA ORO.FTL.205 Table 2 — maximum daily FDP for acclimatised crew, 1–2 sectors, by reporting time.
 * [fromMinute, toMinute (exclusive), maxFdpMinutes]
 */
const FDP_TABLE_2: [number, number, number][] = [
  [6 * 60, 13 * 60 + 30, 13 * 60],
  [13 * 60 + 30, 14 * 60, 12 * 60 + 45],
  [14 * 60, 14 * 60 + 30, 12 * 60 + 30],
  [14 * 60 + 30, 15 * 60, 12 * 60 + 15],
  [15 * 60, 15 * 60 + 30, 12 * 60],
  [15 * 60 + 30, 16 * 60, 11 * 60 + 45],
  [16 * 60, 16 * 60 + 30, 11 * 60 + 30],
  [16 * 60 + 30, 17 * 60, 11 * 60 + 15],
  [17 * 60, 24 * 60, 11 * 60],
  [0, 5 * 60, 11 * 60],
  [5 * 60, 5 * 60 + 15, 12 * 60],
  [5 * 60 + 15, 5 * 60 + 30, 12 * 60 + 15],
  [5 * 60 + 30, 5 * 60 + 45, 12 * 60 + 30],
  [5 * 60 + 45, 6 * 60, 12 * 60 + 45]
];

const EASA_TRADE_CATEGORIES: Record<CertificationFacts['trade'], string[]> = {
  MECHANICAL: ['B1'],
  STRUCTURES: ['B1'],
  POWERPLANT: ['B1'],
  AVIONICS: ['B2']
};

export function easaRulepack(version: string, effectiveFrom: string): Rulepack {
  const id = ruleId({ authority: 'EASA', version });

  const pack: Rulepack = {
    authority: 'EASA',
    version,
    effectiveFrom: new Date(effectiveFrom),
    status: 'approved',

    melDeadline(f: DeferralFacts): Decision<Date> {
      if (f.category === 'A') {
        if (!f.intervalHours || f.intervalHours <= 0) {
          throw new Error('Category A items require the interval stated in the operator MEL remarks (intervalHours)');
        }
        return {
          value: new Date(f.raisedAt.getTime() + f.intervalHours * HOUR_MS),
          rule: id,
          basis: `MEL Cat A — interval per MEL remarks (${f.intervalHours} h)`
        };
      }
      const days = DAYS[f.category];
      return {
        value: endOfCalendarDaysAfter(f.raisedAt, days, f.timeZone),
        rule: id,
        basis: `MEL Cat ${f.category} — ${days} consecutive calendar days excluding the day of discovery (${f.timeZone})`
      };
    },

    melExtension(f: ExtensionFacts): Decision<ExtensionOutcome> {
      const no = (reason: string): Decision<ExtensionOutcome> => ({ value: { allowed: false, reason }, rule: id, basis: 'ORO.MLR.105 — rectification interval extension' });
      if (f.category === 'A') return no('Category A rectification intervals cannot be extended');
      if (!f.entryExtensionPermitted) return no('The operator MEL does not permit an extension for this item');
      if (f.extensionsGranted > 0) return no('Only one extension is permitted per deferral');
      if (f.requestedAt.getTime() >= f.currentDeadline.getTime()) return no('Extension must be approved before the rectification interval expires');
      const length = f.originalDeadline.getTime() - f.raisedAt.getTime();
      return {
        value: {
          allowed: true,
          newDeadline: new Date(f.currentDeadline.getTime() + length),
          conditions: [
            'Extension does not exceed the duration of the original rectification interval',
            'Granted under the operator’s approved rectification-interval-extension procedure',
            'Competent authority to be notified as defined in that procedure'
          ]
        },
        rule: id,
        basis: 'ORO.MLR.105 — rectification interval extension (one-time, ≤ original interval)'
      };
    },

    maxFdpMinutes(f: DutyFacts): Decision<number> {
      if (!f.acclimatised) throw new Error('Non-acclimatised FDP (ORO.FTL.205 Table 3) is not implemented in this rulepack version');
      if (f.sectors < 1) throw new Error('At least one sector is required');
      const m = f.reportLocal.hour * 60 + f.reportLocal.minute;
      const row = FDP_TABLE_2.find(([a, b]) => m >= a && m < b)!;
      const max = Math.max(9 * 60, row[2] - 30 * Math.max(0, f.sectors - 2));
      return { value: max, rule: id, basis: 'ORO.FTL.205 Table 2 — acclimatised, 30 min reduction per sector from the 3rd, minimum 9:00' };
    },

    canCertify(f: CertificationFacts): Decision<CertificationOutcome> {
      const basis = 'Part-145.A.35 / Part-66 — certifying staff privileges and company authorisation';
      const no = (reason: string): Decision<CertificationOutcome> => ({ value: { allowed: false, reason }, rule: id, basis });
      if (f.currency) {
        const c = pack.currency(f.currency);
        if (!c.value.current) return { value: { allowed: false, reason: c.value.reason }, rule: id, basis: c.basis };
      }
      const a = f.authorisation;
      if (!a) return no('No company certification authorisation on file');
      if (a.suspended) return no(`Company authorisation ${a.reference} is suspended`);
      if (a.validUntil.getTime() <= f.at.getTime()) return no(`Company authorisation ${a.reference} has expired`);
      if (!a.aircraftTypes.includes(f.aircraftType)) return no(`Company authorisation ${a.reference} does not cover ${f.aircraftType}`);
      const wanted = EASA_TRADE_CATEGORIES[f.trade];
      const match = f.privileges.find(p =>
        p.authority === 'EASA' &&
        p.validUntil.getTime() > f.at.getTime() &&
        wanted.some(c => p.category.startsWith(c)) &&
        p.typeRatings.includes(f.aircraftType)
      );
      if (!match) {
        const anyValid = f.privileges.some(p => p.authority === 'EASA' && p.validUntil.getTime() > f.at.getTime());
        return no(anyValid
          ? `No valid Part-66 ${wanted.join('/')} licence with a ${f.aircraftType} type rating for ${f.trade.toLowerCase()} work`
          : 'No valid Part-66 licence');
      }
      return { value: { allowed: true, via: `Part-66 ${match.category} · ${f.aircraftType} · ${a.reference}` }, rule: id, basis };
    },

    currency(f: CurrencyFacts): Decision<CurrencyOutcome> {
      const basis = 'Part-145.A.35(c)(d) — 6 months relevant experience in any 2 years; continuation training each 2 years';
      if (f.experienceMonthsLast24 < 6) {
        return { value: { current: false, reason: `Only ${f.experienceMonthsLast24} month(s) of relevant maintenance experience in the last 24 months (6 required)` }, rule: id, basis };
      }
      if (!f.lastContinuationTraining) return { value: { current: false, reason: 'No continuation training on record' }, rule: id, basis };
      const due = addMonths(f.lastContinuationTraining, 24);
      if (due.getTime() <= f.at.getTime()) {
        return { value: { current: false, reason: `Continuation training expired on ${due.toISOString().slice(0, 10)}` }, rule: id, basis };
      }
      return { value: { current: true, trainingDue: due }, rule: id, basis };
    },

    authorisationScope(f: ScopeFacts) {
      const basis = 'Part-145.A.35(a)/(h) — authorisation scope must not exceed the Part-66 licence and type ratings';
      const valid = f.privileges.filter(p => p.authority === 'EASA' && p.validUntil.getTime() > f.at.getTime() && /^(B1|B2|B3|C)/.test(p.category));
      if (valid.length === 0) return { value: { allowed: false as const, reason: 'Holder has no valid Part-66 B1, B2, B3 or C licence' }, rule: id, basis };
      const uncovered = f.aircraftTypes.filter(t => !valid.some(p => p.typeRatings.includes(t)));
      if (uncovered.length) return { value: { allowed: false as const, reason: `No valid Part-66 type rating for ${uncovered.join(', ')}` }, rule: id, basis };
      return { value: { allowed: true as const }, rule: id, basis };
    },
    rosterCheck(f: RosterFacts): Decision<RosterViolation[]> {
      const duties = sortDuties(f.duties);
      const violations = [
        // ORO.FTL.205(f): the commander may extend the FDP by up to 2 hours in unforeseen circumstances.
        ...fdpViolations(duties, x => pack.maxFdpMinutes(x).value, 120, 'ORO.FTL.205 Table 2 / 205(f)'),
        // ORO.FTL.235(b)(c): at least as long as the preceding duty, and at least 12 h at home base or 10 h away.
        ...restViolations(duties, (prev, next) => Math.max(
          Math.round((prev.dutyEnd.getTime() - prev.report.getTime()) / 60_000),
          next.restAtHomeBase ? 12 * 60 : 10 * 60
        ), 'ORO.FTL.235(b)(c)'),
        ...windowViolations(duties, [
          { code: 'DUTY_7D', pick: 'duty', window: days(7), limitMinutes: 60 * 60, label: 'Duty in 7 consecutive days', ref: 'ORO.FTL.210(a)(1)' },
          { code: 'DUTY_14D', pick: 'duty', window: days(14), limitMinutes: 110 * 60, label: 'Duty in 14 consecutive days', ref: 'ORO.FTL.210(a)(2)' },
          { code: 'DUTY_28D', pick: 'duty', window: days(28), limitMinutes: 190 * 60, label: 'Duty in 28 consecutive days', ref: 'ORO.FTL.210(a)(3)' },
          { code: 'FLIGHT_28D', pick: 'flight', window: days(28), limitMinutes: 100 * 60, label: 'Flight time in 28 consecutive days', ref: 'ORO.FTL.210(b)(1)' },
          { code: 'FLIGHT_YEAR', pick: 'flight', window: 'calendar-year', limitMinutes: 900 * 60, label: 'Flight time in the calendar year', ref: 'ORO.FTL.210(b)(2)' },
          { code: 'FLIGHT_12M', pick: 'flight', window: days(365), limitMinutes: 1000 * 60, label: 'Flight time in 12 consecutive months', ref: 'ORO.FTL.210(b)(3)' }
        ])
      ];
      return { value: violations, rule: id, basis: 'ORO.FTL.205 / 210 / 235 — FDP, cumulative duty and flight time, minimum rest' };
    }
  };
  return pack;
}

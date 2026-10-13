export type Authority = 'EASA' | 'FAA' | 'KCAA';
export type MelCategory = 'A' | 'B' | 'C' | 'D';
export type Trade = 'MECHANICAL' | 'POWERPLANT' | 'AVIONICS' | 'STRUCTURES';

/**
 * Every regulated decision carries the rule that produced it ("EASA@2026.1") and the
 * regulatory basis in words, so an auditor can see exactly why the system decided what it did.
 */
export interface Decision<T> {
  value: T;
  rule: string;
  basis: string;
}

/* ---------------------------------------------------------------- operator overlay */

/** One line of the operator's approved MEL. Operator data, not authority data. */
export interface OperatorMelEntry {
  ref: string;
  ata: string;
  title: string;
  category: MelCategory;
  /** Category A only: the interval stated in the MEL remarks, in hours. */
  intervalHours?: number;
  /** Whether the operator's approved procedure allows a rectification interval extension for this item. */
  extensionPermitted: boolean;
  opsProcedure?: string;
  maintProcedure?: string;
}

/** Everything about an operator that changes how the authority's rules apply. */
export interface OperatorProfile {
  operatorId: string;
  name: string;
  authority: Authority;
  /** IANA zone used to count MEL calendar days (most operators use UTC). */
  melTimeZone: string;
  mel: Record<string, OperatorMelEntry>;
  /** Aircraft types on the operator's approval / AOC. */
  approvedTypes: string[];
}

/* ---------------------------------------------------------------- MEL */

export interface DeferralFacts {
  category: MelCategory;
  raisedAt: Date;
  timeZone: string;
  intervalHours?: number;
}

export interface ExtensionFacts {
  category: MelCategory;
  raisedAt: Date;
  currentDeadline: Date;
  originalDeadline: Date;
  extensionsGranted: number;
  entryExtensionPermitted: boolean;
  requestedAt: Date;
}

export type ExtensionOutcome =
  | { allowed: true; newDeadline: Date; conditions: string[] }
  | { allowed: false; reason: string };

/* ---------------------------------------------------------------- crew duty */

export interface DutyFacts {
  /** Local time at the reporting point. */
  reportLocal: { hour: number; minute: number };
  sectors: number;
  acclimatised: boolean;
}

/** One duty period of a crew member, as Flight Ops computes it from the legs they operate. */
export interface DutyFact {
  id: string;
  /** Report time (start of FDP and of the duty period). */
  report: Date;
  /** On-blocks of the last sector (end of FDP). */
  fdpEnd: Date;
  /** End of duty (post-flight duties included). */
  dutyEnd: Date;
  sectors: number;
  /** Block time flown in this duty. */
  flightMinutes: number;
  /** IANA zone of the reporting point — FDP limits depend on local report time. */
  reportTimeZone: string;
  acclimatised: boolean;
  /** Whether the rest that precedes this duty is taken at the crew member's home base. */
  restAtHomeBase: boolean;
}

export interface RosterFacts {
  /** All duties in the look-back and planning window, any order. */
  duties: DutyFact[];
}

export type RosterViolationCode =
  | 'FDP' | 'FDP_UNSUPPORTED' | 'REST'
  | 'DUTY_7D' | 'DUTY_14D' | 'DUTY_28D'
  | 'FLIGHT_28D' | 'FLIGHT_YEAR' | 'FLIGHT_12M';

export interface RosterViolation {
  dutyId: string;
  code: RosterViolationCode;
  /** 'discretion' = within the commander's discretion extension; anything else must not be operated. */
  severity: 'violation' | 'discretion';
  message: string;
  ref: string;
  limitMinutes: number | null;
  actualMinutes: number | null;
}

/* ---------------------------------------------------------------- certification */

export interface Privilege {
  authority: Authority;
  /** e.g. "B1.1", "B2", "C" (EASA Part-66) or "A", "P", "IA" (FAA). */
  category: string;
  typeRatings: string[];
  validUntil: Date;
}

export interface CompanyAuthorisation {
  reference: string;
  aircraftTypes: string[];
  validUntil: Date;
  suspended: boolean;
}

/**
 * Facts for "is this person still current?" — recent experience and continuation training.
 * Both come from Organization Core: experience months from the work they actually signed,
 * training dates from their training record.
 */
export interface CurrencyFacts {
  /** Distinct calendar months (in the last 24) in which the person performed relevant maintenance. */
  experienceMonthsLast24: number;
  /** Most recent completed continuation training (includes human factors), or null if none on file. */
  lastContinuationTraining: Date | null;
  at: Date;
}

export type CurrencyOutcome =
  | { current: true; trainingDue: Date }
  | { current: false; reason: string };

export interface ScopeFacts {
  privileges: Privilege[];
  aircraftTypes: string[];
  at: Date;
}

export interface CertificationFacts {
  privileges: Privilege[];
  authorisation: CompanyAuthorisation | null;
  aircraftType: string;
  trade: Trade;
  at: Date;
  /** When present, currency is checked before privileges (Org Core always supplies it). */
  currency?: CurrencyFacts;
}

export type CertificationOutcome = { allowed: true; via: string } | { allowed: false; reason: string };

/* ---------------------------------------------------------------- rulepack */

export interface Rulepack {
  authority: Authority;
  /** Calendar-style version, e.g. "2026.1". */
  version: string;
  effectiveFrom: Date;
  /** Draft rulepacks are refused outside development until a compliance officer approves them. */
  status: 'approved' | 'draft';
  melDeadline(f: DeferralFacts): Decision<Date>;
  melExtension(f: ExtensionFacts): Decision<ExtensionOutcome>;
  maxFdpMinutes(f: DutyFacts): Decision<number>;
  canCertify(f: CertificationFacts): Decision<CertificationOutcome>;
  /** Recent experience + continuation training required to keep exercising certification privileges. */
  currency(f: CurrencyFacts): Decision<CurrencyOutcome>;
  /** May a company authorisation covering these aircraft types be issued to a holder of these privileges? */
  authorisationScope(f: ScopeFacts): Decision<{ allowed: true } | { allowed: false; reason: string }>;
  /** Flight and duty time limitations for one crew member's duties (FDP, rest, cumulative limits). */
  rosterCheck(f: RosterFacts): Decision<RosterViolation[]>;
}

export const ruleId = (p: Pick<Rulepack, 'authority' | 'version'>) => `${p.authority}@${p.version}`;

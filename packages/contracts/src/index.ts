/**
 * Contracts between modules and with clients. Events are versioned by topic name (".v1");
 * a breaking change ships as a new topic so old consumers keep working during migration.
 */

export type Trade = 'MECHANICAL' | 'POWERPLANT' | 'AVIONICS' | 'STRUCTURES';
export type MelCategory = 'A' | 'B' | 'C' | 'D';
export type TrainingCourse = 'CONTINUATION' | 'HUMAN_FACTORS' | 'TYPE' | 'FUEL_TANK_SAFETY' | 'EWIS';
export type Severity = 'red' | 'amber' | 'green' | 'cyan' | 'mag';

export const TOPICS = {
  camo: 'aeroos.camo.v1',
  amo: 'aeroos.amo.v1',
  org: 'aeroos.org.v1',
  ops: 'aeroos.ops.v1',
  platform: 'aeroos.platform.v1'
} as const;
export type Topic = (typeof TOPICS)[keyof typeof TOPICS];

export interface EventMap {
  'camo.mel.deferred': { melItemId: string; tail: string; melRef: string; category: MelCategory; deadline: string; rule: string };
  'camo.mel.extended': { melItemId: string; tail: string; deadline: string; rule: string };
  'camo.mel.closed': { melItemId: string; tail: string; closureRef: string };
  'camo.mel.expired': { melItemId: string; tail: string };
  'camo.eo.released': {
    eoId: string; tail: string; aircraftType: string; title: string; ata: string; trade: Trade;
    steps: string[]; estimatedHours: number; source: { type: 'MEL'; id: string };
  };
  'amo.taskcard.created': { taskCardId: string; eoId: string; tail: string };
  'amo.taskcard.step_signed': { taskCardId: string; step: number; tail: string; personnelId: string };
  /** `eoId` is the card's source id (an EO, or "WP-…/REQ-…" for a work-package item); `sourceType` tells which. */
  'amo.crs.issued': { taskCardId: string; crsNumber: string; eoId: string; tail: string; personnelId: string; sourceType?: 'EO' | 'WP' };
  /** A non-conforming part was scrapped and mutilated (145.A.42): its serial can never be installed again. */
  'amo.part.scrapped': { ncrId: string; partNo: string; serial: string | null; method: string; at: string };
  /** A third-party maintenance invoice or credit note was issued (amounts in cents of `currency`; credit notes positive). */
  'amo.invoice.issued': {
    invoiceId: string; kind: 'INVOICE' | 'CREDIT_NOTE'; credits: string | null; orderId: string; customerId: string; customerName: string; issuedOn: string;
    currency: string; basePerUnit: number; labourCents: number; partsCents: number; serviceCents: number; vatCents: number; totalCents: number; costCentre: string;
  };
  'amo.payment.received': { invoiceId: string; customerName: string; reference: string; receivedOn: string; amountCents: number; currency: string; basePerUnit: number;
    /** This payment completes the invoice: the ledger clears the rest of the receivable exactly. */
    settles?: boolean };
  /** Goods received against a purchase order (value in base-currency cents) — the ledger accrues stock against the supplier. */
  'amo.goods.received': { receiptId: string; poId: string; partNo: string; qty: number; unitPrice: number; currency: string; basePerUnit: number; amountBaseCents: number; receivedAt: string; station: string };
  'org.authorisation.issued': { authorisationId: string; personnelId: string; reference: string; aircraftTypes: string[]; validUntil: string; rule: string };
  'org.authorisation.suspended': { authorisationId: string; personnelId: string; reference: string; reason: string };
  'org.authorisation.reinstated': { authorisationId: string; personnelId: string; reference: string };
  'org.authorisation.revoked': { authorisationId: string; personnelId: string; reference: string; reason: string };
  'org.authorisation.expired': { authorisationId: string; personnelId: string; reference: string };
  'org.training.recorded': { personnelId: string; course: TrainingCourse; completedAt: string };
  'org.expiry.warning': { subject: 'AUTHORISATION' | 'LICENCE' | 'TRAINING'; subjectId: string; personnelId: string; level: string; expiresAt: string };
  'camo.wp.planned': { wpId: string; tail: string; station: string; bay: string; plannedStart: string; plannedEnd: string; status: string };
  'camo.wp.released': {
    wpId: string; tail: string; aircraftType: string; title: string; station: string; checkType: 'A' | 'C' | 'OTHER'; priority: 'ROUTINE' | 'HIGH' | 'AOG';
    items: { requirementId: string; ref: string; title: string; ata: string; trade: Trade; steps: string[]; estimatedHours: number; tools: string[]; parts: { partNo: string; qty: number }[]; predecessors: string[] }[];
  };
  'camo.wp.completed': { wpId: string; tail: string };
  'camo.requirement.complied': { requirementId: string; ref: string; tail: string; at: string; fh: number; fc: number; crsNumber: string };
  /** An overdue AD, task or life-limited part grounds the aircraft until complied. */
  'camo.airworthiness.changed': { tail: string; airworthy: boolean; reasons: string[] };
  'ops.flight.departed': { flightId: string; flightNo: string; tail: string; offBlock: string; airborne: string | null; delayMinutes: number; delayCodes: string[] };
  /** `flightMinutes` = airborne time (takeoff → landing) when reported; CAMO counts it as flight hours, else block time. */
  'ops.flight.arrived': { flightId: string; flightNo: string; tail: string; blockMinutes: number; flightMinutes?: number | null; arrivedAt: string; source?: 'MESSAGE' | 'SIMULATED'; station?: string };
  /** The aircraft is not where the plan says: diversion, forced return (FR, landed back at origin) or return to ramp (RR, before takeoff). */
  'ops.flight.diverted': { flightId: string; flightNo: string; tail: string; kind: 'DIVERSION' | 'FORCED_RETURN' | 'RETURN_TO_RAMP'; plannedArr: string; station: string; at: string };
  'ops.flight.delayed': { flightId: string; flightNo: string; tail: string; etd: string; delayMinutes: number; reason: string; knockOn: string[] };
  'ops.flight.cancelled': { flightId: string; flightNo: string; tail: string; reason: string };
  'ops.flight.tail_changed': { flightId: string; flightNo: string; tail: string; from: string };
  'ops.dispatch.changed': { tail: string; dispatchable: boolean; reasons: string[] };
  'ops.recovery.proposed': { runId: string; solver: string; objective: number; changes: number };
  'ops.recovery.applied': { runId: string; changes: number };
  'ops.crew.reassigned': { runId: string; flightIds: string[]; fromCrew: string; toCrew: string; role: 'CPT' | 'FO' };
  'platform.notification.raised': { notificationId: string; severity: Severity; title: string; body: string; link: string | null };
}
export const EVENT_TYPES = [
  "camo.mel.deferred",
  "camo.mel.extended",
  "camo.mel.closed",
  "camo.mel.expired",
  "camo.eo.released",
  "amo.taskcard.created",
  "amo.taskcard.step_signed",
  "amo.crs.issued",
  "amo.part.scrapped",
  "amo.invoice.issued",
  "amo.payment.received",
  "amo.goods.received",
  "org.authorisation.issued",
  "org.authorisation.suspended",
  "org.authorisation.reinstated",
  "org.authorisation.revoked",
  "org.authorisation.expired",
  "org.training.recorded",
  "org.expiry.warning",
  "camo.wp.planned",
  "camo.wp.released",
  "camo.wp.completed",
  "camo.requirement.complied",
  "camo.airworthiness.changed",
  "ops.flight.departed",
  "ops.flight.arrived",
  "ops.flight.diverted",
  "ops.flight.delayed",
  "ops.flight.cancelled",
  "ops.flight.tail_changed",
  "ops.dispatch.changed",
  "ops.recovery.proposed",
  "ops.recovery.applied",
  "ops.crew.reassigned",
  "platform.notification.raised"
] as const;
export type EventType = keyof EventMap;

/** What a module produces: just the fact. */
export interface DomainEvent<T extends EventType = EventType> {
  type: T;
  data: EventMap[T];
}

/** What travels on the wire: the fact plus identity, tenancy and provenance. */
export interface EventEnvelope<T extends EventType = EventType> extends DomainEvent<T> {
  id: string;
  occurredAt: string;
  operatorId: string;
  actor: string;
  correlationId: string | null;
}

export const topicFor = (type: EventType): Topic => TOPICS[type.split('.')[0] as keyof typeof TOPICS];

/* ---------------------------------------------------------------- API DTOs (JSON over HTTP) */

export interface MeDto {
  subject: string;
  username: string;
  name: string;
  roles: string[];
  /** The operator this session acts for, and every operator the user may switch to. */
  operatorId: string;
  operators: string[];
  personnel: { id: string; licenceNo: string | null; privileges: { authority: string; category: string; typeRatings: string[]; validUntil: string }[] } | null;
}

export interface FleetTailDto { reg: string; operatorId: string; type: string; msn: string; status: 'SVC' | 'AOG' | 'CHK' }
export interface MelCatalogueEntryDto { ref: string; ata: string; title: string; category: MelCategory; intervalHours: number | null; extensionPermitted: boolean }

export interface MelItemDto {
  id: string;
  operatorId: string;
  tail: string;
  aircraftType: string;
  melRef: string;
  ata: string;
  category: MelCategory;
  title: string;
  description: string;
  raisedAt: string;
  raisedBy: string;
  originalDeadline: string;
  deadline: string;
  deadlineRule: string;
  deadlineBasis: string;
  extensions: number;
  status: 'OPEN' | 'CLOSED' | 'EXPIRED';
  eoId: string | null;
  closedAt: string | null;
  closedBy: string | null;
  closureRef: string | null;
}

export interface SignatureDto { alg: string; keyId: string; signedAt: string; payloadSha256: string; signature: string }
export interface StampDto { personnelId: string; name: string; licence: string; at: string; rule: string; via: string; signature: SignatureDto; tools?: string[] }

export interface TaskCardDto {
  id: string;
  operatorId: string;
  tail: string;
  aircraftType: string;
  title: string;
  ata: string;
  trade: Trade;
  source: { type: 'EO' | 'WP'; id: string };
  status: 'OPEN' | 'IN_PROGRESS' | 'CERTIFIED';
  requirements: { tools: string[]; parts: { partNo: string; qty: number }[]; predecessors?: string[] };
  reservations: { partNo: string; location: string; qty: number; status: 'RESERVED' | 'ISSUED' | 'SHORT' }[];
  steps: { n: number; text: string; stamp: StampDto | null }[];
  crs: (StampDto & { number: string; documentId: string | null }) | null;
  attachments: DocumentDto[];
  createdAt: string;
}

export interface CertificationCheckDto { allowed: boolean; reason: string | null; via: string | null; rule: string; basis: string }

export interface AuditEntryDto {
  seq: number;
  chain: string;
  at: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  data: Record<string, unknown>;
  rule: string | null;
  prevHash: string;
  hash: string;
}

export interface AuditVerifyDto {
  chain: string; ok: boolean; count: number; head: string | null; brokenAtSeq: number | null; reason: string | null; verifiedAt: string;
  /** Latest external anchor and whether the live chain still contains it unchanged. */
  anchor: { seq: number; hash: string; anchoredAt: string; objectKey: string; matches: boolean } | null;
}

export interface NotificationDto { id: string; severity: Severity; title: string; body: string; link: string | null; createdAt: string; read: boolean }

export interface ApiError { statusCode: number; code: string; message: string }

/* ---------------------------------------------------------------- Organization Core */

export type AuthorisationStatus = 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'EXPIRED';

export interface AuthorisationDto {
  id: string;
  personnelId: string;
  reference: string;
  aircraftTypes: string[];
  issuedAt: string;
  validUntil: string;
  status: AuthorisationStatus;
  issueRule: string;
  history: { at: string; action: string; by: string; reason: string | null }[];
}

export interface LicenceDto { id: string; authority: string; category: string; typeRatings: string[]; validUntil: string; documentId: string | null }
export interface TrainingRecordDto { id: string; course: TrainingCourse; title: string; completedAt: string; recordedBy: string; documentId: string | null }

export interface CurrencyDto { current: boolean; reason: string | null; trainingDue: string | null; experienceMonthsLast24: number; rule: string; basis: string }

export interface PersonnelSummaryDto {
  id: string;
  username: string;
  name: string;
  licenceNo: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  authorisation: { reference: string; status: AuthorisationStatus; validUntil: string } | null;
  nextExpiry: { what: string; at: string } | null;
  current: boolean | null;
}

export interface PersonnelDetailDto extends Omit<PersonnelSummaryDto, 'authorisation'> {
  licences: LicenceDto[];
  training: TrainingRecordDto[];
  authorisations: AuthorisationDto[];
  currency: CurrencyDto | null;
  permissions: { manage: boolean };
}

/* ---------------------------------------------------------------- documents (object storage) */

export interface DocumentDto {
  id: string;
  ownerType: string;
  ownerId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number | null;
  sha256: string | null;
  status: 'PENDING' | 'STORED' | 'EXPIRED';
  uploadedBy: string;
  createdAt: string;
}

export interface UploadTicketDto { document: DocumentDto; uploadUrl: string; headers: Record<string, string>; expiresAt: string }

/* ---------------------------------------------------------------- Flight Ops / OCC */

/** DIVERTED = landed somewhere other than planned (a diversion, or a forced return to the departure station). */
export type FlightStatus = 'SCHEDULED' | 'DELAYED' | 'CANCELLED' | 'DEPARTED' | 'ARRIVED' | 'DIVERTED';

export interface AirportDto { icao: string; iata: string; name: string; timeZone: string; lat: number; lon: number; base: boolean }

export interface FlightDto {
  id: string;
  flightNo: string;
  date: string;
  dep: string;
  arr: string;
  std: string;
  sta: string;
  /** Estimated times (equal to scheduled when on time). */
  etd: string;
  eta: string;
  tail: string;
  aircraftType: string;
  status: FlightStatus;
  delayMinutes: number;
  delayReason: string | null;
  blockMinutes: number;
  /** Operational warnings: MEL deadline before arrival, tail not dispatchable, rotation conflicts. */
  warnings: string[];
  /** Actual times from movement messages (MVT / ACARS OOOI); null until reported. */
  actuals: { offBlock: string | null; airborne: string | null; touchdown: string | null; onBlock: string | null };
  /** ICAO station where the aircraft actually is after this flight, when different from `arr` (diversion / forced return). */
  actualArr: string | null;
  /** Diversion announced (EA to another station) but not confirmed by an arrival message from there. */
  divertingTo: string | null;
  delayCodes: { code: string; minutes: number | null }[];
  version: number;
  /** Passengers booked against the cabin; positioning crew need a free seat, or a jump seat when full. */
  load: { bookedPax: number; seats: number; jumpSeats: number };
}

export interface MovementLogDto { id: number; receivedAt: string; source: 'MVT' | 'ACARS' | 'OCC'; raw: string; flightId: string | null; status: 'APPLIED' | 'IGNORED' | 'REJECTED'; detail: string | null }

export interface TailRowDto {
  reg: string;
  type: string;
  dispatchable: boolean;
  reasons: string[];
  mel: { id: string; melRef: string; category: MelCategory; deadline: string; expired: boolean }[];
}

export interface MaintenanceSlotDto { wpId: string; tail: string; station: string; bay: string | null; start: string; end: string; status: string }

export interface TimelineDto { from: string; to: string; tails: TailRowDto[]; flights: FlightDto[]; maintenance: MaintenanceSlotDto[] }

export interface RosterViolationDto {
  dutyId: string; code: string; severity: 'violation' | 'discretion'; message: string; ref: string;
  limitMinutes: number | null; actualMinutes: number | null;
}

export interface DutyDto {
  id: string; report: string; fdpEnd: string; dutyEnd: string; sectors: number; flightMinutes: number;
  legs: { flightId: string; flightNo: string; dep: string; arr: string; etd: string; eta: string; status: FlightStatus }[];
}

export type FtlStatus = 'OK' | 'DISCRETION' | 'VIOLATION';
export type CrewRank = 'CPT' | 'FO' | 'SCCM' | 'CC';

export interface CrewSummaryDto {
  id: string; name: string; rank: CrewRank; base: string; qualifications: string[];
  status: FtlStatus; findings: number; nextDuty: { report: string; legs: string } | null;
}

export interface CrewDetailDto extends CrewSummaryDto {
  duties: DutyDto[];
  violations: RosterViolationDto[];
  rule: string;
  basis: string;
}

export interface CrewImpactDto { crewId: string; name: string; status: FtlStatus; findings: RosterViolationDto[] }

export interface FlightDetailDto {
  flight: FlightDto;
  rotation: FlightDto[];
  /** `positioning`: on board as a passenger (deadhead), not operating. */
  crew: { id: string; name: string; rank: string; status: FtlStatus; positioning?: boolean }[];
  alternates: { icao: string; iata: string; name: string; distanceKm: number }[];
  permissions: { manage: boolean };
  audit: AuditEntryDto[];
}

export interface FlightChangeResultDto { flight: FlightDto; knockOn: FlightDto[]; crewImpact: CrewImpactDto[] }

/* Recovery optimiser contract — shared with the Python solver (services/optimiser). Times are epoch minutes (UTC). */

export interface RecoveryProblem {
  runId: string;
  horizonStart: number;
  horizonEnd: number;
  minTurnMinutes: number;
  maxDelayMinutes: number;
  costs: { delayPerMinute: number; cancel: number; swap: number };
  tails: { reg: string; type: string; location: string; availableFrom: number; dispatchable: boolean }[];
  /** `earliest` = current ETD (a delay already entered is a lower bound); delay cost is counted from `std`. */
  flights: { id: string; flightNo: string; dep: string; arr: string; std: number; earliest: number; blockMinutes: number; tail: string; type: string; version: number }[];
}

export interface RecoveryAssignment { flightId: string; tail: string | null; start: number | null }

export interface RecoverySolution {
  runId: string;
  solver: 'cp-sat' | 'greedy';
  status: 'OPTIMAL' | 'FEASIBLE';
  objective: number;
  wallSeconds: number;
  assignments: RecoveryAssignment[];
}

/**
 * Crew recovery: duties that now break a flight-time limitation ("tasks") and the crew who could take
 * them over. Legality is decided in TypeScript by the rulepack (every option listed is legal); the
 * solver only picks the cheapest combination. Each candidate covers at most one task per run, because
 * legality of two extra duties together is not the sum of each alone.
 */
export interface CrewRecoveryProblem {
  runId: string;
  uncoveredCost: number;
  tasks: { id: string; crewId: string; name: string; rank: 'CPT' | 'FO'; dutyKey: string; flightIds: string[]; flightNos: string[]; report: string; reason: string }[];
  candidates: { crewId: string; name: string; rank: 'CPT' | 'FO'; kind: 'STANDBY' | 'RESERVE' }[];
  /** `positioning`: flights the crew member rides as a passenger to reach the hand-over station (and home). */
  options: { taskId: string; crewId: string; cost: number; ftl: 'OK' | 'DISCRETION'; note: string; positioning?: string[] }[];
  /** Assignment snapshot of the tasks' flights, for the stale check at accept time. */
  snapshot: { flightId: string; crewId: string }[];
  /** Seats (cabin + jump) left for positioning crew on each flight used by an option. Absent in runs before 0.8. */
  seats?: Record<string, number>;
}

export interface CrewRecoverySolution {
  runId: string;
  solver: 'cp-sat' | 'greedy';
  status: 'OPTIMAL' | 'FEASIBLE';
  objective: number;
  wallSeconds: number;
  assignments: { taskId: string; crewId: string }[];
}

export interface CrewRecoveryRunDto {
  id: string;
  status: RecoveryRunStatus;
  requestedBy: string;
  createdAt: string;
  solver: string | null;
  objective: number | null;
  wallSeconds: number | null;
  tasks: (CrewRecoveryProblem['tasks'][number] & { cover: { crewId: string; name: string; kind: 'STANDBY' | 'RESERVE'; ftl: 'OK' | 'DISCRETION'; note: string } | null; options: number })[];
  error: string | null;
  decidedBy: string | null;
}

export type RecoveryRunStatus = 'RUNNING' | 'PROPOSED' | 'FAILED' | 'ACCEPTED' | 'REJECTED' | 'STALE';

export interface RecoveryChangeDto {
  flightId: string; flightNo: string; dep: string; arr: string;
  kind: 'DELAY' | 'SWAP' | 'SWAP_DELAY' | 'CANCEL';
  fromTail: string; toTail: string | null; delayMinutes: number; newEtd: string | null;
}

export interface RecoveryRunDto {
  id: string;
  status: RecoveryRunStatus;
  requestedBy: string;
  createdAt: string;
  window: { from: string; to: string };
  solver: string | null;
  objective: number | null;
  wallSeconds: number | null;
  changes: RecoveryChangeDto[];
  error: string | null;
  decidedBy: string | null;
}

/* ---------------------------------------------------------------- CAMO depth: programme, ADs, LLPs, work packages */

export type RequirementKind = 'TASK' | 'AD' | 'SB' | 'LLP';
export type DueStatus = 'OK' | 'DUE_SOON' | 'IN_TOLERANCE' | 'OVERDUE' | 'COMPLIED';

export interface DueItemDto {
  requirementId: string; tail: string; kind: RequirementKind; ref: string; title: string; ata: string; status: DueStatus;
  next: { fh: number | null; fc: number | null; date: string | null };
  remaining: { fh: number | null; fc: number | null; days: number | null };
  limiting: 'FH' | 'FC' | 'DAYS' | null;
  forecast: string | null;
  lastDone: { at: string; fh: number; fc: number; reference: string } | null;
  interval: { fh?: number; fc?: number; days?: number; toleranceFh?: number; toleranceFc?: number; toleranceDays?: number };
  wpId: string | null;
  component: { partNo: string; serial: string; position: string } | null;
}

export interface AircraftStatusDto {
  reg: string; type: string; msn: string;
  counters: { fh: number; fc: number; at: string };
  utilisation: { fhPerDay: number; fcPerDay: number };
  airworthy: boolean;
  reasons: string[];
  due: { overdue: number; inTolerance: number; dueSoon: number };
}

export interface WorkPackageDto {
  id: string; tail: string; aircraftType: string; title: string; station: string; bay: string | null;
  plannedStart: string | null; plannedEnd: string | null; status: 'DRAFT' | 'PLANNED' | 'RELEASED' | 'COMPLETED' | 'CANCELLED';
  checkType: 'LINE' | 'A_CHECK' | 'C_CHECK' | 'ENGINE' | 'MOD' | 'OTHER'; priority: 'NORMAL' | 'HIGH' | 'AOG';
  resourcePlan: { trade: Trade; requiredHours: number; availableHours: number }[];
  dependencies: { beforeRequirementId: string; afterRequirementId: string }[]; frozenAt: string | null; frozenBy: string | null;
  items: { requirementId: string; ref: string; title: string; ata: string; complied: { at: string; crsNumber: string } | null }[];
  createdBy: string; createdAt: string;
}
export interface HangarBayDto { id: string; station: string; code: string; name: string; active: boolean }

export interface DefectRateDto { ata: string; defects: number; ratePer1000Fh: number; alertLevel: number; alert: boolean }
export interface ReliabilityDto { windowDays: number; fleetFh: number; rates: DefectRateDto[] }

/* ---------------------------------------------------------------- AMO depth: tools and stores */

export interface ToolDto { id: string; description: string; serial: string; location: string; calibrationDue: string | null; status: 'OK' | 'DUE_SOON' | 'EXPIRED' }
export interface StockDto { partNo: string; description: string; unit: string; minStock: number; onHand: number; reserved: number; locations: { location: string; qty: number }[]; low: boolean }

/* ---------------------------------------------------------------- search (Cmd+K) */

export interface SearchResultDto { type: string; id: string; title: string; subtitle: string; link: string; domain?: string }

/* ---------------------------------------------------------------- passkeys (WebAuthn) */

export interface PasskeyDto { credentialId: string; label: string; alg: number; createdAt: string; lastUsedAt: string | null }

/** PublicKeyCredentialCreationOptions, JSON form (binary fields base64url). */
export interface PasskeyRegistrationOptionsDto {
  challengeId: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  challenge: string;
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  timeout: number;
  excludeCredentials: { type: 'public-key'; id: string }[];
  authenticatorSelection: { residentKey: 'preferred'; userVerification: 'required' };
  attestation: 'none';
}

/** PublicKeyCredentialRequestOptions, JSON form, plus what is being approved (shown to the user). */
export interface PasskeyAssertionOptionsDto {
  challengeId: string;
  challenge: string;
  rpId: string;
  allowCredentials: { type: 'public-key'; id: string }[];
  userVerification: 'required';
  timeout: number;
  approving: string;
}

export interface PasskeyAssertionDto { credentialId: string; clientDataJSON: string; authenticatorData: string; signature: string }

/* ------------------------------------------------------------------ round 9: CAMO engineering, document control */

export type DirectiveKind = 'AD' | 'SB';
export type DirectiveStatus = 'RECEIVED' | 'EVALUATED' | 'DEFERRED' | 'NOT_APPLICABLE_PENDING' | 'INCORPORATED' | 'NOT_APPLICABLE' | 'REJECTED' | 'SUPERSEDED';
export type DirectiveDecision = 'COMPLY' | 'EMBODY' | 'DEFER' | 'REJECT' | 'NOT_APPLICABLE';

export interface DirectiveDto {
  id: string;
  kind: DirectiveKind;
  ref: string;
  revision: string;
  authority: string;
  title: string;
  ata: string;
  types: string[];
  msnRanges: { from: string; to: string }[] | null;
  effective: string;
  /** Negative once effective. */
  daysToEffective: number;
  action: string;
  interval: { fh?: number; fc?: number; days?: number };
  repetitive: boolean;
  estimatedHours: number;
  steps: string[];
  supersedes: string | null;
  status: DirectiveStatus;
  decision: DirectiveDecision | null;
  decisionReason: string | null;
  receivedBy: string;
  receivedAt: string;
  evaluatedBy: string | null;
  evaluatedAt: string | null;
  incorporatedBy: string | null;
  incorporatedAt: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  requirementId: string | null;
  version: number;
  tails: { tail: string; type: string; msn: string; applicable: boolean; reason: string; overridden: boolean }[];
  affected: number;
}

export interface ComponentDto {
  id: string;
  tail: string;
  position: string;
  partNo: string;
  serial: string;
  requirementId: string;
  requirementRef: string;
  installedAt: string;
  tsn: number;
  csn: number;
  lifeLimit: { fh?: number; fc?: number } | null;
  remaining: { fh: number | null; fc: number | null } | null;
}

export interface ComponentEventDto {
  id: number;
  partNo: string;
  serial: string;
  type: 'INSTALLED' | 'REMOVED' | 'SCRAPPED';
  tail: string;
  position: string;
  at: string;
  tsn: number;
  csn: number;
  reason: 'UNSERVICEABLE' | 'SCHEDULED' | 'ROBBERY' | 'LIFE_LIMIT' | 'OTHER' | null;
  reference: string;
  recordedBy: string;
}

export interface ComponentHistoryDto {
  partNo: string;
  serial: string;
  installed: { tail: string; position: string } | null;
  /** Latest known life: now if installed, at removal otherwise. */
  tsn: number;
  csn: number;
  events: ComponentEventDto[];
}

export type DocumentCategory = 'EXPOSITION' | 'MANUAL' | 'PROCEDURE' | 'FORM';
export type RevisionStatus = 'DRAFT' | 'APPROVED' | 'EFFECTIVE' | 'SUPERSEDED';

export interface DocumentRevisionDto {
  revision: number;
  status: RevisionStatus;
  summary: string;
  effectiveFrom: string | null;
  authoredBy: string;
  authoredAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  /** The approved file (pinned at approval), if any. */
  file: { documentId: string; sha256: string } | null;
}

export interface ControlledDocumentDto {
  id: string;
  code: string;
  title: string;
  category: DocumentCategory;
  owner: string;
  audience: string[];
  effective: DocumentRevisionDto | null;
  /** A revision in draft or approved and waiting for its effective date. */
  pending: DocumentRevisionDto | null;
  /** Certifying staff must have acknowledged the effective revision to sign (after a grace period). */
  requiredForCertification: boolean;
  /** The signed-in user is in the audience and has not acknowledged the effective revision. */
  mustRead: boolean;
  readCount: number;
}

export interface ControlledDocumentDetailDto extends ControlledDocumentDto {
  revisions: DocumentRevisionDto[];
  /** Acknowledgements of the effective revision. */
  reads: { username: string; name: string; readAt: string }[];
}

/* ------------------------------------------------------------------ round 10: safety, quality, non-conformities */

export type Probability = 1 | 2 | 3 | 4 | 5;
export type Severity5 = 'A' | 'B' | 'C' | 'D' | 'E';
export type Tolerability = 'INTOLERABLE' | 'TOLERABLE' | 'ACCEPTABLE';
export type OccurrenceCategory = 'TECHNICAL' | 'MAINTENANCE' | 'OPERATIONAL' | 'GROUND' | 'CABIN' | 'SECURITY' | 'OTHER';
export type OccurrenceStatus = 'REPORTED' | 'TRIAGED' | 'UNDER_INVESTIGATION' | 'CLOSED';
export type ActionStatus = 'OPEN' | 'DONE' | 'VERIFIED' | 'CANCELLED';

export interface CorrectiveActionDto {
  id: string;
  sourceType: 'OCCURRENCE' | 'FINDING';
  sourceId: string;
  description: string;
  owner: string;
  due: string;
  overdue: boolean;
  status: ActionStatus;
  evidence: string | null;
  doneBy: string | null;
  doneAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  version: number;
}

export interface OccurrenceDto {
  id: string;
  reportedAt: string;
  /** null when confidential and the viewer is neither the safety office nor the reporter. */
  reportedBy: string | null;
  confidential: boolean;
  occurredAt: string;
  station: string | null;
  tail: string | null;
  flightNo: string | null;
  category: OccurrenceCategory;
  title: string;
  description: string;
  status: OccurrenceStatus;
  mandatory: boolean;
  morDeadline: string | null;
  morOverdue: boolean;
  authorityReportedAt: string | null;
  authorityRef: string | null;
  risk: { probability: Probability; severity: Severity5; index: string; tolerability: Tolerability } | null;
  residualRisk: { probability: Probability; severity: Severity5; index: string; tolerability: Tolerability } | null;
  investigator: string | null;
  findings: string | null;
  closedBy: string | null;
  closedAt: string | null;
  version: number;
  actions: CorrectiveActionDto[];
  /** The viewer may triage, investigate and close (the safety office). */
  canManage: boolean;
}

export interface FindingDto {
  id: string;
  auditId: string;
  level: 'LEVEL_1' | 'LEVEL_2' | 'OBSERVATION';
  requirement: string;
  description: string;
  likelihood: number | null;
  impact: number | null;
  riskScore: number | null;
  riskClass: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  classificationBasis: string | null;
  containmentAction: string | null;
  recurrence: boolean;
  rootCause: string | null;
  raisedBy: string;
  raisedAt: string;
  due: string;
  overdue: boolean;
  status: 'OPEN' | 'CLOSED';
  closedBy: string | null;
  closedAt: string | null;
  version: number;
  actions: CorrectiveActionDto[];
}

export interface QualityAuditDto {
  id: string;
  title: string;
  area: string;
  reference: string;
  plannedFor: string;
  leadAuditor: string;
  status: 'PLANNED' | 'IN_PROGRESS' | 'CLOSED';
  closedAt: string | null;
  findings: FindingDto[];
}

export interface NonconformityDto {
  id: string;
  partNo: string;
  serial: string | null;
  qty: number;
  location: string | null;
  source: 'RECEIVING' | 'STOCK' | 'REMOVAL' | 'SHOP' | 'AUDIT';
  description: string;
  raisedBy: string;
  raisedAt: string;
  status: 'QUARANTINED' | 'SCRAP_PENDING' | 'CLOSED';
  disposition: 'SCRAP' | 'RETURN_TO_VENDOR' | 'RETURN_TO_STOCK' | null;
  dispositionReason: string | null;
  releaseRef: string | null;
  dispositionedBy: string | null;
  dispositionedAt: string | null;
  mutilationMethod: string | null;
  mutilatedBy: string | null;
  mutilatedAt: string | null;
  version: number;
}

/* ------------------------------------------------------------------ round 11: supply chain */

export type PartCondition = 'NE' | 'NS' | 'OH' | 'SV' | 'AR';
export type CertificateType = 'FORM1' | 'FAA_8130_3' | 'COC';

export interface VendorDto {
  id: string; name: string; approvalType: 'PART_145' | 'PART_21G' | 'DISTRIBUTOR' | 'OEM'; approvalRef: string; approvedUntil: string;
  status: 'APPROVED' | 'SUSPENDED'; warrantyMonths: number; country: string;
  /** Approved and in date today. */
  usable: boolean;
}

export interface QuoteDto { id: number; vendorId: string; vendorName: string; unitPrice: number; currency: string; leadDays: number; condition: PartCondition; validUntil: string; usable: boolean }

export interface RequisitionDto {
  id: string; partNo: string; description: string | null; qty: number; station: string; neededBy: string; taskCardId: string | null; reason: string;
  status: 'OPEN' | 'ORDERED' | 'CANCELLED'; createdBy: string; createdAt: string; quotes: QuoteDto[]; poId: string | null;
}

export interface ReceiptDto {
  id: string; poId: string | null; vendorId: string; vendorName: string; partNo: string; qty: number; serials: string[]; certificateType: CertificateType;
  certificateRef: string; condition: PartCondition; station: string; customsStatus: 'NONE' | 'BONDED' | 'CLEARED'; customsRef: string | null;
  receivedBy: string; receivedAt: string; clearedBy: string | null; clearedAt: string | null;
}

export interface PurchaseOrderDto {
  id: string; requisitionId: string | null; vendorId: string; vendorName: string; partNo: string; qty: number; receivedQty: number; unitPrice: number; total: number;
  currency: string; condition: PartCondition; import: boolean; station: string;
  status: 'PENDING_APPROVAL' | 'ISSUED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
  createdBy: string; createdAt: string; approvedBy: string | null; approvedAt: string | null; version: number; receipts: ReceiptDto[];
}

export interface WarrantyClaimDto {
  id: string; receiptId: string; vendorId: string; vendorName: string; partNo: string; serial: string | null; failure: string; failedAt: string;
  claimedAmount: number; currency: string; status: 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'CREDITED'; vendorRef: string | null; creditAmount: number | null;
  decidedBy: string | null; decidedAt: string | null; createdBy: string; createdAt: string; version: number;
}

export interface ExchangeDto {
  id: string; vendorId: string; vendorName: string; partNo: string; serialIn: string; serialOut: string; fee: number; currency: string; coreDue: string;
  status: 'OPEN' | 'CORE_RETURNED'; overdue: boolean; coreReturnedAt: string | null; coreRef: string | null; createdAt: string;
}

export interface PbhContractDto { id: string; vendorId: string; vendorName: string; scope: string; tails: string[]; ratePerFh: number; currency: string; starts: string; ends: string }

export interface PbhStatementDto { contractId: string; month: string; currency: string; ratePerFh: number; lines: { tail: string; fh: number; amount: number }[]; total: number }

/* ------------------------------------------------------------------ round 12: dispatch */

export interface DispatchLoadDto { flightCrew: number; cabinCrew: number; adults: number; children: number; infants: number; bags: number; holdFwdKg: number; holdAftKg: number }
export interface DispatchFuelDto { block: number; taxi: number; extra: number }
export interface ReleaseCheckDto { code: string; ok: boolean; message: string }

export interface DispatchDto {
  flight: FlightDto;
  status: 'OPEN' | 'RELEASED' | 'WITHDRAWN';
  type: { type: string; icaoType: string; seats: number; mzfw: number; mtow: number; mlw: number; maxFuel: number; fwdLimit: number; aftLimit: number } | null;
  weighing: { basicEmptyKg: number; weighedOn: string } | null;
  load: DispatchLoadDto | null;
  fuelInput: DispatchFuelDto | null;
  massBalance: {
    dow: number; paxMass: number; bagMass: number; zfw: number; tow: number; lw: number; zfwMac: number; towMac: number; lwMac: number;
    limits: { mzfw: number; tow: number; lw: number; towBy: 'MTOW' | 'RTOW'; lwBy: 'MLW' | 'RLW' }; underload: number; findings: string[];
  } | null;
  fuel: { taxi: number; trip: number; contingency: number; alternate: number; finalReserve: number; extra: number; required: number; block: number; margin: number;
    tripMinutes: number; alternateIcao: string | null; alternateMinutes: number } | null;
  tankering: { carryKg: number; savingUsd: number; worthIt: boolean; reason: string; priceDep: number | null; priceArr: number | null } | null;
  flightPlan: { message: string; filedAt: string | null; filedBy: string | null; current: boolean };
  route: { route: string; cruiseLevel: number; countries: string[] } | null;
  permits: { country: string; ok: boolean; permit: string | null; note: string }[];
  flightWatch: FlightWatchDto | null;
  ofp: OfpPackageDto | null;
  cabin: CabinStaffingDto | null;
  checks: ReleaseCheckDto[];
  release: { at: string; by: string; tow: number; pax: number } | null;
  lmc: { at: string; by: string; change: string }[];
  version: number;
  permissions: { prepare: boolean; release: boolean };
}

export interface DispatchBoardRowDto { flight: FlightDto; status: 'NONE' | 'OPEN' | 'RELEASED' | 'WITHDRAWN'; ready: number; total: number }
export interface OverflightPermitDto { id: number; country: string; number: string; validFrom: string; validTo: string; types: string[]; expiresInDays: number }

export interface WeatherReportDto { id: number; station: string; kind: 'METAR' | 'TAF'; issuedAt: string; validFrom: string; validTo: string; raw: string; ceilingFt: number | null; visibilityM: number | null; windGustKt: number | null; crosswindKt: number | null; thunderstorm: boolean; sourceRef: string }
export interface NotamDto { id: number; station: string; number: string; startsAt: string; endsAt: string; category: 'AIRPORT' | 'RUNWAY' | 'NAV' | 'AIRSPACE' | 'OTHER'; severity: 'INFO' | 'RESTRICTED' | 'CLOSED'; text: string; sourceRef: string; cancelled: boolean }
export interface FlowSlotDto { id: number; flightId: string; ctot: string; toleranceBefore: number; toleranceAfter: number; sourceRef: string; status: 'ACTIVE' | 'CANCELLED' }
export interface FlightWatchDto { flightId: string; generatedAt: string; weather: { station: string; metar: WeatherReportDto | null; taf: WeatherReportDto | null; findings: ReleaseCheckDto[] }[]; notams: NotamDto[]; slot: FlowSlotDto | null; checks: ReleaseCheckDto[] }

/* ---------------------------------------------------------------- crew rostering, fatigue, crew hub (Round 13) */

export type FatigueBand = 'LOW' | 'MODERATE' | 'HIGH';
export type UnavailabilityKind = 'LEAVE' | 'SICK' | 'OFF' | 'TRAINING';
export interface UnavailabilityDto { id: number; crewId: string; crewName: string; kind: UnavailabilityKind; start: string; end: string; note: string | null; createdBy: string }
export interface RosterLegDto { flightId: string; flightNo: string; dep: string; arr: string; etd: string; eta: string; tail: string; aircraftType: string; status: FlightStatus; positioning: boolean }
export interface RosterDutyDto {
  id: string; report: string; dutyEnd: string; sectors: number; flightMinutes: number; legs: RosterLegDto[];
  fatigue: number; fatigueBand: FatigueBand; fatigueReasons: string[];
}
export interface RosterCrewRowDto {
  id: string; name: string; rank: CrewRank; base: string; qualifications: string[]; status: FtlStatus; blockMinutes: number;
  duties: RosterDutyDto[]; away: UnavailabilityDto[];
}
export interface RosterOpenFlightDto { flightId: string; flightNo: string; date: string; dep: string; arr: string; etd: string; eta: string; tail: string; aircraftType: string; missing: ('CPT' | 'FO')[] }
export interface RosterRunDto {
  id: string; from: string; to: string; status: 'PROPOSED' | 'ACCEPTED' | 'REJECTED'; createdBy: string; createdAt: string; decidedBy: string | null;
  assignments: { pairingKey: string; flightIds: string[]; dutyNos?: number[]; flightNos: string; crewId: string; crewName: string; role: 'CPT' | 'FO'; fatigue: number; note: string }[];
  unfilled: { pairingKey: string; flightNos: string; role: 'CPT' | 'FO'; reason: string }[];
}
export interface RosterPublicationDto { id: number; from: string; to: string; notice: string | null; note: string | null; publishedBy: string; publishedAt: string }

export interface PairingDto { id: string; name: string; base: string; startsOn: string; endsOn: string; status: 'DRAFT' | 'APPROVED' | 'RETIRED'; createdBy: string; createdAt: string; approvedBy: string | null; approvedAt: string | null; legs: (RosterLegDto & { dutyNo: number })[] }
export type CrewPreferenceKind = 'PREFER_OFF' | 'PREFER_FLY' | 'PREFER_EARLY' | 'PREFER_LATE' | 'AVOID_NIGHT';
export interface CrewPreferenceDto { id: number; crewId: string; crewName: string; kind: CrewPreferenceKind; startsAt: string; endsAt: string; weight: number; note: string | null; createdBy: string; cancelled: boolean }
export interface ReserveDto { crewId: string; crewName: string; base: string; start: string; end: string; status: 'AVAILABLE' | 'CALLED' | 'RELEASED'; calledFlightId: string | null; calledAt: string | null; calledBy: string | null }
export interface RosterGridDto {
  from: string; to: string; crew: RosterCrewRowDto[]; openFlights: RosterOpenFlightDto[]; runs: RosterRunDto[]; publications: RosterPublicationDto[];
  pairings?: PairingDto[]; preferences?: CrewPreferenceDto[]; reserves?: ReserveDto[];
  cabin?: { flightId: string; flightNo: string; aircraftType: string; assignedSccm: number; requiredSccm: number; assignedCc: number; requiredCc: number; configured: boolean }[];
  permissions: { build: boolean; publish: boolean; manageUnavailability: boolean };
}
export interface FatigueReportDto {
  id: number; crewId: string; crewName: string; flightId: string | null; kss: number; samnPerelli: number; sleepHours24: number | null;
  severity: FatigueBand; narrative: string; status: 'OPEN' | 'REVIEWED'; reportedAt: string; reviewedBy: string | null; reviewedAt: string | null; reviewNote: string | null; mine: boolean;
}
export interface RosterChangeDto { id: number; flightId: string; flightNo: string; date: string; change: 'ADDED' | 'REMOVED'; at: string }
export interface CrewHubDutyDto extends RosterDutyDto {
  flights: (RosterLegDto & { dispatch: 'NONE' | 'OPEN' | 'RELEASED' | 'WITHDRAWN'; crew: { name: string; rank: string }[] })[];
}
export interface CrewHubDto {
  crew: { id: string; name: string; rank: CrewRank; base: string; qualifications: string[] } | null;
  status: FtlStatus; violations: RosterViolationDto[]; duties: CrewHubDutyDto[]; changes: RosterChangeDto[];
  away: UnavailabilityDto[]; fatigueReports: FatigueReportDto[];
}

/* ---------------------------------------------------------------- engineering health (Round 14) */

export type HealthAlertLevel = 'AMBER' | 'RED';
export interface HealthAlertDto {
  id: number | null; serial: string; tail: string | null; code: string; level: HealthAlertLevel; message: string; action: string;
  status: 'OPEN' | 'CLOSED'; raisedAt: string | null; closedBy: string | null; closedAt: string | null; closureNote: string | null;
  /** The condition is still present in the latest data. */
  active: boolean;
}
export interface EngineSummaryDto {
  serial: string; engineType: string; tail: string | null; position: number | null;
  last: { at: string; fh: number; egtMargin: number; egtDev: number; n2Dev: number; ffDevPct: number; vib: number } | null;
  oilQph: number | null; alerts: HealthAlertDto[];
}
export interface EngineDetailDto extends EngineSummaryDto {
  limits: { egtMarginAmber: number; egtMarginRed: number; egtShift: number; n2Shift: number; ffShift: number; vibMax: number; oilAlertQph: number; oilMaxQph: number };
  snapshots: { at: string; fh: number; egtMargin: number; egtDev: number; n2Dev: number; ffDevPct: number; vib: number; source: string }[];
  oil: { at: string; fh: number; quarts: number; qph: number | null; station: string | null; recordedBy: string }[];
  history: HealthAlertDto[];
  permissions: { recordTrend: boolean; recordOil: boolean; manageAlerts: boolean };
}
export type DamageTypeDto = 'DENT' | 'SCRATCH' | 'GOUGE' | 'CORROSION' | 'CRACK' | 'LIGHTNING' | 'DELAMINATION';
export interface DamageDto {
  id: string; tail: string; zone: string; zoneName: string; side: 'L' | 'R' | 'C'; damageType: DamageTypeDto; xMm: number; yMm: number;
  lengthMm: number; widthMm: number; depthMm: number; description: string; foundAt: string; foundFc: number; foundBy: string;
  disposition: 'ALLOWABLE' | 'REPAIR' | 'REFER'; srmRef: string | null; reason: string; nextInspectionFc: number | null;
  approvedData: string | null; approvedBy: string | null;
  repair: { kind: 'PERMANENT' | 'TEMPORARY'; data: string; untilFc: number | null; untilDate: string | null; by: string; at: string } | null;
  grounding: string | null; version: number;
}
export interface DamageChartDto {
  tail: string; aircraftType: string; fc: number; tails: { reg: string; type: string; open: number; grounding: number }[];
  zones: { zone: string; name: string }[]; damages: DamageDto[];
  permissions: { record: boolean; approveData: boolean; repair: boolean };
}

/* ---------------------------------------------------------------- business (Round 15) */

export interface CustomerDto {
  id: string; name: string; country: string; currency: string; labourRate: number; partsMarkupPct: number; serviceMarkupPct: number; vatPct: number;
  paymentTermsDays: number; creditLimit: number; openCents: number; overdueCents: number;
}
export type OrderStatusDto = 'QUOTED' | 'APPROVED' | 'IN_WORK' | 'COMPLETED' | 'INVOICED' | 'CANCELLED';
export interface BillingLineDto { kind: 'LABOUR' | 'PART' | 'SERVICE'; description: string; qty: number; unitCost: number; unitPrice: number; amountCents: number }
export interface InvoiceDto {
  id: string; kind: 'INVOICE' | 'CREDIT_NOTE'; credits: string | null; orderId: string; customerId: string; customerName: string; issuedOn: string; dueOn: string;
  currency: string; lines: BillingLineDto[]; netCents: number; vatCents: number; totalCents: number; paidCents: number;
  status: 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'CREDITED'; overdueDays: number; reason: string | null;
  payments: { amountCents: number; reference: string; receivedOn: string; recordedBy: string }[];
  version: number;
}
export interface CustomerOrderDto {
  id: string; customerId: string; customerName: string; aircraftReg: string; aircraftType: string; title: string; status: OrderStatusDto; currency: string;
  quote: { lines: BillingLineDto[]; netCents: number; vatCents: number; totalCents: number };
  actual: { lines: (BillingLineDto & { id: number; workDate: string; bookedBy: string })[]; netCents: number; vatCents: number; totalCents: number };
  overrunPct: number; overrunNeedsApproval: boolean; customerRef: string | null; overrunRef: string | null; costCentre: string;
  invoices: InvoiceDto[]; createdBy: string; createdAt: string; version: number;
}
export interface BillingOverviewDto {
  customers: CustomerDto[]; orders: CustomerOrderDto[]; invoices: InvoiceDto[];
  ageing: Record<'CURRENT' | 'D1_30' | 'D31_60' | 'D61_90' | 'D90_PLUS', number>; baseCurrency: string;
  permissions: { manageCustomers: boolean; quote: boolean; book: boolean; invoice: boolean };
}

export interface EnterpriseDto {
  entities: { id: string; name: string; country: string; currency: string; parentId: string | null; orgNumber: string | null;
    approvals: { kind: string; reference: string; authority: string; validUntil: string | null; scope: string; daysLeft: number | null }[];
    costCentres: { code: string; name: string; kind: string; manager: string | null; active: boolean }[] }[];
  permissions: { manage: boolean };
}

export interface JournalDto {
  id: string; entityId: string; date: string; period: string; source: string; sourceRef: string; memo: string; postedBy: string; postedAt: string;
  lines: { account: string; accountName: string; costCentre: string | null; debitCents: number; creditCents: number }[];
}
export interface ErpProfileDto {
  id: string; entityId: string; name: string; format: 'CSV_JOURNAL_V1' | 'JSON_JOURNAL_V1'; active: boolean;
  accountMap: Record<string, string>; costCentreMap: Record<string, string>; updatedAt: string;
}
export interface ErpExportBatchDto {
  id: string; entityId: string; profileId: string; profileName: string; period: string; format: 'CSV_JOURNAL_V1' | 'JSON_JOURNAL_V1';
  status: 'GENERATED' | 'ACKNOWLEDGED' | 'REJECTED'; contentSha256: string; journalCount: number; debitCents: number; creditCents: number;
  generatedBy: string; generatedAt: string; acknowledgementRef: string | null; acknowledgementNote: string | null; acknowledgedBy: string | null; acknowledgedAt: string | null;
}
export interface ErpIntegrationDto { profiles: ErpProfileDto[]; batches: ErpExportBatchDto[]; permissions: { integrate: boolean }; }

export interface LedgerDto {
  entityId: string; entities: { id: string; name: string }[]; period: string; baseCurrency: string;
  periods: { period: string; status: 'OPEN' | 'CLOSED'; closedBy: string | null; closedAt: string | null }[];
  trialBalance: { rows: { code: string; name: string; type: string; debitCents: number; creditCents: number; balanceCents: number }[]; debitCents: number; creditCents: number; balanced: boolean };
  profitAndLoss: { costCentre: string; revenueCents: number; expenseCents: number; resultCents: number }[];
  journals: JournalDto[];
  accounts: { code: string; name: string; type: string }[]; costCentres: { code: string; name: string }[];
  permissions: { post: boolean; close: boolean; integrate: boolean };
}

export interface KpiDto { key: string; label: string; value: number; unit: string; tone: 'green' | 'amber' | 'red' | ''; detail: string; link: string | null }
export interface ExecutiveDashboardDto {
  generatedAt: string; operatorId: string;
  sections: { key: 'operations' | 'technical' | 'safety' | 'crew' | 'commercial'; title: string; kpis: KpiDto[] }[];
  otpByDay: { date: string; flights: number; onTimePct: number | null }[];
  revenueByMonth: { period: string; revenueCents: number }[];
}

/* ---------------------------------------------------------------- certification readiness (Delivery 5) */

export interface ComplianceMatrixRowDto {
  id: string; scope: string; reference: string; title: string; exposition: { document: string; section: string };
  status: 'IMPLEMENTED' | 'SUPPORTED' | 'DATA' | 'PROCEDURAL'; implementation: string; organisation: string | null;
  evidence: { tests: { file: string; name: string }[]; rules: string[]; policies: string[]; routes: string[]; auditActions: { action: string; count: number; last: string | null }[] };
}
export interface ComplianceMatrixDto {
  operatorId: string; from: string; to: string;
  /** Audit chains counted (null: all). */
  chains: string[] | null;
  rows: ComplianceMatrixRowDto[];
  summary: { status: string; count: number }[];
  dataToReplace: { table: string; what: string; source: string }[];
  rulepacks: { authority: string; version: string; status: string }[];
}


export interface MasterDataSetDto {
  id: string; key: string; domain: 'AIRWORTHINESS' | 'ENGINEERING' | 'OPERATIONS' | 'CREW'; title: string; sourceRef: string; contentSha256: string;
  status: 'DRAFT' | 'VALIDATED' | 'APPROVED' | 'EFFECTIVE' | 'SUPERSEDED' | 'WITHDRAWN'; revision: number; createdBy: string; createdAt: string;
  validatedBy: string | null; validatedAt: string | null; approvedBy: string | null; approvedAt: string | null; effectiveFrom: string | null; version: number;
}
export interface MasterDataReadinessDto { ready: boolean; required: { key: string; effective: boolean }[] }

/* ---------------------------------------------------------------- engineering configuration (0.21) */
export type ConfigurationBaselineStatusDto = 'DRAFT' | 'APPROVED' | 'EFFECTIVE' | 'SUPERSEDED';
export interface ConfigurationEffectivityDto { tails?: string[]; msnRanges?: { from: string; to: string }[] }
export interface ConfigurationPositionDto {
  id: string; code: string; parentId: string | null; ata: string; title: string; required: boolean; maxQty: number; effectivity: ConfigurationEffectivityDto;
  allowableParts: { id: number; partNo: string; description: string; requiredMods: string[] }[];
}
export interface ConfigurationBaselineDto {
  id: string; aircraftType: string; name: string; revision: number; status: ConfigurationBaselineStatusDto; effectiveFrom: string | null;
  createdBy: string; createdAt: string; approvedBy: string | null; approvedAt: string | null; version: number; positions: ConfigurationPositionDto[];
}
export interface InstalledConfigurationItemDto {
  id: string; tail: string; aircraftType: string; positionId: string; positionCode: string; positionTitle: string; partNo: string; serial: string; mods: string[];
  installedAt: string; installationRef: string; installedBy: string; removedAt: string | null; removalRef: string | null; removedBy: string | null;
}
export interface AircraftConfigurationDto {
  tail: string; aircraftType: string; msn: string; baseline: ConfigurationBaselineDto | null; items: InstalledConfigurationItemDto[];
  issues: { code: string; positionId: string; itemId?: string; detail: string }[];
  conforming: boolean; permissions: { design: boolean; install: boolean; approve: boolean };
}


/* ---------------------------------------------------------------- 0.28 P1 closure: production, warehouse, provider planning */
export interface OfpPackageDto { id: string; flightId: string; provider: string; providerRef: string; revision: number; tail: string; etd: string; generatedAt: string; route: string; cruiseLevel: number | null; alternate: string | null; etopsMinutes: number | null; redispatchPoint: string | null; tripFuelKg: number; contingencyFuelKg: number; alternateFuelKg: number; finalReserveFuelKg: number; blockFuelKg: number; payloadKg: number; takeoffMassKg: number; landingMassKg: number; performanceRef: string; navDataCycle: string; weatherRef: string; notamRef: string; contentSha256: string; }
export interface FrmsAssessmentDto { id: string; crewId: string; dutyId: string; provider: string; model: string; modelVersion: string; score: number; riskBand: 'LOW'|'MODERATE'|'HIGH'|'CRITICAL'; generatedAt: string; sourceRef: string; contentSha256: string; recommendation: string | null; }
export interface CabinRequirementDto { aircraftType: string; sccmRequired: number; ccRequired: number; }
export interface CabinStaffingDto { flightId: string; requirement: CabinRequirementDto | null; assigned: { crewId: string; name: string; rank: 'SCCM'|'CC' }[]; missing: { role: 'SCCM'|'CC'; count: number }[]; candidates: { crewId: string; name: string; rank: 'SCCM'|'CC'; ftl: FtlStatus }[]; }

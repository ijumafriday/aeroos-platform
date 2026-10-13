/**
 * Compliance traceability matrix: each regulatory requirement the platform touches, where the operator's
 * exposition addresses it, how AeroOS implements it, and the evidence that proves it — automated tests, rulepack
 * decisions, authorisation policies, the screens, and the audit-trail actions an inspector can sample.
 *
 * The references are checked by `checks/matrix.test.ts` (a test, rule, policy, screen or audit action that does
 * not exist fails the build), so the matrix cannot drift from the code.
 *
 * Exposition section numbers follow the EASA user-guide templates (MOE per AMC1 145.A.70, CAME per AMC1
 * CAMO.A.300, OM per AMC3 ORO.MLR.100, SMS manual per AMC1 ORO.GEN.200(a)(5)); an operator adjusts them to its own
 * documents. The status says who carries the requirement:
 *   IMPLEMENTED  the system enforces it (a wrong action is refused) and records it;
 *   SUPPORTED    the system records and tracks it; the organisation's procedure decides;
 *   DATA         the logic is in place but needs the operator's approved data (the demo data is illustrative);
 *   PROCEDURAL   outside the system: the organisation's own procedure, facilities or people.
 */

export type MatrixStatus = 'IMPLEMENTED' | 'SUPPORTED' | 'DATA' | 'PROCEDURAL';
export type MatrixScope = 'PART-CAMO' | 'PART-145' | 'PART-ORO' | 'PART-CAT' | 'PART-M' | 'PART-21' | 'PLATFORM';
export type ExpositionDoc = 'CAME' | 'MOE' | 'OM-A' | 'OM-B' | 'SMM' | 'OMM' | '—';

export interface MatrixRow {
  id: string;
  scope: MatrixScope;
  reference: string;
  title: string;
  exposition: { document: ExpositionDoc; section: string };
  status: MatrixStatus;
  /** How the platform meets it (or what the organisation must do). */
  implementation: string;
  evidence: {
    /** Repository test files and a substring of the test name. */
    tests?: { file: string; name: string }[];
    /** Rulepack decisions (methods of the rulepack). */
    rules?: ('melDeadline' | 'melExtension' | 'maxFdpMinutes' | 'canCertify' | 'currency' | 'authorisationScope' | 'rosterCheck')[];
    /** Cerbos resource kinds that govern who may do it. */
    policies?: string[];
    /** Screens where it is done / shown. */
    routes?: string[];
    /** Audit-trail actions an inspector samples. */
    auditActions?: string[];
  };
  /** What the organisation still has to provide (data, procedure, approval). */
  organisation?: string;
}

const T = (file: string, name: string) => ({ file, name });

export const COMPLIANCE_MATRIX: MatrixRow[] = [
  /* ------------------------------------------------------------------ Part-CAMO / Part-M */
  {
    id: 'CAMO-01', scope: 'PART-CAMO', reference: 'CAMO.A.315(b)(1); M.A.302', title: 'Aircraft maintenance programme and due list',
    exposition: { document: 'CAME', section: '1.2 Aircraft maintenance programme' }, status: 'IMPLEMENTED',
    implementation: 'Requirements by type with FH/FC/calendar intervals and approved tolerances; a live due list per aircraft from utilisation; an overdue item grounds the aircraft and the OCC sees it at once.',
    evidence: {
      tests: [T('packages/mro-domain/src/maintenance.test.ts', 'FH limits first at current utilisation'), T('packages/mro-domain/src/maintenance.test.ts', 'a task inside its approved tolerance is flagged')],
      policies: ['maintenance_programme'], routes: ['/camo/programme'], auditActions: ['requirement.complied', 'airworthiness.lost', 'airworthiness.restored']
    },
    organisation: 'Load the approved AMP (and its revisions) in place of the demo programme; the AMP itself is approved by the competent authority.'
  },
  {
    id: 'CAMO-02', scope: 'PART-M', reference: 'M.A.301(c), M.A.303; Part-21 AD', title: 'Airworthiness directives',
    exposition: { document: 'CAME', section: '1.6 Airworthiness directives' }, status: 'IMPLEMENTED',
    implementation: 'AD/SB register with applicability by type and MSN; an applicable AD can never be deferred or rejected; taking an aircraft out of applicability by override and recording incorporation each need a second person; superseding ADs keep the earlier compliance clock; ADs carry no tolerance.',
    evidence: {
      tests: [T('packages/mro-domain/src/directive.test.ts', 'an applicable AD is mandatory'), T('packages/mro-domain/src/directive.test.ts', 'a superseding AD starts no later'), T('packages/mro-domain/src/maintenance.test.ts', 'ADs never get a tolerance')],
      policies: ['directive'], routes: ['/camo/directives'], auditActions: ['directive.received', 'directive.evaluated', 'directive.incorporated', 'directive.superseded']
    },
    organisation: 'Subscribe to the EASA AD publishing tool / TC-holder feeds and enter new ADs within the CAME time limit.'
  },
  {
    id: 'CAMO-03', scope: 'PART-M', reference: 'M.A.305(d), M.A.307', title: 'Component records and life-limited parts',
    exposition: { document: 'CAME', section: '1.3 Continuing airworthiness records' }, status: 'IMPLEMENTED',
    implementation: 'Installations and removals keep TSN/CSN; installation needs a release certificate; a scrapped serial can never be installed again; LLP limits feed the due list.',
    evidence: {
      tests: [T('packages/mro-domain/src/directive.test.ts', 'installation cannot lose time'), T('packages/mro-domain/src/nonconformity.test.ts', 'a scrapped serial can never be installed'), T('packages/mro-domain/src/maintenance.test.ts', 'life-limited part')],
      policies: ['maintenance_programme'], routes: ['/camo/components'], auditActions: ['component.installed', 'component.removed', 'component.scrapped']
    }
  },
  {
    id: 'CAMO-04', scope: 'PART-CAMO', reference: 'ORO.MLR.105; M.A.403', title: 'Defect deferral under the MEL',
    exposition: { document: 'CAME', section: '1.9 Deferred defects (MEL)' }, status: 'IMPLEMENTED',
    implementation: 'Deferral against the operator MEL with the category interval computed by the rulepack (calendar days in the operator time zone); one extension of at most the original interval, never for Cat A; expiry grounds; closure only by a CRS.',
    evidence: {
      tests: [T('packages/compliance/src/compliance.test.ts', 'Cat B: 3 calendar days'), T('packages/compliance/src/compliance.test.ts', 'Category A is never extendable'), T('packages/mro-domain/src/domain.test.ts', 'closing is idempotent for the same CRS')],
      rules: ['melDeadline', 'melExtension'], policies: ['mel_item'], routes: ['/camo/mel'], auditActions: ['mel.deferred', 'mel.extended', 'mel.expired', 'mel.closed']
    },
    organisation: 'Load the approved operator MEL (per type) in the operator profile; the MMEL/MEL approval is by the authority.'
  },
  {
    id: 'CAMO-05', scope: 'PART-CAMO', reference: 'CAMO.A.315(b)(4); AMC M.A.302(f)', title: 'Reliability programme',
    exposition: { document: 'CAME', section: '1.2.3 Reliability programme' }, status: 'SUPPORTED',
    implementation: 'Defect rates per 1000 FH by ATA chapter against alert levels; engine condition trend monitoring and oil consumption with alerts closed by an engineer with the action taken.',
    evidence: {
      tests: [T('packages/mro-domain/src/maintenance.test.ts', 'defect rate per 1000 FH'), T('packages/mro-domain/src/health.test.ts', 'an EGT step shift is flagged'), T('packages/mro-domain/src/health.test.ts', 'alert, limit and doubling')],
      policies: ['maintenance_programme', 'engine_health'], routes: ['/camo/programme', '/camo/health'], auditActions: ['engine.alert_raised', 'engine.alert_closed', 'engine.oil_uplift']
    },
    organisation: 'Set alert levels and engine trend limits from the OEM / reliability group; the reliability meeting reviews and records actions.'
  },
  {
    id: 'CAMO-06', scope: 'PART-21', reference: 'M.A.304; 21.A.433; SRM', title: 'Damage assessment and repairs',
    exposition: { document: 'CAME', section: '1.7 Modifications and repairs' }, status: 'DATA',
    implementation: 'Structural damage assessed against SRM allowable/repair limits by zone; interacting damages assessed together; damage beyond the SRM needs approved repair data recorded by engineering before a different person records the repair; temporary repairs are time-limited; open damage grounds the aircraft.',
    evidence: {
      tests: [T('packages/mro-domain/src/health.test.ts', 'allowable, repair, refer'), T('packages/mro-domain/src/health.test.ts', 'two allowable dents close together'), T('packages/mro-domain/src/health.test.ts', 'grounding: unrepaired')],
      policies: ['structural_damage'], routes: ['/camo/health'], auditActions: ['damage.recorded', 'damage.repair_data_approved', 'damage.repaired', 'damage.inspected']
    },
    organisation: 'Replace the illustrative SRM limits (camo.srm_limits) with the type SRM chapters 51–57 values.'
  },
  {
    id: 'CAMO-07', scope: 'PART-CAMO', reference: 'CAMO.A.315(b)(5); M.A.708', title: 'Maintenance planning and work packages',
    exposition: { document: 'CAME', section: '1.5 Work packages and maintenance contracts' }, status: 'IMPLEMENTED',
    implementation: 'Work packages from due items, hangar slot and parts check before release; one task card per item; the package completes only with a CRS for every item.',
    evidence: {
      tests: [T('packages/mro-domain/src/maintenance.test.ts', 'release requires slot'), T('packages/mro-domain/src/maintenance.test.ts', 'the package completes when every item has a CRS')],
      policies: ['work_package'], routes: ['/camo/work-packages'], auditActions: ['wp.created', 'wp.planned', 'wp.released']
    }
  },
  /* ------------------------------------------------------------------ Part-145 */
  {
    id: '145-01', scope: 'PART-145', reference: '145.A.30(j), 145.A.35', title: 'Certifying staff authorisation and scope',
    exposition: { document: 'MOE', section: '1.6 List of certifying staff' }, status: 'IMPLEMENTED',
    implementation: 'Company authorisations issued only within the Part-66 licence categories and type ratings (rulepack); one live authorisation per holder; suspend/reinstate/revoke with reasons; expiry swept daily.',
    evidence: {
      tests: [T('packages/org-domain/src/org.test.ts', 'issued within licence scope'), T('packages/org-domain/src/org.test.ts', 'scope beyond the Part-66 type ratings is refused'), T('packages/org-domain/src/org.test.ts', 'revoked is terminal')],
      rules: ['authorisationScope'], policies: ['personnel'], routes: ['/org/personnel'], auditActions: ['authorisation.issued', 'authorisation.expired']
    }
  },
  {
    id: '145-02', scope: 'PART-145', reference: '145.A.35(c)(d)', title: 'Recent experience and continuation training',
    exposition: { document: 'MOE', section: '3.4 Certifying staff training and currency' }, status: 'IMPLEMENTED',
    implementation: 'Six months of relevant experience in two years and continuation training every two years are checked by the rulepack at every signature; a non-current engineer cannot stamp or certify.',
    evidence: {
      tests: [T('packages/org-domain/src/org.test.ts', 'experience counts distinct months'), T('packages/mro-domain/src/domain.test.ts', 'a licensed engineer who is not current')],
      rules: ['currency'], policies: ['personnel'], routes: ['/org/personnel'], auditActions: ['training.recorded']
    }
  },
  {
    id: '145-03', scope: 'PART-145', reference: '145.A.50; 145.A.65(b)', title: 'Certificate of release to service',
    exposition: { document: 'MOE', section: '2.16 Release to service procedure' }, status: 'IMPLEMENTED',
    implementation: 'Every task-card step is stamped by a qualified, current person with a verifiable electronic signature (passkey); the CRS needs every step and then locks the card; the signed CRS document is stored with its hash.',
    evidence: {
      tests: [T('packages/mro-domain/src/domain.test.ts', 'a qualified engineer stamps steps'), T('packages/mro-domain/src/domain.test.ts', 'the CRS requires every step'), T('packages/signing/src/webauthn.test.ts', 'stored evidence re-verifies later')],
      rules: ['canCertify'], policies: ['task_card'], routes: ['/amo/task-cards', '/account/passkeys'], auditActions: ['taskcard.step_signed', 'crs.issued', 'crs.document_stored', 'passkey.registered']
    }
  },
  {
    id: '145-04', scope: 'PART-145', reference: '145.A.40', title: 'Tools and calibration',
    exposition: { document: 'MOE', section: '2.5 Tools — calibration' }, status: 'IMPLEMENTED',
    implementation: 'Tools carry a calibration due date; a step that records a tool cannot be signed with an out-of-calibration tool.',
    evidence: { tests: [T('packages/mro-domain/src/maintenance.test.ts', 'an out-of-calibration tool is refused')], policies: ['stores'], routes: ['/amo/stores'] }
  },
  {
    id: '145-05', scope: 'PART-145', reference: '145.A.42', title: 'Acceptance of components and parts',
    exposition: { document: 'MOE', section: '2.2 Acceptance of components' }, status: 'IMPLEMENTED',
    implementation: 'Parts are received only from approved suppliers, with an EASA Form 1 / FAA 8130-3 (or a CoC for standard parts) and in the ordered condition or better; unserviceable parts go through an NCR; scrapping is witnessed by a second person.',
    evidence: {
      tests: [T('packages/mro-domain/src/supply.test.ts', 'receiving: certificate, condition'), T('packages/mro-domain/src/supply.test.ts', 'approved supplier list'), T('packages/mro-domain/src/nonconformity.test.ts', 'scrapping: mutilation witnessed')],
      policies: ['procurement', 'nonconformity'], routes: ['/amo/supply', '/amo/ncr'], auditActions: ['goods.received', 'vendor.approved', 'ncr.raised', 'ncr.scrapped']
    }
  },
  {
    id: '145-06', scope: 'PART-145', reference: '145.A.45', title: 'Maintenance data and document control',
    exposition: { document: 'MOE', section: '2.8 Maintenance data and its amendment' }, status: 'SUPPORTED',
    implementation: 'Controlled documents with numbered revisions approved by a second person; the effective revision is the only one that can be acknowledged; required reading is checked before certification.',
    evidence: {
      tests: [T('packages/org-domain/src/document-control.test.ts', 'approval: second person'), T('packages/org-domain/src/document-control.test.ts', 'only the effective revision can be acknowledged')],
      policies: ['controlled_document'], routes: ['/org/documents'], auditActions: ['document_revision.drafted', 'document_revision.approved', 'document_revision.acknowledged']
    },
    organisation: 'Hold current TC-holder maintenance data (AMM, IPC, SRM, WDM) under contract; the system controls the operator’s own documents.'
  },
  {
    id: '145-07', scope: 'PART-145', reference: '145.A.55', title: 'Maintenance records',
    exposition: { document: 'MOE', section: '2.14 Maintenance records' }, status: 'IMPLEMENTED',
    implementation: 'Every regulated action is on a hash-chained, signed audit trail anchored hourly to write-once storage; documents are stored with SHA-256; records are kept beyond the 3-year minimum (no deletion path).',
    evidence: {
      tests: [T('packages/audit/src/audit.test.ts', 'editing a past record is detected'), T('packages/audit/src/evidence.test.ts', 'a pack verifies offline')],
      policies: ['audit_chain', 'document'], routes: ['/quality/audit'], auditActions: ['document.stored', 'evidence.exported']
    }
  },
  {
    id: '145-08', scope: 'PART-145', reference: '145.A.65(b); 145.A.48', title: 'Performance of maintenance and error prevention',
    exposition: { document: 'MOE', section: '2.23 Critical maintenance tasks and error-capturing' }, status: 'SUPPORTED',
    implementation: 'Step-by-step task cards with a signature per step; four-eyes on scrapping, AD closure and repair data; independent inspection is recorded as a separate step where the task card requires it.',
    evidence: { tests: [T('packages/mro-domain/src/domain.test.ts', 'a step cannot be stamped twice')], policies: ['task_card'], routes: ['/amo/task-cards'], auditActions: ['taskcard.created', 'taskcard.step_signed'] },
    organisation: 'Define the critical maintenance tasks and the independent inspection steps in the task-card templates; require the tool on steps that need one.'
  },
  {
    id: '145-09', scope: 'PART-145', reference: '145.A.47', title: 'Production planning and man-hours',
    exposition: { document: 'MOE', section: '2.22 Production planning' }, status: 'SUPPORTED',
    implementation: 'Hangar slots per bay without overlaps; parts allocation by station with shortages reported; estimated hours per task.',
    evidence: { tests: [T('packages/mro-domain/src/maintenance.test.ts', 'planning refuses a bay already booked'), T('packages/mro-domain/src/maintenance.test.ts', 'parts are allocated from the station first')], policies: ['work_package', 'stores'], routes: ['/amo/stores'] },
    organisation: 'Man-hour plan against available certifying staff (rostering of maintenance staff is not in the system).'
  },
  {
    id: '145-10', scope: 'PART-145', reference: '145.A.20, 145.A.25', title: 'Terms of approval, facilities',
    exposition: { document: 'MOE', section: '1.8–1.9 Facilities; scope of work' }, status: 'PROCEDURAL',
    implementation: 'The enterprise register records the approvals (reference, authority, scope, expiry) and warns before expiry; facilities are outside the system.',
    evidence: { policies: ['enterprise'], routes: ['/org/enterprise'] },
    organisation: 'Facilities, environment and the approval itself (Form 3) are the organisation’s; keep the approval references and expiry dates current in the enterprise register.'
  },
  /* ------------------------------------------------------------------ ORO / CAT */
  {
    id: 'ORO-01', scope: 'PART-ORO', reference: 'ORO.FTL.205–235', title: 'Flight and duty time limitations',
    exposition: { document: 'OM-A', section: '7 Flight time limitations' }, status: 'IMPLEMENTED',
    implementation: 'Every roster change (delay, recovery, roster builder) is judged by the FTL rulepack: maximum FDP by report time and sectors, cumulative duty and flight time, minimum rest, standby; commander’s discretion is flagged.',
    evidence: {
      tests: [T('packages/compliance/src/compliance.test.ts', '07:00 report, 2 sectors'), T('packages/ops-domain/src/ops.test.ts', 'three consecutive demo days are FTL-legal'), T('packages/ops-domain/src/crew-recovery.test.ts', 'airport standby beyond 4 h')],
      rules: ['maxFdpMinutes', 'rosterCheck'], policies: ['crew_roster'], routes: ['/ops/crew', '/ops/roster'], auditActions: ['crew.reassigned', 'crew_recovery.accepted']
    },
    organisation: 'The approved individual FTL scheme (CS-FTL.1 / ORO.FTL.125) values and any derogations must be configured in the operator profile.'
  },
  {
    id: 'ORO-02', scope: 'PART-ORO', reference: 'ORO.FTL.110', title: 'Rostering and publication',
    exposition: { document: 'OM-A', section: '7.1 Rostering' }, status: 'IMPLEMENTED',
    implementation: 'Roster builder (rank, rating, base, leave, standby, FTL), publication at least 14 days ahead or with a recorded reason; every later change is logged and shown to the crew member until acknowledged.',
    evidence: {
      tests: [T('packages/ops-domain/src/rostering.test.ts', 'builder covers a week legally'), T('packages/ops-domain/src/rostering.test.ts', '14-day publication notice')],
      rules: ['rosterCheck'], policies: ['crew_roster', 'crew_hub'], routes: ['/ops/roster', '/crew/me'], auditActions: ['roster.proposed', 'roster.accepted', 'roster.published']
    }
  },
  {
    id: 'ORO-03', scope: 'PART-ORO', reference: 'ORO.FTL.120', title: 'Fatigue risk management',
    exposition: { document: 'OM-A', section: '7.6 Fatigue risk management' }, status: 'SUPPORTED',
    implementation: 'Confidential fatigue reports (KSS, Samn-Perelli) reviewed by the safety office (not the reporter); a fatigue index per duty informs planning. The index is a planning aid, not a validated biomathematical model.',
    evidence: {
      tests: [T('packages/ops-domain/src/rostering.test.ts', 'WOCL minutes and fatigue bands')],
      policies: ['fatigue_report'], routes: ['/ops/fatigue'], auditActions: ['fatigue.reported', 'fatigue.reviewed']
    },
    organisation: 'An FRM approved under ORO.FTL.120 needs a validated model, an FSAG and the authority’s approval.'
  },
  {
    id: 'ORO-04', scope: 'PART-ORO', reference: 'ORO.GEN.200(a)(3); ORO.GEN.160', title: 'Safety management and occurrence reporting',
    exposition: { document: 'SMM', section: '2 Hazard identification and risk management' }, status: 'IMPLEMENTED',
    implementation: 'Occurrence reports (confidential if wished) with ICAO 5×5 risk; MOR to the authority within 72 h; intolerable risk needs an investigation; closure needs the MOR, findings and verified actions.',
    evidence: {
      tests: [T('packages/org-domain/src/safety.test.ts', 'MOR: 72 hours'), T('packages/org-domain/src/safety.test.ts', 'closure: MOR filed')],
      policies: ['occurrence', 'safety_action'], routes: ['/safety/reports', '/safety/actions'], auditActions: ['occurrence.reported', 'occurrence.triaged', 'occurrence.mor_filed', 'occurrence.closed']
    },
    organisation: 'Submit MORs through the authority’s system (ECCAIRS / national portal); the system records the reference.'
  },
  {
    id: 'ORO-05', scope: 'PART-ORO', reference: 'ORO.GEN.200(a)(6); 145.A.65(c); CAMO.A.200(a)(6)', title: 'Compliance monitoring (audits, findings, corrective actions)',
    exposition: { document: 'MOE', section: '3.1 Quality audit of procedures' }, status: 'IMPLEMENTED',
    implementation: 'Audit plan, findings by level with due dates, root cause, corrective actions completed with evidence and verified by someone else; level 1 closure by a second person.',
    evidence: {
      tests: [T('packages/org-domain/src/quality.test.ts', 'finding closure needs a root cause'), T('packages/org-domain/src/corrective-action.test.ts', 'owner completes with evidence')],
      policies: ['quality_audit', 'quality_action'], routes: ['/quality/audits', '/quality/actions'], auditActions: ['quality_audit.planned', 'finding.raised', 'finding.closed', 'corrective_action.verified']
    }
  },
  {
    id: 'CAT-01', scope: 'PART-CAT', reference: 'CAT.POL.MAB.100/105', title: 'Mass and balance, load sheet',
    exposition: { document: 'OM-A', section: '8.1.8 Mass and balance' }, status: 'DATA',
    implementation: 'Standard masses (adult 84 kg, child 35 kg, crew 85/75, bags by flight kind); ZFW/TOW/LW against structural and runway limits; CG in %MAC at ZFW, TOW and LW; 4-yearly reweighing; LMC tolerance after release.',
    evidence: {
      tests: [T('packages/ops-domain/src/dispatch.test.ts', 'standard masses, ZFW/TOW/LW'), T('packages/ops-domain/src/dispatch.test.ts', 'seats, infants and the 4-year reweighing')],
      policies: ['dispatch'], routes: ['/ops/dispatch'], auditActions: ['dispatch.released', 'dispatch.withdrawn']
    },
    organisation: 'Replace the illustrative type data (ops.aircraft_types) and weighing records with the approved Weight & Balance Manual values.'
  },
  {
    id: 'CAT-02', scope: 'PART-CAT', reference: 'CAT.OP.MPA.150, .181', title: 'Fuel policy and flight planning',
    exposition: { document: 'OM-A', section: '8.1.7 Fuel policy' }, status: 'DATA',
    implementation: 'Basic fuel scheme (taxi, trip, contingency, alternate, final reserve, extra) ≤ block; ICAO flight plan; overflight permits per route country; the release needs every check to pass.',
    evidence: {
      tests: [T('packages/ops-domain/src/dispatch.test.ts', 'basic fuel scheme'), T('packages/ops-domain/src/dispatch.test.ts', 'ICAO flight plan'), T('packages/ops-domain/src/dispatch.test.ts', 'overflight permits and the release')],
      policies: ['dispatch'], routes: ['/ops/dispatch'], auditActions: ['dispatch.fpl_filed', 'permit.recorded', 'dispatch.released']
    },
    organisation: 'Burn and holding figures from the AFM/FCOM; an individual fuel scheme needs approval.'
  },
  {
    id: 'CAT-03', scope: 'PART-CAT', reference: 'ORO.GEN.110(c); CAT.GEN.MPA.180', title: 'Operational control (movements, irregular operations)',
    exposition: { document: 'OM-A', section: '2 Operational control and supervision' }, status: 'SUPPORTED',
    implementation: 'Movement messages (MVT/ACARS) drive actual times; delays propagate along rotations; tail changes only to a dispatchable aircraft of the type; recovery proposals are checked before acceptance.',
    evidence: {
      tests: [T('packages/ops-domain/src/movement.test.ts', 'a departure MVT sets actuals'), T('packages/ops-domain/src/ops.test.ts', 'tail changes require the same type')],
      policies: ['flight', 'recovery'], routes: ['/ops/occ'], auditActions: ['flight.movement', 'flight.delayed', 'flight.tail_changed', 'recovery.accepted']
    }
  },
  /* ------------------------------------------------------------------ platform */
  {
    id: 'PLT-01', scope: 'PLATFORM', reference: 'Reg. (EU) 2018/1139 Art. 62; AMC1 145.A.55(c); ICAO Annex 6', title: 'Electronic records and signatures',
    exposition: { document: 'MOE', section: '2.14.1 Electronic record keeping' }, status: 'IMPLEMENTED',
    implementation: 'Signatures with a key held in OpenBao Transit (rotatable; old versions keep verifying) and per-person passkeys (WebAuthn) for certification; stored evidence re-verifies later; the audit chain is hash-linked and anchored to write-once storage.',
    evidence: {
      tests: [T('packages/signing/src/transit.test.ts', 'signatures from an older key version remain verifiable'), T('packages/signing/src/webauthn.test.ts', 'a signature over different content'), T('packages/audit/src/audit.test.ts', 'deleting a record breaks the next link')],
      policies: ['audit_chain'], routes: ['/quality/audit', '/account/passkeys'], auditActions: ['passkey.registered', 'passkey.revoked']
    },
    organisation: 'The authority accepts the electronic record system through the exposition (procedure, back-up, access control).'
  },
  {
    id: 'PLT-02', scope: 'PLATFORM', reference: 'ORO.GEN.220; 145.A.55(c)', title: 'Record retention, back-up and restore',
    exposition: { document: 'MOE', section: '2.14.2 Back-up and recovery of records' }, status: 'SUPPORTED',
    implementation: 'Backups of the database and object storage with a monthly restore drill that proves every audit chain recomputes, contains the head recorded at backup time and matches its signed anchor.',
    evidence: { policies: ['audit_chain'], routes: ['/quality/audit'] },
    organisation: 'Run scripts/dr/drill.sh monthly and keep the drill reports; off-site copy of the backups.'
  },
  {
    id: 'PLT-03', scope: 'PLATFORM', reference: 'ORO.GEN.140; 145.A.90 (access for the authority)', title: 'Access for the competent authority (evidence packs)',
    exposition: { document: 'MOE', section: '1.11 Notification procedure / access for the authority' }, status: 'IMPLEMENTED',
    implementation: 'Signed evidence packs per operator and period that an inspector verifies offline, with this compliance matrix and its live evidence counts inside; the export is itself recorded.',
    evidence: {
      tests: [T('packages/audit/src/evidence.test.ts', 'editing an entry, deleting a link or adding a file is detected'), T('packages/audit/src/evidence.test.ts', 'the export refuses to sign a broken')],
      policies: ['audit_chain', 'compliance_matrix'], routes: ['/quality/audit', '/quality/compliance'], auditActions: ['evidence.exported']
    }
  },
  {
    id: 'PLT-04', scope: 'PLATFORM', reference: 'Part-IS (Reg. (EU) 2023/203) IS.I.OR.205–230', title: 'Information security: access control and tenant separation',
    exposition: { document: 'MOE', section: '1.12 Information security management' }, status: 'SUPPORTED',
    implementation: 'OIDC sign-in; every action authorised by policy per operator; each module has its own database role and schema; every route is authenticated unless explicitly public and guarded (checked at build).',
    evidence: { tests: [T('checks/security.test.ts', 'every route is authenticated'), T('checks/security.test.ts', 'every request body is validated')] },
    organisation: 'Part-IS ISMS (risk assessment, incident response, penetration test) — see docs/certification/pentest-scope.md.'
  },
  {
    id: 'PLT-05', scope: 'PLATFORM', reference: 'ORO.GEN.200(a)(1)', title: 'Rulepack approval (compliance engine)',
    exposition: { document: '—', section: 'Compliance engine change control' }, status: 'PROCEDURAL',
    implementation: 'Rulepacks are versioned and effective-dated; every decision records the rulepack version and basis; draft rulepacks (FAA) are refused outside development until approved.',
    evidence: { tests: [T('packages/compliance/src/compliance.test.ts', 'the decision records the rulepack version')], rules: ['melDeadline', 'canCertify'] },
    organisation: 'A qualified compliance person reviews and approves each rulepack version (the FAA rulepack is a draft) before use.'
  }
];

/** The illustrative data that must be replaced with the operator's approved data before operational use. */
export const DATA_TO_REPLACE: { table: string; what: string; source: string }[] = [
  { table: 'ops.aircraft_types', what: 'Mass & balance and performance type data', source: 'Approved Weight & Balance Manual, AFM/FCOM' },
  { table: 'ops.aircraft_weights', what: 'Basic empty mass and arm per aircraft', source: 'Last weighing report' },
  { table: 'ops.runway_limits', what: 'Regulated take-off / landing weights', source: 'Performance department (RTOW charts)' },
  { table: 'ops.routes, ops.permit_rules', what: 'Routes, cruise levels, overflight permit requirements', source: 'Flight planning provider, AIPs' },
  { table: 'camo.requirements', what: 'Maintenance programme tasks and intervals', source: 'Approved AMP' },
  { table: 'camo.srm_limits', what: 'Structural damage allowable and repair limits', source: 'Type SRM chapters 51–57' },
  { table: 'camo.engine_types', what: 'Engine trend and oil consumption limits', source: 'Engine manufacturer ECTM guidance, AMM' },
  { table: 'operator profile (MEL)', what: 'Operator MEL items and categories', source: 'Approved operator MEL' },
  { table: 'compliance rulepacks', what: 'FTL scheme values, FAA rulepack', source: 'Approved FTL scheme; review by a qualified compliance person' }
];

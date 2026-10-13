import { boolean, date, integer, jsonb, pgSchema, primaryKey, serial, text, timestamp } from 'drizzle-orm/pg-core';

const org = pgSchema('org');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const personnel = org.table('personnel', {
  id: text('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  username: text('username').notNull(),
  name: text('name').notNull(),
  licenceNo: text('licence_no'),
  active: boolean('active').notNull(),
  roleTitle: text('role_title'),
  base: text('base')
});

export const privileges = org.table('privileges', {
  id: serial('id').primaryKey(),
  personnelId: text('personnel_id').notNull(),
  authority: text('authority').notNull(),
  category: text('category').notNull(),
  typeRatings: text('type_ratings').array().notNull(),
  validUntil: ts('valid_until').notNull()
});

export interface StoredHistoryEntry { at: string; action: string; by: string; reason: string | null }

export const authorisations = org.table('authorisations', {
  id: text('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  personnelId: text('personnel_id').notNull(),
  reference: text('reference').notNull(),
  aircraftTypes: text('aircraft_types').array().notNull(),
  issuedAt: ts('issued_at').notNull(),
  validUntil: ts('valid_until').notNull(),
  status: text('status').notNull(),
  issueRule: text('issue_rule').notNull(),
  history: jsonb('history').$type<StoredHistoryEntry[]>().notNull(),
  version: integer('version').notNull()
});

export const trainingRecords = org.table('training_records', {
  id: text('id').primaryKey(),
  personnelId: text('personnel_id').notNull(),
  course: text('course').notNull(),
  title: text('title').notNull(),
  completedAt: ts('completed_at').notNull(),
  recordedBy: text('recorded_by').notNull(),
  recordedAt: ts('recorded_at').notNull().defaultNow()
});

export const experienceLog = org.table('experience_log', {
  personnelId: text('personnel_id').notNull(),
  workAt: ts('work_at').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  detail: text('detail')
}, t => ({ pk: primaryKey({ columns: [t.personnelId, t.sourceType, t.sourceId] }) }));

export const expiryNotices = org.table('expiry_notices', {
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(),
  level: text('level').notNull(),
  validUntil: ts('valid_until').notNull(),
  notifiedAt: ts('notified_at').notNull().defaultNow()
}, t => ({ pk: primaryKey({ columns: [t.subjectType, t.subjectId, t.level, t.validUntil] }) }));

/* ------------------------------------------------------------------ document & manual control (round 9) */

export const controlledDocuments = org.table('controlled_documents', {
  id: text('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  code: text('code').notNull(),
  title: text('title').notNull(),
  category: text('category').notNull(),
  owner: text('owner').notNull(),
  audience: text('audience').array().notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  requiredForCertification: boolean('required_for_certification').notNull().default(false)
});

export const documentRevisions = org.table('document_revisions', {
  documentId: text('document_id').notNull(),
  revision: integer('revision').notNull(),
  operatorId: text('operator_id').notNull(),
  status: text('status').notNull(),
  summary: text('summary').notNull(),
  effectiveFrom: date('effective_from', { mode: 'string' }),
  authoredBy: text('authored_by').notNull(),
  authoredAt: ts('authored_at').notNull().defaultNow(),
  approvedBy: text('approved_by'),
  approvedAt: ts('approved_at'),
  fileDocumentId: text('file_document_id'),
  fileSha256: text('file_sha256')
}, t => ({ pk: primaryKey({ columns: [t.documentId, t.revision] }) }));

export const documentReads = org.table('document_reads', {
  documentId: text('document_id').notNull(),
  revision: integer('revision').notNull(),
  username: text('username').notNull(),
  name: text('name').notNull(),
  readAt: ts('read_at').notNull().defaultNow()
}, t => ({ pk: primaryKey({ columns: [t.documentId, t.revision, t.username] }) }));

/* ------------------------------------------------------------------ safety & quality (round 10) */

export const occurrences = org.table('occurrences', {
  id: text('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  reportedAt: ts('reported_at').notNull().defaultNow(),
  reportedBy: text('reported_by').notNull(),
  confidential: boolean('confidential').notNull(),
  occurredAt: ts('occurred_at').notNull(),
  station: text('station'),
  tail: text('tail'),
  flightNo: text('flight_no'),
  category: text('category').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull(),
  mandatory: boolean('mandatory').notNull(),
  authorityReportedAt: ts('authority_reported_at'),
  authorityRef: text('authority_ref'),
  probability: integer('probability'),
  severity: text('severity'),
  investigator: text('investigator'),
  findings: text('findings'),
  residualProbability: integer('residual_probability'),
  residualSeverity: text('residual_severity'),
  triagedBy: text('triaged_by'),
  triagedAt: ts('triaged_at'),
  closedBy: text('closed_by'),
  closedAt: ts('closed_at'),
  version: integer('version').notNull()
});

export const qualityAudits = org.table('quality_audits', {
  id: text('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  title: text('title').notNull(),
  area: text('area').notNull(),
  reference: text('reference').notNull(),
  plannedFor: date('planned_for', { mode: 'string' }).notNull(),
  leadAuditor: text('lead_auditor').notNull(),
  status: text('status').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  closedAt: ts('closed_at')
});

export const findings = org.table('findings', {
  id: text('id').primaryKey(),
  auditId: text('audit_id').notNull(),
  operatorId: text('operator_id').notNull(),
  level: text('level').notNull(),
  requirement: text('requirement').notNull(),
  description: text('description').notNull(),
  likelihood: integer('likelihood'),
  impact: integer('impact'),
  riskScore: integer('risk_score'),
  riskClass: text('risk_class'),
  classificationBasis: text('classification_basis'),
  containmentAction: text('containment_action'),
  recurrence: boolean('recurrence').notNull().default(false),
  rootCause: text('root_cause'),
  raisedBy: text('raised_by').notNull(),
  raisedAt: ts('raised_at').notNull().defaultNow(),
  due: ts('due').notNull(),
  status: text('status').notNull(),
  closedBy: text('closed_by'),
  closedAt: ts('closed_at'),
  version: integer('version').notNull()
});

export const correctiveActions = org.table('corrective_actions', {
  id: text('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  description: text('description').notNull(),
  owner: text('owner').notNull(),
  due: date('due', { mode: 'string' }).notNull(),
  status: text('status').notNull(),
  evidence: text('evidence'),
  doneBy: text('done_by'),
  doneAt: ts('done_at'),
  verifiedBy: text('verified_by'),
  verifiedAt: ts('verified_at'),
  createdBy: text('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  version: integer('version').notNull()
});

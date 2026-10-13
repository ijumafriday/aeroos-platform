-- AeroOS 0.45.0 — Quality domain completion.
-- Risk-based audit programme, surveillance execution, auditor competence/independence,
-- finding due-date governance and assurance trend review.

CREATE TABLE org.quality_programmes (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  programme_year integer NOT NULL CHECK (programme_year BETWEEN 2000 AND 2200),
  title text NOT NULL,
  scope text NOT NULL,
  objectives text NOT NULL,
  risk_basis text NOT NULL,
  owner text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEW','APPROVED','ACTIVE','CLOSED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_by text,
  submitted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  activated_by text,
  activated_at timestamptz,
  closed_by text,
  closed_at timestamptz,
  UNIQUE(operator_id, programme_year, title)
);

CREATE TABLE org.quality_programme_items (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  programme_id text NOT NULL REFERENCES org.quality_programmes(id) ON DELETE CASCADE,
  surveillance_type text NOT NULL CHECK (surveillance_type IN ('INTERNAL','REGULATORY','CUSTOMER','SUPPLIER','STATION','PRODUCT','PROCESS')),
  subject text NOT NULL,
  area text NOT NULL,
  requirement_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_score integer NOT NULL CHECK (risk_score BETWEEN 1 AND 25),
  frequency text NOT NULL,
  planned_start date NOT NULL,
  planned_end date NOT NULL,
  lead_auditor text,
  linked_audit_id text,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','SCHEDULED','IN_PROGRESS','COMPLETE','CANCELLED')),
  cancellation_reason text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (planned_end >= planned_start)
);

CREATE TABLE org.quality_auditor_qualifications (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  username text NOT NULL,
  scope text NOT NULL,
  qualification_ref text NOT NULL,
  valid_from date NOT NULL,
  valid_until date NOT NULL,
  independence_restrictions jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','SUSPENDED','EXPIRED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  suspension_reason text,
  CHECK (valid_until >= valid_from),
  UNIQUE(operator_id, username, scope, qualification_ref)
);

CREATE TABLE org.quality_auditor_assignments (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  programme_item_id text NOT NULL REFERENCES org.quality_programme_items(id) ON DELETE CASCADE,
  username text NOT NULL,
  role text NOT NULL CHECK (role IN ('LEAD','MEMBER','OBSERVER')),
  qualification_id text REFERENCES org.quality_auditor_qualifications(id),
  independence_declaration text NOT NULL,
  conflict_of_interest boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','APPROVED','REJECTED')),
  proposed_by text NOT NULL,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  rejection_reason text,
  UNIQUE(operator_id, programme_item_id, username, role)
);

CREATE TABLE org.quality_surveillance_visits (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  programme_item_id text NOT NULL REFERENCES org.quality_programme_items(id) ON DELETE CASCADE,
  location text NOT NULL,
  sample_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  sample_size integer NOT NULL CHECK (sample_size > 0),
  samples_checked integer NOT NULL DEFAULT 0 CHECK (samples_checked >= 0),
  exceptions_count integer NOT NULL DEFAULT 0 CHECK (exceptions_count >= 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','IN_PROGRESS','COMPLETE','REVIEWED')),
  started_by text,
  started_at timestamptz,
  completed_by text,
  completed_at timestamptz,
  evidence_ref text,
  conclusion text,
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (samples_checked <= sample_size)
);

CREATE TABLE org.quality_checklist_results (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  visit_id text NOT NULL REFERENCES org.quality_surveillance_visits(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  requirement text NOT NULL,
  question text NOT NULL,
  result text NOT NULL CHECK (result IN ('COMPLIANT','NONCOMPLIANT','NOT_APPLICABLE','OBSERVATION')),
  evidence_ref text,
  note text,
  finding_id text,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id, visit_id, sequence)
);

CREATE TABLE org.quality_finding_extensions (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  finding_id text NOT NULL REFERENCES org.findings(id) ON DELETE CASCADE,
  original_due timestamptz NOT NULL,
  requested_due timestamptz NOT NULL,
  rationale text NOT NULL,
  requested_by text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','REJECTED')),
  approved_by text,
  approved_at timestamptz,
  decision_note text,
  CHECK (requested_due > original_due)
);

CREATE TABLE org.quality_assurance_trends (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  period text NOT NULL,
  metric text NOT NULL,
  scope text NOT NULL,
  numerator numeric(18,4) NOT NULL,
  denominator numeric(18,4) NOT NULL CHECK (denominator > 0),
  rate numeric(18,6) NOT NULL,
  threshold numeric(18,6) NOT NULL,
  direction text NOT NULL CHECK (direction IN ('ABOVE_BAD','BELOW_BAD')),
  state text NOT NULL CHECK (state IN ('NORMAL','WATCH','BREACH')),
  source_sha256 char(64) NOT NULL,
  action_ref text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','SUPERSEDED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  UNIQUE(operator_id, period, metric, scope, status)
);

CREATE TABLE org.quality_management_reviews (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  review_period text NOT NULL,
  meeting_date date NOT NULL,
  chair text NOT NULL,
  programme_coverage_pct numeric(6,2) NOT NULL CHECK (programme_coverage_pct BETWEEN 0 AND 100),
  overdue_findings integer NOT NULL CHECK (overdue_findings >= 0),
  repeated_findings integer NOT NULL CHECK (repeated_findings >= 0),
  breached_trends integer NOT NULL CHECK (breached_trends >= 0),
  conclusions text NOT NULL,
  actions_ref text,
  evidence_sha256 char(64) NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','CLOSED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  closed_by text,
  closed_at timestamptz,
  UNIQUE(operator_id, review_period)
);

CREATE INDEX quality_programme_status_idx ON org.quality_programmes(operator_id, programme_year, status);
CREATE INDEX quality_programme_item_due_idx ON org.quality_programme_items(operator_id, status, planned_start, risk_score DESC);
CREATE INDEX quality_auditor_validity_idx ON org.quality_auditor_qualifications(operator_id, username, status, valid_until);
CREATE INDEX quality_surveillance_status_idx ON org.quality_surveillance_visits(operator_id, status, created_at DESC);
CREATE INDEX quality_extension_status_idx ON org.quality_finding_extensions(operator_id, status, requested_at DESC);
CREATE INDEX quality_trend_period_idx ON org.quality_assurance_trends(operator_id, period, state);

GRANT SELECT,INSERT,UPDATE ON org.quality_programmes,org.quality_programme_items,org.quality_auditor_qualifications,org.quality_auditor_assignments,org.quality_surveillance_visits,org.quality_checklist_results,org.quality_finding_extensions,org.quality_assurance_trends,org.quality_management_reviews TO org_svc;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['quality_programmes','quality_programme_items','quality_auditor_qualifications','quality_auditor_assignments','quality_surveillance_visits','quality_checklist_results','quality_finding_extensions','quality_assurance_trends','quality_management_reviews'] LOOP
    EXECUTE format('ALTER TABLE org.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE org.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY aeroos_tenant_isolation ON org.%I USING (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), '''')) WITH CHECK (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), ''''))',t);
  END LOOP;
END $$;

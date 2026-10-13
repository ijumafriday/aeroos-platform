-- AeroOS 0.47.0 — Compliance / regulatory governance completion.
-- Multi-authority profiles, applicability, regulatory change control, evidence and review governance.

CREATE TABLE compliance.authority_profiles (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  authority_code text NOT NULL,
  jurisdiction text NOT NULL,
  approval_number text,
  approval_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  rulepack_id text,
  source_ref text NOT NULL,
  source_revision text NOT NULL,
  source_sha256 char(64) NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEW','APPROVED','ACTIVE','SUSPENDED','SUPERSEDED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_by text,
  submitted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  activated_by text,
  activated_at timestamptz,
  UNIQUE(operator_id, authority_code, source_revision),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE compliance.regulatory_requirements (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  authority_profile_id text NOT NULL REFERENCES compliance.authority_profiles(id),
  requirement_ref text NOT NULL,
  title text NOT NULL,
  requirement_text text NOT NULL,
  domain text NOT NULL,
  compliance_method text NOT NULL,
  exposition_ref text,
  evidence_expectation text NOT NULL,
  criticality text NOT NULL CHECK (criticality IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  effective_from date NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEW','APPROVED','RETIRED')),
  source_sha256 char(64) NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  UNIQUE(operator_id, authority_profile_id, requirement_ref, effective_from)
);

CREATE TABLE compliance.requirement_applicability (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  requirement_id text NOT NULL REFERENCES compliance.regulatory_requirements(id) ON DELETE CASCADE,
  scope_type text NOT NULL CHECK (scope_type IN ('OPERATOR','AOC','AMO','CAMO','AIRCRAFT_TYPE','TAIL','STATION','ROUTE','PROCESS','SUPPLIER')),
  scope_ref text NOT NULL,
  determination text NOT NULL CHECK (determination IN ('APPLICABLE','NOT_APPLICABLE','CONDITIONAL')),
  rationale text NOT NULL,
  condition_text text,
  owner text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','SUPERSEDED')),
  determined_by text NOT NULL,
  determined_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  UNIQUE(operator_id, requirement_id, scope_type, scope_ref, status)
);

CREATE TABLE compliance.requirement_evidence (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  requirement_id text NOT NULL REFERENCES compliance.regulatory_requirements(id) ON DELETE CASCADE,
  applicability_id text REFERENCES compliance.requirement_applicability(id),
  evidence_type text NOT NULL CHECK (evidence_type IN ('PROCEDURE','RECORD','SYSTEM_CONTROL','TEST','TRAINING','AUDIT','AUTHORITY_ACCEPTANCE','OTHER')),
  evidence_ref text NOT NULL,
  evidence_sha256 char(64) NOT NULL,
  observed_on date NOT NULL,
  valid_until date,
  conclusion text NOT NULL,
  status text NOT NULL DEFAULT 'RECORDED' CHECK (status IN ('RECORDED','VERIFIED','SUPERSEDED','EXPIRED')),
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  verified_by text,
  verified_at timestamptz,
  CHECK (valid_until IS NULL OR valid_until >= observed_on)
);

CREATE TABLE compliance.regulatory_changes (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  authority_profile_id text NOT NULL REFERENCES compliance.authority_profiles(id),
  change_ref text NOT NULL,
  title text NOT NULL,
  publication_date date NOT NULL,
  effective_date date NOT NULL,
  source_ref text NOT NULL,
  source_sha256 char(64) NOT NULL,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'INTAKE' CHECK (status IN ('INTAKE','ASSESSMENT','ACTION','READY','IMPLEMENTED','CLOSED','NOT_APPLICABLE')),
  owner text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_by text,
  closed_at timestamptz,
  CHECK (effective_date >= publication_date),
  UNIQUE(operator_id, authority_profile_id, change_ref)
);

CREATE TABLE compliance.regulatory_change_assessments (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  change_id text NOT NULL REFERENCES compliance.regulatory_changes(id) ON DELETE CASCADE,
  affected_domains jsonb NOT NULL DEFAULT '[]'::jsonb,
  affected_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  impact_level text NOT NULL CHECK (impact_level IN ('NONE','LOW','MEDIUM','HIGH','CRITICAL')),
  gap_analysis text NOT NULL,
  implementation_plan text NOT NULL,
  action_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  due_date date,
  residual_risk text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEW','APPROVED','IMPLEMENTED')),
  assessed_by text NOT NULL,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  implemented_by text,
  implemented_at timestamptz
);

CREATE TABLE compliance.compliance_reviews (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  authority_profile_id text REFERENCES compliance.authority_profiles(id),
  review_period text NOT NULL,
  review_scope text NOT NULL,
  review_date date NOT NULL,
  chair text NOT NULL,
  requirements_reviewed integer NOT NULL CHECK (requirements_reviewed >= 0),
  evidence_verified integer NOT NULL CHECK (evidence_verified >= 0),
  gaps_open integer NOT NULL CHECK (gaps_open >= 0),
  overdue_changes integer NOT NULL CHECK (overdue_changes >= 0),
  conclusions text NOT NULL,
  action_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  acceptance_evidence_ref text,
  evidence_sha256 char(64) NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','CLOSED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  closed_by text,
  closed_at timestamptz
);

CREATE INDEX authority_profiles_operator_idx ON compliance.authority_profiles(operator_id,status);
CREATE INDEX regulatory_requirements_operator_idx ON compliance.regulatory_requirements(operator_id,authority_profile_id,status);
CREATE INDEX requirement_applicability_operator_idx ON compliance.requirement_applicability(operator_id,requirement_id,status);
CREATE INDEX requirement_evidence_operator_idx ON compliance.requirement_evidence(operator_id,requirement_id,status);
CREATE INDEX regulatory_changes_operator_idx ON compliance.regulatory_changes(operator_id,authority_profile_id,status,effective_date);
CREATE INDEX compliance_reviews_operator_idx ON compliance.compliance_reviews(operator_id,review_date,status);

ALTER TABLE compliance.authority_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.authority_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.regulatory_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.regulatory_requirements FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.requirement_applicability ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.requirement_applicability FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.requirement_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.requirement_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.regulatory_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.regulatory_changes FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.regulatory_change_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.regulatory_change_assessments FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.compliance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.compliance_reviews FORCE ROW LEVEL SECURITY;

CREATE POLICY authority_profiles_tenant ON compliance.authority_profiles USING (operator_id = current_setting('app.operator_id', true));
CREATE POLICY regulatory_requirements_tenant ON compliance.regulatory_requirements USING (operator_id = current_setting('app.operator_id', true));
CREATE POLICY requirement_applicability_tenant ON compliance.requirement_applicability USING (operator_id = current_setting('app.operator_id', true));
CREATE POLICY requirement_evidence_tenant ON compliance.requirement_evidence USING (operator_id = current_setting('app.operator_id', true));
CREATE POLICY regulatory_changes_tenant ON compliance.regulatory_changes USING (operator_id = current_setting('app.operator_id', true));
CREATE POLICY regulatory_change_assessments_tenant ON compliance.regulatory_change_assessments USING (operator_id = current_setting('app.operator_id', true));
CREATE POLICY compliance_reviews_tenant ON compliance.compliance_reviews USING (operator_id = current_setting('app.operator_id', true));

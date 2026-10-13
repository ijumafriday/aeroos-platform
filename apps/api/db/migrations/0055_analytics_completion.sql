-- AeroOS 0.48.0 — Analytics / governed reporting completion.
-- Adds a tenant-isolated semantic layer, controlled dataset snapshots, report definitions/runs and schedules.
-- Also corrects the 0.47.0 compliance RLS setting name to match the platform tenant context.

CREATE TABLE platform.analytics_datasets (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  domain text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('DOMAIN_API','IMPORT','MANUAL_SNAPSHOT')),
  source_ref text NOT NULL,
  grain text NOT NULL,
  schema_definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  owner text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEW','APPROVED','SUSPENDED','RETIRED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  UNIQUE(operator_id, code)
);

CREATE TABLE platform.analytics_dataset_snapshots (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  dataset_id text NOT NULL REFERENCES platform.analytics_datasets(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL,
  period_from date,
  period_to date,
  row_count integer NOT NULL CHECK (row_count >= 0),
  rows jsonb NOT NULL,
  source_sha256 char(64) NOT NULL,
  schema_sha256 char(64) NOT NULL,
  status text NOT NULL DEFAULT 'RECORDED' CHECK (status IN ('RECORDED','VERIFIED','SUPERSEDED','REJECTED')),
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  verified_by text,
  verified_at timestamptz,
  CHECK (period_to IS NULL OR period_from IS NULL OR period_to >= period_from)
);

CREATE TABLE platform.analytics_semantic_models (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  dataset_id text NOT NULL REFERENCES platform.analytics_datasets(id),
  description text NOT NULL,
  dimensions jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_filters jsonb NOT NULL DEFAULT '[]'::jsonb,
  row_level_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEW','APPROVED','ACTIVE','SUPERSEDED','RETIRED')),
  definition_sha256 char(64) NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_by text,
  submitted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  activated_by text,
  activated_at timestamptz,
  UNIQUE(operator_id, code, revision)
);

CREATE TABLE platform.analytics_reports (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  semantic_model_id text NOT NULL REFERENCES platform.analytics_semantic_models(id),
  description text NOT NULL,
  visualization text NOT NULL CHECK (visualization IN ('TABLE','KPI','BAR','LINE','AREA','PIE')),
  dimensions jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '[]'::jsonb,
  filters jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_definition jsonb NOT NULL DEFAULT '[]'::jsonb,
  limit_rows integer NOT NULL DEFAULT 500 CHECK (limit_rows BETWEEN 1 AND 5000),
  drilldown_dimensions jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEW','APPROVED','ACTIVE','RETIRED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_by text,
  submitted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  activated_by text,
  activated_at timestamptz,
  UNIQUE(operator_id, code)
);

CREATE TABLE platform.analytics_report_versions (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  report_id text NOT NULL REFERENCES platform.analytics_reports(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  definition jsonb NOT NULL,
  definition_sha256 char(64) NOT NULL,
  change_note text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id, report_id, version)
);

CREATE TABLE platform.analytics_report_runs (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  report_id text NOT NULL REFERENCES platform.analytics_reports(id),
  report_version_id text NOT NULL REFERENCES platform.analytics_report_versions(id),
  snapshot_id text NOT NULL REFERENCES platform.analytics_dataset_snapshots(id),
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  row_count integer NOT NULL CHECK (row_count >= 0),
  result_sha256 char(64) NOT NULL,
  status text NOT NULL CHECK (status IN ('SUCCEEDED','FAILED')),
  error_code text,
  requested_by text NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL
);

CREATE TABLE platform.analytics_report_schedules (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  report_id text NOT NULL REFERENCES platform.analytics_reports(id) ON DELETE CASCADE,
  name text NOT NULL,
  cadence text NOT NULL CHECK (cadence IN ('DAILY','WEEKLY','MONTHLY')),
  timezone text NOT NULL,
  delivery_channel text NOT NULL CHECK (delivery_channel IN ('IN_APP','EMAIL','WEBHOOK')),
  delivery_target text NOT NULL,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  next_run_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz
);

CREATE INDEX analytics_datasets_operator_idx ON platform.analytics_datasets(operator_id,status,domain);
CREATE INDEX analytics_snapshots_operator_idx ON platform.analytics_dataset_snapshots(operator_id,dataset_id,captured_at DESC);
CREATE INDEX analytics_models_operator_idx ON platform.analytics_semantic_models(operator_id,status,code);
CREATE INDEX analytics_reports_operator_idx ON platform.analytics_reports(operator_id,status,code);
CREATE INDEX analytics_runs_operator_idx ON platform.analytics_report_runs(operator_id,report_id,completed_at DESC);
CREATE INDEX analytics_schedules_operator_idx ON platform.analytics_report_schedules(operator_id,active,next_run_at);

ALTER TABLE platform.analytics_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.analytics_datasets FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.analytics_dataset_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.analytics_dataset_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.analytics_semantic_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.analytics_semantic_models FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.analytics_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.analytics_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.analytics_report_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.analytics_report_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.analytics_report_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.analytics_report_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.analytics_report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.analytics_report_schedules FORCE ROW LEVEL SECURITY;

CREATE POLICY aeroos_tenant_isolation ON platform.analytics_datasets
  USING (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),''))
  WITH CHECK (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),''));
CREATE POLICY aeroos_tenant_isolation ON platform.analytics_dataset_snapshots
  USING (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),''))
  WITH CHECK (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),''));
CREATE POLICY aeroos_tenant_isolation ON platform.analytics_semantic_models
  USING (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),''))
  WITH CHECK (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),''));
CREATE POLICY aeroos_tenant_isolation ON platform.analytics_reports
  USING (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),''))
  WITH CHECK (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),''));
CREATE POLICY aeroos_tenant_isolation ON platform.analytics_report_versions
  USING (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),''))
  WITH CHECK (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),''));
CREATE POLICY aeroos_tenant_isolation ON platform.analytics_report_runs
  USING (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),''))
  WITH CHECK (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),''));
CREATE POLICY aeroos_tenant_isolation ON platform.analytics_report_schedules
  USING (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),''))
  WITH CHECK (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),''));

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.analytics_datasets, platform.analytics_dataset_snapshots, platform.analytics_semantic_models, platform.analytics_reports, platform.analytics_report_versions, platform.analytics_report_runs, platform.analytics_report_schedules TO platform_svc;

-- Correct 0.47.0 compliance RLS policy setting names to match TenantContextInterceptor / ModuleDb.
DROP POLICY IF EXISTS authority_profiles_tenant ON compliance.authority_profiles;
DROP POLICY IF EXISTS regulatory_requirements_tenant ON compliance.regulatory_requirements;
DROP POLICY IF EXISTS requirement_applicability_tenant ON compliance.requirement_applicability;
DROP POLICY IF EXISTS requirement_evidence_tenant ON compliance.requirement_evidence;
DROP POLICY IF EXISTS regulatory_changes_tenant ON compliance.regulatory_changes;
DROP POLICY IF EXISTS regulatory_change_assessments_tenant ON compliance.regulatory_change_assessments;
DROP POLICY IF EXISTS compliance_reviews_tenant ON compliance.compliance_reviews;
CREATE POLICY aeroos_tenant_isolation ON compliance.authority_profiles USING (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),'')) WITH CHECK (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),''));
CREATE POLICY aeroos_tenant_isolation ON compliance.regulatory_requirements USING (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),'')) WITH CHECK (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),''));
CREATE POLICY aeroos_tenant_isolation ON compliance.requirement_applicability USING (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),'')) WITH CHECK (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),''));
CREATE POLICY aeroos_tenant_isolation ON compliance.requirement_evidence USING (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),'')) WITH CHECK (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),''));
CREATE POLICY aeroos_tenant_isolation ON compliance.regulatory_changes USING (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),'')) WITH CHECK (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),''));
CREATE POLICY aeroos_tenant_isolation ON compliance.regulatory_change_assessments USING (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),'')) WITH CHECK (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),''));
CREATE POLICY aeroos_tenant_isolation ON compliance.compliance_reviews USING (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),'')) WITH CHECK (current_setting('aeroos.system', true)='true' OR operator_id=NULLIF(current_setting('aeroos.operator_id', true),''));

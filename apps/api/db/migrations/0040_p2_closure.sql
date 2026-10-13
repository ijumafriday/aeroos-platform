-- AeroOS 0.29: P2 closure.
-- Cross-domain user workspace views and Commercial/Finance ERP handoff/reconciliation.

CREATE TABLE platform.user_views (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  subject text NOT NULL,
  route text NOT NULL,
  name text NOT NULL,
  search jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id, subject, route, name)
);
CREATE INDEX user_views_subject_route_idx ON platform.user_views(operator_id, subject, route, updated_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.user_views TO platform_svc;
ALTER TABLE platform.user_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY aeroos_tenant_isolation ON platform.user_views
  USING (current_setting('aeroos.system', true)='true' OR operator_id=nullif(current_setting('aeroos.operator_id', true),''))
  WITH CHECK (current_setting('aeroos.system', true)='true' OR operator_id=nullif(current_setting('aeroos.operator_id', true),''));

CREATE TABLE org.erp_profiles (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  entity_id text NOT NULL REFERENCES org.legal_entities(id),
  name text NOT NULL,
  format text NOT NULL CHECK (format IN ('CSV_JOURNAL_V1','JSON_JOURNAL_V1')),
  account_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_centre_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id, entity_id, name)
);

CREATE TABLE org.erp_export_batches (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  entity_id text NOT NULL REFERENCES org.legal_entities(id),
  profile_id uuid NOT NULL REFERENCES org.erp_profiles(id),
  period text NOT NULL CHECK (period ~ '^\\d{4}-\\d{2}$'),
  format text NOT NULL CHECK (format IN ('CSV_JOURNAL_V1','JSON_JOURNAL_V1')),
  status text NOT NULL DEFAULT 'GENERATED' CHECK (status IN ('GENERATED','ACKNOWLEDGED','REJECTED')),
  content text NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  journal_count integer NOT NULL CHECK (journal_count >= 0),
  debit_cents bigint NOT NULL CHECK (debit_cents >= 0),
  credit_cents bigint NOT NULL CHECK (credit_cents >= 0),
  generated_by text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  acknowledgement_ref text,
  acknowledgement_note text,
  acknowledged_by text,
  acknowledged_at timestamptz
);
CREATE INDEX erp_export_batches_idx ON org.erp_export_batches(operator_id, entity_id, period, generated_at DESC);

GRANT SELECT, INSERT, UPDATE ON org.erp_profiles, org.erp_export_batches TO org_svc;
ALTER TABLE org.erp_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.erp_export_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY aeroos_tenant_isolation ON org.erp_profiles
  USING (current_setting('aeroos.system', true)='true' OR operator_id=nullif(current_setting('aeroos.operator_id', true),''))
  WITH CHECK (current_setting('aeroos.system', true)='true' OR operator_id=nullif(current_setting('aeroos.operator_id', true),''));
CREATE POLICY aeroos_tenant_isolation ON org.erp_export_batches
  USING (current_setting('aeroos.system', true)='true' OR operator_id=nullif(current_setting('aeroos.operator_id', true),''))
  WITH CHECK (current_setting('aeroos.system', true)='true' OR operator_id=nullif(current_setting('aeroos.operator_id', true),''));

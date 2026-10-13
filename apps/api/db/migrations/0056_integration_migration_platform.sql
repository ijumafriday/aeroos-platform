-- AeroOS 0.49.0 — Integration & Migration Platform completion.
-- Additive governance for incumbent migration adapters, connector lifecycle,
-- API deprecation, event-schema compatibility and Temporal workflow versions.

CREATE TABLE platform.migration_adapter_profiles (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  code text NOT NULL,
  source_system text NOT NULL CHECK (source_system IN ('AMOS','TRAX','RAMCO','SAP','EXCEL','GENERIC_CSV')),
  source_version text NOT NULL,
  target_domain text NOT NULL,
  target_entity text NOT NULL,
  mapping_version integer NOT NULL DEFAULT 1 CHECK (mapping_version > 0),
  mappings jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  sample_sha256 char(64),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEW','APPROVED','RETIRED')),
  owner text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_by text,
  submitted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  UNIQUE(operator_id, code, mapping_version)
);

CREATE TABLE platform.connector_catalog (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('ERP','DCS','EFB','WEATHER_NOTAM','IDENTITY','MESSAGING','MRO','OTHER')),
  provider text NOT NULL,
  protocol text NOT NULL CHECK (protocol IN ('REST','SOAP','SFTP','KAFKA','AMQP','SMTP','OIDC','FILE')),
  auth_type text NOT NULL CHECK (auth_type IN ('OAUTH2','MTLS','API_KEY','BASIC','SSH_KEY','NONE')),
  direction text NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND','BIDIRECTIONAL')),
  owner text NOT NULL,
  support_tier text NOT NULL CHECK (support_tier IN ('EXPERIMENTAL','SUPPORTED','CERTIFIED')),
  data_classes text[] NOT NULL DEFAULT '{}',
  lifecycle_status text NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle_status IN ('DRAFT','REVIEW','APPROVED','RETIRED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  UNIQUE(operator_id, code)
);

CREATE TABLE platform.connector_instances (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  connector_id uuid NOT NULL REFERENCES platform.connector_catalog(id),
  name text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('SANDBOX','TEST','PRODUCTION')),
  endpoint_ref text NOT NULL,
  credential_ref text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'INACTIVE' CHECK (status IN ('INACTIVE','PENDING_APPROVAL','ACTIVE','DEGRADED','SUSPENDED')),
  last_health_status text CHECK (last_health_status IN ('HEALTHY','DEGRADED','FAILED','UNKNOWN')),
  last_health_at timestamptz,
  last_error text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  UNIQUE(operator_id, connector_id, name, environment)
);

CREATE TABLE platform.connector_health_checks (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  instance_id uuid NOT NULL REFERENCES platform.connector_instances(id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('HEALTHY','DEGRADED','FAILED')),
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  detail text,
  checked_by text NOT NULL
);

CREATE TABLE platform.api_lifecycle_policies (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  api_name text NOT NULL,
  route_prefix text NOT NULL,
  major_version integer NOT NULL CHECK (major_version > 0),
  stability text NOT NULL CHECK (stability IN ('EXPERIMENTAL','BETA','STABLE')),
  compatibility_mode text NOT NULL CHECK (compatibility_mode IN ('BACKWARD','STRICT')),
  deprecation_window_days integer NOT NULL CHECK (deprecation_window_days >= 30),
  effective_from date NOT NULL,
  deprecated_at timestamptz,
  sunset_at timestamptz,
  replacement_ref text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEW','APPROVED','DEPRECATED','RETIRED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  UNIQUE(operator_id, api_name, major_version)
);

CREATE TABLE platform.event_schema_subjects (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  subject text NOT NULL,
  topic_pattern text NOT NULL,
  compatibility_mode text NOT NULL CHECK (compatibility_mode IN ('BACKWARD','FORWARD','FULL','NONE')),
  owner text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','RETIRED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id, subject)
);

CREATE TABLE platform.event_schema_versions (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  subject_id uuid NOT NULL REFERENCES platform.event_schema_subjects(id),
  version integer NOT NULL CHECK (version > 0),
  schema_type text NOT NULL DEFAULT 'JSON_SCHEMA' CHECK (schema_type IN ('JSON_SCHEMA','AVRO')),
  schema_definition jsonb NOT NULL,
  schema_sha256 char(64) NOT NULL,
  compatibility_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','COMPATIBLE','APPROVED','REJECTED','RETIRED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  UNIQUE(operator_id, subject_id, version)
);

CREATE TABLE platform.workflow_definitions (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  workflow_type text NOT NULL,
  task_queue text NOT NULL,
  owner text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','RETIRED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id, workflow_type)
);

CREATE TABLE platform.workflow_versions (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  workflow_id uuid NOT NULL REFERENCES platform.workflow_definitions(id),
  version integer NOT NULL CHECK (version > 0),
  build_id text NOT NULL,
  change_type text NOT NULL CHECK (change_type IN ('PATCH','COMPATIBLE','BREAKING')),
  patch_ids text[] NOT NULL DEFAULT '{}',
  rollout_percent integer NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEW','APPROVED','ACTIVE','RETIRED')),
  notes text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  activated_at timestamptz,
  UNIQUE(operator_id, workflow_id, version),
  UNIQUE(operator_id, workflow_id, build_id)
);

CREATE TABLE platform.workflow_migration_plans (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  workflow_id uuid NOT NULL REFERENCES platform.workflow_definitions(id),
  from_version integer NOT NULL,
  to_version integer NOT NULL,
  strategy text NOT NULL CHECK (strategy IN ('PIN_EXISTING','CONTINUE_AS_NEW','RESET_WITH_APPROVAL','DUAL_WORKER')),
  history_compatibility text NOT NULL,
  rollback_plan text NOT NULL,
  drain_criteria text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEW','APPROVED','EXECUTING','COMPLETED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  completed_at timestamptz,
  CHECK (to_version > from_version),
  UNIQUE(operator_id, workflow_id, from_version, to_version)
);

CREATE INDEX migration_adapter_profiles_status_idx ON platform.migration_adapter_profiles(operator_id,status);
CREATE INDEX connector_catalog_status_idx ON platform.connector_catalog(operator_id,lifecycle_status,category);
CREATE INDEX connector_instances_status_idx ON platform.connector_instances(operator_id,status,environment);
CREATE INDEX connector_health_checks_instance_idx ON platform.connector_health_checks(operator_id,instance_id,checked_at DESC);
CREATE INDEX api_lifecycle_status_idx ON platform.api_lifecycle_policies(operator_id,status,api_name);
CREATE INDEX event_schema_versions_subject_idx ON platform.event_schema_versions(operator_id,subject_id,version DESC);
CREATE INDEX workflow_versions_workflow_idx ON platform.workflow_versions(operator_id,workflow_id,version DESC);

GRANT SELECT,INSERT,UPDATE,DELETE ON platform.migration_adapter_profiles, platform.connector_catalog, platform.connector_instances,
  platform.connector_health_checks, platform.api_lifecycle_policies, platform.event_schema_subjects, platform.event_schema_versions,
  platform.workflow_definitions, platform.workflow_versions, platform.workflow_migration_plans TO platform_svc;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['migration_adapter_profiles','connector_catalog','connector_instances','connector_health_checks','api_lifecycle_policies','event_schema_subjects','event_schema_versions','workflow_definitions','workflow_versions','workflow_migration_plans'] LOOP
    EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE platform.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS aeroos_tenant_isolation ON platform.%I', t);
    EXECUTE format($p$CREATE POLICY aeroos_tenant_isolation ON platform.%I USING (current_setting('aeroos.system', true)='true' OR operator_id=nullif(current_setting('aeroos.operator_id', true),'')) WITH CHECK (current_setting('aeroos.system', true)='true' OR operator_id=nullif(current_setting('aeroos.operator_id', true),''))$p$, t);
  END LOOP;
END $$;

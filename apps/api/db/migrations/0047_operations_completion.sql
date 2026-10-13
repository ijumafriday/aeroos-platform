-- Operations depth completion: provider governance/failover, AIRAC, EFB, DCS/load control,
-- runway operational state, ACMI responsibility control and electronic technical/journey log.

CREATE SEQUENCE IF NOT EXISTS ops.airac_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS ops.efb_package_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS ops.efb_distribution_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS ops.load_message_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS ops.runway_state_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS ops.acmi_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS ops.techlog_seq START 1001;

CREATE TABLE ops.integration_providers (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  capability text NOT NULL CHECK (capability IN ('WEATHER','NOTAM','NAVDATA','FLIGHT_PLAN','DCS','EFB','ACARS','AFTN')),
  provider_name text NOT NULL,
  endpoint_ref text NOT NULL,
  priority integer NOT NULL CHECK (priority > 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','STANDBY','SUSPENDED','FAILED')),
  credential_ref text NOT NULL,
  contract_ref text,
  sla_seconds integer NOT NULL DEFAULT 60 CHECK (sla_seconds > 0),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  health_message text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id, capability, provider_name)
);
CREATE INDEX ops_provider_capability_idx ON ops.integration_providers(operator_id, capability, priority);

CREATE TABLE ops.airac_cycles (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  cycle text NOT NULL,
  provider_id text REFERENCES ops.integration_providers(id),
  provider_version text NOT NULL,
  source_sha256 char(64) NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'STAGED' CHECK (status IN ('STAGED','VALIDATED','APPROVED','ACTIVE','SUPERSEDED','REJECTED')),
  validation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  validated_by text,
  validated_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  activated_by text,
  activated_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until > effective_from),
  UNIQUE(operator_id, cycle, provider_version)
);
CREATE INDEX ops_airac_effectivity_idx ON ops.airac_cycles(operator_id, effective_from, effective_until, status);

CREATE TABLE ops.efb_packages (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  title text NOT NULL,
  revision text NOT NULL,
  package_type text NOT NULL CHECK (package_type IN ('FLIGHT_RELEASE','MANUAL','BULLETIN','AIRPORT_BRIEF','NAVDATA')),
  content_ref text NOT NULL,
  content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  airac_cycle_id text REFERENCES ops.airac_cycles(id),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','RELEASED','RECALLED','EXPIRED')),
  released_by text,
  released_at timestamptz,
  recalled_by text,
  recalled_at timestamptz,
  recall_reason text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id, title, revision)
);

CREATE TABLE ops.efb_distributions (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  package_id text NOT NULL REFERENCES ops.efb_packages(id),
  target_type text NOT NULL CHECK (target_type IN ('DEVICE','CREW','AIRCRAFT','FLEET')),
  target_ref text NOT NULL,
  provider_id text REFERENCES ops.integration_providers(id),
  delivery_ref text,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','DELIVERED','ACKNOWLEDGED','FAILED','RECALLED')),
  delivered_at timestamptz,
  acknowledged_by text,
  acknowledged_at timestamptz,
  acknowledgement_ref text,
  offline_sync_at timestamptz,
  failure_reason text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ops_efb_distribution_target_idx ON ops.efb_distributions(operator_id, target_type, target_ref, status);

CREATE TABLE ops.load_control_messages (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  flight_id text,
  provider_id text REFERENCES ops.integration_providers(id),
  message_type text NOT NULL CHECK (message_type IN ('DCS_LOAD','BAGGAGE','CARGO','ULD','SPECIAL_LOAD','TRIM_SHEET','LOADSHEET')),
  provider_message_ref text NOT NULL,
  payload jsonb NOT NULL,
  payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','VALIDATED','ACKNOWLEDGED','REJECTED')),
  validation_findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  acknowledged_by text,
  acknowledged_at timestamptz,
  acknowledgement_ref text,
  UNIQUE(operator_id, provider_message_ref)
);
CREATE INDEX ops_load_control_flight_idx ON ops.load_control_messages(operator_id, flight_id, received_at);

CREATE TABLE ops.runway_operational_states (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  airport_icao text NOT NULL,
  runway text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  state text NOT NULL CHECK (state IN ('OPEN','CLOSED','RESTRICTED')),
  contamination text,
  braking_action text,
  tora_m integer CHECK (tora_m IS NULL OR tora_m >= 0),
  toda_m integer CHECK (toda_m IS NULL OR toda_m >= 0),
  asda_m integer CHECK (asda_m IS NULL OR asda_m >= 0),
  lda_m integer CHECK (lda_m IS NULL OR lda_m >= 0),
  source_type text NOT NULL CHECK (source_type IN ('NOTAM','AIRPORT','OPS','AUTHORITY')),
  source_ref text NOT NULL,
  source_sha256 char(64) NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ops_runway_state_lookup_idx ON ops.runway_operational_states(operator_id, airport_icao, runway, valid_from);

CREATE TABLE ops.acmi_contracts (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  contract_ref text NOT NULL,
  lessor text NOT NULL,
  lessee text NOT NULL,
  lessor_aoc text NOT NULL,
  lessee_aoc text NOT NULL,
  aircraft_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  effective_from date NOT NULL,
  effective_until date NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','ACTIVE','SUSPENDED','CLOSED')),
  operational_control_party text NOT NULL,
  crew_responsibility_party text NOT NULL,
  maintenance_responsibility_party text NOT NULL,
  continuing_airworthiness_party text NOT NULL,
  records_responsibility_party text NOT NULL,
  occurrence_reporting_party text NOT NULL,
  authority_approval_ref text,
  approved_by text,
  approved_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until >= effective_from),
  UNIQUE(operator_id, contract_ref)
);

CREATE TABLE ops.tech_logs (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  tail text NOT NULL,
  log_date date NOT NULL,
  opening_station text NOT NULL,
  closing_station text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','HANDOVER','CLOSED')),
  opening_hobbs numeric(12,2),
  closing_hobbs numeric(12,2),
  opening_cycles integer CHECK (opening_cycles IS NULL OR opening_cycles >= 0),
  closing_cycles integer CHECK (closing_cycles IS NULL OR closing_cycles >= 0),
  continuity_token text NOT NULL,
  offline_revision integer NOT NULL DEFAULT 0 CHECK (offline_revision >= 0),
  last_sync_at timestamptz,
  opened_by text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_by text,
  closed_at timestamptz,
  UNIQUE(operator_id, tail, log_date)
);

CREATE TABLE ops.tech_log_events (
  id bigserial PRIMARY KEY,
  operator_id text NOT NULL,
  tech_log_id text NOT NULL REFERENCES ops.tech_logs(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('SECTOR','DEFECT','FLUID','MAINT_ACTION','SIGNATURE','HANDOVER','SYNC')),
  event_time timestamptz NOT NULL,
  flight_no text,
  dep text,
  arr text,
  reference text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor text NOT NULL,
  signature jsonb,
  offline_revision integer NOT NULL DEFAULT 0 CHECK (offline_revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ops_techlog_events_idx ON ops.tech_log_events(operator_id, tech_log_id, event_time, id);

GRANT SELECT,INSERT,UPDATE ON ops.integration_providers, ops.airac_cycles, ops.efb_packages, ops.efb_distributions, ops.load_control_messages, ops.runway_operational_states, ops.acmi_contracts, ops.tech_logs, ops.tech_log_events TO ops_svc;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ops TO ops_svc;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['integration_providers','airac_cycles','efb_packages','efb_distributions','load_control_messages','runway_operational_states','acmi_contracts','tech_logs','tech_log_events'] LOOP
    EXECUTE format('ALTER TABLE ops.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE ops.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY aeroos_tenant_isolation ON ops.%I USING (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), '''')) WITH CHECK (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), ''''))', t);
  END LOOP;
END $$;

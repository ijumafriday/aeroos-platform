-- AeroOS 0.46.0 — Continuing Airworthiness domain completion.
-- Reliability programme governance, exposure-normalised metrics, alert investigation,
-- condition-monitoring source provenance and evidence-backed predictive escalation.

CREATE TABLE camo.reliability_programmes (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  aircraft_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  ata_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  objectives text NOT NULL,
  methodology text NOT NULL,
  review_frequency_days integer NOT NULL CHECK (review_frequency_days BETWEEN 1 AND 3660),
  effective_from date NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEW','APPROVED','ACTIVE','SUPERSEDED','CLOSED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_by text,
  submitted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  activated_by text,
  activated_at timestamptz,
  supersedes_id text REFERENCES camo.reliability_programmes(id),
  UNIQUE(operator_id, code, revision)
);

CREATE TABLE camo.reliability_metrics (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  programme_id text NOT NULL REFERENCES camo.reliability_programmes(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  ata text,
  scope_type text NOT NULL CHECK (scope_type IN ('FLEET','TYPE','TAIL','ENGINE','COMPONENT','SYSTEM')),
  scope_ref text NOT NULL,
  numerator_definition text NOT NULL,
  denominator_definition text NOT NULL,
  denominator_unit text NOT NULL CHECK (denominator_unit IN ('FH','FC','DAYS','SECTORS','UNITS','EVENTS')),
  normalization_factor numeric(18,4) NOT NULL DEFAULT 1000 CHECK (normalization_factor > 0),
  warning_threshold numeric(18,6) NOT NULL CHECK (warning_threshold >= 0),
  alert_threshold numeric(18,6) NOT NULL CHECK (alert_threshold >= 0),
  direction text NOT NULL CHECK (direction IN ('ABOVE_BAD','BELOW_BAD')),
  minimum_exposure numeric(18,4) NOT NULL DEFAULT 1 CHECK (minimum_exposure > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','SUSPENDED','RETIRED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  CHECK ((direction='ABOVE_BAD' AND alert_threshold >= warning_threshold) OR (direction='BELOW_BAD' AND alert_threshold <= warning_threshold)),
  UNIQUE(operator_id, programme_id, code)
);

CREATE TABLE camo.reliability_measurements (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  metric_id text NOT NULL REFERENCES camo.reliability_metrics(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  numerator numeric(18,4) NOT NULL CHECK (numerator >= 0),
  denominator numeric(18,4) NOT NULL CHECK (denominator > 0),
  rate numeric(18,6) NOT NULL,
  state text NOT NULL CHECK (state IN ('INSUFFICIENT_EXPOSURE','NORMAL','WARNING','ALERT')),
  source_type text NOT NULL,
  source_ref text NOT NULL,
  source_sha256 char(64) NOT NULL,
  calculated_by text NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  status text NOT NULL DEFAULT 'CALCULATED' CHECK (status IN ('CALCULATED','APPROVED','SUPERSEDED')),
  CHECK (period_end >= period_start),
  UNIQUE(operator_id, metric_id, period_start, period_end, status)
);

CREATE TABLE camo.reliability_alerts (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  metric_id text NOT NULL REFERENCES camo.reliability_metrics(id),
  measurement_id text NOT NULL REFERENCES camo.reliability_measurements(id),
  severity text NOT NULL CHECK (severity IN ('WARNING','ALERT')),
  title text NOT NULL,
  observed_rate numeric(18,6) NOT NULL,
  threshold numeric(18,6) NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','INVESTIGATING','ACTIONED','MONITORING','CLOSED')),
  owner text NOT NULL,
  opened_by text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_by text,
  closed_at timestamptz,
  closure_evidence_ref text,
  UNIQUE(operator_id, measurement_id, severity)
);

CREATE TABLE camo.reliability_investigations (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  alert_id text NOT NULL REFERENCES camo.reliability_alerts(id) ON DELETE CASCADE,
  hypothesis text NOT NULL,
  analysis_method text NOT NULL,
  sample_basis text NOT NULL,
  findings text,
  root_cause text,
  action_type text CHECK (action_type IN ('NONE','MAINTENANCE','ENGINEERING','PROGRAMME','SUPPLY','OPERATIONS')),
  action_ref text,
  effectiveness_review_on date,
  effectiveness_result text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ANALYSED','ACTIONED','EFFECTIVENESS_REVIEW','CLOSED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text,
  reviewed_at timestamptz
);

CREATE TABLE camo.condition_sources (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  source_code text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('ACMS','QAR','FDR','ENGINE_TREND','HUMS','MANUAL_SAMPLE','LAB','OEM_FEED')),
  aircraft_type text,
  tail text,
  component_ref text,
  parameter_set jsonb NOT NULL DEFAULT '[]'::jsonb,
  unit_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingestion_method text NOT NULL,
  calibration_ref text,
  last_calibrated_on date,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','ACTIVE','SUSPENDED','RETIRED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  UNIQUE(operator_id, source_code)
);

CREATE TABLE camo.condition_thresholds (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  source_id text NOT NULL REFERENCES camo.condition_sources(id) ON DELETE CASCADE,
  parameter text NOT NULL,
  unit text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('ABOVE_BAD','BELOW_BAD','OUTSIDE_BAND')),
  warning_low numeric(18,6),
  warning_high numeric(18,6),
  alert_low numeric(18,6),
  alert_high numeric(18,6),
  persistence_count integer NOT NULL DEFAULT 1 CHECK (persistence_count > 0),
  rationale text NOT NULL,
  reference text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','SUSPENDED','RETIRED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  UNIQUE(operator_id, source_id, parameter, status)
);

CREATE TABLE camo.condition_readings (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  source_id text NOT NULL REFERENCES camo.condition_sources(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL,
  flight_ref text,
  tail text,
  component_ref text,
  parameter text NOT NULL,
  value numeric(18,6) NOT NULL,
  unit text NOT NULL,
  source_record_ref text NOT NULL,
  source_sha256 char(64) NOT NULL,
  quality_state text NOT NULL DEFAULT 'VALID' CHECK (quality_state IN ('VALID','SUSPECT','REJECTED')),
  ingested_by text NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id, source_id, source_record_ref, parameter)
);

CREATE TABLE camo.condition_alerts (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  source_id text NOT NULL REFERENCES camo.condition_sources(id),
  threshold_id text NOT NULL REFERENCES camo.condition_thresholds(id),
  parameter text NOT NULL,
  scope_ref text NOT NULL,
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  consecutive_breaches integer NOT NULL CHECK (consecutive_breaches > 0),
  severity text NOT NULL CHECK (severity IN ('WARNING','ALERT')),
  observed_value numeric(18,6) NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','ACTIONED','MONITORING','CLOSED')),
  disposition text,
  action_ref text,
  evidence_ref text,
  opened_by text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by text,
  acknowledged_at timestamptz,
  closed_by text,
  closed_at timestamptz
);

CREATE TABLE camo.reliability_reviews (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  programme_id text NOT NULL REFERENCES camo.reliability_programmes(id),
  review_period text NOT NULL,
  meeting_date date NOT NULL,
  chair text NOT NULL,
  approved_measurements integer NOT NULL CHECK (approved_measurements >= 0),
  open_reliability_alerts integer NOT NULL CHECK (open_reliability_alerts >= 0),
  open_condition_alerts integer NOT NULL CHECK (open_condition_alerts >= 0),
  repeated_alerts integer NOT NULL CHECK (repeated_alerts >= 0),
  conclusions text NOT NULL,
  programme_change_required boolean NOT NULL DEFAULT false,
  action_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_sha256 char(64) NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','CLOSED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  closed_by text,
  closed_at timestamptz,
  UNIQUE(operator_id, programme_id, review_period)
);

CREATE INDEX reliability_programme_status_idx ON camo.reliability_programmes(operator_id,status,effective_from DESC);
CREATE INDEX reliability_metric_status_idx ON camo.reliability_metrics(operator_id,programme_id,status);
CREATE INDEX reliability_measurement_period_idx ON camo.reliability_measurements(operator_id,metric_id,period_end DESC);
CREATE INDEX reliability_alert_status_idx ON camo.reliability_alerts(operator_id,status,opened_at DESC);
CREATE INDEX condition_source_status_idx ON camo.condition_sources(operator_id,status,source_code);
CREATE INDEX condition_reading_param_idx ON camo.condition_readings(operator_id,source_id,parameter,observed_at DESC);
CREATE INDEX condition_alert_status_idx ON camo.condition_alerts(operator_id,status,last_observed_at DESC);

GRANT SELECT,INSERT,UPDATE ON camo.reliability_programmes,camo.reliability_metrics,camo.reliability_measurements,camo.reliability_alerts,camo.reliability_investigations,camo.condition_sources,camo.condition_thresholds,camo.condition_readings,camo.condition_alerts,camo.reliability_reviews TO camo_svc;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['reliability_programmes','reliability_metrics','reliability_measurements','reliability_alerts','reliability_investigations','condition_sources','condition_thresholds','condition_readings','condition_alerts','reliability_reviews'] LOOP
    EXECUTE format('ALTER TABLE camo.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE camo.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY aeroos_tenant_isolation ON camo.%I USING (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), '''')) WITH CHECK (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), ''''))',t);
  END LOOP;
END $$;

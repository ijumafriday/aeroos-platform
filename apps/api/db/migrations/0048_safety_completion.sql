-- AeroOS 0.41.0 — Safety domain completion.
-- Adds governed hazard/bow-tie, SPI/SPT, Management of Change and emergency-response control.

CREATE TABLE org.safety_hazards (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,
  source_type text NOT NULL,
  source_ref text,
  owner text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','ACCEPTED','CLOSED')),
  initial_probability integer NOT NULL CHECK (initial_probability BETWEEN 1 AND 5),
  initial_severity text NOT NULL CHECK (initial_severity IN ('A','B','C','D','E')),
  residual_probability integer CHECK (residual_probability BETWEEN 1 AND 5),
  residual_severity text CHECK (residual_severity IN ('A','B','C','D','E')),
  acceptance_basis text,
  next_review_date date NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_by text,
  accepted_at timestamptz,
  closed_by text,
  closed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE INDEX org_safety_hazards_status_idx ON org.safety_hazards(operator_id,status,next_review_date);

CREATE TABLE org.safety_bowtie_controls (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  hazard_id text NOT NULL REFERENCES org.safety_hazards(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('PREVENTIVE','RECOVERY')),
  control_type text NOT NULL CHECK (control_type IN ('TECHNICAL','PROCEDURAL','TRAINING','MONITORING','ORGANISATIONAL')),
  description text NOT NULL,
  owner text NOT NULL,
  assurance_method text NOT NULL,
  effectiveness text NOT NULL DEFAULT 'UNASSESSED' CHECK (effectiveness IN ('UNASSESSED','EFFECTIVE','PARTIAL','INEFFECTIVE')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DEGRADED','RETIRED')),
  last_assured_at timestamptz,
  last_assured_by text,
  assurance_evidence text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX org_safety_bowtie_hazard_idx ON org.safety_bowtie_controls(operator_id,hazard_id,side,status);

CREATE TABLE org.safety_indicators (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  indicator_type text NOT NULL CHECK (indicator_type IN ('SPI','SPT')),
  direction text NOT NULL CHECK (direction IN ('LOWER_IS_BETTER','HIGHER_IS_BETTER')),
  unit text NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('DAILY','WEEKLY','MONTHLY','QUARTERLY','ANNUAL')),
  target_value numeric(18,4) NOT NULL,
  warning_value numeric(18,4) NOT NULL,
  breach_value numeric(18,4) NOT NULL,
  owner text NOT NULL,
  linked_hazard_id text REFERENCES org.safety_hazards(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','RETIRED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id,code)
);
CREATE INDEX org_safety_indicators_idx ON org.safety_indicators(operator_id,status,indicator_type);

CREATE TABLE org.safety_indicator_samples (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  indicator_id text NOT NULL REFERENCES org.safety_indicators(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  value numeric(18,4) NOT NULL,
  state text NOT NULL CHECK (state IN ('NORMAL','WARNING','BREACH')),
  source_ref text NOT NULL,
  source_sha256 char(64) NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  note text,
  CHECK (period_end >= period_start),
  UNIQUE(operator_id,indicator_id,period_start,period_end)
);
CREATE INDEX org_safety_indicator_samples_idx ON org.safety_indicator_samples(operator_id,indicator_id,period_end DESC);

CREATE TABLE org.safety_moc (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  title text NOT NULL,
  reason text NOT NULL,
  scope text NOT NULL,
  owner text NOT NULL,
  affected_domains jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_assessment jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ASSESSMENT','APPROVED','IMPLEMENTING','MONITORING','CLOSED','REJECTED')),
  planned_effective_at timestamptz,
  effective_at timestamptz,
  monitoring_due date,
  approval_note text,
  approved_by text,
  approved_at timestamptz,
  closure_evidence text,
  closed_by text,
  closed_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE INDEX org_safety_moc_status_idx ON org.safety_moc(operator_id,status,monitoring_due);

CREATE TABLE org.safety_moc_actions (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  moc_id text NOT NULL REFERENCES org.safety_moc(id) ON DELETE CASCADE,
  phase text NOT NULL CHECK (phase IN ('PRE_IMPLEMENTATION','IMPLEMENTATION','MONITORING')),
  description text NOT NULL,
  owner text NOT NULL,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DONE','VERIFIED')),
  evidence text,
  done_by text,
  done_at timestamptz,
  verified_by text,
  verified_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX org_safety_moc_actions_idx ON org.safety_moc_actions(operator_id,moc_id,status,due_date);

CREATE TABLE org.safety_erp_scenarios (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  scenario_type text NOT NULL CHECK (scenario_type IN ('AIRCRAFT_ACCIDENT','SERIOUS_INCIDENT','SECURITY','DANGEROUS_GOODS','PUBLIC_HEALTH','IT_OUTAGE','FACILITY','OTHER')),
  activation_criteria text NOT NULL,
  commander_role text NOT NULL,
  communications_plan text NOT NULL,
  authority_contacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  stakeholder_contacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','RETIRED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  approved_by text,
  approved_at timestamptz,
  last_exercised_at timestamptz,
  next_exercise_due date NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id,code,version)
);
CREATE INDEX org_safety_erp_scenario_idx ON org.safety_erp_scenarios(operator_id,status,next_exercise_due);

CREATE TABLE org.safety_erp_activations (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  scenario_id text NOT NULL REFERENCES org.safety_erp_scenarios(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','STOOD_DOWN','CLOSED')),
  location text,
  summary text NOT NULL,
  commander text NOT NULL,
  external_reference text,
  activated_by text NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now(),
  stood_down_by text,
  stood_down_at timestamptz,
  debrief text,
  lessons_learned text,
  closed_by text,
  closed_at timestamptz
);
CREATE INDEX org_safety_erp_activation_idx ON org.safety_erp_activations(operator_id,status,activated_at DESC);

CREATE TABLE org.safety_erp_events (
  id bigserial PRIMARY KEY,
  operator_id text NOT NULL,
  activation_id text NOT NULL REFERENCES org.safety_erp_activations(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('LOG','ACTION','AUTHORITY_NOTIFICATION','STAKEHOLDER_NOTIFICATION','DECISION','RESOURCE','STATUS')),
  occurred_at timestamptz NOT NULL,
  detail text NOT NULL,
  owner text,
  due_at timestamptz,
  completed_at timestamptz,
  external_ref text,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX org_safety_erp_events_idx ON org.safety_erp_events(operator_id,activation_id,occurred_at,id);

GRANT SELECT,INSERT,UPDATE ON org.safety_hazards, org.safety_bowtie_controls, org.safety_indicators, org.safety_indicator_samples, org.safety_moc, org.safety_moc_actions, org.safety_erp_scenarios, org.safety_erp_activations, org.safety_erp_events TO org_svc;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA org TO org_svc;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['safety_hazards','safety_bowtie_controls','safety_indicators','safety_indicator_samples','safety_moc','safety_moc_actions','safety_erp_scenarios','safety_erp_activations','safety_erp_events'] LOOP
    EXECUTE format('ALTER TABLE org.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE org.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY aeroos_tenant_isolation ON org.%I USING (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), '''')) WITH CHECK (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), ''''))', t);
  END LOOP;
END $$;

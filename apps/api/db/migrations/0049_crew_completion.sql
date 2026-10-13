-- AeroOS 0.42.0 — Crew domain completion.
-- Adds governed surface positioning, formal bidding/award, training-resource planning and payroll interfaces.

CREATE TABLE ops.crew_surface_legs (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  crew_id text NOT NULL,
  leg_type text NOT NULL CHECK (leg_type IN ('TAXI','BUS','RAIL','FERRY','HOTEL_TRANSFER','OTHER')),
  provider text NOT NULL,
  booking_ref text,
  origin text NOT NULL,
  destination text NOT NULL,
  scheduled_departure timestamptz NOT NULL,
  scheduled_arrival timestamptz NOT NULL,
  actual_departure timestamptz,
  actual_arrival timestamptz,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','CONFIRMED','IN_PROGRESS','COMPLETED','DELAYED','CANCELLED')),
  connection_flight_id text,
  duty_impact_minutes integer NOT NULL DEFAULT 0 CHECK (duty_impact_minutes >= 0),
  minimum_connection_minutes integer NOT NULL DEFAULT 30 CHECK (minimum_connection_minutes >= 0),
  legality_state text NOT NULL DEFAULT 'PENDING' CHECK (legality_state IN ('PENDING','LEGAL','AT_RISK','ILLEGAL')),
  delay_minutes integer NOT NULL DEFAULT 0 CHECK (delay_minutes >= 0),
  disruption_reason text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamptz,
  CHECK (scheduled_arrival > scheduled_departure),
  CHECK (actual_arrival IS NULL OR actual_departure IS NULL OR actual_arrival >= actual_departure)
);
CREATE INDEX ops_crew_surface_leg_idx ON ops.crew_surface_legs(operator_id,crew_id,scheduled_departure,status);

CREATE TABLE ops.crew_bid_periods (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  name text NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  bid_open_at timestamptz NOT NULL,
  bid_close_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','OPEN','CLOSED','AWARDING','AWARDED','PUBLISHED')),
  contract_rule_set jsonb NOT NULL DEFAULT '{}'::jsonb,
  seniority_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  scoring_method text NOT NULL DEFAULT 'WEIGHTED_SENIORITY' CHECK (scoring_method IN ('WEIGHTED_SENIORITY','SENIORITY_FIRST','POINTS')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  published_roster_ref text,
  published_by text,
  published_at timestamptz,
  CHECK (period_to >= period_from),
  CHECK (bid_close_at > bid_open_at),
  UNIQUE(operator_id,name,period_from)
);
CREATE INDEX ops_crew_bid_period_idx ON ops.crew_bid_periods(operator_id,status,period_from);

CREATE TABLE ops.crew_bids (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  bid_period_id text NOT NULL REFERENCES ops.crew_bid_periods(id) ON DELETE CASCADE,
  crew_id text NOT NULL,
  preference_type text NOT NULL CHECK (preference_type IN ('PAIRING','DAY_OFF','BASE','ROUTE','RESERVE','TRAINING','AVOID_PAIRING')),
  preference_ref text NOT NULL,
  weight integer NOT NULL CHECK (weight BETWEEN 1 AND 100),
  rank_order integer NOT NULL CHECK (rank_order > 0),
  note text,
  submitted_by text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  UNIQUE(operator_id,bid_period_id,crew_id,rank_order)
);
CREATE INDEX ops_crew_bids_idx ON ops.crew_bids(operator_id,bid_period_id,crew_id);

CREATE TABLE ops.crew_awards (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  bid_period_id text NOT NULL REFERENCES ops.crew_bid_periods(id) ON DELETE CASCADE,
  crew_id text NOT NULL,
  award_type text NOT NULL,
  award_ref text NOT NULL,
  source_bid_id text REFERENCES ops.crew_bids(id),
  score numeric(12,4) NOT NULL,
  seniority_rank integer NOT NULL CHECK (seniority_rank > 0),
  rule_trace jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','APPROVED','REJECTED','PUBLISHED')),
  generated_by text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  UNIQUE(operator_id,bid_period_id,crew_id,award_type,award_ref)
);
CREATE INDEX ops_crew_awards_idx ON ops.crew_awards(operator_id,bid_period_id,status,crew_id);

CREATE TABLE ops.crew_training_resources (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('INSTRUCTOR','SIMULATOR','CLASSROOM','AIRCRAFT','DEVICE')),
  code text NOT NULL,
  name text NOT NULL,
  qualifications jsonb NOT NULL DEFAULT '[]'::jsonb,
  capacity integer NOT NULL DEFAULT 1 CHECK (capacity > 0),
  base text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','OUT_OF_SERVICE','RETIRED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id,resource_type,code)
);

CREATE TABLE ops.crew_training_sessions (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  course_code text NOT NULL,
  course_name text NOT NULL,
  qualification_code text NOT NULL,
  recurrent_months integer CHECK (recurrent_months IS NULL OR recurrent_months > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  location text NOT NULL,
  capacity integer NOT NULL CHECK (capacity > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PLANNED','CONFIRMED','COMPLETED','CANCELLED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  CHECK (ends_at > starts_at)
);
CREATE INDEX ops_crew_training_session_idx ON ops.crew_training_sessions(operator_id,status,starts_at);

CREATE TABLE ops.crew_training_session_resources (
  id bigserial PRIMARY KEY,
  operator_id text NOT NULL,
  session_id text NOT NULL REFERENCES ops.crew_training_sessions(id) ON DELETE CASCADE,
  resource_id text NOT NULL REFERENCES ops.crew_training_resources(id),
  role text NOT NULL,
  UNIQUE(operator_id,session_id,resource_id)
);

CREATE TABLE ops.crew_training_enrollments (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  session_id text NOT NULL REFERENCES ops.crew_training_sessions(id) ON DELETE CASCADE,
  crew_id text NOT NULL,
  demand_reason text NOT NULL CHECK (demand_reason IN ('EXPIRY','INITIAL','UPGRADE','RECURRENCY','REMEDIAL','VOLUNTARY')),
  qualification_expires_on date,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','CONFIRMED','ATTENDED','PASSED','FAILED','NO_SHOW','CANCELLED')),
  result_note text,
  enrolled_by text NOT NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  completed_by text,
  completed_at timestamptz,
  UNIQUE(operator_id,session_id,crew_id)
);
CREATE INDEX ops_crew_training_enrollment_idx ON ops.crew_training_enrollments(operator_id,crew_id,status,qualification_expires_on);

CREATE TABLE ops.crew_pay_events (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  crew_id text NOT NULL,
  event_date date NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('ROSTER_ACTUAL','FLIGHT_ACTUAL','POSITIONING','TRAINING','ALLOWANCE','ADJUSTMENT')),
  source_ref text NOT NULL,
  pay_code text NOT NULL,
  units numeric(12,2) NOT NULL,
  unit_type text NOT NULL CHECK (unit_type IN ('HOURS','SECTORS','DAYS','COUNT','CURRENCY')),
  amount numeric(14,2),
  currency char(3),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','EXPORTED','RECONCILED','VOID')),
  evidence_ref text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  batch_id text,
  UNIQUE(operator_id,crew_id,source_type,source_ref,pay_code)
);
CREATE INDEX ops_crew_pay_event_idx ON ops.crew_pay_events(operator_id,event_date,status,crew_id);

CREATE TABLE ops.crew_payroll_batches (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  payroll_provider text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','READY','EXPORTED','ACKNOWLEDGED','RECONCILED','REJECTED')),
  event_count integer NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  total_amount numeric(16,2) NOT NULL DEFAULT 0,
  currency char(3),
  export_sha256 char(64),
  external_batch_ref text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  exported_by text,
  exported_at timestamptz,
  acknowledged_at timestamptz,
  reconciliation_note text,
  reconciled_by text,
  reconciled_at timestamptz,
  CHECK (period_to >= period_from)
);
CREATE INDEX ops_crew_payroll_batch_idx ON ops.crew_payroll_batches(operator_id,period_from,status);

GRANT SELECT,INSERT,UPDATE ON ops.crew_surface_legs, ops.crew_bid_periods, ops.crew_bids, ops.crew_awards, ops.crew_training_resources, ops.crew_training_sessions, ops.crew_training_session_resources, ops.crew_training_enrollments, ops.crew_pay_events, ops.crew_payroll_batches TO ops_svc;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ops TO ops_svc;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['crew_surface_legs','crew_bid_periods','crew_bids','crew_awards','crew_training_resources','crew_training_sessions','crew_training_session_resources','crew_training_enrollments','crew_pay_events','crew_payroll_batches'] LOOP
    EXECUTE format('ALTER TABLE ops.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE ops.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY aeroos_tenant_isolation ON ops.%I USING (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), '''')) WITH CHECK (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), ''''))', t);
  END LOOP;
END $$;

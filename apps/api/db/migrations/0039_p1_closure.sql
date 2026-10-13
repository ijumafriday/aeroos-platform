-- AeroOS 0.28: remaining P1 closure.
-- Deep maintenance production control, controlled supply lots/loans, provider-backed OFP/FRMS,
-- cabin-crew operational roles, and migration support. No new business-domain schemas are created.

/* ---------------------------------------------------------------- Maintenance production control */
CREATE SEQUENCE IF NOT EXISTS amo.non_routine_seq START 1001;

CREATE TABLE amo.maintenance_shifts (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  station text NOT NULL,
  name text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  capacity jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX maintenance_shifts_window_idx ON amo.maintenance_shifts(operator_id, station, starts_at, ends_at);

CREATE TABLE amo.work_package_production (
  wp_id text PRIMARY KEY,
  operator_id text NOT NULL,
  tail text NOT NULL,
  station text NOT NULL,
  title text NOT NULL,
  check_type text NOT NULL,
  planned_hours jsonb NOT NULL DEFAULT '[]'::jsonb,
  task_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'READY' CHECK (status IN ('READY','IN_PROGRESS','HOLD','COMPLETE')),
  planned_start timestamptz,
  planned_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  hold_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wp_production_station_idx ON amo.work_package_production(operator_id, station, status, planned_start);

CREATE TABLE amo.work_package_shift_allocations (
  id bigserial PRIMARY KEY,
  operator_id text NOT NULL,
  wp_id text NOT NULL REFERENCES amo.work_package_production(wp_id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES amo.maintenance_shifts(id) ON DELETE CASCADE,
  trade text NOT NULL CHECK (trade IN ('MECHANICAL','POWERPLANT','AVIONICS','STRUCTURES')),
  hours double precision NOT NULL CHECK (hours > 0),
  allocated_by text NOT NULL,
  allocated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(wp_id, shift_id, trade)
);
CREATE INDEX wp_shift_alloc_idx ON amo.work_package_shift_allocations(operator_id, shift_id, trade);

CREATE TABLE amo.work_package_milestones (
  id bigserial PRIMARY KEY,
  operator_id text NOT NULL,
  wp_id text NOT NULL REFERENCES amo.work_package_production(wp_id) ON DELETE CASCADE,
  code text NOT NULL,
  title text NOT NULL,
  planned_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETE')),
  actual_at timestamptz,
  completed_by text,
  UNIQUE (wp_id, code)
);

CREATE TABLE amo.non_routines (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  wp_id text NOT NULL REFERENCES amo.work_package_production(wp_id),
  task_card_id text REFERENCES amo.task_cards(id),
  title text NOT NULL,
  description text NOT NULL,
  ata text,
  trade text NOT NULL CHECK (trade IN ('MECHANICAL','POWERPLANT','AVIONICS','STRUCTURES')),
  estimated_hours double precision NOT NULL CHECK (estimated_hours >= 0),
  actual_minutes integer NOT NULL DEFAULT 0 CHECK (actual_minutes >= 0),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_WORK','CLOSED','CANCELLED')),
  disposition text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_by text,
  closed_at timestamptz
);
CREATE INDEX non_routines_wp_idx ON amo.non_routines(operator_id, wp_id, status);

CREATE TABLE amo.labour_entries (
  id bigserial PRIMARY KEY,
  operator_id text NOT NULL,
  wp_id text NOT NULL REFERENCES amo.work_package_production(wp_id),
  task_card_id text REFERENCES amo.task_cards(id),
  non_routine_id text REFERENCES amo.non_routines(id),
  personnel_id text NOT NULL,
  trade text NOT NULL CHECK (trade IN ('MECHANICAL','POWERPLANT','AVIONICS','STRUCTURES')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  minutes integer NOT NULL CHECK (minutes > 0),
  note text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at > started_at),
  CHECK ((task_card_id IS NOT NULL) <> (non_routine_id IS NOT NULL))
);
CREATE INDEX labour_entries_wp_idx ON amo.labour_entries(operator_id, wp_id, started_at);

/* ---------------------------------------------------------------- Controlled warehouse / lot / loan lifecycle */
CREATE SEQUENCE IF NOT EXISTS amo.loan_seq START 1001;
CREATE TABLE amo.warehouse_bins (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  station text NOT NULL,
  warehouse text NOT NULL,
  bin_code text NOT NULL,
  quarantine boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id, station, warehouse, bin_code)
);

CREATE TABLE amo.stock_lots (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  part_no text NOT NULL,
  serial text,
  lot_no text,
  qty integer NOT NULL CHECK (qty > 0),
  condition text NOT NULL CHECK (condition IN ('NE','NS','OH','SV','AR')),
  status text NOT NULL CHECK (status IN ('SERVICEABLE','QUARANTINE','UNSERVICEABLE','ISSUED','CONSUMED')),
  bin_id uuid NOT NULL REFERENCES amo.warehouse_bins(id),
  certificate_ref text,
  receipt_id text,
  shelf_life_until date,
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status <> 'SERVICEABLE') OR certificate_ref IS NOT NULL)
);
CREATE INDEX stock_lots_lookup_idx ON amo.stock_lots(operator_id, part_no, status, shelf_life_until);
CREATE UNIQUE INDEX stock_lots_serial_unique ON amo.stock_lots(operator_id, part_no, serial) WHERE serial IS NOT NULL;

CREATE TABLE amo.part_loans (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('BORROWED','LOANED_OUT')),
  counterparty text NOT NULL,
  part_no text NOT NULL,
  serial text NOT NULL,
  lot_id uuid NOT NULL REFERENCES amo.stock_lots(id),
  due_back date NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RETURNED')),
  reference text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  returned_by text,
  returned_at timestamptz,
  return_ref text
);
CREATE INDEX part_loans_due_idx ON amo.part_loans(operator_id, status, due_back);

/* ---------------------------------------------------------------- Operations: provider-backed OFP */
CREATE TABLE ops.ofp_packages (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  flight_id text NOT NULL REFERENCES ops.flights(id),
  provider text NOT NULL,
  provider_ref text NOT NULL,
  tail text NOT NULL,
  etd timestamptz NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  generated_at timestamptz NOT NULL,
  route text NOT NULL,
  cruise_level integer,
  alternate text,
  etops_minutes integer,
  redispatch_point text,
  trip_fuel_kg integer NOT NULL CHECK (trip_fuel_kg > 0),
  contingency_fuel_kg integer NOT NULL CHECK (contingency_fuel_kg >= 0),
  alternate_fuel_kg integer NOT NULL CHECK (alternate_fuel_kg >= 0),
  final_reserve_fuel_kg integer NOT NULL CHECK (final_reserve_fuel_kg > 0),
  block_fuel_kg integer NOT NULL CHECK (block_fuel_kg > 0),
  payload_kg integer NOT NULL CHECK (payload_kg >= 0),
  takeoff_mass_kg integer NOT NULL CHECK (takeoff_mass_kg > 0),
  landing_mass_kg integer NOT NULL CHECK (landing_mass_kg > 0),
  performance_ref text NOT NULL,
  nav_data_cycle text NOT NULL,
  weather_ref text NOT NULL,
  notam_ref text NOT NULL,
  payload jsonb NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  received_by text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id, flight_id, provider, provider_ref, revision)
);
CREATE INDEX ofp_flight_idx ON ops.ofp_packages(operator_id, flight_id, generated_at DESC);

/* ---------------------------------------------------------------- Crew: cabin roles + validated external FRMS assessments */
ALTER TABLE ops.crew_members DROP CONSTRAINT IF EXISTS crew_members_rank_check;
ALTER TABLE ops.crew_members ADD CONSTRAINT crew_members_rank_check CHECK (rank IN ('CPT','FO','SCCM','CC'));
ALTER TABLE ops.crew_assignments DROP CONSTRAINT IF EXISTS crew_assignments_role_check;
ALTER TABLE ops.crew_assignments ADD CONSTRAINT crew_assignments_role_check CHECK (role IN ('CPT','FO','SCCM','CC'));

CREATE TABLE ops.cabin_requirements (
  operator_id text NOT NULL,
  aircraft_type text NOT NULL,
  sccm_required integer NOT NULL DEFAULT 1 CHECK (sccm_required >= 0),
  cc_required integer NOT NULL CHECK (cc_required >= 0),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(operator_id, aircraft_type)
);

CREATE TABLE ops.frms_assessments (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  crew_id text NOT NULL REFERENCES ops.crew_members(id),
  duty_id text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  model_version text NOT NULL,
  score double precision NOT NULL,
  risk_band text NOT NULL CHECK (risk_band IN ('LOW','MODERATE','HIGH','CRITICAL')),
  generated_at timestamptz NOT NULL,
  source_ref text NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  recommendation text,
  received_by text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id, crew_id, duty_id, provider, model_version, generated_at)
);
CREATE INDEX frms_assessment_crew_idx ON ops.frms_assessments(operator_id, crew_id, generated_at DESC);

/* ---------------------------------------------------------------- Grants + RLS */
GRANT SELECT, INSERT, UPDATE, DELETE ON amo.maintenance_shifts, amo.work_package_production, amo.work_package_shift_allocations, amo.work_package_milestones, amo.non_routines, amo.labour_entries,
  amo.warehouse_bins, amo.stock_lots, amo.part_loans TO amo_svc;
GRANT USAGE, SELECT ON SEQUENCE amo.non_routine_seq, amo.loan_seq, amo.work_package_shift_allocations_id_seq, amo.work_package_milestones_id_seq, amo.labour_entries_id_seq TO amo_svc;
GRANT SELECT, INSERT, UPDATE ON ops.ofp_packages, ops.cabin_requirements, ops.frms_assessments TO ops_svc;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['maintenance_shifts','work_package_production','work_package_shift_allocations','work_package_milestones','non_routines','labour_entries','warehouse_bins','stock_lots','part_loans'] LOOP
    EXECUTE format('ALTER TABLE amo.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY aeroos_tenant_isolation ON amo.%I USING (current_setting(''aeroos.system'', true)=''true'' OR operator_id=nullif(current_setting(''aeroos.operator_id'', true),'''')) WITH CHECK (current_setting(''aeroos.system'', true)=''true'' OR operator_id=nullif(current_setting(''aeroos.operator_id'', true),''''))', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['ofp_packages','cabin_requirements','frms_assessments'] LOOP
    EXECUTE format('ALTER TABLE ops.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY aeroos_tenant_isolation ON ops.%I USING (current_setting(''aeroos.system'', true)=''true'' OR operator_id=nullif(current_setting(''aeroos.operator_id'', true),'''')) WITH CHECK (current_setting(''aeroos.system'', true)=''true'' OR operator_id=nullif(current_setting(''aeroos.operator_id'', true),''''))', t);
  END LOOP;
END $$;

-- AeroOS 0.37: Maintenance domain completion.
-- Adds first-class line/base production control, work orders, station capability,
-- shift handover, task execution evidence, tool crib control, shop orders and AOG coordination.

CREATE SEQUENCE IF NOT EXISTS amo.work_order_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS amo.line_visit_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS amo.shop_order_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS amo.aog_case_seq START 1001;

CREATE TABLE amo.maintenance_station_capabilities (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  station text NOT NULL,
  aircraft_type text NOT NULL,
  maintenance_level text NOT NULL CHECK (maintenance_level IN ('TRANSIT','LINE','BASE','ENGINE_CHANGE','AOG','SHOP_SUPPORT')),
  scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  limitations text,
  authority_ref text NOT NULL,
  effective_from date NOT NULL,
  effective_until date,
  active boolean NOT NULL DEFAULT true,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until >= effective_from),
  UNIQUE(operator_id, station, aircraft_type, maintenance_level, effective_from)
);
CREATE INDEX maintenance_station_capability_lookup_idx ON amo.maintenance_station_capabilities(operator_id, station, aircraft_type, maintenance_level, active);

CREATE TABLE amo.work_orders (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  order_type text NOT NULL CHECK (order_type IN ('LINE','BASE','AOG','COMPONENT','ENGINE','MODIFICATION','UNSCHEDULED')),
  tail text,
  component_ref text,
  station text NOT NULL,
  aircraft_type text,
  title text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('NORMAL','HIGH','AOG')),
  customer_ref text,
  source_type text,
  source_id text,
  planned_start timestamptz,
  planned_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PLANNED','RELEASED','IN_PROGRESS','HOLD','COMPLETE','CANCELLED')),
  hold_reason text,
  planned_hours double precision NOT NULL DEFAULT 0 CHECK (planned_hours >= 0),
  actual_minutes integer NOT NULL DEFAULT 0 CHECK (actual_minutes >= 0),
  task_card_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (tail IS NOT NULL OR component_ref IS NOT NULL),
  CHECK (planned_end IS NULL OR planned_start IS NULL OR planned_end > planned_start)
);
CREATE INDEX work_orders_board_idx ON amo.work_orders(operator_id, station, status, priority, planned_start);
CREATE INDEX work_orders_tail_idx ON amo.work_orders(operator_id, tail, status);

CREATE TABLE amo.line_visits (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  tail text NOT NULL,
  aircraft_type text NOT NULL,
  station text NOT NULL,
  inbound_flight text,
  outbound_flight text,
  scheduled_in timestamptz NOT NULL,
  scheduled_out timestamptz NOT NULL,
  actual_in timestamptz,
  actual_out timestamptz,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','ARRIVED','IN_MAINTENANCE','RELEASED','DEPARTED','CANCELLED')),
  work_order_id text REFERENCES amo.work_orders(id),
  open_defects integer NOT NULL DEFAULT 0 CHECK (open_defects >= 0),
  turnaround_notes text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (scheduled_out > scheduled_in)
);
CREATE INDEX line_visits_station_idx ON amo.line_visits(operator_id, station, scheduled_in, status);

CREATE TABLE amo.shift_handovers (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  station text NOT NULL,
  work_area text NOT NULL CHECK (work_area IN ('LINE','BASE','SHOP','AOG','TOOL_CRIB')),
  outgoing_shift text NOT NULL,
  incoming_shift text NOT NULL,
  handed_over_by text NOT NULL,
  handed_over_at timestamptz NOT NULL DEFAULT now(),
  accepted_by text,
  accepted_at timestamptz,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACCEPTED')),
  summary text NOT NULL
);
CREATE INDEX shift_handovers_open_idx ON amo.shift_handovers(operator_id, station, work_area, status, handed_over_at DESC);

CREATE TABLE amo.handover_items (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  handover_id uuid NOT NULL REFERENCES amo.shift_handovers(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('AIRCRAFT','WORK_ORDER','TASK_CARD','OPEN_PANEL','ISOLATION','TOOL','MATERIAL','NCR','GROUND_RUN','SAFETY','OTHER')),
  reference text NOT NULL,
  description text NOT NULL,
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL','HIGH','CRITICAL')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  resolved_by text,
  resolved_at timestamptz,
  resolution text
);
CREATE INDEX handover_items_open_idx ON amo.handover_items(operator_id, handover_id, status, priority);

CREATE TABLE amo.tool_assets (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  tool_no text NOT NULL,
  serial text,
  description text NOT NULL,
  station text NOT NULL,
  crib text NOT NULL,
  kit_code text,
  calibration_required boolean NOT NULL DEFAULT true,
  calibrated_until date,
  certificate_ref text,
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','ISSUED','OUT_FOR_CALIBRATION','QUARANTINE','LOST','DAMAGED','RETIRED')),
  condition_note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id, tool_no, serial)
);
CREATE INDEX tool_assets_crib_idx ON amo.tool_assets(operator_id, station, crib, status, calibrated_until);

CREATE TABLE amo.tool_movements (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  tool_id uuid NOT NULL REFERENCES amo.tool_assets(id),
  movement text NOT NULL CHECK (movement IN ('ISSUE','RETURN','SEND_CALIBRATION','RETURN_CALIBRATION','QUARANTINE','MARK_LOST','MARK_DAMAGED','RETIRE')),
  work_order_id text REFERENCES amo.work_orders(id),
  task_card_id text REFERENCES amo.task_cards(id),
  personnel_id text,
  reference text NOT NULL,
  note text,
  actor text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tool_movements_tool_idx ON amo.tool_movements(operator_id, tool_id, occurred_at DESC);

CREATE TABLE amo.shop_orders (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  shop_type text NOT NULL CHECK (shop_type IN ('ENGINE','APU','COMPONENT','WHEEL_BRAKE','BATTERY','AVIONICS','STRUCTURES','OTHER')),
  part_no text NOT NULL,
  serial text NOT NULL,
  customer_ref text,
  incoming_condition text NOT NULL,
  workscope text NOT NULL,
  status text NOT NULL DEFAULT 'INDUCTED' CHECK (status IN ('INDUCTED','TEARDOWN','INSPECTION','REPAIR','ASSEMBLY','TEST','READY_FOR_RELEASE','RELEASED','HOLD','SCRAPPED')),
  induction_ref text NOT NULL,
  release_certificate_ref text,
  test_result text,
  planned_release date,
  actual_release timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id, part_no, serial, id)
);
CREATE INDEX shop_orders_status_idx ON amo.shop_orders(operator_id, shop_type, status, planned_release);

CREATE TABLE amo.shop_findings (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  shop_order_id text NOT NULL REFERENCES amo.shop_orders(id) ON DELETE CASCADE,
  finding text NOT NULL,
  disposition text,
  part_no text,
  serial text,
  repair_ref text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','APPROVED','REPAIRED','SCRAPPED','CLOSED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_by text,
  closed_at timestamptz
);
CREATE INDEX shop_findings_order_idx ON amo.shop_findings(operator_id, shop_order_id, status);

CREATE TABLE amo.task_execution_records (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  task_card_id text NOT NULL REFERENCES amo.task_cards(id),
  step_no integer NOT NULL,
  record_type text NOT NULL CHECK (record_type IN ('MEASUREMENT','INSPECTION','INTERRUPTION','RESUME','PART_CHANGE','CONSUMABLE','GROUND_TEST','REWORK')),
  value_text text,
  value_number double precision,
  unit text,
  lower_limit double precision,
  upper_limit double precision,
  result text CHECK (result IS NULL OR result IN ('PASS','FAIL','ACCEPTED','REJECTED')),
  reference text,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  inspected_by text,
  inspected_at timestamptz,
  inspection_signature jsonb,
  CHECK (step_no > 0)
);
CREATE INDEX task_execution_records_idx ON amo.task_execution_records(operator_id, task_card_id, step_no, recorded_at);

CREATE TABLE amo.aog_cases (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  tail text NOT NULL,
  station text NOT NULL,
  defect_ref text NOT NULL,
  work_order_id text REFERENCES amo.work_orders(id),
  severity text NOT NULL CHECK (severity IN ('AOG','CRITICAL','HIGH')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DIAGNOSIS','MATERIAL','RECOVERY','RTS','CLOSED')),
  technical_summary text NOT NULL,
  recovery_eta timestamptz,
  required_part text,
  logistics_ref text,
  operational_impact text,
  opened_by text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_by text,
  closed_at timestamptz
);
CREATE INDEX aog_cases_open_idx ON amo.aog_cases(operator_id, status, recovery_eta);

CREATE TABLE amo.aog_updates (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  case_id text NOT NULL REFERENCES amo.aog_cases(id) ON DELETE CASCADE,
  update_type text NOT NULL CHECK (update_type IN ('TECHNICAL','ENGINEERING','MATERIAL','LOGISTICS','CREW','OPS','RECOVERY')),
  note text NOT NULL,
  recovery_eta timestamptz,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX aog_updates_case_idx ON amo.aog_updates(operator_id, case_id, created_at DESC);

CREATE TABLE amo.work_package_zones (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  wp_id text NOT NULL REFERENCES amo.work_package_production(wp_id) ON DELETE CASCADE,
  zone text NOT NULL,
  planned_hours double precision NOT NULL DEFAULT 0 CHECK (planned_hours >= 0),
  actual_minutes integer NOT NULL DEFAULT 0 CHECK (actual_minutes >= 0),
  status text NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED','OPEN','IN_PROGRESS','INSPECTION','CLOSED')),
  UNIQUE(operator_id, wp_id, zone)
);

CREATE TABLE amo.work_package_access_panels (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  wp_id text NOT NULL REFERENCES amo.work_package_production(wp_id) ON DELETE CASCADE,
  panel text NOT NULL,
  zone text,
  status text NOT NULL DEFAULT 'CLOSED' CHECK (status IN ('CLOSED','OPEN','TEMP_CLOSED')),
  opened_by text,
  opened_at timestamptz,
  closed_by text,
  closed_at timestamptz,
  UNIQUE(operator_id, wp_id, panel)
);


-- Depth completion: workforce, reservations, piece-parts, outsource, customer progress and SLA linkage.
ALTER TABLE amo.maintenance_station_capabilities
  ADD COLUMN minimum_authorized_staff integer NOT NULL DEFAULT 1 CHECK (minimum_authorized_staff >= 0),
  ADD COLUMN required_tool_nos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN facilities jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE amo.line_visits
  ADD COLUMN deferred_defect_refs jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE amo.aog_cases
  ADD COLUMN estimated_cost_minor bigint NOT NULL DEFAULT 0 CHECK (estimated_cost_minor >= 0),
  ADD COLUMN currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$');

CREATE TABLE amo.work_order_assignments (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  work_order_id text NOT NULL REFERENCES amo.work_orders(id) ON DELETE CASCADE,
  personnel_id text NOT NULL,
  assignment_role text NOT NULL CHECK (assignment_role IN ('MECHANIC','SUPERVISOR','INSPECTOR','SPECIALIST')),
  trade text,
  shift_ref text,
  planned_minutes integer NOT NULL DEFAULT 0 CHECK (planned_minutes >= 0),
  actual_minutes integer NOT NULL DEFAULT 0 CHECK (actual_minutes >= 0),
  assigned_by text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  UNIQUE(operator_id, work_order_id, personnel_id, assignment_role)
);
CREATE INDEX work_order_assignments_idx ON amo.work_order_assignments(operator_id, work_order_id, assignment_role, released_at);

CREATE TABLE amo.tool_reservations (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  tool_id uuid NOT NULL REFERENCES amo.tool_assets(id),
  work_order_id text REFERENCES amo.work_orders(id),
  task_card_id text REFERENCES amo.task_cards(id),
  reserved_from timestamptz NOT NULL,
  reserved_until timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','ISSUED','FULFILLED','CANCELLED','EXPIRED')),
  reserved_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reserved_until > reserved_from),
  CHECK (work_order_id IS NOT NULL OR task_card_id IS NOT NULL)
);
CREATE INDEX tool_reservations_idx ON amo.tool_reservations(operator_id, tool_id, status, reserved_from, reserved_until);

CREATE TABLE amo.shop_piece_parts (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  shop_order_id text NOT NULL REFERENCES amo.shop_orders(id) ON DELETE CASCADE,
  part_no text NOT NULL,
  serial text,
  lot_no text,
  description text,
  incoming_condition text NOT NULL,
  disposition text NOT NULL DEFAULT 'HOLD' CHECK (disposition IN ('HOLD','SERVICEABLE','REPAIR','SCRAP','REPLACE','EXTERNAL_REPAIR')),
  repair_scheme_ref text,
  external_order_ref text,
  trace_ref text,
  installed boolean NOT NULL DEFAULT false,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shop_piece_parts_idx ON amo.shop_piece_parts(operator_id, shop_order_id, disposition, part_no);

CREATE TABLE amo.outsourced_work (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  work_order_id text REFERENCES amo.work_orders(id) ON DELETE CASCADE,
  wp_id text,
  vendor_ref text NOT NULL,
  scope text NOT NULL,
  purchase_order_ref text,
  outbound_ref text,
  due_at timestamptz,
  returned_at timestamptz,
  return_release_ref text,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','SENT','IN_WORK','RETURNED','ACCEPTED','CANCELLED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (work_order_id IS NOT NULL OR wp_id IS NOT NULL)
);
CREATE INDEX outsourced_work_idx ON amo.outsourced_work(operator_id, status, due_at);


CREATE TABLE amo.material_kits (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  work_order_id text REFERENCES amo.work_orders(id) ON DELETE CASCADE,
  wp_id text,
  kit_no text NOT NULL,
  station text NOT NULL,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','PICKING','READY','ISSUED','CLOSED','CANCELLED')),
  prepared_by text,
  prepared_at timestamptz,
  issued_by text,
  issued_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (work_order_id IS NOT NULL OR wp_id IS NOT NULL),
  UNIQUE(operator_id, kit_no)
);
CREATE INDEX material_kits_idx ON amo.material_kits(operator_id, station, status, work_order_id);

CREATE TABLE amo.material_kit_items (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  kit_id uuid NOT NULL REFERENCES amo.material_kits(id) ON DELETE CASCADE,
  part_no text NOT NULL,
  description text,
  qty_required double precision NOT NULL CHECK (qty_required > 0),
  qty_picked double precision NOT NULL DEFAULT 0 CHECK (qty_picked >= 0),
  stock_ref text,
  certificate_ref text,
  picked_by text,
  picked_at timestamptz,
  CHECK (qty_picked <= qty_required)
);
CREATE INDEX material_kit_items_idx ON amo.material_kit_items(operator_id, kit_id, part_no);

CREATE TABLE amo.customer_progress_reports (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  work_order_id text REFERENCES amo.work_orders(id) ON DELETE CASCADE,
  wp_id text,
  customer_ref text NOT NULL,
  percent_complete double precision NOT NULL CHECK (percent_complete >= 0 AND percent_complete <= 100),
  forecast_release timestamptz,
  tat_variance_minutes integer,
  summary text NOT NULL,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  sent_by text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  CHECK (work_order_id IS NOT NULL OR wp_id IS NOT NULL)
);
CREATE INDEX customer_progress_reports_idx ON amo.customer_progress_reports(operator_id, customer_ref, sent_at DESC);

CREATE TABLE amo.maintenance_contracts (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  customer_ref text NOT NULL,
  contract_ref text NOT NULL,
  station_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  aircraft_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  maintenance_levels jsonb NOT NULL DEFAULT '[]'::jsonb,
  response_sla_minutes integer CHECK (response_sla_minutes IS NULL OR response_sla_minutes > 0),
  tat_sla_hours integer CHECK (tat_sla_hours IS NULL OR tat_sla_hours > 0),
  rate_card jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from date NOT NULL,
  effective_until date,
  active boolean NOT NULL DEFAULT true,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until >= effective_from),
  UNIQUE(operator_id, contract_ref, effective_from)
);
CREATE INDEX maintenance_contracts_idx ON amo.maintenance_contracts(operator_id, customer_ref, active, effective_from);

ALTER TABLE amo.work_orders
  ADD COLUMN contract_id uuid REFERENCES amo.maintenance_contracts(id),
  ADD COLUMN sla_due_at timestamptz,
  ADD COLUMN customer_approval_ref text;

-- Service grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  amo.maintenance_station_capabilities, amo.work_orders, amo.line_visits,
  amo.shift_handovers, amo.handover_items, amo.tool_assets, amo.tool_movements,
  amo.shop_orders, amo.shop_findings, amo.task_execution_records,
  amo.aog_cases, amo.aog_updates, amo.work_package_zones, amo.work_package_access_panels,
  amo.work_order_assignments, amo.tool_reservations, amo.shop_piece_parts, amo.outsourced_work,
  amo.customer_progress_reports, amo.maintenance_contracts, amo.material_kits, amo.material_kit_items
TO amo_svc;
GRANT USAGE, SELECT ON SEQUENCE amo.work_order_seq, amo.line_visit_seq, amo.shop_order_seq, amo.aog_case_seq TO amo_svc;

-- Tenant isolation is enforced at the database boundary for every new MNT table.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'maintenance_station_capabilities','work_orders','line_visits','shift_handovers','handover_items',
    'tool_assets','tool_movements','shop_orders','shop_findings','task_execution_records',
    'aog_cases','aog_updates','work_package_zones','work_package_access_panels',
    'work_order_assignments','tool_reservations','shop_piece_parts','outsourced_work',
    'customer_progress_reports','maintenance_contracts','material_kits','material_kit_items'
  ] LOOP
    EXECUTE format('ALTER TABLE amo.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE amo.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY aeroos_tenant_isolation ON amo.%I USING (current_setting(''aeroos.system'', true)=''true'' OR operator_id=nullif(current_setting(''aeroos.operator_id'', true),'''')) WITH CHECK (current_setting(''aeroos.system'', true)=''true'' OR operator_id=nullif(current_setting(''aeroos.operator_id'', true),''''))', t);
  END LOOP;
END $$;

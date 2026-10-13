-- AeroOS 0.38: Supply Chain domain completion.
-- Adds governed warehouse execution, inventory counting, fulfillment, replenishment,
-- demand forecasting, supplier performance/source selection, consignment, warranty recovery and AOG logistics.

CREATE SEQUENCE IF NOT EXISTS amo.inventory_count_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS amo.fulfillment_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS amo.aog_shipment_seq START 1001;

CREATE TABLE amo.inventory_count_sessions (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  station text NOT NULL,
  warehouse text,
  count_type text NOT NULL CHECK (count_type IN ('CYCLE','PHYSICAL')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','COUNTING','RECONCILIATION','CLOSED','CANCELLED')),
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_by text,
  started_at timestamptz,
  closed_by text,
  closed_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_count_sessions_idx ON amo.inventory_count_sessions(operator_id, station, status, created_at DESC);

CREATE TABLE amo.inventory_count_lines (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  session_id text NOT NULL REFERENCES amo.inventory_count_sessions(id) ON DELETE CASCADE,
  lot_id uuid REFERENCES amo.stock_lots(id),
  part_no text NOT NULL,
  serial text,
  lot_no text,
  bin_id uuid REFERENCES amo.warehouse_bins(id),
  expected_qty integer NOT NULL CHECK (expected_qty >= 0),
  counted_qty integer CHECK (counted_qty IS NULL OR counted_qty >= 0),
  variance_qty integer,
  discrepancy_reason text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COUNTED','RECONCILED')),
  counted_by text,
  counted_at timestamptz,
  reconciled_by text,
  reconciled_at timestamptz
);
CREATE INDEX inventory_count_lines_idx ON amo.inventory_count_lines(operator_id, session_id, status, part_no);

CREATE TABLE amo.fulfillment_orders (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  request_type text NOT NULL CHECK (request_type IN ('MAINTENANCE','AOG','TRANSFER','CUSTOMER','REPLENISHMENT')),
  request_ref text NOT NULL,
  station text NOT NULL,
  destination text NOT NULL,
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL','HIGH','AOG')),
  required_at timestamptz,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PICKING','PACKED','SHIPPED','RECEIVED','CANCELLED')),
  carrier text,
  shipment_ref text,
  tracking_ref text,
  packed_by text,
  packed_at timestamptz,
  shipped_by text,
  shipped_at timestamptz,
  received_by text,
  received_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fulfillment_orders_idx ON amo.fulfillment_orders(operator_id, station, status, priority, required_at);

CREATE TABLE amo.fulfillment_items (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  order_id text NOT NULL REFERENCES amo.fulfillment_orders(id) ON DELETE CASCADE,
  part_no text NOT NULL,
  qty_required integer NOT NULL CHECK (qty_required > 0),
  qty_picked integer NOT NULL DEFAULT 0 CHECK (qty_picked >= 0),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PARTIAL','PICKED','SHORT','ISSUED')),
  CHECK (qty_picked <= qty_required)
);
CREATE INDEX fulfillment_items_idx ON amo.fulfillment_items(operator_id, order_id, status, part_no);

CREATE TABLE amo.fulfillment_picks (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  item_id uuid NOT NULL REFERENCES amo.fulfillment_items(id) ON DELETE CASCADE,
  lot_id uuid NOT NULL REFERENCES amo.stock_lots(id),
  qty integer NOT NULL CHECK (qty > 0),
  picked_by text NOT NULL,
  picked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(item_id, lot_id)
);
CREATE INDEX fulfillment_picks_lot_idx ON amo.fulfillment_picks(operator_id, lot_id);

CREATE TABLE amo.replenishment_policies (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  part_no text NOT NULL,
  station text NOT NULL,
  min_qty integer NOT NULL CHECK (min_qty >= 0),
  max_qty integer NOT NULL CHECK (max_qty >= min_qty),
  reorder_qty integer NOT NULL CHECK (reorder_qty > 0),
  lead_days integer NOT NULL CHECK (lead_days >= 0),
  service_level numeric(5,4) NOT NULL DEFAULT 0.9500 CHECK (service_level > 0 AND service_level <= 1),
  preferred_vendor_id text REFERENCES amo.vendors(id),
  active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id, part_no, station)
);
CREATE INDEX replenishment_policies_idx ON amo.replenishment_policies(operator_id, station, active, part_no);

CREATE TABLE amo.demand_forecasts (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  part_no text NOT NULL,
  station text NOT NULL,
  horizon_start date NOT NULL,
  horizon_end date NOT NULL,
  maintenance_demand numeric(12,2) NOT NULL DEFAULT 0,
  historical_demand numeric(12,2) NOT NULL DEFAULT 0,
  reliability_demand numeric(12,2) NOT NULL DEFAULT 0,
  fleet_demand numeric(12,2) NOT NULL DEFAULT 0,
  safety_stock numeric(12,2) NOT NULL DEFAULT 0,
  forecast_qty numeric(12,2) NOT NULL CHECK (forecast_qty >= 0),
  method text NOT NULL CHECK (method IN ('WEIGHTED','PLANNER_OVERRIDE')),
  explanation jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_by text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (horizon_end >= horizon_start)
);
CREATE INDEX demand_forecasts_idx ON amo.demand_forecasts(operator_id, station, part_no, horizon_start DESC);

CREATE TABLE amo.consignment_agreements (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  vendor_id text NOT NULL REFERENCES amo.vendors(id),
  station text NOT NULL,
  part_no text,
  reference text NOT NULL,
  replenishment_terms text NOT NULL,
  ownership_terms text NOT NULL,
  effective_from date NOT NULL,
  effective_until date,
  active boolean NOT NULL DEFAULT true,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until >= effective_from),
  UNIQUE(operator_id, reference, effective_from)
);
CREATE INDEX consignment_agreements_idx ON amo.consignment_agreements(operator_id, station, active, part_no);

ALTER TABLE amo.stock_lots ADD COLUMN consignment_agreement_id uuid REFERENCES amo.consignment_agreements(id);
CREATE INDEX stock_lots_consignment_idx ON amo.stock_lots(operator_id, consignment_agreement_id) WHERE consignment_agreement_id IS NOT NULL;

CREATE TABLE amo.supplier_scorecards (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  vendor_id text NOT NULL REFERENCES amo.vendors(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  orders integer NOT NULL DEFAULT 0,
  on_time_orders integer NOT NULL DEFAULT 0,
  accepted_receipts integer NOT NULL DEFAULT 0,
  rejected_receipts integer NOT NULL DEFAULT 0,
  avg_lead_days numeric(10,2) NOT NULL DEFAULT 0,
  quality_ppm numeric(14,2) NOT NULL DEFAULT 0,
  price_variance_pct numeric(10,4) NOT NULL DEFAULT 0,
  score numeric(6,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  grade text NOT NULL CHECK (grade IN ('A','B','C','D')),
  approved_for_source boolean NOT NULL DEFAULT false,
  calculated_by text NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  UNIQUE(operator_id, vendor_id, period_start, period_end)
);
CREATE INDEX supplier_scorecards_idx ON amo.supplier_scorecards(operator_id, vendor_id, period_end DESC);


CREATE TABLE amo.supplier_quality_events (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  vendor_id text NOT NULL REFERENCES amo.vendors(id),
  receipt_id text REFERENCES amo.receipts(id),
  part_no text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('ACCEPTED','REJECTED','NCR','LATE_CERTIFICATE','DOCUMENT_DEFECT')),
  qty integer NOT NULL DEFAULT 1 CHECK (qty > 0),
  severity text NOT NULL DEFAULT 'MINOR' CHECK (severity IN ('MINOR','MAJOR','CRITICAL')),
  reference text,
  note text,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX supplier_quality_events_idx ON amo.supplier_quality_events(operator_id, vendor_id, recorded_at DESC, event_type);

CREATE TABLE amo.supplier_price_agreements (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  vendor_id text NOT NULL REFERENCES amo.vendors(id),
  part_no text NOT NULL,
  condition text NOT NULL CHECK (condition IN ('NE','NS','OH','SV','AR')),
  min_qty integer NOT NULL DEFAULT 1 CHECK (min_qty > 0),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  currency text NOT NULL,
  lead_days integer NOT NULL CHECK (lead_days >= 0),
  effective_from date NOT NULL,
  effective_until date,
  contract_ref text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until >= effective_from),
  UNIQUE(operator_id,vendor_id,part_no,condition,min_qty,effective_from)
);
CREATE INDEX supplier_price_agreements_idx ON amo.supplier_price_agreements(operator_id, part_no, active, effective_from DESC);

CREATE TABLE amo.source_decisions (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  requisition_id text NOT NULL REFERENCES amo.requisitions(id),
  vendor_id text NOT NULL REFERENCES amo.vendors(id),
  quote_id integer REFERENCES amo.quotes(id),
  scorecard_id uuid REFERENCES amo.supplier_scorecards(id),
  decision text NOT NULL CHECK (decision IN ('SELECTED','REJECTED')),
  rationale text NOT NULL,
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX source_decision_selected_once ON amo.source_decisions(operator_id, requisition_id) WHERE decision='SELECTED';
CREATE INDEX source_decisions_idx ON amo.source_decisions(operator_id, requisition_id, decided_at DESC);

CREATE TABLE amo.warranty_entitlements (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  receipt_id text NOT NULL REFERENCES amo.receipts(id),
  vendor_id text NOT NULL REFERENCES amo.vendors(id),
  part_no text NOT NULL,
  serial text,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  basis text NOT NULL,
  covered_failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_amount numeric(12,2),
  currency text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','VOID')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  CHECK ((max_amount IS NULL AND currency IS NULL) OR (max_amount IS NOT NULL AND max_amount >= 0 AND currency IS NOT NULL))
);
CREATE INDEX warranty_entitlements_idx ON amo.warranty_entitlements(operator_id, part_no, serial, ends_on, status);

CREATE TABLE amo.warranty_recoveries (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  claim_id text NOT NULL REFERENCES amo.warranty_claims(id),
  entitlement_id uuid REFERENCES amo.warranty_entitlements(id),
  claimed_amount numeric(12,2) NOT NULL CHECK (claimed_amount > 0),
  approved_amount numeric(12,2) CHECK (approved_amount IS NULL OR approved_amount >= 0),
  received_amount numeric(12,2) CHECK (received_amount IS NULL OR received_amount >= 0),
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','APPROVED','PARTIAL','RECOVERED','REJECTED','WRITTEN_OFF')),
  recovery_ref text,
  commercial_note text,
  reconciled_by text,
  reconciled_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id, claim_id)
);
CREATE INDEX warranty_recoveries_idx ON amo.warranty_recoveries(operator_id, status, created_at DESC);

CREATE TABLE amo.aog_shipments (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  aog_case_id text NOT NULL REFERENCES amo.aog_cases(id),
  fulfillment_order_id text REFERENCES amo.fulfillment_orders(id),
  courier text NOT NULL,
  awb text NOT NULL,
  origin text NOT NULL,
  destination text NOT NULL,
  dispatched_at timestamptz,
  eta timestamptz,
  delivered_at timestamptz,
  cost numeric(12,2),
  currency text,
  status text NOT NULL DEFAULT 'BOOKED' CHECK (status IN ('BOOKED','COLLECTED','IN_TRANSIT','CUSTOMS','DELIVERED','CANCELLED')),
  tracking_note text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id, awb),
  CHECK ((cost IS NULL AND currency IS NULL) OR (cost IS NOT NULL AND cost >= 0 AND currency IS NOT NULL))
);
CREATE INDEX aog_shipments_idx ON amo.aog_shipments(operator_id, aog_case_id, status, eta);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  amo.inventory_count_sessions, amo.inventory_count_lines,
  amo.fulfillment_orders, amo.fulfillment_items, amo.fulfillment_picks,
  amo.replenishment_policies, amo.demand_forecasts, amo.consignment_agreements,
  amo.supplier_scorecards, amo.supplier_quality_events, amo.supplier_price_agreements, amo.source_decisions, amo.warranty_entitlements,
  amo.warranty_recoveries, amo.aog_shipments
TO amo_svc;
GRANT USAGE, SELECT ON SEQUENCE amo.inventory_count_seq, amo.fulfillment_seq, amo.aog_shipment_seq TO amo_svc;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'inventory_count_sessions','inventory_count_lines','fulfillment_orders','fulfillment_items','fulfillment_picks',
    'replenishment_policies','demand_forecasts','consignment_agreements','supplier_scorecards','supplier_quality_events','supplier_price_agreements','source_decisions',
    'warranty_entitlements','warranty_recoveries','aog_shipments'
  ] LOOP
    EXECUTE format('ALTER TABLE amo.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE amo.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY aeroos_tenant_isolation ON amo.%I USING (current_setting(''aeroos.system'', true)=''true'' OR operator_id=nullif(current_setting(''aeroos.operator_id'', true),'''')) WITH CHECK (current_setting(''aeroos.system'', true)=''true'' OR operator_id=nullif(current_setting(''aeroos.operator_id'', true),''''))', t);
  END LOOP;
END $$;

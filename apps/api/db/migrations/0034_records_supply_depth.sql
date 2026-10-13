-- Technical Records domain and deeper supply-chain logistics.
CREATE SCHEMA IF NOT EXISTS records AUTHORIZATION aeroos_owner;

CREATE SEQUENCE IF NOT EXISTS records.binder_seq START 1001;
CREATE TABLE records.binders (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('AIRCRAFT','ENGINE','APU','COMPONENT','WORK_PACKAGE','LEASE')),
  subject_id text NOT NULL,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN','COMPLETE','ARCHIVED')) DEFAULT 'OPEN',
  retention_until date,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_by text,
  completed_at timestamptz,
  UNIQUE(operator_id, subject_type, subject_id, title)
);
CREATE TABLE records.requirements (
  id bigserial PRIMARY KEY,
  operator_id text NOT NULL,
  binder_id text NOT NULL REFERENCES records.binders(id) ON DELETE CASCADE,
  code text NOT NULL,
  title text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  UNIQUE(binder_id, code)
);
CREATE TABLE records.evidence (
  id bigserial PRIMARY KEY,
  operator_id text NOT NULL,
  binder_id text NOT NULL REFERENCES records.binders(id) ON DELETE CASCADE,
  requirement_id bigint NOT NULL REFERENCES records.requirements(id) ON DELETE CASCADE,
  document_id text NOT NULL,
  source_ref text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACCEPTED','REJECTED')) DEFAULT 'ACCEPTED',
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(binder_id, requirement_id, document_id)
);
CREATE TABLE records.packages (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  binder_id text NOT NULL REFERENCES records.binders(id),
  purpose text NOT NULL CHECK (purpose IN ('REDELIVERY','LEASE_TRANSITION','AUTHORITY','ARCHIVE')),
  manifest jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX records_binder_subject_idx ON records.binders(operator_id, subject_type, subject_id);
CREATE INDEX records_evidence_binder_idx ON records.evidence(operator_id, binder_id);

GRANT USAGE ON SCHEMA records TO records_svc;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA records TO records_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA records TO records_svc;
ALTER DEFAULT PRIVILEGES FOR ROLE aeroos_owner IN SCHEMA records GRANT SELECT, INSERT, UPDATE ON TABLES TO records_svc;
ALTER DEFAULT PRIVILEGES FOR ROLE aeroos_owner IN SCHEMA records GRANT USAGE, SELECT ON SEQUENCES TO records_svc;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['binders','requirements','evidence','packages'] LOOP
    EXECUTE format('ALTER TABLE records.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY aeroos_tenant_isolation ON records.%I USING (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), '''')) WITH CHECK (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), ''''))', t);
  END LOOP;
END $$;

-- Correct the legacy stores model: physical stock and reservations are tenant-owned.
ALTER TABLE amo.stock ADD COLUMN operator_id text;
DO $$
DECLARE c integer; only_operator text;
BEGIN
  IF EXISTS (SELECT 1 FROM amo.stock WHERE operator_id IS NULL) THEN
    SELECT count(*), min(operator_id) INTO c, only_operator FROM compliance.operator_profiles;
    IF c = 1 THEN
      UPDATE amo.stock SET operator_id = only_operator WHERE operator_id IS NULL;
    ELSIF EXISTS (SELECT 1 FROM amo.stock) THEN
      RAISE EXCEPTION 'Legacy amo.stock rows are unscoped and % operators exist. Map stock to operators before applying migration 0034.', c;
    END IF;
  END IF;
END $$;
ALTER TABLE amo.stock ALTER COLUMN operator_id SET NOT NULL;
ALTER TABLE amo.stock DROP CONSTRAINT stock_pkey;
ALTER TABLE amo.stock ADD PRIMARY KEY (operator_id, part_no, location);

ALTER TABLE amo.reservations ADD COLUMN operator_id text;
UPDATE amo.reservations r SET operator_id = t.operator_id FROM amo.task_cards t WHERE t.id = r.task_card_id AND r.operator_id IS NULL;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM amo.reservations WHERE operator_id IS NULL) THEN RAISE EXCEPTION 'Unable to derive operator for one or more legacy stock reservations'; END IF; END $$;
ALTER TABLE amo.reservations ALTER COLUMN operator_id SET NOT NULL;
CREATE INDEX reservations_operator_part ON amo.reservations(operator_id, part_no, status);
ALTER TABLE amo.stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE amo.reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY aeroos_tenant_isolation ON amo.stock USING (current_setting('aeroos.system', true) = 'true' OR operator_id = NULLIF(current_setting('aeroos.operator_id', true), '')) WITH CHECK (current_setting('aeroos.system', true) = 'true' OR operator_id = NULLIF(current_setting('aeroos.operator_id', true), ''));
CREATE POLICY aeroos_tenant_isolation ON amo.reservations USING (current_setting('aeroos.system', true) = 'true' OR operator_id = NULLIF(current_setting('aeroos.operator_id', true), '')) WITH CHECK (current_setting('aeroos.system', true) = 'true' OR operator_id = NULLIF(current_setting('aeroos.operator_id', true), ''));

-- Repair/loan logistics are owned by Supply Chain (AMO schema), not Records or Maintenance.
CREATE SEQUENCE IF NOT EXISTS amo.repair_order_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS amo.transfer_seq START 1001;
CREATE TABLE amo.repair_orders (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  vendor_id text NOT NULL REFERENCES amo.vendors(id),
  part_no text NOT NULL,
  serial text NOT NULL,
  reason text NOT NULL,
  station_from text NOT NULL,
  expected_return date,
  status text NOT NULL CHECK (status IN ('OPEN','SENT','AT_VENDOR','RETURNED','CLOSED','CANCELLED')) DEFAULT 'OPEN',
  outbound_ref text,
  release_certificate_ref text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE amo.stock_transfers (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  part_no text NOT NULL,
  qty integer NOT NULL CHECK(qty > 0),
  from_location text NOT NULL,
  to_location text NOT NULL,
  status text NOT NULL CHECK(status IN ('OPEN','IN_TRANSIT','RECEIVED','CANCELLED')) DEFAULT 'OPEN',
  shipment_ref text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  received_by text,
  received_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON amo.repair_orders, amo.stock_transfers TO amo_svc;
GRANT USAGE, SELECT ON SEQUENCE amo.repair_order_seq, amo.transfer_seq TO amo_svc;
ALTER TABLE amo.repair_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE amo.stock_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY aeroos_tenant_isolation ON amo.repair_orders USING (current_setting('aeroos.system', true) = 'true' OR operator_id = NULLIF(current_setting('aeroos.operator_id', true), '')) WITH CHECK (current_setting('aeroos.system', true) = 'true' OR operator_id = NULLIF(current_setting('aeroos.operator_id', true), ''));
CREATE POLICY aeroos_tenant_isolation ON amo.stock_transfers USING (current_setting('aeroos.system', true) = 'true' OR operator_id = NULLIF(current_setting('aeroos.operator_id', true), '')) WITH CHECK (current_setting('aeroos.system', true) = 'true' OR operator_id = NULLIF(current_setting('aeroos.operator_id', true), ''));

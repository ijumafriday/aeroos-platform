-- Technical Records domain completion: intake/classification, lease/redelivery, trace, retention/legal hold, custody and delivery reconciliation.
ALTER TABLE records.binders ADD COLUMN IF NOT EXISTS record_class text;
ALTER TABLE records.binders ADD COLUMN IF NOT EXISTS custodian text;
ALTER TABLE records.binders ADD COLUMN IF NOT EXISTS review_due date;
ALTER TABLE records.packages ADD COLUMN IF NOT EXISTS manifest_sha256 char(64);
ALTER TABLE records.packages ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'GENERATED' CHECK (status IN ('GENERATED','DELIVERED','ACKNOWLEDGED','REJECTED'));

CREATE SEQUENCE IF NOT EXISTS records.ingest_batch_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS records.lease_project_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS records.hold_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS records.disposition_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS records.delivery_seq START 1001;

CREATE TABLE records.record_classes (
  operator_id text NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  retention_years integer NOT NULL CHECK (retention_years >= 0),
  retention_trigger text NOT NULL CHECK (retention_trigger IN ('CREATED','COMPLETED','AIRCRAFT_TRANSFER','COMPONENT_REMOVAL','LEASE_END')),
  description text,
  active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(operator_id, code)
);

CREATE TABLE records.ingest_batches (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  source_system text NOT NULL,
  source_ref text NOT NULL,
  custodian text NOT NULL,
  received_at timestamptz NOT NULL,
  source_manifest_sha256 char(64) NOT NULL CHECK (source_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','REVIEW','COMPLETE','CANCELLED')),
  notes text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_by text,
  completed_at timestamptz
);

CREATE TABLE records.ingest_items (
  id bigserial PRIMARY KEY,
  operator_id text NOT NULL,
  batch_id text NOT NULL REFERENCES records.ingest_batches(id) ON DELETE CASCADE,
  document_id text NOT NULL,
  document_sha256 char(64) NOT NULL CHECK (document_sha256 ~ '^[0-9a-f]{64}$'),
  source_path text NOT NULL,
  status text NOT NULL DEFAULT 'STAGED' CHECK (status IN ('STAGED','EXTRACTED','REVIEWED','ACCEPTED','REJECTED','DUPLICATE')),
  duplicate_of bigint REFERENCES records.ingest_items(id),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operator_id, batch_id, document_id)
);
CREATE INDEX records_ingest_hash_idx ON records.ingest_items(operator_id, document_sha256);

CREATE TABLE records.document_profiles (
  id bigserial PRIMARY KEY,
  operator_id text NOT NULL,
  ingest_item_id bigint NOT NULL UNIQUE REFERENCES records.ingest_items(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_job_ref text NOT NULL,
  model_version text NOT NULL,
  extracted_text_sha256 char(64) NOT NULL CHECK (extracted_text_sha256 ~ '^[0-9a-f]{64}$'),
  extracted_text text NOT NULL,
  extracted_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  record_class text,
  subject_type text,
  subject_id text,
  record_date date,
  document_number text,
  page_from integer CHECK (page_from IS NULL OR page_from > 0),
  page_to integer CHECK (page_to IS NULL OR page_to > 0),
  review_status text NOT NULL DEFAULT 'PENDING' CHECK (review_status IN ('PENDING','ACCEPTED','REJECTED')),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (page_from IS NULL OR page_to IS NULL OR page_to >= page_from)
);
CREATE INDEX records_profile_subject_idx ON records.document_profiles(operator_id, subject_type, subject_id, record_date);
CREATE INDEX records_profile_class_idx ON records.document_profiles(operator_id, record_class, review_status);

CREATE TABLE records.custody_events (
  id bigserial PRIMARY KEY,
  operator_id text NOT NULL,
  document_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('RECEIVED','SCANNED','CLASSIFIED','REVIEWED','TRANSFERRED','PACKAGED','DELIVERED','ACKNOWLEDGED')),
  from_party text,
  to_party text,
  location text,
  reference text NOT NULL,
  actor text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX records_custody_document_idx ON records.custody_events(operator_id, document_id, occurred_at);

CREATE TABLE records.lease_projects (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  aircraft_id text NOT NULL,
  lessor text NOT NULL,
  lease_ref text NOT NULL,
  lease_end date NOT NULL,
  binder_id text NOT NULL REFERENCES records.binders(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ASSESSMENT','REMEDIATION','READY','DELIVERED','ACCEPTED','CLOSED','CANCELLED')),
  customer_contact text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_by text,
  accepted_at timestamptz,
  UNIQUE(operator_id, aircraft_id, lease_ref)
);

CREATE TABLE records.lease_requirements (
  id bigserial PRIMARY KEY,
  operator_id text NOT NULL,
  project_id text NOT NULL REFERENCES records.lease_projects(id) ON DELETE CASCADE,
  code text NOT NULL,
  category text NOT NULL CHECK (category IN ('AIRFRAME','ENGINE','APU','LLP','AD_SB','MODIFICATION','MAINTENANCE','COMPONENT','DOCUMENT','COMMERCIAL')),
  title text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  due_date date,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','EVIDENCED','ACCEPTED','WAIVED','REJECTED')),
  document_id text,
  source_ref text,
  disposition text,
  accepted_by text,
  accepted_at timestamptz,
  UNIQUE(project_id, code)
);

CREATE TABLE records.component_trace_entries (
  id bigserial PRIMARY KEY,
  operator_id text NOT NULL,
  project_id text REFERENCES records.lease_projects(id) ON DELETE CASCADE,
  part_no text NOT NULL,
  serial text NOT NULL,
  event_date date NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('MANUFACTURE','ORIGINAL_RELEASE','INSTALL','REMOVE','SHOP_VISIT','REPAIR','OVERHAUL','SCRAP')),
  document_id text NOT NULL,
  source_ref text NOT NULL,
  previous_entry_id bigint REFERENCES records.component_trace_entries(id),
  verified boolean NOT NULL DEFAULT false,
  verified_by text,
  verified_at timestamptz,
  UNIQUE(operator_id, part_no, serial, event_date, event_type, source_ref)
);
CREATE INDEX records_trace_serial_idx ON records.component_trace_entries(operator_id, part_no, serial, event_date);

CREATE TABLE records.retention_policies (
  operator_id text NOT NULL,
  record_class text NOT NULL,
  retention_years integer NOT NULL CHECK (retention_years >= 0),
  trigger text NOT NULL CHECK (trigger IN ('CREATED','COMPLETED','AIRCRAFT_TRANSFER','COMPONENT_REMOVAL','LEASE_END')),
  disposition_action text NOT NULL DEFAULT 'ARCHIVE' CHECK (disposition_action IN ('ARCHIVE','REVIEW')),
  legal_basis text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(operator_id, record_class)
);

CREATE TABLE records.legal_holds (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('BINDER','DOCUMENT','SUBJECT')),
  scope_id text NOT NULL,
  reason text NOT NULL,
  authority_ref text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RELEASED')),
  placed_by text NOT NULL,
  placed_at timestamptz NOT NULL DEFAULT now(),
  released_by text,
  released_at timestamptz,
  release_reason text
);
CREATE INDEX records_holds_scope_idx ON records.legal_holds(operator_id, scope_type, scope_id, status);

CREATE TABLE records.disposition_cases (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  binder_id text NOT NULL REFERENCES records.binders(id),
  eligible_on date NOT NULL,
  decision text CHECK (decision IN ('ARCHIVE','RETAIN')),
  rationale text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','APPROVED','CANCELLED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz
);

CREATE TABLE records.package_deliveries (
  id text PRIMARY KEY,
  operator_id text NOT NULL,
  package_id text NOT NULL REFERENCES records.packages(id),
  recipient text NOT NULL,
  delivery_method text NOT NULL CHECK (delivery_method IN ('SECURE_LINK','SFTP','PHYSICAL_MEDIA','AUTHORITY_PORTAL')),
  delivery_ref text NOT NULL,
  delivered_by text NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  acknowledgement_ref text,
  acknowledged_by text,
  acknowledged_at timestamptz,
  status text NOT NULL DEFAULT 'DELIVERED' CHECK (status IN ('DELIVERED','ACKNOWLEDGED','REJECTED')),
  rejection_reason text
);

GRANT SELECT,INSERT,UPDATE ON records.record_classes, records.ingest_batches, records.ingest_items, records.document_profiles, records.custody_events, records.lease_projects, records.lease_requirements, records.component_trace_entries, records.retention_policies, records.legal_holds, records.disposition_cases, records.package_deliveries TO records_svc;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA records TO records_svc;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['record_classes','ingest_batches','ingest_items','document_profiles','custody_events','lease_projects','lease_requirements','component_trace_entries','retention_policies','legal_holds','disposition_cases','package_deliveries'] LOOP
    EXECUTE format('ALTER TABLE records.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE records.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY aeroos_tenant_isolation ON records.%I USING (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), '''')) WITH CHECK (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), ''''))', t);
  END LOOP;
END $$;
ALTER TABLE records.binders FORCE ROW LEVEL SECURITY;
ALTER TABLE records.requirements FORCE ROW LEVEL SECURITY;
ALTER TABLE records.evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE records.packages FORCE ROW LEVEL SECURITY;

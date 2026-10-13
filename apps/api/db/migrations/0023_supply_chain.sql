-- Round 11: supply chain — approved suppliers, requisitions and quotes (RFQ), purchase orders, receiving
-- against release certificates, the bonded (customs) store, warranty claims, exchanges and PBH contracts.

ALTER TABLE amo.parts ADD COLUMN standard_part boolean NOT NULL DEFAULT false;   -- CoC acceptable (145.A.42(a)(ii))

CREATE SEQUENCE amo.vendor_seq START 1;

-- Reference exchange rates to the base currency (USD) for the purchase-order approval limit.
CREATE TABLE amo.fx_rates (
  currency      text PRIMARY KEY CHECK (currency ~ '^[A-Z]{3}$'),
  base_per_unit numeric(14, 6) NOT NULL CHECK (base_per_unit > 0),
  as_of         date NOT NULL
);
-- The base currency always exists; finance maintains the others (AMO → Procurement → Suppliers & rates).
INSERT INTO amo.fx_rates (currency, base_per_unit, as_of) VALUES ('USD', 1, current_date);

CREATE TABLE amo.vendors (
  id              text PRIMARY KEY,                     -- V-001
  operator_id     text    NOT NULL,
  name            text    NOT NULL,
  approval_type   text    NOT NULL CHECK (approval_type IN ('PART_145', 'PART_21G', 'DISTRIBUTOR', 'OEM')),
  approval_ref    text    NOT NULL,
  approved_until  date    NOT NULL,
  status          text    NOT NULL CHECK (status IN ('APPROVED', 'SUSPENDED')),
  warranty_months integer NOT NULL DEFAULT 12 CHECK (warranty_months BETWEEN 0 AND 120),
  country         text    NOT NULL
);

CREATE SEQUENCE amo.requisition_seq START 1;
CREATE TABLE amo.requisitions (
  id           text PRIMARY KEY,                        -- RQ-0001
  operator_id  text        NOT NULL,
  part_no      text        NOT NULL REFERENCES amo.parts (part_no),
  qty          integer     NOT NULL CHECK (qty > 0),
  station      text        NOT NULL,
  needed_by    date        NOT NULL,
  task_card_id text,
  reason       text        NOT NULL,
  status       text        NOT NULL CHECK (status IN ('OPEN', 'ORDERED', 'CANCELLED')),
  created_by   text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE amo.quotes (
  id             serial PRIMARY KEY,
  requisition_id text        NOT NULL REFERENCES amo.requisitions (id),
  vendor_id      text        NOT NULL REFERENCES amo.vendors (id),
  unit_price     numeric(12, 2) NOT NULL CHECK (unit_price > 0),
  currency       text        NOT NULL,
  lead_days      integer     NOT NULL CHECK (lead_days >= 0),
  condition      text        NOT NULL CHECK (condition IN ('NE', 'NS', 'OH', 'SV', 'AR')),
  valid_until    date        NOT NULL,
  created_by     text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE amo.po_seq START 1;
CREATE TABLE amo.purchase_orders (
  id             text PRIMARY KEY,                      -- PO-0001
  operator_id    text        NOT NULL,
  requisition_id text        REFERENCES amo.requisitions (id),
  vendor_id      text        NOT NULL REFERENCES amo.vendors (id),
  part_no        text        NOT NULL REFERENCES amo.parts (part_no),
  qty            integer     NOT NULL CHECK (qty > 0),
  received_qty   integer     NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  unit_price     numeric(12, 2) NOT NULL CHECK (unit_price > 0),
  currency       text        NOT NULL,
  condition      text        NOT NULL CHECK (condition IN ('NE', 'NS', 'OH', 'SV')),
  import         boolean     NOT NULL DEFAULT false,    -- arrives through customs: received into the bonded store
  station        text        NOT NULL,
  status         text        NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')),
  created_by     text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  approved_by    text,
  approved_at    timestamptz,
  version        integer     NOT NULL DEFAULT 1,
  CONSTRAINT received_within_order CHECK (received_qty <= qty),
  CONSTRAINT approved_by_other CHECK (approved_by IS NULL OR approved_by <> created_by)
);

CREATE SEQUENCE amo.receipt_seq START 1;
CREATE TABLE amo.receipts (
  id               text PRIMARY KEY,                    -- GR-0001
  operator_id      text        NOT NULL,
  po_id            text        REFERENCES amo.purchase_orders (id),
  vendor_id        text        NOT NULL REFERENCES amo.vendors (id),
  part_no          text        NOT NULL,
  qty              integer     NOT NULL CHECK (qty > 0),
  serials          text[]      NOT NULL DEFAULT '{}',
  certificate_type text        NOT NULL CHECK (certificate_type IN ('FORM1', 'FAA_8130_3', 'COC')),
  certificate_ref  text        NOT NULL,
  condition        text        NOT NULL CHECK (condition IN ('NE', 'NS', 'OH', 'SV')),
  station          text        NOT NULL,
  customs_status   text        NOT NULL CHECK (customs_status IN ('NONE', 'BONDED', 'CLEARED')),
  customs_ref      text,
  cleared_by       text,
  cleared_at       timestamptz,
  received_by      text        NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX receipts_bonded ON amo.receipts (operator_id) WHERE customs_status = 'BONDED';
CREATE INDEX receipts_serials ON amo.receipts USING gin (serials);

CREATE SEQUENCE amo.claim_seq START 1;
CREATE TABLE amo.warranty_claims (
  id             text PRIMARY KEY,                      -- WC-0001
  operator_id    text        NOT NULL,
  receipt_id     text        NOT NULL REFERENCES amo.receipts (id),
  vendor_id      text        NOT NULL REFERENCES amo.vendors (id),
  part_no        text        NOT NULL,
  serial         text,
  failure        text        NOT NULL,
  failed_at      date        NOT NULL,
  claimed_amount numeric(12, 2) NOT NULL CHECK (claimed_amount > 0),
  currency       text        NOT NULL,
  status         text        NOT NULL CHECK (status IN ('SUBMITTED', 'ACCEPTED', 'REJECTED', 'CREDITED')),
  vendor_ref     text,
  credit_amount  numeric(12, 2),
  decided_by     text,
  decided_at     timestamptz,
  created_by     text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  version        integer     NOT NULL DEFAULT 1
);

CREATE SEQUENCE amo.exchange_seq START 1;
CREATE TABLE amo.exchanges (
  id               text PRIMARY KEY,                    -- EX-0001
  operator_id      text        NOT NULL,
  vendor_id        text        NOT NULL REFERENCES amo.vendors (id),
  part_no          text        NOT NULL,
  serial_in        text        NOT NULL,                -- the serviceable unit received
  serial_out       text        NOT NULL,                -- the unserviceable core owed back
  fee              numeric(12, 2) NOT NULL CHECK (fee >= 0),
  currency         text        NOT NULL,
  core_due         date        NOT NULL,
  status           text        NOT NULL CHECK (status IN ('OPEN', 'CORE_RETURNED')),
  core_returned_at timestamptz,
  core_ref         text,
  created_by       text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE amo.pbh_contracts (
  id          text PRIMARY KEY,                         -- PBH-001
  operator_id text        NOT NULL,
  vendor_id   text        NOT NULL REFERENCES amo.vendors (id),
  scope       text        NOT NULL,
  tails       text[]      NOT NULL,
  rate_per_fh numeric(10, 2) NOT NULL CHECK (rate_per_fh > 0),
  currency    text        NOT NULL,
  starts      date        NOT NULL,
  ends        date        NOT NULL,
  CONSTRAINT pbh_period CHECK (ends > starts)
);

-- Flight hours per aircraft, projected from Ops (ops.flight.arrived) for power-by-the-hour statements.
CREATE TABLE amo.flight_hours (
  flight_id   text PRIMARY KEY,
  operator_id text        NOT NULL,
  tail        text        NOT NULL,
  arrived_at  timestamptz NOT NULL,
  minutes     integer     NOT NULL CHECK (minutes > 0)
);
CREATE INDEX flight_hours_tail ON amo.flight_hours (tail, arrived_at);
INSERT INTO amo.flight_hours (flight_id, operator_id, tail, arrived_at, minutes)
SELECT u.flight_id, f.operator_id, u.tail, u.arrived_at, u.block_minutes FROM camo.utilisation u JOIN camo.fleet f ON f.reg = u.tail
ON CONFLICT DO NOTHING;

GRANT SELECT, INSERT ON amo.flight_hours TO amo_svc;
GRANT SELECT, INSERT, UPDATE ON amo.vendors, amo.requisitions, amo.purchase_orders, amo.receipts, amo.warranty_claims, amo.exchanges, amo.pbh_contracts TO amo_svc;
GRANT SELECT, INSERT ON amo.quotes TO amo_svc;
GRANT SELECT, INSERT, UPDATE ON amo.fx_rates TO amo_svc;
GRANT USAGE ON SEQUENCE amo.requisition_seq, amo.po_seq, amo.receipt_seq, amo.claim_seq, amo.exchange_seq, amo.quotes_id_seq, amo.vendor_seq TO amo_svc;

-- One live claim per delivered unit (a rejected claim may be filed again with better evidence).
CREATE UNIQUE INDEX warranty_one_live_claim ON amo.warranty_claims (receipt_id, coalesce(serial, '')) WHERE status <> 'REJECTED';
ALTER TABLE amo.warranty_claims ADD CONSTRAINT claim_decided_by_other CHECK (decided_by IS NULL OR decided_by <> created_by);

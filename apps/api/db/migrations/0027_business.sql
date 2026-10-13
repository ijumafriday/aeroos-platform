-- Round 15: business — enterprise structure, third-party maintenance billing, general ledger.

/* ---------------------------------------------------------------- enterprise structure (org) */

-- Legal entities of the group, the approvals they hold (AOC, Part-145, Part-CAMO, Part-147) and their cost centres.
CREATE TABLE org.legal_entities (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  country     text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  currency    text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  parent_id   text REFERENCES org.legal_entities (id),
  -- the tenant whose people see and run this entity (the group holding may span several)
  operator_id text NOT NULL,
  org_number  text
);

CREATE TABLE org.entity_approvals (
  id          serial PRIMARY KEY,
  entity_id   text NOT NULL REFERENCES org.legal_entities (id),
  kind        text NOT NULL CHECK (kind IN ('AOC', 'PART145', 'CAMO', 'PART147', 'PART21J', 'PART21G')),
  reference   text NOT NULL,
  authority   text NOT NULL,
  valid_until date,
  scope       text NOT NULL DEFAULT ''
);

CREATE TABLE org.cost_centres (
  code        text PRIMARY KEY,
  entity_id   text NOT NULL REFERENCES org.legal_entities (id),
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('FLIGHT_OPS', 'MAINTENANCE', 'CAMO', 'MRO_SALES', 'STORES', 'ADMIN')),
  manager     text,
  active      boolean NOT NULL DEFAULT true
);

/* ---------------------------------------------------------------- general ledger (org) */

CREATE TABLE org.gl_accounts (
  code text PRIMARY KEY CHECK (code ~ '^\d{4}$'),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'))
);

CREATE TABLE org.gl_periods (
  entity_id  text NOT NULL REFERENCES org.legal_entities (id),
  period     text NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  status     text NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
  closed_by  text,
  closed_at  timestamptz,
  PRIMARY KEY (entity_id, period)
);

CREATE SEQUENCE org.journal_seq;
CREATE TABLE org.journal_entries (
  id          text PRIMARY KEY,
  entity_id   text        NOT NULL REFERENCES org.legal_entities (id),
  operator_id text        NOT NULL,
  entry_date  date        NOT NULL,
  period      text        NOT NULL,
  -- where it came from: an event type (automatic) or 'manual'; the reference makes event postings idempotent
  source      text        NOT NULL,
  source_ref  text        NOT NULL,
  memo        text        NOT NULL,
  currency    text        NOT NULL DEFAULT 'USD',
  base_per_unit numeric(14, 6) NOT NULL DEFAULT 1,
  posted_by   text        NOT NULL,
  posted_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_ref)
);
CREATE INDEX journal_entries_period ON org.journal_entries (entity_id, period);

CREATE TABLE org.journal_lines (
  id           bigserial PRIMARY KEY,
  entry_id     text   NOT NULL REFERENCES org.journal_entries (id),
  account      text   NOT NULL REFERENCES org.gl_accounts (code),
  cost_centre  text REFERENCES org.cost_centres (code),
  debit_cents  bigint NOT NULL CHECK (debit_cents >= 0),
  credit_cents bigint NOT NULL CHECK (credit_cents >= 0),
  CHECK ((debit_cents > 0) <> (credit_cents > 0))
);
CREATE INDEX journal_lines_entry ON org.journal_lines (entry_id);

-- Every entry balances: checked when the transaction commits (all lines of an entry are inserted together).
CREATE FUNCTION org.check_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d bigint; c bigint;
BEGIN
  SELECT coalesce(sum(debit_cents), 0), coalesce(sum(credit_cents), 0) INTO d, c FROM org.journal_lines WHERE entry_id = NEW.entry_id;
  IF d <> c THEN RAISE EXCEPTION 'journal % does not balance (% vs %)', NEW.entry_id, d, c; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_balanced AFTER INSERT ON org.journal_lines DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION org.check_journal_balanced();

GRANT SELECT ON org.legal_entities, org.entity_approvals, org.gl_accounts TO org_svc;
GRANT SELECT, INSERT, UPDATE ON org.cost_centres, org.gl_periods TO org_svc;
GRANT SELECT, INSERT ON org.journal_entries, org.journal_lines TO org_svc;
GRANT USAGE ON SEQUENCE org.journal_seq, org.journal_lines_id_seq TO org_svc;

/* ---------------------------------------------------------------- third-party maintenance billing (amo) */

CREATE SEQUENCE amo.customer_seq;
CREATE TABLE amo.customers (
  id                 text PRIMARY KEY,
  operator_id        text          NOT NULL,
  name               text          NOT NULL,
  country            text          NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  currency           text          NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  labour_rate        numeric(10, 2) NOT NULL CHECK (labour_rate > 0),
  parts_markup_pct   numeric(5, 2) NOT NULL DEFAULT 15 CHECK (parts_markup_pct >= 0),
  service_markup_pct numeric(5, 2) NOT NULL DEFAULT 10 CHECK (service_markup_pct >= 0),
  vat_pct            numeric(5, 2) NOT NULL DEFAULT 0 CHECK (vat_pct >= 0 AND vat_pct <= 50),
  payment_terms_days integer       NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 180),
  credit_limit       numeric(14, 2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  created_by         text          NOT NULL,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (operator_id, name)
);

CREATE SEQUENCE amo.customer_order_seq;
CREATE TABLE amo.customer_orders (
  id              text PRIMARY KEY,
  operator_id     text        NOT NULL,
  customer_id     text        NOT NULL REFERENCES amo.customers (id),
  aircraft_reg    text        NOT NULL,
  aircraft_type   text        NOT NULL,
  title           text        NOT NULL,
  status          text        NOT NULL CHECK (status IN ('QUOTED', 'APPROVED', 'IN_WORK', 'COMPLETED', 'INVOICED', 'CANCELLED')),
  currency        text        NOT NULL,
  quote_lines     jsonb       NOT NULL,
  quote_net_cents bigint      NOT NULL,
  customer_ref    text,
  approved_at     timestamptz,
  overrun_ref     text,
  cost_centre     text        NOT NULL,
  created_by      text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  version         integer     NOT NULL DEFAULT 1
);

CREATE TABLE amo.order_lines (
  id          serial PRIMARY KEY,
  order_id    text          NOT NULL REFERENCES amo.customer_orders (id),
  kind        text          NOT NULL CHECK (kind IN ('LABOUR', 'PART', 'SERVICE')),
  description text          NOT NULL,
  qty         numeric(10, 2) NOT NULL CHECK (qty > 0),
  unit_cost   numeric(12, 2) NOT NULL CHECK (unit_cost >= 0),
  work_date   date          NOT NULL,
  booked_by   text          NOT NULL,
  booked_at   timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX order_lines_order ON amo.order_lines (order_id);

-- Gap-free invoice / credit-note numbering per issuing operator, series and year (bookkeeping rules expect a continuous sequence):
-- the counter row is updated in the issuing transaction, so a rolled-back invoice does not use up a number.
CREATE TABLE amo.invoice_numbers (
  operator_id text NOT NULL,
  series text    NOT NULL CHECK (series IN ('INV', 'CN')),
  year   integer NOT NULL,
  last   integer NOT NULL CHECK (last >= 0),
  PRIMARY KEY (operator_id, series, year)
);
CREATE TABLE amo.invoices (
  id            text PRIMARY KEY,
  operator_id   text          NOT NULL,
  kind          text          NOT NULL CHECK (kind IN ('INVOICE', 'CREDIT_NOTE')),
  credits       text REFERENCES amo.invoices (id),
  order_id      text          NOT NULL REFERENCES amo.customer_orders (id),
  customer_id   text          NOT NULL REFERENCES amo.customers (id),
  issued_on     date          NOT NULL,
  due_on        date          NOT NULL,
  currency      text          NOT NULL,
  base_per_unit numeric(14, 6) NOT NULL,
  lines         jsonb         NOT NULL,
  labour_cents  bigint        NOT NULL,
  parts_cents   bigint        NOT NULL,
  service_cents bigint        NOT NULL,
  net_cents     bigint        NOT NULL,
  vat_cents     bigint        NOT NULL,
  total_cents   bigint        NOT NULL,
  paid_cents    bigint        NOT NULL DEFAULT 0,
  status        text          NOT NULL CHECK (status IN ('ISSUED', 'PARTIALLY_PAID', 'PAID', 'CREDITED')),
  reason        text,
  issued_by     text          NOT NULL,
  issued_at     timestamptz   NOT NULL DEFAULT now(),
  version       integer       NOT NULL DEFAULT 1,
  CHECK (paid_cents >= 0 AND paid_cents <= total_cents)
);
-- one live invoice per order (a credit note frees the order for a corrected invoice)
CREATE UNIQUE INDEX invoices_one_live ON amo.invoices (order_id) WHERE kind = 'INVOICE' AND status <> 'CREDITED';

CREATE TABLE amo.payments (
  id           serial PRIMARY KEY,
  invoice_id   text        NOT NULL REFERENCES amo.invoices (id),
  amount_cents bigint      NOT NULL CHECK (amount_cents > 0),
  reference    text        NOT NULL,
  received_on  date        NOT NULL,
  recorded_by  text        NOT NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, reference)
);

GRANT SELECT, INSERT, UPDATE ON amo.customers, amo.customer_orders, amo.invoices, amo.invoice_numbers TO amo_svc;
GRANT SELECT, INSERT ON amo.order_lines, amo.payments TO amo_svc;
GRANT USAGE ON SEQUENCE amo.customer_seq, amo.customer_order_seq, amo.order_lines_id_seq, amo.payments_id_seq TO amo_svc;

-- AeroOS 0.44.0 — Commercial / Finance domain completion.
CREATE TABLE org.commercial_contracts (
 id text PRIMARY KEY, operator_id text NOT NULL, contract_no text NOT NULL, contract_type text NOT NULL CHECK(contract_type IN ('MAINTENANCE','ACMI','CHARTER','GROUND_HANDLING','SUPPLY','LEASE','OTHER')), counterparty text NOT NULL, currency char(3) NOT NULL,
 effective_from date NOT NULL, effective_until date, notice_days integer NOT NULL DEFAULT 30 CHECK(notice_days >= 0), billing_basis text NOT NULL, liability_cap numeric(18,2), status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','REVIEW','APPROVED','ACTIVE','SUSPENDED','EXPIRED','TERMINATED')),
 owner text NOT NULL, terms_sha256 char(64) NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), submitted_by text, submitted_at timestamptz, approved_by text, approved_at timestamptz, activated_by text, activated_at timestamptz, termination_reason text,
 UNIQUE(operator_id,contract_no));
CREATE TABLE org.commercial_contract_amendments (
 id text PRIMARY KEY, operator_id text NOT NULL, contract_id text NOT NULL REFERENCES org.commercial_contracts(id) ON DELETE CASCADE, amendment_no integer NOT NULL, summary text NOT NULL, effective_from date NOT NULL, terms_sha256 char(64) NOT NULL,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','REVIEW','APPROVED','REJECTED')), created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), approved_by text, approved_at timestamptz, UNIQUE(operator_id,contract_id,amendment_no));
CREATE TABLE org.commercial_rate_cards (
 id text PRIMARY KEY, operator_id text NOT NULL, contract_id text NOT NULL REFERENCES org.commercial_contracts(id) ON DELETE CASCADE, revision integer NOT NULL, effective_from date NOT NULL, rate_basis jsonb NOT NULL DEFAULT '{}'::jsonb, escalation_rule text, currency char(3) NOT NULL,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED','SUPERSEDED')), created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), approved_by text, approved_at timestamptz, UNIQUE(operator_id,contract_id,revision));
CREATE TABLE org.commercial_obligations (
 id text PRIMARY KEY, operator_id text NOT NULL, contract_id text NOT NULL REFERENCES org.commercial_contracts(id) ON DELETE CASCADE, obligation_type text NOT NULL, description text NOT NULL, owner text NOT NULL, due_on date, recurrence text, sla_minutes integer CHECK(sla_minutes IS NULL OR sla_minutes >= 0), evidence_required boolean NOT NULL DEFAULT true,
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','DUE','MET','BREACHED','WAIVED')), evidence_ref text, updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE org.commercial_cost_allocations (
 id text PRIMARY KEY, operator_id text NOT NULL, source_type text NOT NULL, source_ref text NOT NULL, contract_id text REFERENCES org.commercial_contracts(id), cost_centre text NOT NULL, account_code text NOT NULL, activity_code text, tail text, flight_no text, work_order_ref text,
 currency char(3) NOT NULL, amount numeric(18,2) NOT NULL, base_currency char(3) NOT NULL, fx_rate numeric(18,8) NOT NULL CHECK(fx_rate > 0), base_amount numeric(18,2) NOT NULL, allocation_basis text NOT NULL, occurred_on date NOT NULL, approved_by text, approved_at timestamptz, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(operator_id,source_type,source_ref,cost_centre,account_code));
CREATE TABLE org.commercial_accruals (
 id text PRIMARY KEY, operator_id text NOT NULL, period char(7) NOT NULL, contract_id text REFERENCES org.commercial_contracts(id), source_ref text NOT NULL, description text NOT NULL, currency char(3) NOT NULL, amount numeric(18,2) NOT NULL, base_amount numeric(18,2) NOT NULL, account_code text NOT NULL, cost_centre text NOT NULL,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED','POSTED','REVERSED')), reversal_period char(7), evidence_ref text NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), approved_by text, approved_at timestamptz, posted_ref text, reversed_by text, reversed_at timestamptz, UNIQUE(operator_id,period,source_ref,account_code,cost_centre));
CREATE TABLE org.inventory_valuation_snapshots (
 id text PRIMARY KEY, operator_id text NOT NULL, valuation_date date NOT NULL, warehouse text NOT NULL, method text NOT NULL CHECK(method IN ('WEIGHTED_AVERAGE','FIFO','SPECIFIC_IDENTIFICATION')), currency char(3) NOT NULL, gross_value numeric(18,2) NOT NULL, provision_value numeric(18,2) NOT NULL DEFAULT 0, net_value numeric(18,2) NOT NULL,
 item_count integer NOT NULL CHECK(item_count >= 0), source_sha256 char(64) NOT NULL, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED','LOCKED')), created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), approved_by text, approved_at timestamptz, UNIQUE(operator_id,valuation_date,warehouse,method));
CREATE TABLE org.fx_rates (
 id text PRIMARY KEY, operator_id text NOT NULL, rate_date date NOT NULL, base_currency char(3) NOT NULL, quote_currency char(3) NOT NULL, rate numeric(18,8) NOT NULL CHECK(rate > 0), source text NOT NULL, source_sha256 char(64) NOT NULL, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED','SUPERSEDED')), created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), approved_by text, approved_at timestamptz, UNIQUE(operator_id,rate_date,base_currency,quote_currency,status));
CREATE TABLE org.fx_exposures (
 id text PRIMARY KEY, operator_id text NOT NULL, period char(7) NOT NULL, source_type text NOT NULL, source_ref text NOT NULL, currency char(3) NOT NULL, foreign_amount numeric(18,2) NOT NULL, booked_rate numeric(18,8) NOT NULL CHECK(booked_rate > 0), closing_rate numeric(18,8), booked_base numeric(18,2) NOT NULL, closing_base numeric(18,2), unrealized_gain_loss numeric(18,2), status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','REVALUED','SETTLED')), rate_ref text, revalued_by text, revalued_at timestamptz, UNIQUE(operator_id,period,source_type,source_ref));
CREATE INDEX commercial_contract_status_idx ON org.commercial_contracts(operator_id,status,effective_until);
CREATE INDEX commercial_obligation_due_idx ON org.commercial_obligations(operator_id,status,due_on);
CREATE INDEX commercial_cost_period_idx ON org.commercial_cost_allocations(operator_id,occurred_on,cost_centre);
CREATE INDEX commercial_accrual_period_idx ON org.commercial_accruals(operator_id,period,status);
CREATE INDEX commercial_fx_period_idx ON org.fx_exposures(operator_id,period,status);
GRANT SELECT,INSERT,UPDATE ON org.commercial_contracts,org.commercial_contract_amendments,org.commercial_rate_cards,org.commercial_obligations,org.commercial_cost_allocations,org.commercial_accruals,org.inventory_valuation_snapshots,org.fx_rates,org.fx_exposures TO org_svc;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['commercial_contracts','commercial_contract_amendments','commercial_rate_cards','commercial_obligations','commercial_cost_allocations','commercial_accruals','inventory_valuation_snapshots','fx_rates','fx_exposures'] LOOP
  EXECUTE format('ALTER TABLE org.%I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE org.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY aeroos_tenant_isolation ON org.%I USING (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), '''')) WITH CHECK (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), ''''))',t);
 END LOOP;
END $$;

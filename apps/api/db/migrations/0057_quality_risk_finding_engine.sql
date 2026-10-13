-- AeroOS 0.50.0 — explicit Quality Risk & Finding Classification Engine.
-- Additive only: legacy findings remain readable; new findings are classified by application policy.
ALTER TABLE org.findings
  ADD COLUMN IF NOT EXISTS likelihood integer CHECK (likelihood BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS impact integer CHECK (impact BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS risk_score integer CHECK (risk_score BETWEEN 1 AND 25),
  ADD COLUMN IF NOT EXISTS risk_class text CHECK (risk_class IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  ADD COLUMN IF NOT EXISTS classification_basis text,
  ADD COLUMN IF NOT EXISTS containment_action text,
  ADD COLUMN IF NOT EXISTS recurrence boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS findings_quality_tracker
  ON org.findings (operator_id, status, risk_class, due);
CREATE INDEX IF NOT EXISTS findings_requirement_tracker
  ON org.findings (operator_id, requirement, status);

-- Audit entries carry the operator they concern, so the audit trail view shows each AOC only its own entries.
-- The chains (and their hashes) stay platform-wide; operator_id is outside the hash but, like every column,
-- protected by the append-only trigger. Entries written before 0.5.0 have no operator (NULL).
ALTER TABLE platform.audit_log ADD COLUMN operator_id text;
CREATE INDEX audit_log_operator_chain ON platform.audit_log (operator_id, chain, seq DESC);

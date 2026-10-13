-- Delivery 5: the compliance matrix counts audit actions per operator and period (page and evidence pack).
CREATE INDEX IF NOT EXISTS audit_log_operator_action_at ON platform.audit_log (operator_id, action, at);

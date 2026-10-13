-- Second demo operator, Fjell Regional (FJR), EASA: two Dash 8-400s out of Bergen. Its schedule and
-- crew are created by the API (OpsDemoSchedule). Users in both Keycloak groups (occ.controller,
-- camo.manager, quality.manager, auditor) switch operator in the top bar; everyone else sees NKX only.
INSERT INTO compliance.operator_profiles (operator_id, name, authority, mel_time_zone, approved_types) VALUES
  ('FJR', 'Fjell Regional', 'EASA', 'UTC', ARRAY['DHC-8-400'])
ON CONFLICT (operator_id) DO NOTHING;

INSERT INTO compliance.mel_entries (operator_id, ref, ata, title, category, interval_hours, extension_permitted, ops_procedure, maint_procedure) VALUES
  ('FJR', '30-61-01', '30', 'Propeller de-ice (one blade heater)', 'C', NULL, false, '(O) Not dispatched into known icing', '(M) Deactivate the affected heater'),
  ('FJR', '33-42-01', '33', 'Landing light (one of two)', 'C', NULL, true, '(O) Night operations with one landing light permitted', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO camo.fleet (reg, operator_id, aircraft_type, msn, status) VALUES
  ('LN-WFA', 'FJR', 'DHC-8-400', '4588', 'SVC'),
  ('LN-WFB', 'FJR', 'DHC-8-400', '4601', 'SVC')
ON CONFLICT (reg) DO NOTHING;

INSERT INTO camo.aircraft_counters (reg, delivery_date, base_at, base_fh, base_fc) VALUES
  ('LN-WFA', '2014-03-01', now(), 19800.0, 26100),
  ('LN-WFB', '2015-01-20', now(), 18250.5, 24420)
ON CONFLICT (reg) DO NOTHING;

INSERT INTO camo.reliability_alert_levels (operator_id, ata, alert_level) VALUES
  ('FJR', '30', 2.0), ('FJR', '33', 1.5)
ON CONFLICT DO NOTHING;

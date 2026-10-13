-- Demo reference data for the fictional operator Nordkapp Air (NKX), certified under EASA.
-- Applied only when SEED_DEMO=true. Re-runnable.

INSERT INTO compliance.operator_profiles (operator_id, name, authority, mel_time_zone, approved_types) VALUES
  ('NKX', 'Nordkapp Air', 'EASA', 'UTC', ARRAY['B737-800', 'B737 MAX 8', 'A320neo', 'A330-300', 'DHC-8-400', 'E195-E2'])
ON CONFLICT (operator_id) DO NOTHING;

INSERT INTO compliance.mel_entries (operator_id, ref, ata, title, category, interval_hours, extension_permitted, ops_procedure, maint_procedure) VALUES
  ('NKX', '21-51-02', '21', 'Pack flow control valve', 'B', NULL, true, '(O) Flight level limited to FL310', '(M) Secure valve closed'),
  ('NKX', '23-31-02', '23', 'Passenger address — one zone', 'C', NULL, true, '(O) Megaphone available for affected zone', NULL),
  ('NKX', '25-41-03', '25', 'Lavatory mirror', 'D', NULL, true, NULL, 'Placard'),
  ('NKX', '30-42-01', '30', 'Windshield anti-ice (one side)', 'C', NULL, false, '(O) Not dispatched into known icing', NULL),
  ('NKX', '31-31-01', '31', 'Flight data recorder status', 'A', 24, false, NULL, '(M) Verify recording before each flight day'),
  ('NKX', '33-42-01', '33', 'Landing light (one of two)', 'C', NULL, true, '(O) Night operations with one landing light acceptable', NULL),
  ('NKX', '34-11-07', '34', 'Standby attitude indicator lighting', 'C', NULL, true, NULL, NULL),
  ('NKX', '36-11-04', '36', 'Bleed duct overtemperature sensor (one channel)', 'B', NULL, false, NULL, '(M) Verify remaining channel each flight day')
ON CONFLICT (operator_id, ref) DO NOTHING;

INSERT INTO org.personnel (id, operator_id, username, name, licence_no) VALUES
  ('P-4471', 'NKX', 'k.mwangi', 'Kevin Mwangi', 'NO.66.4471'),
  ('P-3015', 'NKX', 'a.saleh', 'Ahmed Saleh', 'NO.66.3015'),
  ('P-0101', 'NKX', 'camo.engineer', 'Marte Strand', NULL),
  ('P-0102', 'NKX', 'camo.manager', 'Henrik Dahl', NULL),
  ('P-0201', 'NKX', 'occ.controller', 'Ingrid Solberg', NULL),
  ('P-0301', 'NKX', 'auditor', 'Leila Haddad', NULL)
ON CONFLICT (id) DO NOTHING;

-- Privileges are inserted only once (no natural key), guarded by NOT EXISTS.
INSERT INTO org.privileges (personnel_id, authority, category, type_ratings, valid_until)
SELECT * FROM (VALUES
  ('P-4471', 'EASA', 'B1.1', ARRAY['B737-800', 'A320neo'], now() + interval '2 years'),
  ('P-4471', 'EASA', 'B2', ARRAY['B737-800'], now() + interval '2 years'),
  ('P-3015', 'EASA', 'B2', ARRAY['A330-300'], now() - interval '4 days')
) AS v(personnel_id, authority, category, type_ratings, valid_until)
WHERE NOT EXISTS (SELECT 1 FROM org.privileges);

-- Company authorisations (org.authorisations has the Delivery 2 lifecycle shape since migration 0005).
INSERT INTO org.authorisations (id, operator_id, personnel_id, reference, aircraft_types, issued_at, valid_until, status, issue_rule, history) VALUES
  ('AUT-0901', 'NKX', 'P-4471', 'C-AUTH 145-112', ARRAY['B737-800', 'A320neo'], now() - interval '1 year', now() + interval '1 year', 'ACTIVE', 'EASA@2026.1',
   jsonb_build_array(jsonb_build_object('at', now() - interval '1 year', 'action', 'ISSUED', 'by', 'seed', 'reason', null))),
  ('AUT-0902', 'NKX', 'P-3015', 'C-AUTH 145-087', ARRAY['A330-300'], now() - interval '1 year', now() + interval '1 year', 'ACTIVE', 'EASA@2026.1',
   jsonb_build_array(jsonb_build_object('at', now() - interval '1 year', 'action', 'ISSUED', 'by', 'seed', 'reason', null)))
ON CONFLICT (id) DO NOTHING;

INSERT INTO camo.fleet (reg, operator_id, aircraft_type, msn, status) VALUES
  ('LN-ABC', 'NKX', 'B737-800', '38871', 'SVC'),
  ('LN-ABD', 'NKX', 'B737-800', '38874', 'SVC'),
  ('LN-NGX', 'NKX', 'B737 MAX 8', '62451', 'SVC'),
  ('LN-RKF', 'NKX', 'A320neo', '10288', 'SVC'),
  ('LN-RKG', 'NKX', 'A320neo', '10411', 'AOG'),
  ('LN-RTA', 'NKX', 'A330-300', '1702', 'SVC'),
  ('LN-WDE', 'NKX', 'DHC-8-400', '4612', 'AOG'),
  ('LN-FNX', 'NKX', 'E195-E2', '19020034', 'AOG')
ON CONFLICT (reg) DO NOTHING;

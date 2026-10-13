-- Delivery 2 demo data: Organization Core (training, experience, a lapsed engineer, the quality manager).
-- Applied only when SEED_DEMO=true. Works on a fresh database and on one seeded by Delivery 1.

INSERT INTO org.personnel (id, operator_id, username, name, licence_no, role_title, base) VALUES
  ('P-5120', 'NKX', 'j.otieno', 'Joseph Otieno', 'NO.66.5120', 'B1 Licensed Engineer', 'OSL'),
  ('P-0401', 'NKX', 'quality.manager', 'Grace Wanjiru', NULL, 'Quality Manager / Compliance Monitoring Manager', 'OSL'),
  ('P-0402', 'NKX', 'safety.manager', 'Amina Hassan', NULL, 'Safety Manager / SMS Manager', 'OSL')
ON CONFLICT (id) DO NOTHING;

UPDATE org.personnel SET role_title = v.role_title, base = 'OSL'
FROM (VALUES
  ('P-4471', 'B1/B2 Licensed Engineer'),
  ('P-3015', 'B2 Licensed Engineer'),
  ('P-0101', 'CAMO Airworthiness Engineer'),
  ('P-0102', 'CAMO Manager'),
  ('P-0201', 'OCC Duty Controller'),
  ('P-0301', 'Compliance Auditor')
) AS v(id, role_title)
WHERE org.personnel.id = v.id AND org.personnel.role_title IS NULL;

INSERT INTO org.privileges (personnel_id, authority, category, type_ratings, valid_until)
SELECT 'P-5120', 'EASA', 'B1.1', ARRAY['B737-800'], now() + interval '3 years'
WHERE NOT EXISTS (SELECT 1 FROM org.privileges WHERE personnel_id = 'P-5120');

-- Valid licence and authorisation, but continuation training has lapsed: the currency rule refuses him.
INSERT INTO org.authorisations (id, operator_id, personnel_id, reference, aircraft_types, issued_at, valid_until, status, issue_rule, history)
SELECT 'AUT-0903', 'NKX', 'P-5120', 'C-AUTH 145-140', ARRAY['B737-800'], now() - interval '2 years', now() + interval '25 days', 'ACTIVE', 'EASA@2026.1',
       jsonb_build_array(jsonb_build_object('at', now() - interval '2 years', 'action', 'ISSUED', 'by', 'seed', 'reason', null))
WHERE NOT EXISTS (SELECT 1 FROM org.authorisations WHERE personnel_id = 'P-5120');

INSERT INTO org.training_records (id, personnel_id, course, title, completed_at, recorded_by) VALUES
  ('TR-0901', 'P-4471', 'CONTINUATION', 'Continuation training 2025 (incl. human factors)', now() - interval '14 months', 'seed'),
  ('TR-0902', 'P-4471', 'FUEL_TANK_SAFETY', 'Fuel tank safety phase 2', now() - interval '20 months', 'seed'),
  ('TR-0903', 'P-3015', 'CONTINUATION', 'Continuation training 2025', now() - interval '10 months', 'seed'),
  ('TR-0904', 'P-5120', 'CONTINUATION', 'Continuation training 2024', now() - interval '26 months', 'seed'),
  ('TR-0905', 'P-5120', 'TYPE', 'B737-800 type training (B1)', now() - interval '4 years', 'seed')
ON CONFLICT (id) DO NOTHING;

-- Experience: one entry per month worked (historic records imported from the previous system).
INSERT INTO org.experience_log (personnel_id, work_at, source_type, source_id, detail)
SELECT x.pid, now() - (m || ' months')::interval, 'import', x.pid || '-' || m, 'Imported from legacy MIS'
FROM (VALUES ('P-4471', 11), ('P-3015', 9), ('P-5120', 8)) AS x(pid, months),
     generate_series(1, 12) AS m
WHERE m <= x.months
ON CONFLICT DO NOTHING;

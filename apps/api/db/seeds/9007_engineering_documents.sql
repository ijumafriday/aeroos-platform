-- Round 9 demo data: component history, AD/SB intake, controlled documents.

-- Back-to-birth history starts with what is installed (idempotent).
INSERT INTO camo.component_events (operator_id, part_no, serial, type, tail, position, at, tsn, csn, reference, recorded_by)
SELECT f.operator_id, c.part_no, c.serial, 'INSTALLED', c.tail, c.position, c.installed_at, c.part_tsn_at_install, c.part_csn_at_install, 'Records transfer', 'seed'
FROM camo.components c JOIN camo.fleet f ON f.reg = c.tail
WHERE c.removed_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM camo.component_events e WHERE e.part_no = c.part_no AND e.serial = c.serial);

-- A spare engine LLP in stores with history: removed from LN-ABD's engine at the last shop visit.
INSERT INTO camo.component_events (operator_id, part_no, serial, type, tail, position, at, tsn, csn, reason, reference, recorded_by)
SELECT 'NKX', '2073M48P01', 'GWN0Y388', v.type, 'LN-ABD', 'ENG 1', now() - (v.days_ago || ' days')::interval, v.tsn, v.csn, v.reason, v.ref, 'seed'
FROM (VALUES ('INSTALLED', 2900, 14100.0, 9400, NULL, 'EASA Form 1 SR-55102'), ('REMOVED', 2001, 21950.0, 14650, 'SCHEDULED', 'Shop visit WO-2209 (module swap)')) AS v(type, days_ago, tsn, csn, reason, ref)
WHERE NOT EXISTS (SELECT 1 FROM camo.component_events e WHERE e.serial = 'GWN0Y388');

-- AD / SB intake.
INSERT INTO camo.directives (id, operator_id, kind, ref, revision, authority, title, ata, types, msn_ranges, effective, action, interval, repetitive, estimated_hours, steps, status, received_by, received_at)
VALUES
  ('DIR-1001', 'NKX', 'AD', 'EASA AD 2026-0217', '', 'EASA', 'Elevator tab control rod — detailed inspection', '27', ARRAY['B737-800'],
   '[{"from": "38800", "to": "38872"}]', (now() + interval '12 days')::date,
   'Detailed visual inspection of the elevator tab control rod ends for cracks per Boeing SB 737-27A1350; repeat every 3,000 FC.',
   '{"fc": 3000}', true, 3, '["Gain access to the elevator tab rods (AMM 27-31-00)", "Detailed visual inspection of both rod ends per SB 737-27A1350", "Record findings; replace any cracked rod before further flight"]',
   'RECEIVED', 'system:ad-feed', now() - interval '2 hours'),
  ('DIR-1002', 'NKX', 'SB', 'Airbus SB A320-25-1820', '', 'Airbus', 'Cabin attendant seat — harness buckle replacement', '25', ARRAY['A320neo'],
   NULL, (now() - interval '20 days')::date,
   'Replace the attendant seat harness buckle with the improved P/N D1234-05 (optional, recommended).',
   '{"days": 365}', false, 2, '[]',
   'RECEIVED', 'user:camo.engineer', now() - interval '3 days')
ON CONFLICT (id) DO NOTHING;
-- Keep the sequence past the demo ids.
SELECT setval('camo.directive_seq', 1002) WHERE (SELECT last_value FROM camo.directive_seq) < 1002;

INSERT INTO camo.directive_tails (directive_id, tail, applicable, reason)
SELECT 'DIR-1001', f.reg,
  f.aircraft_type = 'B737-800' AND f.msn ~ '^\d+$' AND f.msn::int BETWEEN 38800 AND 38872,
  CASE WHEN f.aircraft_type <> 'B737-800' THEN 'Type ' || f.aircraft_type || ' not listed'
       WHEN f.msn ~ '^\d+$' AND f.msn::int BETWEEN 38800 AND 38872 THEN 'MSN ' || f.msn || ' within the published ranges'
       ELSE 'MSN ' || f.msn || ' outside the published ranges' END
FROM camo.fleet f WHERE f.operator_id = 'NKX'
UNION ALL
SELECT 'DIR-1002', f.reg, f.aircraft_type = 'A320neo', CASE WHEN f.aircraft_type = 'A320neo' THEN 'All A320neo' ELSE 'Type ' || f.aircraft_type || ' not listed' END
FROM camo.fleet f WHERE f.operator_id = 'NKX'
ON CONFLICT DO NOTHING;

-- Controlled documents.
INSERT INTO org.controlled_documents (id, operator_id, code, title, category, owner, audience) VALUES
  ('NKX-MOE', 'NKX', 'MOE', 'Maintenance Organisation Exposition (Part-145)', 'EXPOSITION', 'quality.manager', ARRAY['certifying_staff', 'quality_manager', 'storekeeper']),
  ('NKX-CAME', 'NKX', 'CAME', 'Continuing Airworthiness Management Exposition', 'EXPOSITION', 'camo.manager', ARRAY['camo_engineer', 'camo_manager', 'quality_manager']),
  ('NKX-PROC-07', 'NKX', 'PROC-07', 'Tool and equipment control procedure', 'PROCEDURE', 'quality.manager', ARRAY['certifying_staff', 'storekeeper']),
  ('NKX-OM-A', 'NKX', 'OM-A', 'Operations Manual Part A (general)', 'MANUAL', 'occ.controller', ARRAY['occ_controller', 'quality_manager'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.document_revisions (document_id, revision, operator_id, status, summary, effective_from, authored_by, authored_at, approved_by, approved_at) VALUES
  ('NKX-MOE', 1, 'NKX', 'SUPERSEDED', 'Initial issue (approved by the competent authority)', '2024-03-01', 'user:quality.manager', '2024-02-01', 'user:accountable.manager', '2024-02-20'),
  ('NKX-MOE', 2, 'NKX', 'EFFECTIVE', 'Chapter 2.23 — independent inspection after critical maintenance tasks; chapter 3.4 — continuation training every 24 months', (now() - interval '20 days')::date, 'user:quality.manager', now() - interval '35 days', 'user:accountable.manager', now() - interval '30 days'),
  ('NKX-CAME', 4, 'NKX', 'EFFECTIVE', 'Part 1.8 — AD/SB evaluation and incorporation with four-eyes review', (now() - interval '60 days')::date, 'user:camo.manager', now() - interval '75 days', 'user:quality.manager', now() - interval '70 days'),
  ('NKX-PROC-07', 1, 'NKX', 'EFFECTIVE', 'Initial issue: tool crib, calibration labels, lost-tool reporting', '2025-05-01', 'user:quality.manager', '2025-04-01', 'user:camo.manager', '2025-04-15'),
  ('NKX-PROC-07', 2, 'NKX', 'DRAFT', 'Section 4 — torque wrenches recalibrated every 6 months instead of 12; out-of-calibration tools quarantined', NULL, 'user:quality.manager', now() - interval '1 day', NULL, NULL),
  ('NKX-OM-A', 12, 'NKX', 'EFFECTIVE', 'Chapter 7 — FTL scheme aligned with ORO.FTL.235 standby rules', (now() - interval '10 days')::date, 'user:occ.controller', now() - interval '25 days', 'user:quality.manager', now() - interval '20 days')
ON CONFLICT DO NOTHING;

INSERT INTO org.document_reads (document_id, revision, username, name, read_at) VALUES
  ('NKX-MOE', 2, 'j.otieno', 'Joseph Otieno', now() - interval '18 days'),
  ('NKX-MOE', 2, 'quality.manager', 'Grace Wanjiru', now() - interval '20 days'),
  ('NKX-CAME', 4, 'camo.manager', 'CAMO Manager', now() - interval '55 days'),
  ('NKX-PROC-07', 1, 'k.mwangi', 'Kevin Mwangi', '2025-05-10')
ON CONFLICT DO NOTHING;

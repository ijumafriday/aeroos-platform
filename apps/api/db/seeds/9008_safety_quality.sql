-- Round 10 demo data: safety reports, a quality audit with findings, corrective actions, non-conforming parts.
-- Usernames: reporter, investigator, action owner / done_by / verified_by. Actors (user:…): triage, findings, NCR.

-- The storekeeper owns corrective actions, so is on the personnel register.
INSERT INTO org.personnel (id, operator_id, username, name, licence_no, role_title, base) VALUES
  ('P-0501', 'NKX', 'storekeeper', 'Tomas Berg', NULL, 'Stores supervisor', 'OSL')
ON CONFLICT (id) DO NOTHING;

-- Certifying staff must have read the current exposition and the tool-control procedure.
UPDATE org.controlled_documents SET required_for_certification = true WHERE id IN ('NKX-MOE', 'NKX-PROC-07');

INSERT INTO org.occurrences (id, operator_id, reported_at, reported_by, confidential, occurred_at, station, tail, flight_no, category, title, description,
  status, mandatory, authority_reported_at, authority_ref, probability, severity, investigator, triaged_by, triaged_at, version) VALUES
  ('OR-2026-0001', 'NKX', now() - interval '6 days', 'occ.controller', false, now() - interval '6 days 2 hours', 'ENBR', 'LN-ABD', 'NK602',
   'OPERATIONAL', 'Bird strike on approach, Bergen', 'Single bird strike on the radome at 800 ft on approach RWY 17. Landed normally; post-flight inspection found no damage.',
   'TRIAGED', false, NULL, NULL, 3, 'E', NULL, 'user:quality.manager', now() - interval '5 days', 2),
  ('OR-2026-0002', 'NKX', now() - interval '4 days', 'k.mwangi', false, now() - interval '4 days 3 hours', 'ENGM', 'LN-ABC', NULL,
   'MAINTENANCE', 'Rag found in engine #1 intake after borescope inspection', 'During the walk-round before release a shop rag was found in the #1 engine intake lip after the borescope task. Removed before engine run; no ingestion.',
   'UNDER_INVESTIGATION', true, now() - interval '3 days', 'NO-CAA MOR 2026-04417', 3, 'C', 'quality.manager', 'user:quality.manager', now() - interval '4 days', 2),
  ('OR-2026-0003', 'NKX', now() - interval '1 hour', 'j.otieno', true, now() - interval '10 hours', 'ENGM', NULL, NULL,
   'MAINTENANCE', 'Night shift extended to 14 hours', 'Night shift was extended to 14 hours to finish the A-check; two engineers reported being very tired while signing the last tasks.',
   'REPORTED', false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1)
ON CONFLICT (id) DO NOTHING;
SELECT setval('org.occurrence_seq', 3) WHERE (SELECT last_value FROM org.occurrence_seq) < 3;

INSERT INTO org.quality_audits (id, operator_id, title, area, reference, planned_for, lead_auditor, status, created_at) VALUES
  ('QA-2026-07', 'NKX', 'Tools and equipment control — Oslo', 'Part-145 hangar OSL', '145.A.40, MOE 2.5', (now() - interval '12 days')::date, 'user:auditor', 'IN_PROGRESS', now() - interval '20 days'),
  ('QA-2026-08', 'NKX', 'AD/SB management', 'CAMO', 'CAMO.A.315(b)(4), CAME 1.8', (now() + interval '21 days')::date, 'user:auditor', 'PLANNED', now() - interval '2 days')
ON CONFLICT (id) DO NOTHING;
SELECT setval('org.audit_seq', 8) WHERE (SELECT last_value FROM org.audit_seq) < 8;

INSERT INTO org.findings (id, audit_id, operator_id, level, requirement, description, root_cause, raised_by, raised_at, due, status, version) VALUES
  ('F-0001', 'QA-2026-07', 'NKX', 'LEVEL_2', '145.A.40(b)', 'Two torque wrenches in the OSL tool crib were 3 weeks past their calibration due date and had been issued twice.', NULL,
   'user:auditor', now() - interval '12 days', now() + interval '78 days', 'OPEN', 1),
  ('F-0002', 'QA-2026-07', 'NKX', 'OBSERVATION', 'MOE 2.5', 'Tool shadow boards in bay H2 are incomplete; missing tools are hard to spot at shift end.', NULL,
   'user:auditor', now() - interval '12 days', now() + interval '168 days', 'OPEN', 1)
ON CONFLICT (id) DO NOTHING;
SELECT setval('org.finding_seq', 2) WHERE (SELECT last_value FROM org.finding_seq) < 2;

INSERT INTO org.corrective_actions (id, operator_id, source_type, source_id, description, owner, due, status, evidence, done_by, done_at, created_by, created_at, version) VALUES
  ('CA-0001', 'NKX', 'FINDING', 'F-0001', 'Weekly calibration-due report from the tool register to the crib; overdue tools quarantined automatically', 'storekeeper',
   (now() + interval '20 days')::date, 'OPEN', NULL, NULL, NULL, 'user:quality.manager', now() - interval '10 days', 1),
  ('CA-0002', 'NKX', 'OCCURRENCE', 'OR-2026-0002', 'Rag control: numbered rags issued and counted back at task close; added to the borescope task card', 'k.mwangi',
   (now() + interval '10 days')::date, 'DONE', 'Task card template TC-72-00-BSI rev 4 has the rag count step; rag tally sheet in use since 6 Oct', 'k.mwangi', now() - interval '1 day', 'user:quality.manager', now() - interval '3 days', 2)
ON CONFLICT (id) DO NOTHING;
SELECT setval('org.action_seq', 2) WHERE (SELECT last_value FROM org.action_seq) < 2;

INSERT INTO amo.nonconformities (id, operator_id, part_no, serial, qty, location, source, description, raised_by, raised_at, status, version) VALUES
  ('NCR-0001', 'NKX', 'FILTER-HYD-737', NULL, 1, 'ENGM', 'RECEIVING', 'Received with a damaged seal and no EASA Form 1 in the box.', 'user:storekeeper', now() - interval '2 days', 'QUARANTINED', 1)
ON CONFLICT (id) DO NOTHING;
SELECT setval('amo.ncr_seq', greatest((SELECT last_value FROM amo.ncr_seq), 1), true);

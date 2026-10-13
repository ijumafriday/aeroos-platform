-- Demo maintenance programme, counters, compliance history and life-limited parts for NKX.
-- Dates are relative to the seed run, so the due list is interesting on any day:
--   LN-NGX: EASA AD 2026-0123 has 3 cycles left — it goes OVERDUE during today's flying and grounds the aircraft.
--   LN-ABD: A-check inside its approved tolerance; gear lubrication due in 2 days.
--   LN-RKF: engine borescope inside tolerance.  LN-RTA: hydraulic servicing due in 5 days.

INSERT INTO camo.aircraft_counters (reg, delivery_date, base_at, base_fh, base_fc) VALUES
  ('LN-ABC', '2018-03-01', now(), 21450.5, 14210),
  ('LN-ABD', '2017-06-15', now(), 23110.0, 15002),
  ('LN-NGX', '2022-11-20', now(), 6120.4, 3988),
  ('LN-RKF', '2021-05-01', now(), 9020.0, 6105),
  ('LN-RKG', '2021-07-15', now(), 8770.0, 5920),
  ('LN-RTA', '2012-04-01', now(), 41200.0, 9800),
  ('LN-WDE', '2015-09-01', now(), 18000.0, 22000),
  ('LN-FNX', '2021-02-01', now(), 5000.0, 3500)
ON CONFLICT (reg) DO NOTHING;

INSERT INTO camo.requirements (id, operator_id, kind, ref, title, ata, types, interval, repetitive, steps, estimated_hours, tools, parts) VALUES
  ('R-737-01', 'NKX', 'TASK', 'AMP 12-21-11', 'Main and nose landing gear lubrication', '12', ARRAY['B737-800', 'B737 MAX 8'],
   '{"fh": 300, "days": 60, "toleranceFh": 30, "toleranceDays": 6}', true,
   '["Lubricate main gear per AMM 12-21-11-640-801", "Lubricate nose gear per AMM 12-21-11-640-802", "Inspect for grease extrusion and seal damage"]', 1.5,
   ARRAY['Grease gun'], '[{"partNo": "GREASE-BMS3-33", "qty": 1}]'),
  ('R-737-02', 'NKX', 'TASK', 'AMP 05-51-01', 'A-check', '05', ARRAY['B737-800', 'B737 MAX 8'],
   '{"fh": 750, "days": 120, "toleranceFh": 75, "toleranceDays": 12}', true,
   '["Zonal inspection per A-check card set", "Engine oil and hydraulic fluid servicing", "Replace hydraulic return filter", "Operational check of flight controls", "Close-up and documentation"]', 10,
   ARRAY['Torque wrench 20-100 Nm', 'Borescope'], '[{"partNo": "FILTER-HYD-737", "qty": 1}, {"partNo": "O-RING-MS29513", "qty": 4}]'),
  ('R-737-03', 'NKX', 'AD', 'EASA AD 2026-0123', 'Slat track inspection for corrosion (repetitive)', '27', ARRAY['B737-800', 'B737 MAX 8'],
   '{"fc": 1500}', true,
   '["Open slat track housings 2 to 5", "Detailed visual and borescope inspection per SB 737-57A1302", "Replace track fasteners as required", "Report findings to CAMO"]', 4,
   ARRAY['Borescope', 'Torque wrench 20-100 Nm'], '[{"partNo": "BACB30LM8-4", "qty": 4}]'),
  ('R-737-04', 'NKX', 'AD', 'EASA AD 2025-0310', 'Pitot probe heater replacement (one-time)', '34', ARRAY['B737-800', 'B737 MAX 8'],
   '{"fc": 3000}', false, '["Replace captain and F/O pitot probes", "Leak and heater test"]', 3, ARRAY[]::text[], '[]'),
  ('R-737-LLP1', 'NKX', 'LLP', 'LLP 72-00-HPT1', 'Engine 1 HPT stage 1 disk', '72', ARRAY['B737-800', 'B737 MAX 8'],
   '{"fc": 20000}', false, '["Engine change or module replacement per AMM 72-00-00"]', 40, ARRAY[]::text[], '[]'),
  ('R-320-01', 'NKX', 'TASK', 'AMP 12-14-32', 'Landing gear shock strut servicing', '12', ARRAY['A320neo'],
   '{"fh": 400, "days": 90, "toleranceFh": 40}', true, '["Check strut extension", "Service nitrogen and fluid per AMM 12-14-32"]', 2,
   ARRAY[]::text[], '[]'),
  ('R-320-02', 'NKX', 'TASK', 'AMP 72-00-00-BSI', 'Engine borescope inspection (HPT)', '72', ARRAY['A320neo'],
   '{"fc": 1000, "toleranceFc": 100}', true, '["Borescope HPT stage 1 blades both engines", "Record and compare with limits"]', 3,
   ARRAY['Borescope'], '[]'),
  ('R-320-03', 'NKX', 'AD', 'EASA AD 2026-0201', 'Cargo door latch inspection', '52', ARRAY['A320neo'],
   '{"fc": 500}', true, '["Inspect aft cargo door latch cams", "Lubricate and functional test"]', 1.5, ARRAY['Torque wrench 20-100 Nm'], '[]'),
  ('R-330-01', 'NKX', 'TASK', 'AMP 12-11-28', 'Hydraulic reservoir servicing', '12', ARRAY['A330-300'],
   '{"days": 30}', true, '["Check reservoir levels", "Service per AMM 12-12-29"]', 1, ARRAY[]::text[], '[]')
ON CONFLICT (id) DO NOTHING;

-- Compliance history relative to each aircraft's baseline.
INSERT INTO camo.compliance (requirement_id, tail, done_at, fh, fc, reference, recorded_by)
SELECT v.req, v.tail, now() - (v.days_ago || ' days')::interval, c.base_fh - v.fh_ago, c.base_fc - v.fc_ago, 'Imported from legacy CAMO system', 'seed'
FROM (VALUES
  ('R-737-01', 'LN-ABC', 50, 270, 180), ('R-737-02', 'LN-ABC', 40, 400, 260), ('R-737-03', 'LN-ABC', 120, 1100, 700), ('R-737-04', 'LN-ABC', 400, 3200, 2100),
  ('R-737-01', 'LN-ABD', 58, 200, 130), ('R-737-02', 'LN-ABD', 100, 760, 500), ('R-737-03', 'LN-ABD', 150, 1800, 1200), ('R-737-04', 'LN-ABD', 500, 4000, 2600),
  ('R-737-01', 'LN-NGX', 20, 120, 80), ('R-737-02', 'LN-NGX', 30, 300, 200), ('R-737-03', 'LN-NGX', 240, 2200, 1497), ('R-737-04', 'LN-NGX', 300, 2500, 1700),
  ('R-320-01', 'LN-RKF', 20, 150, 100), ('R-320-02', 'LN-RKF', 160, 1600, 1050), ('R-320-03', 'LN-RKF', 45, 450, 300),
  ('R-320-01', 'LN-RKG', 30, 220, 150), ('R-320-02', 'LN-RKG', 60, 700, 400), ('R-320-03', 'LN-RKG', 20, 200, 120),
  ('R-330-01', 'LN-RTA', 25, 200, 40)
) AS v(req, tail, days_ago, fh_ago, fc_ago)
JOIN camo.aircraft_counters c ON c.reg = v.tail
ON CONFLICT DO NOTHING;

-- Life-limited parts installed.
INSERT INTO camo.components (id, tail, requirement_id, part_no, serial, position, installed_at, aircraft_fh_at_install, aircraft_fc_at_install, part_tsn_at_install, part_csn_at_install)
SELECT v.id, v.tail, 'R-737-LLP1', v.pn, v.sn, 'ENG 1', now() - (v.days_ago || ' days')::interval, c.base_fh - v.fh_ago, c.base_fc - v.fc_ago, v.tsn, v.csn
FROM (VALUES
  ('C-0001', 'LN-ABC', '2073M48P01', 'GWN0Y431', 1000, 3100, 2000, 18000.0, 12000),
  ('C-0002', 'LN-ABD', '2073M48P01', 'GWN0Y517', 2000, 6200, 4000, 26000.0, 15800),
  ('C-0003', 'LN-NGX', '2468M61P02', 'LEAP1B-7731', 1400, 6120, 3988, 0.0, 0)
) AS v(id, tail, pn, sn, days_ago, fh_ago, fc_ago, tsn, csn)
JOIN camo.aircraft_counters c ON c.reg = v.tail
ON CONFLICT DO NOTHING;

INSERT INTO camo.reliability_alert_levels (operator_id, ata, alert_level) VALUES
  ('NKX', '21', 2.0), ('NKX', '23', 2.5), ('NKX', '25', 3.0), ('NKX', '30', 1.5), ('NKX', '31', 1.0), ('NKX', '33', 1.5), ('NKX', '34', 1.5), ('NKX', '36', 1.0)
ON CONFLICT DO NOTHING;

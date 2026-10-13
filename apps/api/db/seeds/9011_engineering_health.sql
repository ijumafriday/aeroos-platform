-- Round 14 demo data: engines, 60 days of trend snapshots and oil uplifts, SRM limits and a few structural damages.
-- Demo-only engine health limits. Production migration 0042 removes historical generic limits where possible.
INSERT INTO camo.engine_types (engine_type,egt_margin_amber,egt_margin_red,egt_shift,n2_shift,ff_shift,vib_max,oil_alert_qph,oil_max_qph,data_origin,source_ref) VALUES
  ('CFM56-7B',25,10,10,1.0,2.0,3.0,0.30,0.50,'DEMO','AeroOS demo dataset'),
  ('LEAP-1B',30,12,10,1.0,2.0,3.0,0.25,0.45,'DEMO','AeroOS demo dataset'),
  ('LEAP-1A',30,12,10,1.0,2.0,3.0,0.25,0.45,'DEMO','AeroOS demo dataset'),
  ('Trent 772B',25,10,12,1.0,2.5,2.5,0.35,0.60,'DEMO','AeroOS demo dataset'),
  ('PW150A',30,10,8,1.0,2.0,2.0,0.20,0.35,'DEMO','AeroOS demo dataset'),
  ('PW1900G',30,12,10,1.0,2.0,2.0,0.25,0.45,'DEMO','AeroOS demo dataset')
ON CONFLICT (engine_type) DO UPDATE SET data_origin='DEMO', source_ref=EXCLUDED.source_ref;

--   896230 (LN-ABC #2): EGT step shift over the last five flights → borescope.
--   41077  (LN-RTA #1): EGT margin wearing away → removal forecast.
--   600118 (LN-NGX #1): oil consumption rising above the alert level.
--   LN-ABD: two dents close together (interacting), temporary repair; LN-FNX (AOG): lightning strike beyond the SRM.

INSERT INTO camo.engines (serial, operator_id, engine_type, tail, position) VALUES
  ('896211', 'NKX', 'CFM56-7B', 'LN-ABC', 1), ('896230', 'NKX', 'CFM56-7B', 'LN-ABC', 2),
  ('896402', 'NKX', 'CFM56-7B', 'LN-ABD', 1), ('896419', 'NKX', 'CFM56-7B', 'LN-ABD', 2),
  ('600118', 'NKX', 'LEAP-1B', 'LN-NGX', 1), ('600131', 'NKX', 'LEAP-1B', 'LN-NGX', 2),
  ('598207', 'NKX', 'LEAP-1A', 'LN-RKF', 1), ('598214', 'NKX', 'LEAP-1A', 'LN-RKF', 2),
  ('598311', 'NKX', 'LEAP-1A', 'LN-RKG', 1), ('598322', 'NKX', 'LEAP-1A', 'LN-RKG', 2),
  ('41077', 'NKX', 'Trent 772B', 'LN-RTA', 1), ('41081', 'NKX', 'Trent 772B', 'LN-RTA', 2),
  ('PCE-FA0431', 'NKX', 'PW150A', 'LN-WDE', 1), ('PCE-FA0436', 'NKX', 'PW150A', 'LN-WDE', 2),
  ('P780112', 'NKX', 'PW1900G', 'LN-FNX', 1), ('P780117', 'NKX', 'PW1900G', 'LN-FNX', 2),
  ('PCE-FA0388', 'FJR', 'PW150A', 'LN-WFA', 1), ('PCE-FA0391', 'FJR', 'PW150A', 'LN-WFA', 2),
  ('PCE-FA0402', 'FJR', 'PW150A', 'LN-WFB', 1), ('PCE-FA0405', 'FJR', 'PW150A', 'LN-WFB', 2)
ON CONFLICT (serial) DO NOTHING;

-- One snapshot a day for 60 days, 8 FH apart, ending at the aircraft's base hours. Small deterministic noise.
INSERT INTO camo.engine_snapshots (serial, at, fh, egt_dev, n2_dev, ff_dev_pct, vib, egt_margin, source, recorded_by)
SELECT e.serial, now() - ((59 - i) || ' days')::interval, c.base_fh - (59 - i) * 8,
  round((sin(i * 1.7 + length(e.serial)) * 1.5 + CASE WHEN e.serial = '896230' AND i >= 55 THEN 14 ELSE 0 END)::numeric, 1),
  round((sin(i * 1.3 + e.position) * 0.2)::numeric, 2),
  round((sin(i * 0.9 + e.position) * 0.4)::numeric, 2),
  round((1.0 + abs(sin(i * 0.7 + e.position)) * 0.5)::numeric, 1),
  round((CASE WHEN e.serial = '41077' THEN 40 - i * 0.36 ELSE 55 + e.position * 4 - i * 0.02 END + sin(i * 2.1) * 0.8)::numeric, 1),
  'DOWNLOAD', 'seed'
FROM camo.engines e
JOIN camo.aircraft_counters c ON c.reg = e.tail
CROSS JOIN generate_series(0, 59) AS i
WHERE NOT EXISTS (SELECT 1 FROM camo.engine_snapshots s WHERE s.serial = e.serial);

-- Oil uplifts every 3 days (24 FH): about 0.1 qt/h; 600118 rising to about 0.35 qt/h over the last 9 days.
INSERT INTO camo.oil_uplifts (serial, tail, at, fh, quarts, station, recorded_by)
SELECT e.serial, e.tail, now() - ((57 - k * 3) || ' days')::interval, c.base_fh - (57 - k * 3) * 8,
  CASE WHEN e.serial = '600118' AND k >= 17 THEN 8.5 WHEN e.serial = '600118' AND k >= 15 THEN 4.5 ELSE 2.0 + (k % 3) * 0.5 END,
  'ENGM', 'seed'
FROM camo.engines e
JOIN camo.aircraft_counters c ON c.reg = e.tail
CROSS JOIN generate_series(0, 19) AS k
WHERE NOT EXISTS (SELECT 1 FROM camo.oil_uplifts o WHERE o.serial = e.serial);

-- SRM limits: the same illustrative table for each type in the fleet, by zone and damage type.
INSERT INTO camo.srm_limits (aircraft_type, zone, zone_name, damage_type, srm_ref, allowable_depth_mm, allowable_length_mm,
  repairable_depth_mm, repairable_length_mm, min_spacing_mm, inspect_fc)
SELECT t.type, z.zone, z.name, d.dtype, 'SRM ' || z.chapter || ' Fig ' || d.fig, d.ad, d.al, d.rd, d.rl, d.spacing, d.insp
FROM (VALUES ('B737-800'), ('B737 MAX 8'), ('A320neo'), ('A330-300'), ('DHC-8-400'), ('E195-E2')) AS t(type)
CROSS JOIN (VALUES
  ('100', 'Lower fuselage', '53-10-01'), ('200', 'Upper fuselage', '53-20-01'), ('300', 'Empennage', '55-00-01'),
  ('400', 'Nacelles & pylons', '54-00-01'), ('500', 'Left wing', '57-10-01'), ('600', 'Right wing', '57-20-01'),
  ('700', 'Landing gear & doors', '52-80-01'), ('800', 'Passenger & cargo doors', '52-10-01')
) AS z(zone, name, chapter)
CROSS JOIN (VALUES
  ('DENT', '101', 2.0, 50.0, 6.0, 150.0, 100.0, 1500),
  ('SCRATCH', '102', 0.1, 100.0, 0.5, 300.0, 50.0, NULL),
  ('GOUGE', '103', 0.1, 25.0, 1.0, 150.0, 50.0, NULL),
  ('CORROSION', '104', 0.2, 100.0, 1.0, 300.0, 100.0, 3000),
  ('CRACK', '105', NULL, NULL, NULL, 25.0, 150.0, NULL),
  ('LIGHTNING', '106', 0.2, 10.0, 1.0, 50.0, 100.0, NULL),
  ('DELAMINATION', '107', NULL, 25.0, NULL, 100.0, 75.0, 1000)
) AS d(dtype, fig, ad, al, rd, rl, spacing, insp)
ON CONFLICT DO NOTHING;

-- Damages. FC from the counters at seeding time.
WITH fc AS (
  SELECT c.reg, c.base_fc + (SELECT count(*) FROM camo.utilisation u WHERE u.tail = c.reg AND u.arrived_at > c.base_at)::int AS fc
  FROM camo.aircraft_counters c
)
INSERT INTO camo.structural_damage (id, operator_id, tail, zone, side, damage_type, x_mm, y_mm, length_mm, width_mm, depth_mm, description,
  found_at, found_fc, found_by, disposition, srm_ref, reason, next_inspection_fc, approved_data, approved_by, approved_at,
  repair_kind, repair_data, repair_until_fc, repaired_by, repaired_at)
SELECT v.id, 'NKX', v.tail, v.zone, v.side, v.dtype, v.x, v.y, v.len, v.wid, v.dep, v.descr,
  now() - (v.days_ago || ' days')::interval, fc.fc - v.fc_ago, v.found_by, v.disp, v.srm, v.reason,
  CASE WHEN v.insp THEN fc.fc - v.fc_ago + 1500 END, v.appr, CASE WHEN v.appr IS NOT NULL THEN 'user:camo.engineer' END, CASE WHEN v.appr IS NOT NULL THEN now() - interval '20 days' END,
  v.rk, v.rdata, CASE WHEN v.rk = 'TEMPORARY' THEN fc.fc + 400 END, CASE WHEN v.rk IS NOT NULL THEN 'user:k.mwangi' END, CASE WHEN v.rk IS NOT NULL THEN now() - interval '20 days' END
FROM (VALUES
  ('SD-0001', 'LN-ABC', '200', 'L', 'DENT', 12500.0, 900.0, 30.0, 25.0, 1.2, 'Hail dent above the forward entry door, smooth, no crease', 75, 600, 'user:k.mwangi',
   'ALLOWABLE', 'SRM 53-20-01 Fig 101', 'within allowable damage limits', true, NULL, NULL, NULL),
  ('SD-0002', 'LN-ABD', '100', 'R', 'DENT', 8200.0, -1500.0, 35.0, 30.0, 1.5, 'Ground equipment dent aft of the cargo door (belt loader)', 21, 110, 'user:k.mwangi',
   'REPAIR', 'SRM 53-10-01 Fig 101', 'interacts with SD-0003', false, NULL, 'TEMPORARY', 'SRM 53-10-01 Fig 201 — external doubler, temporary'),
  ('SD-0003', 'LN-ABD', '100', 'R', 'DENT', 8260.0, -1500.0, 30.0, 25.0, 1.0, 'Second dent next to SD-0002, same event', 21, 110, 'user:k.mwangi',
   'REPAIR', 'SRM 53-10-01 Fig 101', 'interacts with SD-0002', false, NULL, 'TEMPORARY', 'SRM 53-10-01 Fig 201 — external doubler, temporary'),
  ('SD-0004', 'LN-FNX', '200', 'C', 'LIGHTNING', 3000.0, 2500.0, 80.0, 40.0, 0.5, 'Lightning strike exit, crown skin aft of the cockpit: burn marks and pitting', 2, 3, 'user:a.saleh',
   'REFER', 'SRM 53-20-01 Fig 106', 'beyond SRM limits', false, NULL, NULL, NULL),
  ('SD-0005', 'LN-RTA', '800', 'L', 'SCRATCH', 2100.0, 300.0, 60.0, 1.0, 0.05, 'Light scratch on the L1 door skin (catering truck)', 40, 160, 'user:k.mwangi',
   'ALLOWABLE', 'SRM 52-10-01 Fig 102', 'within allowable damage limits', false, NULL, NULL, NULL)
) AS v(id, tail, zone, side, dtype, x, y, len, wid, dep, descr, days_ago, fc_ago, found_by, disp, srm, reason, insp, appr, rk, rdata)
JOIN fc ON fc.reg = v.tail
ON CONFLICT (id) DO NOTHING;

SELECT setval('camo.damage_seq', greatest((SELECT last_value FROM camo.damage_seq), 5), true);

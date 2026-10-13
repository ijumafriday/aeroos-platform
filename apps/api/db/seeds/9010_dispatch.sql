-- Round 12 demo data: weighing records, runway limits, fuel prices, routes, overflight permit rules and permits.

-- Demo-only generic aircraft type data, scoped to operators whose approved fleet includes the type.
WITH type_data(type,icao_type,wake,seats,mzfw,mtow,mlw,max_fuel,lemac,mac,fwd_limit,aft_limit,crew_arm,pax_arm,hold_fwd_arm,hold_aft_arm,fuel_arm,burn_kg_per_hour,hold_kg_per_min,cruise_kt,data_origin,source_ref) AS (VALUES
  ('B737-800','B738','M',186,62732,79016,66361,20894,16.0,3.96,8,33,3.0,17.2,11.0,23.5,17.0,2500,40,450,'DEMO','AeroOS demo dataset'),
  ('B737 MAX 8','B38M','M',189,65952,82191,69309,20730,16.2,3.96,8,33,3.0,17.4,11.2,23.8,17.2,2250,37,450,'DEMO','AeroOS demo dataset'),
  ('A320neo','A20N','M',180,64300,79000,67400,18728,17.9,4.19,17,40,3.2,18.6,12.4,25.2,18.8,2300,38,450,'DEMO','AeroOS demo dataset'),
  ('A330-300','A333','H',300,175000,242000,187000,109185,25.2,7.27,14,41,4.5,28.0,17.5,39.0,28.5,5800,95,470,'DEMO','AeroOS demo dataset'),
  ('DHC-8-400','DH8D','M',78,25854,29574,28123,5318,12.0,2.47,16,37,2.6,12.9,6.5,19.5,12.4,900,16,340,'DEMO','AeroOS demo dataset'),
  ('E195-E2','E295','M',136,49000,61500,54000,13690,15.0,3.54,9,34,2.8,16.0,10.5,21.8,15.6,1900,30,440,'DEMO','AeroOS demo dataset')
)
INSERT INTO ops.aircraft_types (operator_id,type,icao_type,wake,seats,mzfw,mtow,mlw,max_fuel,lemac,mac,fwd_limit,aft_limit,crew_arm,pax_arm,hold_fwd_arm,hold_aft_arm,fuel_arm,burn_kg_per_hour,hold_kg_per_min,cruise_kt,data_origin,source_ref)
SELECT p.operator_id,t.* FROM type_data t JOIN compliance.operator_profiles p ON t.type=ANY(p.approved_types)
ON CONFLICT (operator_id,type) DO UPDATE SET data_origin='DEMO',source_ref=EXCLUDED.source_ref;

INSERT INTO ops.aircraft_weights (tail, operator_id, basic_empty_kg, basic_arm, weighed_on) VALUES
  ('LN-ABC', 'NKX', 41800, 17.00, '2024-03-01'),
  ('LN-ABD', 'NKX', 41950, 17.05, '2023-01-20'),
  ('LN-NGX', 'NKX', 45070, 17.25, '2025-05-12'),
  ('LN-RKF', 'NKX', 44300, 18.95, '2024-09-30'),
  ('LN-RKG', 'NKX', 44420, 18.97, '2021-11-02'),
  ('LN-RTA', 'NKX', 124500, 28.40, '2023-06-15'),
  ('LN-WDE', 'NKX', 17800, 12.85, '2024-02-10'),
  ('LN-FNX', 'NKX', 35800, 15.85, '2025-01-08'),
  ('LN-WFA', 'FJR', 17750, 12.84, '2023-04-04'),
  ('LN-WFB', 'FJR', 17820, 12.86, '2025-08-21')
ON CONFLICT (tail) DO NOTHING;

INSERT INTO ops.runway_limits (operator_id,airport,type,rtow_kg,rlw_kg,note)
SELECT p.operator_id,r.* FROM (VALUES
  ('ENTC','B737-800',72500,64000,'RWY 19, winter contamination table'),
  ('ENBO','B737 MAX 8',76000,NULL,'RWY 07, obstacle-limited'),
  ('ENEV','DHC-8-400',28200,NULL,'RWY 17'),
  ('ENHD','DHC-8-400',27900,27500,'RWY 13, short runway')
) AS r(airport,type,rtow_kg,rlw_kg,note) JOIN compliance.operator_profiles p ON r.type=ANY(p.approved_types)
ON CONFLICT DO NOTHING;

INSERT INTO ops.fuel_prices (operator_id, station, usd_per_kg, as_of)
SELECT o, st, p, current_date FROM (VALUES
  ('ENGM', 0.92), ('ENBR', 0.98), ('ENZV', 0.97), ('ENVA', 0.99), ('ENTC', 1.12), ('ENBO', 1.06), ('EKCH', 0.90), ('ESSA', 0.93),
  ('EGLL', 0.86), ('GCLP', 0.95), ('ENAL', 1.04), ('ENEV', 1.08), ('ENTO', 1.00), ('ENHD', 1.07)
) AS v(st, p) CROSS JOIN (VALUES ('NKX'), ('FJR')) AS ops(o)
ON CONFLICT DO NOTHING;

-- Cruise levels follow the semicircular rule. Demo route references are operator-owned.
INSERT INTO ops.routes (operator_id,dep,arr,route,cruise_level,countries)
SELECT p.operator_id,v.d,v.a,v.r,v.fl,v.c FROM (VALUES
  ('ENGM', 'ENBR', 'DCT', 280, ARRAY['NO']), ('ENBR', 'ENGM', 'DCT', 290, ARRAY['NO']),
  ('ENGM', 'ENZV', 'DCT', 280, ARRAY['NO']), ('ENZV', 'ENGM', 'DCT', 290, ARRAY['NO']),
  ('ENGM', 'ENVA', 'DCT', 300, ARRAY['NO']), ('ENVA', 'ENGM', 'DCT', 290, ARRAY['NO']),
  ('ENGM', 'ENTC', 'DCT', 370, ARRAY['NO']), ('ENTC', 'ENGM', 'DCT', 360, ARRAY['NO']),
  ('ENGM', 'ENBO', 'DCT', 350, ARRAY['NO']), ('ENBO', 'ENGM', 'DCT', 340, ARRAY['NO']),
  ('ENGM', 'EKCH', 'DCT', 330, ARRAY['NO', 'SE', 'DK']), ('EKCH', 'ENGM', 'DCT', 320, ARRAY['DK', 'SE', 'NO']),
  ('ENGM', 'ESSA', 'DCT', 310, ARRAY['NO', 'SE']), ('ESSA', 'ENGM', 'DCT', 300, ARRAY['SE', 'NO']),
  ('ENGM', 'EGLL', 'DCT', 360, ARRAY['NO', 'DK', 'GB']), ('EGLL', 'ENGM', 'DCT', 370, ARRAY['GB', 'DK', 'NO']),
  ('ENGM', 'GCLP', 'DCT', 380, ARRAY['NO', 'DK', 'DE', 'NL', 'BE', 'FR', 'ES', 'PT', 'MA']),
  ('GCLP', 'ENGM', 'DCT', 370, ARRAY['MA', 'PT', 'ES', 'FR', 'BE', 'NL', 'DE', 'DK', 'NO']),
  ('ENBR', 'ENAL', 'DCT', 210, ARRAY['NO']), ('ENAL', 'ENBR', 'DCT', 200, ARRAY['NO']),
  ('ENBR', 'ENEV', 'DCT', 250, ARRAY['NO']), ('ENEV', 'ENBR', 'DCT', 240, ARRAY['NO']),
  ('ENBR', 'ENTO', 'DCT', 170, ARRAY['NO']), ('ENTO', 'ENBR', 'DCT', 160, ARRAY['NO']),
  ('ENBR', 'ENHD', 'DCT', 140, ARRAY['NO']), ('ENHD', 'ENBR', 'DCT', 150, ARRAY['NO'])
) AS v(d, a, r, fl, c)
CROSS JOIN compliance.operator_profiles p
ON CONFLICT DO NOTHING;

INSERT INTO ops.permit_rules (operator_id,country,permit_required,note)
SELECT p.operator_id,v.country,v.permit_required,v.note FROM (VALUES
  ('NO', false, NULL), ('SE', false, NULL), ('DK', false, NULL), ('DE', false, NULL), ('NL', false, NULL), ('BE', false, NULL),
  ('FR', false, NULL), ('ES', false, NULL), ('PT', false, NULL), ('GB', false, 'EEA carriers: no overflight permit'),
  ('MA', true, 'Casablanca FIR: overflight authorisation required for this operator (demo rule)')
) AS v(country,permit_required,note) CROSS JOIN compliance.operator_profiles p
ON CONFLICT (operator_id,country) DO NOTHING;

INSERT INTO ops.overflight_permits (operator_id, country, number, valid_from, valid_to, types, created_by)
SELECT 'NKX', 'MA', 'MA-DGAC-OVF-2026-0418', (now() - interval '200 days')::date, (now() + interval '25 days')::date, ARRAY['A330-300', 'B737-800', 'B737 MAX 8'], 'seed'
WHERE NOT EXISTS (SELECT 1 FROM ops.overflight_permits WHERE number = 'MA-DGAC-OVF-2026-0418');

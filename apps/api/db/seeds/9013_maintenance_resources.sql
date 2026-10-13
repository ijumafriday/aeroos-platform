-- Demo-only hangar resource master data used by the local journey suite.
INSERT INTO camo.hangar_bays (id, operator_id, station, code, name, active) VALUES
  ('NKX-ENGM-H1', 'NKX', 'ENGM', 'OSL-H1', 'Hangar 1', true),
  ('NKX-ENGM-H2', 'NKX', 'ENGM', 'OSL-H2', 'Hangar 2', true),
  ('NKX-ENGM-LINE', 'NKX', 'ENGM', 'OSL-LINE', 'Line maintenance stand', true)
ON CONFLICT DO NOTHING;

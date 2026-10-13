-- Demo tools register and stores. T-TQ-07 is out of calibration: using it for a stamp is refused (Part-145.A.40).
INSERT INTO amo.tools (id, operator_id, description, serial, location, calibration_due) VALUES
  ('T-TQ-07', 'NKX', 'Torque wrench 20-100 Nm', 'NM-58821', 'ENGM', current_date - 8),
  ('T-TQ-08', 'NKX', 'Torque wrench 20-100 Nm', 'NM-58904', 'ENGM', current_date + 120),
  ('T-BS-01', 'NKX', 'Borescope', 'OLY-IPLEX-7733', 'ENGM', current_date + 200),
  ('T-GG-02', 'NKX', 'Grease gun', 'GG-1102', 'ENGM', NULL),
  ('T-TQ-11', 'NKX', 'Torque wrench 20-100 Nm', 'NM-60112', 'ENBR', current_date + 20)
ON CONFLICT (id) DO NOTHING;

INSERT INTO amo.parts (part_no, description, unit, min_stock) VALUES
  ('GREASE-BMS3-33', 'Grease BMS 3-33, 14 oz cartridge', 'EA', 6),
  ('BACB30LM8-4', 'Bolt, slat track', 'EA', 10),
  ('FILTER-HYD-737', 'Hydraulic return filter element', 'EA', 2),
  ('O-RING-MS29513', 'O-ring MS29513-235', 'EA', 20)
ON CONFLICT (part_no) DO NOTHING;

INSERT INTO amo.stock (part_no, location, qty) VALUES
  ('GREASE-BMS3-33', 'ENGM', 9), ('BACB30LM8-4', 'ENGM', 3), ('BACB30LM8-4', 'ENBR', 12),
  ('FILTER-HYD-737', 'ENGM', 1), ('O-RING-MS29513', 'ENGM', 40)
ON CONFLICT (part_no, location) DO NOTHING;

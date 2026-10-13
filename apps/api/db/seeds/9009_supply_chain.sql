-- Round 11 demo data: approved suppliers, a requisition with quotes, orders (one awaiting approval, one in
-- transit through customs), a bonded receipt, a warranty claim, an exchange with a core due, a PBH contract.

UPDATE amo.parts SET standard_part = true WHERE part_no IN ('O-RING-MS29513', 'GREASE-BMS3-33', 'BACB30LM8-4');

INSERT INTO amo.vendors (id, operator_id, name, approval_type, approval_ref, approved_until, status, warranty_months, country) VALUES
  ('V-001', 'NKX', 'Nordic Aero Components AS', 'DISTRIBUTOR', 'EASA-accepted distributor · ASA-100 cert 2291', (now() + interval '300 days')::date, 'APPROVED', 12, 'NO'),
  ('V-002', 'NKX', 'Lufthansa Technik Component Services', 'PART_145', 'DE.145.0009', (now() + interval '500 days')::date, 'APPROVED', 24, 'DE'),
  ('V-003', 'NKX', 'Pacific Surplus Parts LLC', 'DISTRIBUTOR', 'ASA-100 cert 7710', (now() - interval '20 days')::date, 'APPROVED', 6, 'US'),
  ('V-004', 'NKX', 'AeroSpares Direct Ltd', 'DISTRIBUTOR', 'ASA-100 cert 5521', (now() + interval '120 days')::date, 'SUSPENDED', 12, 'GB')
ON CONFLICT (id) DO NOTHING;

SELECT setval('amo.vendor_seq', greatest((SELECT last_value FROM amo.vendor_seq), 4), true);

-- Reference rates (demo values; finance maintains them).
INSERT INTO amo.fx_rates (currency, base_per_unit, as_of) VALUES
  ('EUR', 1.08, current_date), ('GBP', 1.27, current_date), ('NOK', 0.093, current_date),
  ('SEK', 0.095, current_date), ('DKK', 0.145, current_date), ('CHF', 1.12, current_date), ('KES', 0.0077, current_date)
ON CONFLICT (currency) DO NOTHING;

INSERT INTO amo.requisitions (id, operator_id, part_no, qty, station, needed_by, task_card_id, reason, status, created_by, created_at) VALUES
  ('RQ-0001', 'NKX', 'FILTER-HYD-737', 4, 'ENGM', (now() + interval '10 days')::date, NULL, 'Stock below minimum (min 2, NCR-0001 quarantined one)', 'OPEN', 'user:storekeeper', now() - interval '1 day'),
  ('RQ-0002', 'NKX', 'BACB30LM8-4', 20, 'ENGM', (now() + interval '14 days')::date, NULL, 'Slat-track bolts below minimum at Oslo', 'ORDERED', 'user:storekeeper', now() - interval '6 days')
ON CONFLICT (id) DO NOTHING;
SELECT setval('amo.requisition_seq', greatest((SELECT last_value FROM amo.requisition_seq), 2), true);

INSERT INTO amo.quotes (requisition_id, vendor_id, unit_price, currency, lead_days, condition, valid_until, created_by)
SELECT * FROM (VALUES
  ('RQ-0001', 'V-001', 312.00, 'EUR', 3, 'NE', (now() + interval '20 days')::date, 'user:storekeeper'),
  ('RQ-0001', 'V-002', 268.50, 'EUR', 9, 'OH', (now() + interval '30 days')::date, 'user:storekeeper')
) AS v(requisition_id, vendor_id, unit_price, currency, lead_days, condition, valid_until, created_by)
WHERE NOT EXISTS (SELECT 1 FROM amo.quotes q WHERE q.requisition_id = 'RQ-0001');

INSERT INTO amo.purchase_orders (id, operator_id, requisition_id, vendor_id, part_no, qty, received_qty, unit_price, currency, condition, import, station, status, created_by, created_at, version) VALUES
  ('PO-0001', 'NKX', 'RQ-0002', 'V-002', 'BACB30LM8-4', 20, 10, 41.20, 'EUR', 'NE', true, 'ENGM', 'PARTIALLY_RECEIVED', 'user:storekeeper', now() - interval '5 days', 2),
  ('PO-0002', 'NKX', NULL, 'V-002', 'FILTER-HYD-737', 24, 0, 295.00, 'EUR', 'NE', false, 'ENGM', 'PENDING_APPROVAL', 'user:storekeeper', now() - interval '3 hours', 1)
ON CONFLICT (id) DO NOTHING;
SELECT setval('amo.po_seq', greatest((SELECT last_value FROM amo.po_seq), 2), true);

INSERT INTO amo.receipts (id, operator_id, po_id, vendor_id, part_no, qty, serials, certificate_type, certificate_ref, condition, station, customs_status, received_by, received_at) VALUES
  ('GR-0001', 'NKX', 'PO-0001', 'V-002', 'BACB30LM8-4', 10, '{}', 'COC', 'LHT-CoC-778120', 'NE', 'ENGM', 'BONDED', 'user:storekeeper', now() - interval '1 day'),
  ('GR-0002', 'NKX', NULL, 'V-002', 'IDG-737NG-761574', 1, '{IDG-30551}', 'FORM1', 'DE.145.0009-F1-552001', 'OH', 'ENGM', 'NONE', 'user:storekeeper', now() - interval '150 days')
ON CONFLICT (id) DO NOTHING;
SELECT setval('amo.receipt_seq', greatest((SELECT last_value FROM amo.receipt_seq), 2), true);

INSERT INTO amo.warranty_claims (id, operator_id, receipt_id, vendor_id, part_no, serial, failure, failed_at, claimed_amount, currency, status, created_by, created_at) VALUES
  ('WC-0001', 'NKX', 'GR-0002', 'V-002', 'IDG-737NG-761574', 'IDG-30551', 'Integrated drive generator disconnected in flight (oil overtemp) 140 days after overhaul', (now() - interval '4 days')::date, 18500.00, 'EUR', 'SUBMITTED', 'user:camo.engineer', now() - interval '3 days')
ON CONFLICT (id) DO NOTHING;
SELECT setval('amo.claim_seq', greatest((SELECT last_value FROM amo.claim_seq), 1), true);

INSERT INTO amo.exchanges (id, operator_id, vendor_id, part_no, serial_in, serial_out, fee, currency, core_due, status, created_by, created_at) VALUES
  ('EX-0001', 'NKX', 'V-002', 'HYD-PUMP-737-EDP', 'EDP-88213', 'EDP-71102', 9800.00, 'EUR', (now() - interval '3 days')::date, 'OPEN', 'user:storekeeper', now() - interval '33 days'),
  ('EX-0002', 'NKX', 'V-001', 'STARTER-737-ATS', 'ATS-5501', 'ATS-4419', 4200.00, 'EUR', (now() + interval '21 days')::date, 'OPEN', 'user:storekeeper', now() - interval '9 days')
ON CONFLICT (id) DO NOTHING;
SELECT setval('amo.exchange_seq', greatest((SELECT last_value FROM amo.exchange_seq), 2), true);

INSERT INTO amo.pbh_contracts (id, operator_id, vendor_id, scope, tails, rate_per_fh, currency, starts, ends) VALUES
  ('PBH-001', 'NKX', 'V-002', 'APU and wheels & brakes — B737 fleet (exchange pool, repairs included)', ARRAY['LN-ABC', 'LN-ABD', 'LN-NGX'], 38.50, 'EUR', '2025-01-01', '2029-12-31')
ON CONFLICT (id) DO NOTHING;

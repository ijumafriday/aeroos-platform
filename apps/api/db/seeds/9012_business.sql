-- Round 15 demo data: the Nordkapp group, chart of accounts, open periods, third-party maintenance customers,
-- orders in every state, one part-paid invoice past its due date and the matching ledger entries.
-- Ledger amounts are in the base currency (USD, like procurement); entity reporting currency is USD for the demo.

INSERT INTO org.legal_entities (id, name, country, currency, parent_id, operator_id, org_number) VALUES
  ('NKG', 'Nordkapp Group AS', 'NO', 'USD', NULL, 'NKX', '921 000 111'),
  ('NKA', 'Nordkapp Air AS', 'NO', 'USD', 'NKG', 'NKX', '921 000 222'),
  ('NKT', 'Nordkapp Technics AS', 'NO', 'USD', 'NKG', 'NKX', '921 000 333'),
  ('FJA', 'Fjord Regional AS', 'NO', 'USD', NULL, 'FJR', '934 555 777')
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.entity_approvals (entity_id, kind, reference, authority, valid_until, scope)
SELECT * FROM (VALUES
  ('NKA', 'AOC', 'NO.AOC.0117', 'Luftfartstilsynet (CAA Norway)', (current_date + 400)::date, 'Commercial air transport — passengers; B737, A320neo, A330, DHC-8, E195-E2'),
  ('NKA', 'CAMO', 'NO.CAMO.0117', 'Luftfartstilsynet (CAA Norway)', NULL::date, 'Continuing airworthiness of the NKX fleet'),
  ('NKT', 'PART145', 'NO.145.0042', 'Luftfartstilsynet (CAA Norway)', NULL::date, 'A1 B737-600/700/800/900, B737-8; A1 A320neo; B1 CFM56-7B; C6, C7, C14; third-party customers'),
  ('FJA', 'AOC', 'NO.AOC.0233', 'Luftfartstilsynet (CAA Norway)', (current_date + 75)::date, 'Commercial air transport — passengers; DHC-8-400'),
  ('FJA', 'CAMO', 'NO.CAMO.0233', 'Luftfartstilsynet (CAA Norway)', NULL::date, 'Continuing airworthiness of the FJR fleet')
) AS v(entity_id, kind, reference, authority, valid_until, scope)
WHERE NOT EXISTS (SELECT 1 FROM org.entity_approvals);

INSERT INTO org.cost_centres (code, entity_id, name, kind, manager) VALUES
  ('NKG-ADM', 'NKG', 'Group administration', 'ADMIN', 'auditor'),
  ('NKA-FLT', 'NKA', 'Flight operations', 'FLIGHT_OPS', 'occ.controller'),
  ('NKA-CAMO', 'NKA', 'Continuing airworthiness', 'CAMO', 'camo.manager'),
  ('NKT-BASE', 'NKT', 'Base maintenance (own fleet)', 'MAINTENANCE', 'k.mwangi'),
  ('NKT-MRO', 'NKT', 'Third-party maintenance sales', 'MRO_SALES', 'camo.manager'),
  ('NKT-STORES', 'NKT', 'Stores & logistics', 'STORES', 'storekeeper'),
  ('FJA-FLT', 'FJA', 'Flight operations', 'FLIGHT_OPS', 'occ.controller'),
  ('FJA-CAMO', 'FJA', 'Continuing airworthiness', 'CAMO', 'camo.manager'),
  ('FJA-MRO', 'FJA', 'Line maintenance sales (third party)', 'MRO_SALES', 'camo.manager'),
  ('FJA-STORES', 'FJA', 'Stores', 'STORES', 'storekeeper')
ON CONFLICT (code) DO NOTHING;

INSERT INTO org.gl_accounts (code, name, type) VALUES
  ('1100', 'Bank', 'ASSET'), ('1200', 'Trade receivables', 'ASSET'), ('1300', 'Parts inventory', 'ASSET'),
  ('2100', 'Trade payables / goods received not invoiced', 'LIABILITY'), ('2200', 'Output VAT', 'LIABILITY'),
  ('3000', 'Share capital and reserves', 'EQUITY'),
  ('4000', 'Maintenance revenue — labour', 'REVENUE'), ('4010', 'Maintenance revenue — parts', 'REVENUE'),
  ('4020', 'Maintenance revenue — subcontracted services', 'REVENUE'), ('4100', 'Passenger revenue', 'REVENUE'),
  ('5000', 'Cost of parts sold', 'EXPENSE'), ('6100', 'Fuel', 'EXPENSE'), ('6200', 'Crew costs', 'EXPENSE'),
  ('6300', 'Maintenance materials (own fleet)', 'EXPENSE'), ('6900', 'Other operating expenses', 'EXPENSE')
ON CONFLICT (code) DO NOTHING;

-- Periods: two months ago closed, last month and this month open.
INSERT INTO org.gl_periods (entity_id, period, status, closed_by, closed_at)
SELECT e.id, to_char(date_trunc('month', current_date) - (k || ' month')::interval, 'YYYY-MM'),
  CASE WHEN k = 3 THEN 'CLOSED' ELSE 'OPEN' END, CASE WHEN k = 3 THEN 'user:finance' END, CASE WHEN k = 3 THEN now() - interval '10 days' END
-- three months back is closed; the seeded entries (at most 40 days old) always fall in an open month
FROM org.legal_entities e CROSS JOIN (VALUES (0), (1), (2), (3)) AS m(k)
ON CONFLICT DO NOTHING;

INSERT INTO amo.customers (id, operator_id, name, country, currency, labour_rate, parts_markup_pct, service_markup_pct, vat_pct, payment_terms_days, credit_limit, created_by) VALUES
  ('CU-0001', 'NKX', 'Baltic Wings SIA', 'LV', 'EUR', 88, 15, 10, 0, 30, 60000, 'user:finance'),
  ('CU-0002', 'NKX', 'Arctic Charter AS', 'NO', 'NOK', 1050, 15, 10, 25, 20, 900000, 'user:finance'),
  ('CU-0003', 'NKX', 'Greenland Coastal ApS', 'DK', 'DKK', 690, 18, 12, 0, 30, 120000, 'user:finance')
ON CONFLICT (id) DO NOTHING;
SELECT setval('amo.customer_seq', greatest((SELECT last_value FROM amo.customer_seq), 3), true);

INSERT INTO amo.customer_orders (id, operator_id, customer_id, aircraft_reg, aircraft_type, title, status, currency, quote_lines, quote_net_cents, customer_ref, approved_at, cost_centre, created_by, created_at) VALUES
  ('CO-0001', 'NKX', 'CU-0001', 'YL-BWA', 'B737-800', 'Brake change both main gears and eddy-current inspection', 'INVOICED', 'EUR',
   '[{"kind":"LABOUR","description":"Brake change and NDT support","qty":60,"unitCost":0},{"kind":"PART","description":"Brake assembly 2612311-1","qty":2,"unitCost":4200},{"kind":"SERVICE","description":"Eddy-current NDT (subcontract)","qty":1,"unitCost":1500}]',
   1659000, 'BW-PO-26-0412', now() - interval '50 days', 'NKT-MRO', 'user:camo.manager', now() - interval '55 days'),
  ('CO-0002', 'NKX', 'CU-0002', 'LN-ACX', 'DHC-8-400', 'A-check and wheel change', 'IN_WORK', 'NOK',
   '[{"kind":"LABOUR","description":"A-check","qty":40,"unitCost":0},{"kind":"PART","description":"Main wheel assembly","qty":2,"unitCost":21000}]',
   9030000, 'AC-2026-118', now() - interval '6 days', 'NKT-MRO', 'user:camo.manager', now() - interval '8 days'),
  ('CO-0003', 'NKX', 'CU-0001', 'YL-BWB', 'B737-800', 'Borescope inspection after bird strike, engine 2', 'QUOTED', 'EUR',
   '[{"kind":"LABOUR","description":"Borescope inspection and report","qty":8,"unitCost":0}]',
   70400, NULL, NULL, 'NKT-MRO', 'user:camo.manager', now() - interval '1 day'),
  ('CO-0004', 'NKX', 'CU-0003', 'OY-GRC', 'DHC-8-400', 'Propeller de-ice boot replacement, propeller 1', 'COMPLETED', 'DKK',
   '[{"kind":"LABOUR","description":"De-ice boot replacement","qty":10,"unitCost":0},{"kind":"PART","description":"De-ice boot kit","qty":1,"unitCost":9000}]',
   1752000, 'GC-77120', now() - interval '12 days', 'NKT-MRO', 'user:camo.manager', now() - interval '14 days')
ON CONFLICT (id) DO NOTHING;
SELECT setval('amo.customer_order_seq', greatest((SELECT last_value FROM amo.customer_order_seq), 4), true);

INSERT INTO amo.order_lines (order_id, kind, description, qty, unit_cost, work_date, booked_by)
SELECT * FROM (VALUES
  ('CO-0001', 'LABOUR', 'Brake change both main gears', 52.0, 0.00, (current_date - 45)::date, 'user:k.mwangi'),
  ('CO-0001', 'LABOUR', 'NDT support and paperwork', 12.0, 0.00, (current_date - 44)::date, 'user:k.mwangi'),
  ('CO-0001', 'PART', 'Brake assembly 2612311-1', 2.0, 4200.00, (current_date - 45)::date, 'user:storekeeper'),
  ('CO-0001', 'SERVICE', 'Eddy-current NDT (subcontract)', 1.0, 1500.00, (current_date - 44)::date, 'user:k.mwangi'),
  ('CO-0002', 'LABOUR', 'A-check day 1', 18.0, 0.00, (current_date - 2)::date, 'user:k.mwangi'),
  ('CO-0002', 'PART', 'Main wheel assembly', 2.0, 21000.00, (current_date - 2)::date, 'user:storekeeper'),
  ('CO-0004', 'LABOUR', 'De-ice boot replacement', 14.5, 0.00, (current_date - 5)::date, 'user:j.otieno'),
  ('CO-0004', 'PART', 'De-ice boot kit', 1.0, 9000.00, (current_date - 5)::date, 'user:storekeeper'),
  ('CO-0004', 'PART', 'Adhesive kit EC-1300L', 2.0, 650.00, (current_date - 5)::date, 'user:storekeeper')
) AS v(order_id, kind, description, qty, unit_cost, work_date, booked_by)
WHERE NOT EXISTS (SELECT 1 FROM amo.order_lines);

-- CO-0001 invoiced 40 days ago (30 days terms): labour 64 h × 88 = 5,632.00; brakes 2 × 4,830.00 = 9,660.00;
-- NDT 1,650.00; net 16,942.00 EUR, no VAT (intra-EU, reverse charge). 8,000.00 paid; the rest is overdue.
INSERT INTO amo.invoices (id, operator_id, kind, order_id, customer_id, issued_on, due_on, currency, base_per_unit, lines,
  labour_cents, parts_cents, service_cents, net_cents, vat_cents, total_cents, paid_cents, status, issued_by, issued_at)
VALUES ('INV-NKX-2026-0001', 'NKX', 'INVOICE', 'CO-0001', 'CU-0001', (current_date - 40)::date, (current_date - 10)::date, 'EUR', 1.08,
  '[{"kind":"LABOUR","description":"Brake change both main gears","qty":52,"unitCost":0,"unitPrice":88,"amountCents":457600},{"kind":"LABOUR","description":"NDT support and paperwork","qty":12,"unitCost":0,"unitPrice":88,"amountCents":105600},{"kind":"PART","description":"Brake assembly 2612311-1","qty":2,"unitCost":4200,"unitPrice":4830,"amountCents":966000},{"kind":"SERVICE","description":"Eddy-current NDT (subcontract)","qty":1,"unitCost":1500,"unitPrice":1650,"amountCents":165000}]',
  563200, 966000, 165000, 1694200, 0, 1694200, 800000, 'PARTIALLY_PAID', 'user:finance', now() - interval '40 days')
ON CONFLICT (id) DO NOTHING;
INSERT INTO amo.invoice_numbers (operator_id, series, year, last) VALUES ('NKX', 'INV', 2026, 1) ON CONFLICT (operator_id, series, year) DO UPDATE SET last = greatest(amo.invoice_numbers.last, 1);

INSERT INTO amo.payments (invoice_id, amount_cents, reference, received_on, recorded_by)
VALUES ('INV-NKX-2026-0001', 800000, 'BW-PAY-7781', (current_date - 12)::date, 'user:finance')
ON CONFLICT DO NOTHING;

-- The ledger entries those two events produce (same source references, so the consumer will not post them twice),
-- plus last month's fuel and crew costs imported from the ERP as a manual journal.
INSERT INTO org.journal_entries (id, entity_id, operator_id, entry_date, period, source, source_ref, memo, currency, base_per_unit, posted_by) VALUES
  ('JE-000001', 'NKT', 'NKX', (current_date - 40)::date, to_char(current_date - 40, 'YYYY-MM'), 'amo.invoice.issued', 'INV-NKX-2026-0001',
   'Invoice INV-NKX-2026-0001 — Baltic Wings SIA (EUR @ 1.08)', 'EUR', 1.08, 'system:ledger'),
  ('JE-000002', 'NKT', 'NKX', (current_date - 12)::date, to_char(current_date - 12, 'YYYY-MM'), 'amo.payment.received', 'INV-NKX-2026-0001:BW-PAY-7781',
   'Payment BW-PAY-7781 for INV-NKX-2026-0001 — Baltic Wings SIA', 'EUR', 1.08, 'system:ledger'),
  ('JE-000003', 'NKA', 'NKX', (date_trunc('month', current_date) - interval '1 day')::date, to_char(date_trunc('month', current_date) - interval '1 day', 'YYYY-MM'), 'manual', 'JE-000003',
   'Fuel and crew costs last month (ERP import)', 'USD', 1, 'user:finance')
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.journal_lines (entry_id, account, cost_centre, debit_cents, credit_cents)
SELECT * FROM (VALUES
  ('JE-000001', '1200', NULL, 1829736::bigint, 0::bigint),
  ('JE-000001', '4000', 'NKT-MRO', 0, 608256),
  ('JE-000001', '4010', 'NKT-MRO', 0, 1043280),
  ('JE-000001', '4020', 'NKT-MRO', 0, 178200),
  ('JE-000002', '1100', NULL, 864000, 0),
  ('JE-000002', '1200', NULL, 0, 864000),
  ('JE-000003', '6100', 'NKA-FLT', 186500000, 0),
  ('JE-000003', '6200', 'NKA-FLT', 94200000, 0),
  ('JE-000003', '2100', NULL, 0, 280700000)
) AS v(entry_id, account, cost_centre, debit_cents, credit_cents)
WHERE NOT EXISTS (SELECT 1 FROM org.journal_lines);
SELECT setval('org.journal_seq', greatest((SELECT last_value FROM org.journal_seq), 3), true);

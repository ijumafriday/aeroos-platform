-- 0.35 P0: eliminate historical illustrative regulated values from production state and
-- make provenance explicit for the two master tables that originally carried demo defaults.

ALTER TABLE ops.aircraft_types
  ADD COLUMN IF NOT EXISTS data_origin text NOT NULL DEFAULT 'LEGACY_UNVERIFIED',
  ADD COLUMN IF NOT EXISTS source_ref text;
ALTER TABLE ops.aircraft_types DROP CONSTRAINT IF EXISTS aircraft_types_data_origin_check;
ALTER TABLE ops.aircraft_types ADD CONSTRAINT aircraft_types_data_origin_check
  CHECK (data_origin IN ('PROVENANCED','DEMO','ILLUSTRATIVE_MIGRATION','LEGACY_UNVERIFIED'));

-- Mark only the exact generic values shipped by migration 0024 as illustrative.
UPDATE ops.aircraft_types SET data_origin='ILLUSTRATIVE_MIGRATION', source_ref='historical migration 0024 generic demo figures'
WHERE (type, icao_type, seats, mzfw, mtow, mlw, max_fuel, burn_kg_per_hour, hold_kg_per_min, cruise_kt) IN (
  ('B737-800','B738',186,62732,79016,66361,20894,2500,40,450),
  ('B737 MAX 8','B38M',189,65952,82191,69309,20730,2250,37,450),
  ('A320neo','A20N',180,64300,79000,67400,18728,2300,38,450),
  ('A330-300','A333',300,175000,242000,187000,109185,5800,95,470),
  ('DHC-8-400','DH8D',78,25854,29574,28123,5318,900,16,340),
  ('E195-E2','E295',136,49000,61500,54000,13690,1900,30,440)
);

-- Fresh production installs have no references yet, so the historical generic rows disappear.
-- Existing deployments with dependent rows are deliberately retained but are tagged untrusted;
-- the production guard below will refuse to start until they are replaced/provenanced.
DELETE FROM ops.aircraft_types t
WHERE t.data_origin='ILLUSTRATIVE_MIGRATION'
  AND NOT EXISTS (SELECT 1 FROM ops.runway_limits r WHERE r.type=t.type);

ALTER TABLE ops.aircraft_types ALTER COLUMN data_origin DROP DEFAULT;

ALTER TABLE camo.engine_types
  ADD COLUMN IF NOT EXISTS data_origin text NOT NULL DEFAULT 'LEGACY_UNVERIFIED',
  ADD COLUMN IF NOT EXISTS source_ref text;
ALTER TABLE camo.engine_types DROP CONSTRAINT IF EXISTS engine_types_data_origin_check;
ALTER TABLE camo.engine_types ADD CONSTRAINT engine_types_data_origin_check
  CHECK (data_origin IN ('PROVENANCED','DEMO','ILLUSTRATIVE_MIGRATION','LEGACY_UNVERIFIED'));

UPDATE camo.engine_types SET data_origin='ILLUSTRATIVE_MIGRATION', source_ref='historical migration 0026 generic demo limits'
WHERE (engine_type, egt_margin_amber, egt_margin_red, egt_shift, n2_shift, ff_shift, vib_max, oil_alert_qph, oil_max_qph) IN (
  ('CFM56-7B',25,10,10,1.0,2.0,3.0,0.30,0.50),
  ('LEAP-1B',30,12,10,1.0,2.0,3.0,0.25,0.45),
  ('LEAP-1A',30,12,10,1.0,2.0,3.0,0.25,0.45),
  ('Trent 772B',25,10,12,1.0,2.5,2.5,0.35,0.60),
  ('PW150A',30,10,8,1.0,2.0,2.0,0.20,0.35),
  ('PW1900G',30,12,10,1.0,2.0,2.0,0.25,0.45)
);
DELETE FROM camo.engine_types t
WHERE t.data_origin='ILLUSTRATIVE_MIGRATION'
  AND NOT EXISTS (SELECT 1 FROM camo.engines e WHERE e.engine_type=t.engine_type);
ALTER TABLE camo.engine_types ALTER COLUMN data_origin DROP DEFAULT;

-- Production startup uses this SECURITY DEFINER function so the compliance service can inspect
-- hygiene without direct read grants into every owning domain.
CREATE OR REPLACE FUNCTION compliance.production_regulated_data_hygiene()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,compliance,ops,camo,platform AS $$
  SELECT jsonb_build_object(
    'demoSeedsApplied', EXISTS (SELECT 1 FROM platform.schema_migrations WHERE name LIKE 'seed:%'),
    'untrustedAircraftTypes', COALESCE((SELECT jsonb_agg(jsonb_build_object('type',type,'origin',data_origin,'sourceRef',source_ref) ORDER BY type)
      FROM ops.aircraft_types WHERE data_origin <> 'PROVENANCED'), '[]'::jsonb),
    'untrustedEngineTypes', COALESCE((SELECT jsonb_agg(jsonb_build_object('engineType',engine_type,'origin',data_origin,'sourceRef',source_ref) ORDER BY engine_type)
      FROM camo.engine_types WHERE data_origin <> 'PROVENANCED'), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION compliance.production_regulated_data_hygiene() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compliance.production_regulated_data_hygiene() TO compliance_svc;

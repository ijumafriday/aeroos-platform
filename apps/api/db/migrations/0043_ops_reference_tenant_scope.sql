-- 0.36 P0 D003: make regulated Operations reference data operator-owned.
-- Rebuild global-keyed tables with composite tenant keys and RLS. No application fallback remains.

ALTER TABLE ops.runway_limits DROP CONSTRAINT IF EXISTS runway_limits_type_fkey;

CREATE TABLE ops.aircraft_types_v2 (LIKE ops.aircraft_types INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING STORAGE INCLUDING COMMENTS);
ALTER TABLE ops.aircraft_types_v2 ADD COLUMN operator_id text NOT NULL;
ALTER TABLE ops.aircraft_types_v2 DROP CONSTRAINT IF EXISTS aircraft_types_v2_pkey;
ALTER TABLE ops.aircraft_types_v2 ADD PRIMARY KEY (operator_id, type);

INSERT INTO ops.aircraft_types_v2
SELECT t.*, p.operator_id
FROM ops.aircraft_types t
JOIN compliance.operator_profiles p ON t.type = ANY(p.approved_types);

CREATE TABLE ops.runway_limits_v2 (LIKE ops.runway_limits INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING STORAGE INCLUDING COMMENTS);
ALTER TABLE ops.runway_limits_v2 ADD COLUMN operator_id text NOT NULL;
ALTER TABLE ops.runway_limits_v2 DROP CONSTRAINT IF EXISTS runway_limits_v2_pkey;
ALTER TABLE ops.runway_limits_v2 ADD PRIMARY KEY (operator_id, airport, type);
INSERT INTO ops.runway_limits_v2
SELECT r.*, p.operator_id
FROM ops.runway_limits r
JOIN compliance.operator_profiles p ON r.type = ANY(p.approved_types);

CREATE TABLE ops.routes_v2 (LIKE ops.routes INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING STORAGE INCLUDING COMMENTS);
ALTER TABLE ops.routes_v2 ADD COLUMN operator_id text NOT NULL;
ALTER TABLE ops.routes_v2 DROP CONSTRAINT IF EXISTS routes_v2_pkey;
ALTER TABLE ops.routes_v2 ADD PRIMARY KEY (operator_id, dep, arr);
-- Legacy route rows are copied to existing operators for continuity, but remain governed by each
-- operator's own approval hash and may diverge immediately after migration.
INSERT INTO ops.routes_v2
SELECT r.*, p.operator_id FROM ops.routes r CROSS JOIN compliance.operator_profiles p;

CREATE TABLE ops.permit_rules_v2 (LIKE ops.permit_rules INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING STORAGE INCLUDING COMMENTS);
ALTER TABLE ops.permit_rules_v2 ADD COLUMN operator_id text NOT NULL;
ALTER TABLE ops.permit_rules_v2 DROP CONSTRAINT IF EXISTS permit_rules_v2_pkey;
ALTER TABLE ops.permit_rules_v2 ADD PRIMARY KEY (operator_id, country);
INSERT INTO ops.permit_rules_v2
SELECT r.*, p.operator_id FROM ops.permit_rules r CROSS JOIN compliance.operator_profiles p;

DROP TABLE ops.runway_limits;
DROP TABLE ops.aircraft_types;
DROP TABLE ops.routes;
DROP TABLE ops.permit_rules;
ALTER TABLE ops.aircraft_types_v2 RENAME TO aircraft_types;
ALTER TABLE ops.runway_limits_v2 RENAME TO runway_limits;
ALTER TABLE ops.routes_v2 RENAME TO routes;
ALTER TABLE ops.permit_rules_v2 RENAME TO permit_rules;
ALTER TABLE ops.runway_limits ADD CONSTRAINT runway_limits_type_fkey FOREIGN KEY (operator_id,type) REFERENCES ops.aircraft_types(operator_id,type);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['aircraft_types','runway_limits','routes','permit_rules'] LOOP
    EXECUTE format('ALTER TABLE ops.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE ops.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY aeroos_tenant_isolation ON ops.%I USING (current_setting(''aeroos.system'', true)=''true'' OR operator_id=nullif(current_setting(''aeroos.operator_id'', true),'''')) WITH CHECK (current_setting(''aeroos.system'', true)=''true'' OR operator_id=nullif(current_setting(''aeroos.operator_id'', true),''''))', t);
  END LOOP;
END $$;

GRANT SELECT ON ops.aircraft_types, ops.runway_limits, ops.routes, ops.permit_rules TO ops_svc;

-- Tenant-aware canonical hashes for regulated Operations data.
CREATE OR REPLACE FUNCTION compliance.current_regulated_dataset_sha256(p_operator text, p_key text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,compliance,ops,camo AS $$
DECLARE payload text;
BEGIN
  CASE p_key
    WHEN 'ops.aircraft_types' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.type)::text,'[]') INTO payload FROM ops.aircraft_types t WHERE t.operator_id=p_operator;
    WHEN 'ops.aircraft_weights' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.tail)::text,'[]') INTO payload FROM ops.aircraft_weights t WHERE t.operator_id=p_operator;
    WHEN 'ops.runway_limits' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.airport,t.type)::text,'[]') INTO payload FROM ops.runway_limits t WHERE t.operator_id=p_operator;
    WHEN 'ops.routes_permits' THEN
      SELECT jsonb_build_object(
        'routes',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.dep,r.arr) FROM ops.routes r WHERE r.operator_id=p_operator),'[]'::jsonb),
        'permitRules',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.country) FROM ops.permit_rules r WHERE r.operator_id=p_operator),'[]'::jsonb),
        'permits',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.country,r.number) FROM ops.overflight_permits r WHERE r.operator_id=p_operator),'[]'::jsonb)
      )::text INTO payload;
    WHEN 'camo.maintenance_programme' THEN SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,'[]') INTO payload FROM camo.requirements t WHERE t.operator_id=p_operator;
    WHEN 'camo.srm_limits' THEN SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.aircraft_type,t.zone,t.damage_type)::text,'[]') INTO payload FROM camo.srm_limits t WHERE t.aircraft_type = ANY(coalesce((SELECT approved_types FROM compliance.operator_profiles WHERE operator_id=p_operator),'{}'::text[]));
    WHEN 'camo.engine_limits' THEN SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.engine_type)::text,'[]') INTO payload FROM camo.engine_types t WHERE t.engine_type IN (SELECT DISTINCT e.engine_type FROM camo.engines e WHERE e.operator_id=p_operator);
    WHEN 'camo.mel' THEN SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.ref)::text,'[]') INTO payload FROM compliance.mel_entries t WHERE t.operator_id=p_operator;
    ELSE RETURN NULL;
  END CASE;
  RETURN encode(digest(convert_to(payload,'UTF8'),'sha256'),'hex');
END $$;
REVOKE ALL ON FUNCTION compliance.current_regulated_dataset_sha256(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compliance.current_regulated_dataset_sha256(text,text) TO compliance_svc;

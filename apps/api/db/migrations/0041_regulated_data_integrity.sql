-- 0.32 P0: bind governed regulatory approvals to the live dataset used by production actions.
-- The function is SECURITY DEFINER so compliance_svc can verify a canonical digest without gaining
-- direct write access to another domain's tables.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE compliance.master_data_sets DROP CONSTRAINT IF EXISTS master_data_sets_domain_check;
ALTER TABLE compliance.master_data_sets ADD CONSTRAINT master_data_sets_domain_check
  CHECK (domain IN ('AIRWORTHINESS','ENGINEERING','OPERATIONS','CREW','COMPLIANCE'));

CREATE OR REPLACE FUNCTION compliance.current_regulated_dataset_sha256(p_operator text, p_key text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,compliance,ops,camo AS $$
DECLARE payload text;
BEGIN
  CASE p_key
    WHEN 'ops.aircraft_types' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.type)::text,'[]') INTO payload
      FROM ops.aircraft_types t
      WHERE t.type = ANY(coalesce((SELECT approved_types FROM compliance.operator_profiles WHERE operator_id=p_operator),'{}'::text[]));
    WHEN 'ops.aircraft_weights' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.tail)::text,'[]') INTO payload FROM ops.aircraft_weights t WHERE t.operator_id=p_operator;
    WHEN 'ops.runway_limits' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.airport,t.type)::text,'[]') INTO payload
      FROM ops.runway_limits t WHERE t.type = ANY(coalesce((SELECT approved_types FROM compliance.operator_profiles WHERE operator_id=p_operator),'{}'::text[]));
    WHEN 'ops.routes_permits' THEN
      SELECT jsonb_build_object(
        'routes',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.dep,r.arr) FROM ops.routes r),'[]'::jsonb),
        'permitRules',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.country) FROM ops.permit_rules r),'[]'::jsonb),
        'permits',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.country,r.number) FROM ops.overflight_permits r WHERE r.operator_id=p_operator),'[]'::jsonb)
      )::text INTO payload;
    WHEN 'camo.maintenance_programme' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,'[]') INTO payload FROM camo.requirements t WHERE t.operator_id=p_operator;
    WHEN 'camo.srm_limits' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.aircraft_type,t.zone,t.damage_type)::text,'[]') INTO payload
      FROM camo.srm_limits t WHERE t.aircraft_type = ANY(coalesce((SELECT approved_types FROM compliance.operator_profiles WHERE operator_id=p_operator),'{}'::text[]));
    WHEN 'camo.engine_limits' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.engine_type)::text,'[]') INTO payload FROM camo.engine_types t
      WHERE t.engine_type IN (SELECT DISTINCT e.engine_type FROM camo.engines e WHERE e.operator_id=p_operator);
    WHEN 'camo.mel' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.ref)::text,'[]') INTO payload FROM compliance.mel_entries t WHERE t.operator_id=p_operator;
    ELSE
      RETURN NULL;
  END CASE;
  RETURN encode(digest(convert_to(payload,'UTF8'),'sha256'),'hex');
END $$;
REVOKE ALL ON FUNCTION compliance.current_regulated_dataset_sha256(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compliance.current_regulated_dataset_sha256(text,text) TO compliance_svc;

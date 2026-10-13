-- Database-enforced tenant isolation for tenant tables carrying operator_id.
-- platform.audit_log is intentionally excluded: ADR-0005 defines one cross-operator hash chain per module;
-- hiding prior operators from the append path would fork that chain. Audit reads are explicitly operator-scoped.
-- aeroos_owner (migration role) remains exempt as PostgreSQL table owner; service roles are subject to RLS.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    WHERE c.column_name = 'operator_id'
      AND c.table_schema IN ('platform','compliance','org','camo','amo','ops')
      AND NOT (c.table_schema = 'platform' AND c.table_name IN ('rate_limits','audit_log'))
    GROUP BY c.table_schema, c.table_name
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.table_schema, r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS aeroos_tenant_isolation ON %I.%I', r.table_schema, r.table_name);
    EXECUTE format(
      'CREATE POLICY aeroos_tenant_isolation ON %I.%I USING (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), '''')) WITH CHECK (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), ''''))',
      r.table_schema, r.table_name
    );
  END LOOP;
END $$;

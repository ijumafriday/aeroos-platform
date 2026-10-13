-- Runs as the PostgreSQL superuser on every `docker compose up` (service "db-roles"), before the API
-- applies migrations. Idempotent: creates module roles added after the database volume was first
-- initialised (00-roles.sql only runs on an empty volume). DEVELOPMENT PASSWORDS ONLY.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['aeroos_owner', 'platform_svc', 'compliance_svc', 'org_svc', 'camo_svc', 'engineering_svc', 'records_svc', 'amo_svc', 'ops_svc'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', r, r);
      RAISE NOTICE 'created role %', r;
    END IF;
  END LOOP;
END $$;
CREATE SCHEMA IF NOT EXISTS ops AUTHORIZATION aeroos_owner;

CREATE SCHEMA IF NOT EXISTS engineering AUTHORIZATION aeroos_owner;

CREATE SCHEMA IF NOT EXISTS records AUTHORIZATION aeroos_owner;

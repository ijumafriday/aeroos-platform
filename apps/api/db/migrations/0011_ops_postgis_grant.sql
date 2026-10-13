-- PostGIS lives in schema public (created by the init script after REVOKE ALL ... FROM PUBLIC).
-- Flight Ops calls ST_Distance / ST_DWithin for diversion alternates, so its role needs USAGE there.
GRANT USAGE ON SCHEMA public TO ops_svc;

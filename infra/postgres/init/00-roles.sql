-- Runs once, as the PostgreSQL superuser, when the database volume is first created.
-- One schema and one login role per module: a module can only touch its own tables, so the
-- modular-monolith boundaries are enforced by the database, not just by code review.
--
-- DEVELOPMENT PASSWORDS ONLY. In Kubernetes these roles and secrets come from CloudNativePG
-- (self-hosted profile) or the managed database (cloud profile) — see deploy/helm.

CREATE ROLE aeroos_owner  LOGIN PASSWORD 'aeroos_owner';   -- runs migrations
CREATE ROLE platform_svc  LOGIN PASSWORD 'platform_svc';   -- outbox relay, notifications, idempotency, audit reads
CREATE ROLE compliance_svc LOGIN PASSWORD 'compliance_svc';
CREATE ROLE org_svc       LOGIN PASSWORD 'org_svc';
CREATE ROLE camo_svc      LOGIN PASSWORD 'camo_svc';
CREATE ROLE engineering_svc LOGIN PASSWORD 'engineering_svc';
CREATE ROLE records_svc    LOGIN PASSWORD 'records_svc';
CREATE ROLE amo_svc       LOGIN PASSWORD 'amo_svc';
CREATE ROLE ops_svc       LOGIN PASSWORD 'ops_svc';
-- The Temporal worker has no database role: its activities change state only through the
-- API's internal endpoints, so every write still passes through the owning module's rules.

ALTER DATABASE aeroos OWNER TO aeroos_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA platform   AUTHORIZATION aeroos_owner;
CREATE SCHEMA compliance AUTHORIZATION aeroos_owner;
CREATE SCHEMA org        AUTHORIZATION aeroos_owner;
CREATE SCHEMA camo       AUTHORIZATION aeroos_owner;
CREATE SCHEMA engineering AUTHORIZATION aeroos_owner;
CREATE SCHEMA records     AUTHORIZATION aeroos_owner;
CREATE SCHEMA amo        AUTHORIZATION aeroos_owner;
CREATE SCHEMA ops        AUTHORIZATION aeroos_owner;

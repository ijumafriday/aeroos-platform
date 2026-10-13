-- Platform: audit chain, outbox, inbox, dead letters, notifications, idempotency.
-- Migrations are immutable once applied (checksummed by the migrator). Change = new file.

CREATE TABLE platform.audit_log (
  seq         bigserial PRIMARY KEY,
  chain       text        NOT NULL,
  at          timestamptz NOT NULL,
  actor       text        NOT NULL,
  action      text        NOT NULL,
  entity_type text        NOT NULL,
  entity_id   text        NOT NULL,
  data        jsonb       NOT NULL,
  rule        text,
  prev_hash   char(64)    NOT NULL,
  hash        char(64)    NOT NULL UNIQUE,
  -- A chain can never fork: each hash is the predecessor of at most one entry.
  CONSTRAINT audit_chain_no_fork UNIQUE (chain, prev_hash)
);
CREATE INDEX audit_log_entity ON platform.audit_log (entity_type, entity_id);
CREATE INDEX audit_log_chain_seq ON platform.audit_log (chain, seq DESC);

-- Append-only: no role, including the owner, can update or delete without dropping this trigger,
-- and dropping it is itself a DDL event visible in database logs.
CREATE FUNCTION platform.audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'platform.audit_log is append-only';
END $$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON platform.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION platform.audit_log_append_only();

CREATE TABLE platform.outbox (
  id           uuid PRIMARY KEY,
  topic        text        NOT NULL,
  key          text        NOT NULL,
  type         text        NOT NULL,
  payload      jsonb       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_unpublished ON platform.outbox (created_at) WHERE published_at IS NULL;

CREATE TABLE platform.inbox (
  consumer     text        NOT NULL,
  event_id     uuid        NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

CREATE TABLE platform.dead_letters (
  id        uuid PRIMARY KEY,
  consumer  text        NOT NULL,
  topic     text        NOT NULL,
  payload   jsonb       NOT NULL,
  error     text        NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.notifications (
  id          uuid PRIMARY KEY,
  operator_id text        NOT NULL,
  severity    text        NOT NULL,
  title       text        NOT NULL,
  body        text        NOT NULL,
  link        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_by     text[]      NOT NULL DEFAULT '{}'
);
CREATE INDEX notifications_operator ON platform.notifications (operator_id, created_at DESC);

CREATE TABLE platform.idempotency (
  actor      text        NOT NULL,
  key        text        NOT NULL,
  status     text        NOT NULL,
  response   jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor, key)
);

-- Grants: every module may append to the shared platform tables inside its own transaction.
GRANT USAGE ON SCHEMA platform TO platform_svc, compliance_svc, org_svc, camo_svc, amo_svc;
GRANT SELECT, INSERT ON platform.audit_log TO compliance_svc, org_svc, camo_svc, amo_svc;
GRANT USAGE ON SEQUENCE platform.audit_log_seq_seq TO compliance_svc, org_svc, camo_svc, amo_svc;
GRANT INSERT ON platform.outbox, platform.notifications TO compliance_svc, org_svc, camo_svc, amo_svc;
GRANT SELECT, INSERT ON platform.inbox TO compliance_svc, org_svc, camo_svc, amo_svc;

GRANT SELECT ON platform.audit_log TO platform_svc;
GRANT SELECT, UPDATE ON platform.outbox TO platform_svc;
GRANT SELECT, UPDATE ON platform.notifications TO platform_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.idempotency TO platform_svc;
GRANT INSERT ON platform.dead_letters TO platform_svc;

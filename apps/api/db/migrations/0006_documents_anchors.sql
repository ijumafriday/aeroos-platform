-- Documents (bytes live in S3-compatible object storage; this is the register) and audit anchors.

CREATE TABLE platform.documents (
  id           text PRIMARY KEY,
  operator_id  text        NOT NULL,
  owner_type   text        NOT NULL,            -- e.g. task_card, training_record, licence, crs
  owner_id     text        NOT NULL,
  kind         text        NOT NULL DEFAULT 'attachment',  -- attachment | generated
  file_name    text        NOT NULL,
  content_type text        NOT NULL,
  object_key   text        NOT NULL UNIQUE,
  size_bytes   bigint,
  sha256       char(64),
  status       text        NOT NULL CHECK (status IN ('PENDING', 'STORED')),
  uploaded_by  text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  stored_at    timestamptz
);
CREATE INDEX documents_owner ON platform.documents (owner_type, owner_id);
-- A generated document (e.g. the CRS PDF) exists once per owner, so regeneration is idempotent.
CREATE UNIQUE INDEX documents_generated_once ON platform.documents (owner_type, owner_id) WHERE kind = 'generated';

-- External anchors of each audit chain head: signed checkpoint written to a write-once bucket.
CREATE TABLE platform.audit_anchors (
  id          bigserial PRIMARY KEY,
  chain       text        NOT NULL,
  seq         bigint      NOT NULL,
  hash        char(64)    NOT NULL,
  anchored_at timestamptz NOT NULL,
  object_key  text        NOT NULL,
  signature   jsonb       NOT NULL,
  CONSTRAINT anchor_once UNIQUE (chain, seq)
);
CREATE TRIGGER audit_anchors_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON platform.audit_anchors
  FOR EACH STATEMENT EXECUTE FUNCTION platform.audit_log_append_only();

-- The CRS PDF reference is set after the PDF is generated (asynchronously, from the CRS event).
ALTER TABLE amo.task_cards ADD COLUMN crs_document_id text;

GRANT SELECT, INSERT, UPDATE ON platform.documents TO platform_svc;
-- Platform-owned chains ("documents", "anchors") are written with the platform role.
GRANT INSERT ON platform.audit_log, platform.outbox, platform.notifications TO platform_svc;
GRANT USAGE ON SEQUENCE platform.audit_log_seq_seq TO platform_svc;
GRANT SELECT, INSERT ON platform.audit_anchors TO platform_svc;
GRANT USAGE ON SEQUENCE platform.audit_anchors_id_seq TO platform_svc;

-- AMO (Part-145): task cards with signed step stamps and the CRS.
CREATE SEQUENCE amo.task_card_seq START 77900;
CREATE SEQUENCE amo.crs_seq START 88200;

CREATE TABLE amo.task_cards (
  id            text PRIMARY KEY,
  operator_id   text        NOT NULL,
  tail          text        NOT NULL,
  aircraft_type text        NOT NULL,
  title         text        NOT NULL,
  ata           text        NOT NULL,
  trade         text        NOT NULL,
  source_type   text        NOT NULL,
  source_id     text        NOT NULL,
  status        text        NOT NULL CHECK (status IN ('OPEN', 'IN_PROGRESS', 'CERTIFIED')),
  steps         jsonb       NOT NULL,
  crs           jsonb,
  created_at    timestamptz NOT NULL,
  version       integer     NOT NULL DEFAULT 1,
  -- One task card per engineering order: makes event redelivery harmless.
  CONSTRAINT task_card_per_source UNIQUE (source_type, source_id)
);
CREATE INDEX task_cards_open ON amo.task_cards (operator_id, status) WHERE status <> 'CERTIFIED';

GRANT USAGE ON SCHEMA amo TO amo_svc;
GRANT SELECT, INSERT, UPDATE ON amo.task_cards TO amo_svc;
GRANT USAGE ON SEQUENCE amo.task_card_seq, amo.crs_seq TO amo_svc;

-- CAMO: fleet, MEL deferrals, engineering orders.
CREATE TABLE camo.fleet (
  reg           text PRIMARY KEY,
  operator_id   text NOT NULL,
  aircraft_type text NOT NULL,
  msn           text NOT NULL,
  status        text NOT NULL DEFAULT 'SVC' CHECK (status IN ('SVC', 'AOG', 'CHK'))
);

CREATE SEQUENCE camo.mel_seq START 24500;
CREATE SEQUENCE camo.eo_seq START 430;

CREATE TABLE camo.mel_items (
  id                text PRIMARY KEY,
  operator_id       text        NOT NULL,
  tail              text        NOT NULL REFERENCES camo.fleet (reg),
  aircraft_type     text        NOT NULL,
  mel_ref           text        NOT NULL,
  ata               text        NOT NULL,
  category          text        NOT NULL CHECK (category IN ('A', 'B', 'C', 'D')),
  title             text        NOT NULL,
  description       text        NOT NULL,
  raised_at         timestamptz NOT NULL,
  raised_by         text        NOT NULL,
  original_deadline timestamptz NOT NULL,
  deadline          timestamptz NOT NULL,
  deadline_rule     text        NOT NULL,
  deadline_basis    text        NOT NULL,
  extensions        integer     NOT NULL DEFAULT 0,
  status            text        NOT NULL CHECK (status IN ('OPEN', 'CLOSED', 'EXPIRED')),
  eo_id             text UNIQUE,
  closed_at         timestamptz,
  closed_by         text,
  closure_ref       text,
  version           integer     NOT NULL DEFAULT 1
);
CREATE INDEX mel_items_open ON camo.mel_items (operator_id, deadline) WHERE status = 'OPEN';

CREATE TABLE camo.engineering_orders (
  id              text PRIMARY KEY,
  operator_id     text             NOT NULL,
  tail            text             NOT NULL REFERENCES camo.fleet (reg),
  aircraft_type   text             NOT NULL,
  title           text             NOT NULL,
  ata             text             NOT NULL,
  trade           text             NOT NULL,
  source_type     text             NOT NULL,
  source_id       text             NOT NULL,
  steps           jsonb            NOT NULL,
  estimated_hours double precision NOT NULL,
  status          text             NOT NULL,
  created_at      timestamptz      NOT NULL,
  created_by      text             NOT NULL
);

GRANT USAGE ON SCHEMA camo TO camo_svc;
GRANT SELECT ON camo.fleet TO camo_svc;
GRANT SELECT, INSERT, UPDATE ON camo.mel_items, camo.engineering_orders TO camo_svc;
GRANT USAGE ON SEQUENCE camo.mel_seq, camo.eo_seq TO camo_svc;

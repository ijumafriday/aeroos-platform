-- CAMO depth: maintenance programme (tasks, ADs, life-limited parts), utilisation, compliance records,
-- work packages, airworthiness state and reliability alert levels.

-- Aircraft counters: a baseline (from the previous system / delivery) plus utilisation fed by Ops events.
CREATE TABLE camo.aircraft_counters (
  reg           text PRIMARY KEY REFERENCES camo.fleet (reg),
  delivery_date date             NOT NULL,
  base_at       timestamptz      NOT NULL,
  base_fh       double precision NOT NULL,
  base_fc       integer          NOT NULL
);

-- One row per completed flight (ops.flight.arrived). The natural key makes redelivery harmless.
CREATE TABLE camo.utilisation (
  flight_id     text PRIMARY KEY,
  tail          text        NOT NULL,
  arrived_at    timestamptz NOT NULL,
  block_minutes integer     NOT NULL CHECK (block_minutes > 0)
);
CREATE INDEX utilisation_tail ON camo.utilisation (tail, arrived_at);

CREATE TABLE camo.requirements (
  id              text PRIMARY KEY,
  operator_id     text    NOT NULL,
  kind            text    NOT NULL CHECK (kind IN ('TASK', 'AD', 'LLP')),
  ref             text    NOT NULL,
  title           text    NOT NULL,
  ata             text    NOT NULL,
  types           text[]  NOT NULL,
  interval        jsonb   NOT NULL,
  repetitive      boolean NOT NULL,
  steps           jsonb   NOT NULL,
  estimated_hours double precision NOT NULL DEFAULT 1,
  tools           text[]  NOT NULL DEFAULT '{}',
  parts           jsonb   NOT NULL DEFAULT '[]',
  active          boolean NOT NULL DEFAULT true,
  CONSTRAINT requirement_ref_unique UNIQUE (operator_id, ref)
);

-- Installed life-limited parts: where they are and how much life they had when installed.
CREATE TABLE camo.components (
  id                      text PRIMARY KEY,
  tail                    text NOT NULL REFERENCES camo.fleet (reg),
  requirement_id          text NOT NULL REFERENCES camo.requirements (id),
  part_no                 text NOT NULL,
  serial                  text NOT NULL,
  position                text NOT NULL,
  installed_at            timestamptz      NOT NULL,
  aircraft_fh_at_install  double precision NOT NULL,
  aircraft_fc_at_install  integer          NOT NULL,
  part_tsn_at_install     double precision NOT NULL,
  part_csn_at_install     integer          NOT NULL,
  removed_at              timestamptz
);
CREATE UNIQUE INDEX components_installed ON camo.components (tail, requirement_id) WHERE removed_at IS NULL;

-- Compliance history: the latest row per (requirement, tail) is the "last done".
CREATE TABLE camo.compliance (
  id             serial PRIMARY KEY,
  requirement_id text        NOT NULL REFERENCES camo.requirements (id),
  tail           text        NOT NULL,
  done_at        timestamptz NOT NULL,
  fh             double precision NOT NULL,
  fc             integer     NOT NULL,
  reference      text        NOT NULL,   -- CRS number, or the source of an imported record
  recorded_by    text        NOT NULL,
  CONSTRAINT compliance_once_per_reference UNIQUE (requirement_id, tail, reference)
);
CREATE INDEX compliance_latest ON camo.compliance (requirement_id, tail, done_at DESC);

CREATE SEQUENCE camo.wp_seq START 3100;
CREATE TABLE camo.work_packages (
  id            text PRIMARY KEY,
  operator_id   text        NOT NULL,
  tail          text        NOT NULL,
  aircraft_type text        NOT NULL,
  title         text        NOT NULL,
  station       text        NOT NULL,
  bay           text,
  planned_start timestamptz,
  planned_end   timestamptz,
  status        text        NOT NULL CHECK (status IN ('DRAFT', 'PLANNED', 'RELEASED', 'COMPLETED', 'CANCELLED')),
  items         jsonb       NOT NULL,
  created_by    text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  version       integer     NOT NULL DEFAULT 1
);
CREATE INDEX work_packages_tail ON camo.work_packages (tail, status);

-- Last published airworthiness state per aircraft (to emit changes once).
CREATE TABLE camo.airworthiness (
  reg        text PRIMARY KEY,
  airworthy  boolean     NOT NULL,
  reasons    jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Reliability programme alert levels (defects per 1000 FH) by ATA chapter.
CREATE TABLE camo.reliability_alert_levels (
  operator_id text NOT NULL,
  ata         text NOT NULL,
  alert_level double precision NOT NULL,
  PRIMARY KEY (operator_id, ata)
);

GRANT SELECT ON camo.aircraft_counters, camo.requirements, camo.components, camo.reliability_alert_levels TO camo_svc;
GRANT SELECT, INSERT ON camo.utilisation, camo.compliance TO camo_svc;
GRANT USAGE ON SEQUENCE camo.compliance_id_seq, camo.wp_seq TO camo_svc;
GRANT SELECT, INSERT, UPDATE ON camo.work_packages, camo.airworthiness TO camo_svc;

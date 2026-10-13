-- Flight Ops / OCC: airports (PostGIS), schedule, crew roster, dispatch projection, recovery runs.
-- The ops schema and the ops_svc role exist from 00-roles.sql (fresh volume) or ensure-roles.sql (upgrade).

CREATE TABLE ops.airports (
  icao      text PRIMARY KEY,
  iata      text NOT NULL,
  name      text NOT NULL,
  time_zone text NOT NULL,
  lat       double precision NOT NULL,
  lon       double precision NOT NULL,
  location  geography(Point, 4326) NOT NULL,
  is_base   boolean NOT NULL DEFAULT false
);
CREATE INDEX airports_location ON ops.airports USING GIST (location);

CREATE TABLE ops.flights (
  id            text PRIMARY KEY,
  operator_id   text        NOT NULL,
  flight_no     text        NOT NULL,
  op_date       date        NOT NULL,
  dep           text        NOT NULL REFERENCES ops.airports (icao),
  arr           text        NOT NULL REFERENCES ops.airports (icao),
  std           timestamptz NOT NULL,
  sta           timestamptz NOT NULL,
  etd           timestamptz NOT NULL,
  eta           timestamptz NOT NULL,
  tail          text        NOT NULL,
  aircraft_type text        NOT NULL,
  status        text        NOT NULL CHECK (status IN ('SCHEDULED', 'DELAYED', 'CANCELLED', 'DEPARTED', 'ARRIVED')),
  delay_minutes integer     NOT NULL DEFAULT 0,
  delay_reason  text,
  version       integer     NOT NULL DEFAULT 1,
  CONSTRAINT flight_once_per_day UNIQUE (flight_no, op_date),
  CONSTRAINT sta_after_std CHECK (sta > std)
);
CREATE INDEX flights_window ON ops.flights (operator_id, etd);
CREATE INDEX flights_tail ON ops.flights (tail, etd);

CREATE TABLE ops.crew_members (
  id             text PRIMARY KEY,
  operator_id    text   NOT NULL,
  name           text   NOT NULL,
  rank           text   NOT NULL CHECK (rank IN ('CPT', 'FO')),
  base           text   NOT NULL,
  qualifications text[] NOT NULL DEFAULT '{}',
  active         boolean NOT NULL DEFAULT true
);

CREATE TABLE ops.crew_assignments (
  crew_id   text NOT NULL REFERENCES ops.crew_members (id),
  flight_id text NOT NULL REFERENCES ops.flights (id),
  role      text NOT NULL CHECK (role IN ('CPT', 'FO')),
  duty_key  text NOT NULL,
  PRIMARY KEY (crew_id, flight_id)
);
CREATE INDEX crew_assignments_flight ON ops.crew_assignments (flight_id);

-- Dispatch projection: open MEL items per tail, maintained from CAMO events (never read from camo.*).
CREATE TABLE ops.tail_mel (
  mel_item_id text PRIMARY KEY,
  tail        text        NOT NULL,
  mel_ref     text        NOT NULL,
  category    text        NOT NULL,
  deadline    timestamptz NOT NULL,
  expired     boolean     NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tail_mel_tail ON ops.tail_mel (tail);

CREATE SEQUENCE ops.recovery_seq START 100;
CREATE TABLE ops.recovery_runs (
  id           text PRIMARY KEY,
  operator_id  text        NOT NULL,
  status       text        NOT NULL CHECK (status IN ('RUNNING', 'PROPOSED', 'FAILED', 'ACCEPTED', 'REJECTED', 'STALE')),
  window_from  timestamptz NOT NULL,
  window_to    timestamptz NOT NULL,
  problem      jsonb       NOT NULL,
  solution     jsonb,
  changes      jsonb       NOT NULL DEFAULT '[]',
  solver       text,
  objective    double precision,
  wall_seconds double precision,
  error        text,
  requested_by text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_by   text,
  decided_at   timestamptz
);

GRANT USAGE ON SCHEMA ops TO ops_svc;
GRANT SELECT ON ops.airports TO ops_svc;
GRANT SELECT, INSERT, UPDATE ON ops.flights, ops.crew_members, ops.crew_assignments, ops.recovery_runs TO ops_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ops.tail_mel TO ops_svc;
GRANT USAGE ON SEQUENCE ops.recovery_seq TO ops_svc;
-- Platform services used inside ops transactions (audit chain, outbox, inbox, notifications).
GRANT USAGE ON SCHEMA platform TO ops_svc;
GRANT SELECT, INSERT ON platform.audit_log, platform.inbox TO ops_svc;
GRANT USAGE ON SEQUENCE platform.audit_log_seq_seq TO ops_svc;
GRANT INSERT ON platform.outbox, platform.notifications TO ops_svc;

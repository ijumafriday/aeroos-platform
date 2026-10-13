-- Crew recovery: airport standby windows, and runs of the crew-assignment optimiser.
CREATE TABLE ops.standby (
  crew_id  text        NOT NULL REFERENCES ops.crew_members (id),
  start_at timestamptz NOT NULL,
  end_at   timestamptz NOT NULL CHECK (end_at > start_at),
  base     text        NOT NULL,
  PRIMARY KEY (crew_id, start_at)
);
CREATE INDEX standby_window ON ops.standby (start_at, end_at);

CREATE SEQUENCE ops.crew_recovery_seq START 1001;
CREATE TABLE ops.crew_recovery_runs (
  id           text PRIMARY KEY,
  operator_id  text        NOT NULL,
  status       text        NOT NULL CHECK (status IN ('RUNNING', 'PROPOSED', 'FAILED', 'ACCEPTED', 'REJECTED', 'STALE')),
  problem      jsonb       NOT NULL,
  solution     jsonb,
  solver       text,
  objective    double precision,
  wall_seconds double precision,
  error        text,
  requested_by text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_by   text,
  decided_at   timestamptz
);
CREATE INDEX crew_recovery_runs_recent ON ops.crew_recovery_runs (operator_id, created_at DESC);

GRANT SELECT, INSERT ON ops.standby TO ops_svc;
GRANT SELECT, INSERT, UPDATE ON ops.crew_recovery_runs TO ops_svc;
GRANT USAGE ON SEQUENCE ops.crew_recovery_seq TO ops_svc;

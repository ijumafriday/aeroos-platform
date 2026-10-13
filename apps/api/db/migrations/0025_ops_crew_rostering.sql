-- Round 13: crew rostering, fatigue risk management and the crew hub.

-- A crew member can sign in: the Keycloak username of the person (one person, one crew record).
ALTER TABLE ops.crew_members ADD COLUMN username text UNIQUE;

-- Leave, sickness, days off and ground training: the roster builder never assigns flying into these.
CREATE TABLE ops.crew_unavailability (
  id           serial PRIMARY KEY,
  operator_id  text        NOT NULL,
  crew_id      text        NOT NULL REFERENCES ops.crew_members (id),
  kind         text        NOT NULL CHECK (kind IN ('LEAVE', 'SICK', 'OFF', 'TRAINING')),
  start_at     timestamptz NOT NULL,
  end_at       timestamptz NOT NULL,
  note         text,
  cancelled    boolean     NOT NULL DEFAULT false,
  created_by   text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (start_at < end_at)
);
CREATE INDEX crew_unavailability_crew ON ops.crew_unavailability (crew_id, start_at);

-- A roster-builder run: the proposal is kept as computed; accepting it books the assignments.
CREATE TABLE ops.roster_runs (
  id           text PRIMARY KEY,
  operator_id  text        NOT NULL,
  period_from  date        NOT NULL,
  period_to    date        NOT NULL,
  status       text        NOT NULL CHECK (status IN ('PROPOSED', 'ACCEPTED', 'REJECTED')),
  proposal     jsonb       NOT NULL,
  created_by   text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_by   text,
  decided_at   timestamptz,
  CHECK (period_from <= period_to)
);
CREATE SEQUENCE ops.roster_run_seq;

-- Published roster periods (ORO.FTL.110(b): at least 14 days ahead; a shorter notice needs a reason).
CREATE TABLE ops.roster_publications (
  id           serial PRIMARY KEY,
  operator_id  text        NOT NULL,
  period_from  date        NOT NULL,
  period_to    date        NOT NULL,
  notice       text,
  note         text,
  published_by text        NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_from <= period_to)
);

-- Every change to a published roster, for the crew member to see and acknowledge.
CREATE TABLE ops.roster_changes (
  id          bigserial PRIMARY KEY,
  operator_id text        NOT NULL,
  crew_id     text        NOT NULL,
  flight_id   text        NOT NULL,
  change      text        NOT NULL CHECK (change IN ('ADDED', 'REMOVED')),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX roster_changes_crew ON ops.roster_changes (crew_id, id);

CREATE TABLE ops.roster_acks (
  crew_id         text PRIMARY KEY REFERENCES ops.crew_members (id),
  last_change_id  bigint      NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION ops.log_roster_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  kind text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; kind := 'REMOVED';
  ELSE r := NEW; kind := 'ADDED';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.crew_id = NEW.crew_id AND OLD.flight_id = NEW.flight_id THEN RETURN NULL; END IF;
    INSERT INTO ops.roster_changes (operator_id, crew_id, flight_id, change)
      SELECT f.operator_id, OLD.crew_id, OLD.flight_id, 'REMOVED' FROM ops.flights f
      WHERE f.id = OLD.flight_id AND EXISTS (SELECT 1 FROM ops.roster_publications p
        WHERE p.operator_id = f.operator_id AND f.op_date BETWEEN p.period_from AND p.period_to);
  END IF;
  INSERT INTO ops.roster_changes (operator_id, crew_id, flight_id, change)
    SELECT f.operator_id, r.crew_id, r.flight_id, kind FROM ops.flights f
    WHERE f.id = r.flight_id AND EXISTS (SELECT 1 FROM ops.roster_publications p
      WHERE p.operator_id = f.operator_id AND f.op_date BETWEEN p.period_from AND p.period_to);
  RETURN NULL;
END $$;
CREATE TRIGGER crew_assignments_changes AFTER INSERT OR UPDATE OR DELETE ON ops.crew_assignments
  FOR EACH ROW EXECUTE FUNCTION ops.log_roster_change();

-- Fatigue reports (ORO.FTL.120 FRM / AMC1 ORO.FTL.120: non-punitive reporting). Karolinska Sleepiness Scale
-- 1–9 and Samn-Perelli 1–7; the safety office reviews them.
CREATE TABLE ops.fatigue_reports (
  id             serial PRIMARY KEY,
  operator_id    text        NOT NULL,
  crew_id        text        NOT NULL REFERENCES ops.crew_members (id),
  flight_id      text REFERENCES ops.flights (id),
  kss            integer     NOT NULL CHECK (kss BETWEEN 1 AND 9),
  samn_perelli   integer     NOT NULL CHECK (samn_perelli BETWEEN 1 AND 7),
  sleep_hours_24 numeric(4, 1) CHECK (sleep_hours_24 BETWEEN 0 AND 24),
  severity       text        NOT NULL CHECK (severity IN ('LOW', 'MODERATE', 'HIGH')),
  narrative      text        NOT NULL,
  status         text        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'REVIEWED')),
  reported_by    text        NOT NULL,
  reported_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_by    text,
  reviewed_at    timestamptz,
  review_note    text,
  CHECK (reviewed_by IS NULL OR reviewed_by <> reported_by)
);

GRANT SELECT, INSERT, UPDATE ON ops.crew_unavailability, ops.roster_runs, ops.roster_publications, ops.roster_acks, ops.fatigue_reports TO ops_svc;
GRANT SELECT, INSERT ON ops.roster_changes TO ops_svc;
GRANT USAGE ON SEQUENCE ops.crew_unavailability_id_seq, ops.roster_run_seq, ops.roster_publications_id_seq,
  ops.roster_changes_id_seq, ops.fatigue_reports_id_seq TO ops_svc;

-- AeroOS 0.24: flight-watch operational data and deeper crew planning.
-- All provider-fed operational data keeps provenance; no synthetic provider data is generated here.

CREATE TABLE ops.weather_reports (
  id              bigserial PRIMARY KEY,
  operator_id     text        NOT NULL,
  station         text        NOT NULL,
  kind            text        NOT NULL CHECK (kind IN ('METAR','TAF')),
  issued_at       timestamptz NOT NULL,
  valid_from      timestamptz NOT NULL,
  valid_to        timestamptz NOT NULL,
  raw             text        NOT NULL,
  ceiling_ft      integer,
  visibility_m    integer,
  wind_gust_kt    integer,
  crosswind_kt    integer,
  thunderstorm    boolean     NOT NULL DEFAULT false,
  source_ref      text        NOT NULL,
  received_by     text        NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_from <= valid_to),
  CHECK (ceiling_ft IS NULL OR ceiling_ft >= 0),
  CHECK (visibility_m IS NULL OR visibility_m >= 0),
  CHECK (wind_gust_kt IS NULL OR wind_gust_kt >= 0),
  CHECK (crosswind_kt IS NULL OR crosswind_kt >= 0)
);
CREATE INDEX weather_reports_station_recent ON ops.weather_reports(operator_id, station, kind, issued_at DESC);

CREATE TABLE ops.notams (
  id              bigserial PRIMARY KEY,
  operator_id     text        NOT NULL,
  station         text        NOT NULL,
  notam_no        text        NOT NULL,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  category        text        NOT NULL CHECK (category IN ('AIRPORT','RUNWAY','NAV','AIRSPACE','OTHER')),
  severity        text        NOT NULL CHECK (severity IN ('INFO','RESTRICTED','CLOSED')),
  text            text        NOT NULL,
  source_ref      text        NOT NULL,
  received_by     text        NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  cancelled       boolean     NOT NULL DEFAULT false,
  UNIQUE(operator_id, notam_no),
  CHECK (starts_at < ends_at)
);
CREATE INDEX notams_active_station ON ops.notams(operator_id, station, starts_at, ends_at) WHERE cancelled = false;

CREATE TABLE ops.flow_slots (
  id                bigserial PRIMARY KEY,
  operator_id       text        NOT NULL,
  flight_id         text        NOT NULL REFERENCES ops.flights(id) ON DELETE CASCADE,
  ctot              timestamptz NOT NULL,
  tolerance_before  integer     NOT NULL DEFAULT 5 CHECK (tolerance_before BETWEEN 0 AND 60),
  tolerance_after   integer     NOT NULL DEFAULT 10 CHECK (tolerance_after BETWEEN 0 AND 120),
  source_ref        text        NOT NULL,
  status            text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
  received_by       text        NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX flow_slots_one_active ON ops.flow_slots(operator_id, flight_id) WHERE status = 'ACTIVE';

-- Approved pairing definitions are planning objects. They can span multiple operating days and night-stops.
CREATE TABLE ops.pairings (
  id            text PRIMARY KEY,
  operator_id   text        NOT NULL,
  name          text        NOT NULL,
  base          text        NOT NULL,
  starts_on     date        NOT NULL,
  ends_on       date        NOT NULL,
  status        text        NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','RETIRED')),
  created_by    text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  approved_by   text,
  approved_at   timestamptz,
  CHECK (starts_on <= ends_on),
  CHECK ((status = 'DRAFT' AND approved_at IS NULL) OR (status IN ('APPROVED','RETIRED') AND approved_at IS NOT NULL))
);
CREATE INDEX pairings_period ON ops.pairings(operator_id, starts_on, ends_on, status);

CREATE TABLE ops.pairing_legs (
  operator_id text    NOT NULL,
  pairing_id text    NOT NULL REFERENCES ops.pairings(id) ON DELETE CASCADE,
  seq        integer NOT NULL CHECK (seq > 0),
  duty_no    integer NOT NULL DEFAULT 1 CHECK (duty_no > 0),
  flight_id  text    NOT NULL REFERENCES ops.flights(id),
  PRIMARY KEY(pairing_id, seq),
  UNIQUE(pairing_id, flight_id)
);

CREATE TABLE ops.crew_preferences (
  id           bigserial PRIMARY KEY,
  operator_id  text        NOT NULL,
  crew_id      text        NOT NULL REFERENCES ops.crew_members(id),
  kind         text        NOT NULL CHECK (kind IN ('PREFER_OFF','PREFER_FLY','PREFER_EARLY','PREFER_LATE','AVOID_NIGHT')),
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  weight       integer     NOT NULL DEFAULT 3 CHECK (weight BETWEEN 1 AND 5),
  note         text,
  created_by   text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  cancelled    boolean     NOT NULL DEFAULT false,
  CHECK (starts_at < ends_at)
);
CREATE INDEX crew_preferences_window ON ops.crew_preferences(operator_id, crew_id, starts_at, ends_at) WHERE cancelled = false;

-- Standby was historically keyed only by crew_id. Make reserve ownership explicit and lifecycle auditable.
ALTER TABLE ops.standby ADD COLUMN operator_id text;
UPDATE ops.standby s SET operator_id = c.operator_id FROM ops.crew_members c WHERE c.id = s.crew_id;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM ops.standby WHERE operator_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot assign operator ownership to legacy standby rows';
  END IF;
END $$;
ALTER TABLE ops.standby ALTER COLUMN operator_id SET NOT NULL;
ALTER TABLE ops.standby ADD COLUMN status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','CALLED','RELEASED'));
ALTER TABLE ops.standby ADD COLUMN called_flight_id text REFERENCES ops.flights(id);
ALTER TABLE ops.standby ADD COLUMN called_at timestamptz;
ALTER TABLE ops.standby ADD COLUMN called_by text;
ALTER TABLE ops.standby ADD CONSTRAINT standby_call_state CHECK (status <> 'CALLED' OR called_at IS NOT NULL);
CREATE INDEX standby_operator_window ON ops.standby(operator_id, start_at, end_at, status);

GRANT SELECT, INSERT, UPDATE ON ops.weather_reports, ops.notams, ops.flow_slots, ops.pairings, ops.pairing_legs, ops.crew_preferences, ops.standby TO ops_svc;
GRANT USAGE, SELECT ON SEQUENCE ops.weather_reports_id_seq, ops.notams_id_seq, ops.flow_slots_id_seq, ops.crew_preferences_id_seq TO ops_svc;

-- Database tenant boundary for new/extended tenant tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['weather_reports','notams','flow_slots','pairings','pairing_legs','crew_preferences','standby'] LOOP
    EXECUTE format('ALTER TABLE ops.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS aeroos_tenant_isolation ON ops.%I', t);
    EXECUTE format(
      'CREATE POLICY aeroos_tenant_isolation ON ops.%I USING (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), '''')) WITH CHECK (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), ''''))',
      t
    );
  END LOOP;
END $$;

-- Round 12: dispatch — mass & balance, performance limits, fuel, tankering, ICAO flight plans, overflight
-- permits and the dispatch release.

-- Type data for mass & balance, fuel and the flight plan. The values below are ILLUSTRATIVE generic figures for
-- the demo fleet; an operator replaces them with its approved Weight & Balance Manual / AFM data.
CREATE TABLE ops.aircraft_types (
  type             text PRIMARY KEY,
  icao_type        text    NOT NULL,
  wake             text    NOT NULL CHECK (wake IN ('L', 'M', 'H')),
  seats            integer NOT NULL CHECK (seats > 0),
  mzfw             integer NOT NULL,
  mtow             integer NOT NULL,
  mlw              integer NOT NULL,
  max_fuel         integer NOT NULL,
  lemac            double precision NOT NULL,
  mac              double precision NOT NULL CHECK (mac > 0),
  fwd_limit        double precision NOT NULL,
  aft_limit        double precision NOT NULL,
  crew_arm         double precision NOT NULL,
  pax_arm          double precision NOT NULL,
  hold_fwd_arm     double precision NOT NULL,
  hold_aft_arm     double precision NOT NULL,
  fuel_arm         double precision NOT NULL,
  burn_kg_per_hour integer NOT NULL,
  hold_kg_per_min  integer NOT NULL,
  cruise_kt        integer NOT NULL,
  CHECK (mzfw < mtow AND mlw <= mtow AND fwd_limit < aft_limit)
);
INSERT INTO ops.aircraft_types VALUES
  ('B737-800',   'B738', 'M', 186, 62732, 79016, 66361, 20894, 16.0, 3.96,  8, 33, 3.0, 17.2, 11.0, 23.5, 17.0, 2500, 40, 450),
  ('B737 MAX 8', 'B38M', 'M', 189, 65952, 82191, 69309, 20730, 16.2, 3.96,  8, 33, 3.0, 17.4, 11.2, 23.8, 17.2, 2250, 37, 450),
  ('A320neo',    'A20N', 'M', 180, 64300, 79000, 67400, 18728, 17.9, 4.19, 17, 40, 3.2, 18.6, 12.4, 25.2, 18.8, 2300, 38, 450),
  ('A330-300',   'A333', 'H', 300, 175000, 242000, 187000, 109185, 25.2, 7.27, 14, 41, 4.5, 28.0, 17.5, 39.0, 28.5, 5800, 95, 470),
  ('DHC-8-400',  'DH8D', 'M', 78, 25854, 29574, 28123, 5318, 12.0, 2.47, 16, 37, 2.6, 12.9, 6.5, 19.5, 12.4, 900, 16, 340),
  ('E195-E2',    'E295', 'M', 136, 49000, 61500, 54000, 13690, 15.0, 3.54, 9, 34, 2.8, 16.0, 10.5, 21.8, 15.6, 1900, 30, 440)
ON CONFLICT (type) DO NOTHING;

-- Basic empty mass and arm per aircraft, from the last weighing (CAT.POL.MAB.100(b): every 4 years).
CREATE TABLE ops.aircraft_weights (
  tail           text PRIMARY KEY,
  operator_id    text             NOT NULL,
  basic_empty_kg integer          NOT NULL CHECK (basic_empty_kg > 0),
  basic_arm      double precision NOT NULL,
  weighed_on     date             NOT NULL
);

-- Regulated take-off / landing weights per airport and type (from the performance department).
CREATE TABLE ops.runway_limits (
  airport text    NOT NULL,
  type    text    NOT NULL REFERENCES ops.aircraft_types (type),
  rtow_kg integer,
  rlw_kg  integer,
  note    text,
  PRIMARY KEY (airport, type)
);

-- Contract fuel prices are per operator (each has its own supplier contracts).
CREATE TABLE ops.fuel_prices (
  operator_id text NOT NULL,
  station     text NOT NULL,
  usd_per_kg  numeric(8, 4) NOT NULL CHECK (usd_per_kg > 0),
  as_of       date NOT NULL,
  PRIMARY KEY (operator_id, station)
);

-- The filed route and the countries (FIRs) it crosses, per city pair.
CREATE TABLE ops.routes (
  dep          text    NOT NULL,
  arr          text    NOT NULL,
  route        text    NOT NULL DEFAULT 'DCT',
  cruise_level integer NOT NULL DEFAULT 350,
  countries    text[]  NOT NULL,
  PRIMARY KEY (dep, arr)
);

CREATE TABLE ops.permit_rules (
  country         text PRIMARY KEY,
  permit_required boolean NOT NULL,
  note            text
);

CREATE TABLE ops.overflight_permits (
  id          serial PRIMARY KEY,
  operator_id text NOT NULL,
  country     text NOT NULL,
  number      text NOT NULL,
  valid_from  date NOT NULL,
  valid_to    date NOT NULL,
  types       text[] NOT NULL DEFAULT '{}',
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_from <= valid_to)
);

-- One dispatch record per flight: load, fuel, flight plan, release (and its withdrawal on a large change).
CREATE TABLE ops.dispatch (
  flight_id    text PRIMARY KEY REFERENCES ops.flights (id),
  operator_id  text        NOT NULL,
  load         jsonb,
  fuel         jsonb,
  fpl          text,
  fpl_filed_at timestamptz,
  fpl_filed_by text,
  status       text        NOT NULL CHECK (status IN ('OPEN', 'RELEASED', 'WITHDRAWN')),
  released_at  timestamptz,
  released_by  text,
  release      jsonb,
  lmc          jsonb       NOT NULL DEFAULT '[]',
  updated_at   timestamptz NOT NULL DEFAULT now(),
  version      integer     NOT NULL DEFAULT 1
);

GRANT SELECT ON ops.aircraft_types, ops.aircraft_weights, ops.runway_limits, ops.routes, ops.permit_rules TO ops_svc;
GRANT SELECT, INSERT, UPDATE ON ops.fuel_prices, ops.overflight_permits, ops.dispatch TO ops_svc;
GRANT USAGE ON SEQUENCE ops.overflight_permits_id_seq TO ops_svc;

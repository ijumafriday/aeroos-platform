-- Round 14: engineering health — engine condition trend monitoring, oil consumption and structural damage.

-- Trend and oil limits per engine type. ILLUSTRATIVE values for the demo fleet; an operator enters the values from
-- the engine manufacturer's ECTM guidance and the AMM (oil consumption limit).
CREATE TABLE camo.engine_types (
  engine_type      text PRIMARY KEY,
  egt_margin_amber double precision NOT NULL,
  egt_margin_red   double precision NOT NULL,
  egt_shift        double precision NOT NULL CHECK (egt_shift > 0),
  n2_shift         double precision NOT NULL CHECK (n2_shift > 0),
  ff_shift         double precision NOT NULL CHECK (ff_shift > 0),
  vib_max          double precision NOT NULL CHECK (vib_max > 0),
  oil_alert_qph    double precision NOT NULL CHECK (oil_alert_qph > 0),
  oil_max_qph      double precision NOT NULL,
  CHECK (egt_margin_red < egt_margin_amber AND oil_alert_qph < oil_max_qph)
);
INSERT INTO camo.engine_types VALUES
  ('CFM56-7B',   25, 10, 10, 1.0, 2.0, 3.0, 0.30, 0.50),
  ('LEAP-1B',    30, 12, 10, 1.0, 2.0, 3.0, 0.25, 0.45),
  ('LEAP-1A',    30, 12, 10, 1.0, 2.0, 3.0, 0.25, 0.45),
  ('Trent 772B', 25, 10, 12, 1.0, 2.5, 2.5, 0.35, 0.60),
  ('PW150A',     30, 10,  8, 1.0, 2.0, 2.0, 0.20, 0.35),
  ('PW1900G',    30, 12, 10, 1.0, 2.0, 2.0, 0.25, 0.45)
ON CONFLICT DO NOTHING;

-- Engines by serial and where they are installed (position 1, 2…). A removed engine keeps its trend history.
CREATE TABLE camo.engines (
  serial      text PRIMARY KEY,
  operator_id text    NOT NULL,
  engine_type text    NOT NULL REFERENCES camo.engine_types (engine_type),
  tail        text REFERENCES camo.fleet (reg),
  position    integer CHECK (position BETWEEN 1 AND 4),
  UNIQUE (tail, position)
);

-- Stabilised-cruise snapshots, corrected to standard day, as deltas from the engine's baseline (from the ECTM
-- download / ACARS report, or entered by hand). fh = aircraft flight hours at the snapshot.
CREATE TABLE camo.engine_snapshots (
  id          bigserial PRIMARY KEY,
  serial      text             NOT NULL REFERENCES camo.engines (serial),
  at          timestamptz      NOT NULL,
  fh          double precision NOT NULL,
  egt_dev     double precision NOT NULL,
  n2_dev      double precision NOT NULL,
  ff_dev_pct  double precision NOT NULL,
  vib         double precision NOT NULL,
  egt_margin  double precision NOT NULL,
  source      text             NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'ACARS', 'DOWNLOAD')),
  recorded_by text             NOT NULL
);
CREATE INDEX engine_snapshots_serial ON camo.engine_snapshots (serial, fh);

CREATE TABLE camo.oil_uplifts (
  id          serial PRIMARY KEY,
  serial      text             NOT NULL REFERENCES camo.engines (serial),
  tail        text             NOT NULL,
  at          timestamptz      NOT NULL,
  fh          double precision NOT NULL,
  quarts      numeric(4, 1)    NOT NULL CHECK (quarts > 0 AND quarts <= 20),
  station     text,
  recorded_by text             NOT NULL
);
CREATE INDEX oil_uplifts_serial ON camo.oil_uplifts (serial, fh);

-- Raised trend / oil alerts, one open alert per engine and code; closed by an engineer with the action taken.
CREATE TABLE camo.health_alerts (
  id           serial PRIMARY KEY,
  operator_id  text        NOT NULL,
  serial       text        NOT NULL REFERENCES camo.engines (serial),
  tail         text,
  code         text        NOT NULL,
  level        text        NOT NULL CHECK (level IN ('AMBER', 'RED')),
  message      text        NOT NULL,
  action       text        NOT NULL,
  status       text        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  raised_at    timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  closed_by    text,
  closed_at    timestamptz,
  closure_note text
);
CREATE UNIQUE INDEX health_alerts_open ON camo.health_alerts (serial, code) WHERE status = 'OPEN';

-- SRM allowable / repairable limits per aircraft type, zone (ATA iSpec 2200 major zones) and damage type.
-- ILLUSTRATIVE values; an operator loads its SRM chapter 51–57 limits.
CREATE TABLE camo.srm_limits (
  aircraft_type       text    NOT NULL,
  zone                text    NOT NULL,
  zone_name           text    NOT NULL,
  damage_type         text    NOT NULL CHECK (damage_type IN ('DENT', 'SCRATCH', 'GOUGE', 'CORROSION', 'CRACK', 'LIGHTNING', 'DELAMINATION')),
  srm_ref             text    NOT NULL,
  allowable_depth_mm  double precision,
  allowable_length_mm double precision,
  repairable_depth_mm double precision,
  repairable_length_mm double precision,
  min_spacing_mm      double precision NOT NULL DEFAULT 0,
  inspect_fc          integer CHECK (inspect_fc > 0),
  PRIMARY KEY (aircraft_type, zone, damage_type)
);

CREATE SEQUENCE camo.damage_seq;
CREATE TABLE camo.structural_damage (
  id                 text PRIMARY KEY,
  operator_id        text             NOT NULL,
  tail               text             NOT NULL REFERENCES camo.fleet (reg),
  zone               text             NOT NULL,
  side               text             NOT NULL CHECK (side IN ('L', 'R', 'C')),
  damage_type        text             NOT NULL,
  x_mm               double precision NOT NULL,
  y_mm               double precision NOT NULL,
  length_mm          double precision NOT NULL CHECK (length_mm > 0),
  width_mm           double precision NOT NULL CHECK (width_mm >= 0),
  depth_mm           double precision NOT NULL CHECK (depth_mm >= 0),
  description        text             NOT NULL,
  found_at           timestamptz      NOT NULL DEFAULT now(),
  found_fc           integer          NOT NULL,
  found_by           text             NOT NULL,
  -- the last assessment (recomputed on every change on the aircraft, interactions included)
  disposition        text             NOT NULL CHECK (disposition IN ('ALLOWABLE', 'REPAIR', 'REFER')),
  srm_ref            text,
  reason             text             NOT NULL,
  next_inspection_fc integer,
  -- engineering disposition for damage beyond the SRM: approved repair data (TC holder / DOA)
  approved_data      text,
  approved_by        text,
  approved_at        timestamptz,
  repair_kind        text CHECK (repair_kind IN ('PERMANENT', 'TEMPORARY')),
  repair_data        text,
  repair_until_fc    integer,
  repair_until_date  date,
  repaired_by        text,
  repaired_at        timestamptz,
  version            integer          NOT NULL DEFAULT 1,
  CHECK (approved_by IS NULL OR repaired_by IS NULL OR approved_by <> repaired_by)
);
CREATE INDEX structural_damage_tail ON camo.structural_damage (tail);

GRANT SELECT ON camo.engine_types, camo.engines, camo.srm_limits TO camo_svc;
GRANT SELECT, INSERT ON camo.engine_snapshots, camo.oil_uplifts TO camo_svc;
GRANT SELECT, INSERT, UPDATE ON camo.health_alerts, camo.structural_damage TO camo_svc;
GRANT USAGE ON SEQUENCE camo.engine_snapshots_id_seq, camo.oil_uplifts_id_seq, camo.health_alerts_id_seq, camo.damage_seq TO camo_svc;

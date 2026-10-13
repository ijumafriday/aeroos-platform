-- Compliance: per-operator overlays on the authority rulepacks (approved MEL, time zone, approved types).
CREATE TABLE compliance.operator_profiles (
  operator_id    text PRIMARY KEY,
  name           text   NOT NULL,
  authority      text   NOT NULL CHECK (authority IN ('EASA', 'FAA', 'KCAA')),
  mel_time_zone  text   NOT NULL DEFAULT 'UTC',
  approved_types text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE compliance.mel_entries (
  operator_id         text    NOT NULL REFERENCES compliance.operator_profiles (operator_id),
  ref                 text    NOT NULL,
  ata                 text    NOT NULL,
  title               text    NOT NULL,
  category            text    NOT NULL CHECK (category IN ('A', 'B', 'C', 'D')),
  interval_hours      integer CHECK (interval_hours IS NULL OR interval_hours > 0),
  extension_permitted boolean NOT NULL DEFAULT false,
  ops_procedure       text,
  maint_procedure     text,
  PRIMARY KEY (operator_id, ref),
  CONSTRAINT cat_a_needs_interval CHECK (category <> 'A' OR interval_hours IS NOT NULL)
);

GRANT USAGE ON SCHEMA compliance TO compliance_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA compliance TO compliance_svc;

-- Organisation: people and their certification privileges.
CREATE TABLE org.personnel (
  id          text PRIMARY KEY,
  operator_id text    NOT NULL,
  username    text    NOT NULL UNIQUE,  -- matches the identity provider's preferred_username
  name        text    NOT NULL,
  licence_no  text,
  active      boolean NOT NULL DEFAULT true
);

CREATE TABLE org.privileges (
  id           serial PRIMARY KEY,
  personnel_id text        NOT NULL REFERENCES org.personnel (id),
  authority    text        NOT NULL,
  category     text        NOT NULL,
  type_ratings text[]      NOT NULL DEFAULT '{}',
  valid_until  timestamptz NOT NULL
);

CREATE TABLE org.authorisations (
  personnel_id   text PRIMARY KEY REFERENCES org.personnel (id),
  reference      text        NOT NULL,
  aircraft_types text[]      NOT NULL DEFAULT '{}',
  valid_until    timestamptz NOT NULL,
  suspended      boolean     NOT NULL DEFAULT false
);

GRANT USAGE ON SCHEMA org TO org_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA org TO org_svc;

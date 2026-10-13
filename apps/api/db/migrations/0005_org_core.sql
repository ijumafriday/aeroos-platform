-- Organization Core: authorisation lifecycle, training records, experience log.
-- Scans and certificates are documents owned by these records (platform.documents, migration 0006).
-- Upgrades Delivery 1 data in place: the single-row-per-person authorisation table becomes a
-- history of authorisations with a status; existing rows are carried over.

ALTER TABLE org.personnel ADD COLUMN role_title text;
ALTER TABLE org.personnel ADD COLUMN base text;

ALTER TABLE org.authorisations RENAME TO authorisations_d1;

CREATE SEQUENCE org.authorisation_seq START 1000;

CREATE TABLE org.authorisations (
  id             text PRIMARY KEY,
  operator_id    text        NOT NULL,
  personnel_id   text        NOT NULL REFERENCES org.personnel (id),
  reference      text        NOT NULL,
  aircraft_types text[]      NOT NULL,
  issued_at      timestamptz NOT NULL,
  valid_until    timestamptz NOT NULL,
  status         text        NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')),
  issue_rule     text        NOT NULL,
  history        jsonb       NOT NULL,
  version        integer     NOT NULL DEFAULT 1,
  CONSTRAINT authorisation_reference_unique UNIQUE (operator_id, reference)
);
-- At most one live (active or suspended) authorisation per person.
CREATE UNIQUE INDEX authorisations_one_live ON org.authorisations (personnel_id) WHERE status IN ('ACTIVE', 'SUSPENDED');
CREATE INDEX authorisations_valid_until ON org.authorisations (valid_until) WHERE status IN ('ACTIVE', 'SUSPENDED');

INSERT INTO org.authorisations (id, operator_id, personnel_id, reference, aircraft_types, issued_at, valid_until, status, issue_rule, history)
SELECT 'AUT-' || nextval('org.authorisation_seq'), p.operator_id, a.personnel_id, a.reference, a.aircraft_types, now(), a.valid_until,
       CASE WHEN a.valid_until <= now() THEN 'EXPIRED' WHEN a.suspended THEN 'SUSPENDED' ELSE 'ACTIVE' END,
       'MIGRATED',
       jsonb_build_array(jsonb_build_object('at', now(), 'action', 'ISSUED', 'by', 'migration:0005', 'reason', 'Carried over from Delivery 1'))
FROM org.authorisations_d1 a JOIN org.personnel p ON p.id = a.personnel_id;

DROP TABLE org.authorisations_d1;

CREATE TABLE org.training_records (
  id           text PRIMARY KEY,
  personnel_id text        NOT NULL REFERENCES org.personnel (id),
  course       text        NOT NULL CHECK (course IN ('CONTINUATION', 'HUMAN_FACTORS', 'TYPE', 'FUEL_TANK_SAFETY', 'EWIS')),
  title        text        NOT NULL,
  completed_at timestamptz NOT NULL,
  recorded_by  text        NOT NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX training_records_person ON org.training_records (personnel_id, completed_at DESC);
CREATE SEQUENCE org.training_seq START 5000;

-- Maintenance experience, fed by AMO events (each signed step is evidence of practice).
-- The natural key makes event redelivery harmless.
CREATE TABLE org.experience_log (
  personnel_id text        NOT NULL REFERENCES org.personnel (id),
  work_at      timestamptz NOT NULL,
  source_type  text        NOT NULL,
  source_id    text        NOT NULL,
  detail       text,
  PRIMARY KEY (personnel_id, source_type, source_id)
);
CREATE INDEX experience_log_recent ON org.experience_log (personnel_id, work_at DESC);

-- Which expiry warnings have been sent. valid_until is part of the key, so renewing re-arms the ladder.
CREATE TABLE org.expiry_notices (
  subject_type text        NOT NULL CHECK (subject_type IN ('AUTHORISATION', 'LICENCE', 'TRAINING')),
  subject_id   text        NOT NULL,
  level        text        NOT NULL,
  valid_until  timestamptz NOT NULL,
  notified_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_type, subject_id, level, valid_until)
);

GRANT SELECT ON ALL TABLES IN SCHEMA org TO org_svc;
GRANT INSERT ON org.expiry_notices TO org_svc;
GRANT INSERT, UPDATE ON org.authorisations, org.training_records TO org_svc;
GRANT INSERT ON org.experience_log TO org_svc;
GRANT USAGE ON SEQUENCE org.authorisation_seq, org.training_seq TO org_svc;

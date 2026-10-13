-- Round 10: safety management (occurrences), quality audits and findings, corrective actions, non-conforming
-- parts and scrapping, and documents whose current revision certifying staff must have read.

-- ---------------------------------------------------------------- safety occurrences (ORO.GEN.200, 376/2014)
CREATE SEQUENCE org.occurrence_seq START 1;
CREATE TABLE org.occurrences (
  id                    text PRIMARY KEY,                       -- OR-2026-0001
  operator_id           text        NOT NULL,
  reported_at           timestamptz NOT NULL DEFAULT now(),
  reported_by           text        NOT NULL,                   -- username; shown only to the safety office and the reporter
  confidential          boolean     NOT NULL DEFAULT false,
  occurred_at           timestamptz NOT NULL,
  station               text,
  tail                  text,
  flight_no             text,
  category              text        NOT NULL CHECK (category IN ('TECHNICAL', 'MAINTENANCE', 'OPERATIONAL', 'GROUND', 'CABIN', 'SECURITY', 'OTHER')),
  title                 text        NOT NULL,
  description           text        NOT NULL,
  status                text        NOT NULL CHECK (status IN ('REPORTED', 'TRIAGED', 'UNDER_INVESTIGATION', 'CLOSED')),
  mandatory             boolean     NOT NULL DEFAULT false,
  authority_reported_at timestamptz,
  authority_ref         text,
  probability           integer     CHECK (probability BETWEEN 1 AND 5),
  severity              text        CHECK (severity IN ('A', 'B', 'C', 'D', 'E')),
  investigator          text,
  findings              text,
  residual_probability  integer     CHECK (residual_probability BETWEEN 1 AND 5),
  residual_severity     text        CHECK (residual_severity IN ('A', 'B', 'C', 'D', 'E')),
  triaged_by            text,
  triaged_at            timestamptz,
  closed_by             text,
  closed_at             timestamptz,
  version               integer     NOT NULL DEFAULT 1
);
CREATE INDEX occurrences_open ON org.occurrences (operator_id, status);

-- ---------------------------------------------------------------- quality audits and findings
CREATE SEQUENCE org.audit_seq START 1;
CREATE TABLE org.quality_audits (
  id           text PRIMARY KEY,                                -- QA-2026-01
  operator_id  text        NOT NULL,
  title        text        NOT NULL,
  area         text        NOT NULL,                            -- e.g. Part-145 tools & equipment
  reference    text        NOT NULL,                            -- the requirement(s) audited, e.g. 145.A.40
  planned_for  date        NOT NULL,
  lead_auditor text        NOT NULL,
  status       text        NOT NULL CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'CLOSED')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz
);

CREATE SEQUENCE org.finding_seq START 1;
CREATE TABLE org.findings (
  id          text PRIMARY KEY,                                 -- F-0001
  audit_id    text        NOT NULL REFERENCES org.quality_audits (id),
  operator_id text        NOT NULL,
  level       text        NOT NULL CHECK (level IN ('LEVEL_1', 'LEVEL_2', 'OBSERVATION')),
  requirement text        NOT NULL,
  description text        NOT NULL,
  root_cause  text,
  raised_by   text        NOT NULL,
  raised_at   timestamptz NOT NULL DEFAULT now(),
  due         timestamptz NOT NULL,
  status      text        NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
  closed_by   text,
  closed_at   timestamptz,
  version     integer     NOT NULL DEFAULT 1
);
CREATE INDEX findings_audit ON org.findings (audit_id);

-- ---------------------------------------------------------------- corrective actions (occurrences and findings)
CREATE SEQUENCE org.action_seq START 1;
CREATE TABLE org.corrective_actions (
  id          text PRIMARY KEY,                                 -- CA-0001
  operator_id text        NOT NULL,
  source_type text        NOT NULL CHECK (source_type IN ('OCCURRENCE', 'FINDING')),
  source_id   text        NOT NULL,
  description text        NOT NULL,
  owner       text        NOT NULL,                             -- username
  due         date        NOT NULL,
  status      text        NOT NULL CHECK (status IN ('OPEN', 'DONE', 'VERIFIED', 'CANCELLED')),
  evidence    text,
  done_by     text,
  done_at     timestamptz,
  verified_by text,
  verified_at timestamptz,
  created_by  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  version     integer     NOT NULL DEFAULT 1,
  CONSTRAINT verified_by_other CHECK (verified_by IS NULL OR verified_by <> done_by)
);
CREATE INDEX actions_source ON org.corrective_actions (source_type, source_id);
CREATE INDEX actions_owner ON org.corrective_actions (operator_id, owner, status);

-- ---------------------------------------------------------------- documents certifying staff must have read
ALTER TABLE org.controlled_documents ADD COLUMN required_for_certification boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------- non-conforming parts and scrapping (145.A.42)
CREATE SEQUENCE amo.ncr_seq START 1;
CREATE TABLE amo.nonconformities (
  id                text PRIMARY KEY,                           -- NCR-0001
  operator_id       text        NOT NULL,
  part_no           text        NOT NULL,
  serial            text,
  qty               integer     NOT NULL CHECK (qty > 0),
  location          text,                                       -- stores location it was taken from (quarantined stock)
  source            text        NOT NULL CHECK (source IN ('RECEIVING', 'STOCK', 'REMOVAL', 'SHOP', 'AUDIT')),
  description       text        NOT NULL,
  raised_by         text        NOT NULL,
  raised_at         timestamptz NOT NULL DEFAULT now(),
  status            text        NOT NULL CHECK (status IN ('QUARANTINED', 'SCRAP_PENDING', 'CLOSED')),
  disposition       text        CHECK (disposition IN ('SCRAP', 'RETURN_TO_VENDOR', 'RETURN_TO_STOCK')),
  disposition_reason text,
  release_ref       text,
  dispositioned_by  text,
  dispositioned_at  timestamptz,
  mutilation_method text,
  mutilated_by      text,
  mutilated_at      timestamptz,
  version           integer     NOT NULL DEFAULT 1,
  CONSTRAINT mutilation_witnessed CHECK (mutilated_by IS NULL OR mutilated_by <> dispositioned_by)
);
CREATE INDEX ncr_open ON amo.nonconformities (operator_id, status);

-- A scrapped serial is recorded in its back-to-birth history.
ALTER TABLE camo.component_events DROP CONSTRAINT IF EXISTS component_events_type_check;
ALTER TABLE camo.component_events ADD CONSTRAINT component_events_type_check CHECK (type IN ('INSTALLED', 'REMOVED', 'SCRAPPED'));

-- ---------------------------------------------------------------- grants
GRANT SELECT, INSERT, UPDATE ON org.occurrences, org.quality_audits, org.findings, org.corrective_actions TO org_svc;
GRANT USAGE ON SEQUENCE org.occurrence_seq, org.audit_seq, org.finding_seq, org.action_seq TO org_svc;
GRANT SELECT, INSERT, UPDATE ON amo.nonconformities TO amo_svc;
GRANT USAGE ON SEQUENCE amo.ncr_seq TO amo_svc;

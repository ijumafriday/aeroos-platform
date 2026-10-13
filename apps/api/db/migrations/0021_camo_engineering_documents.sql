-- Round 9: CAMO engineering (AD/SB intake, component history) and document & manual control.

-- ---------------------------------------------------------------- AD / SB
ALTER TABLE camo.requirements DROP CONSTRAINT IF EXISTS requirements_kind_check;
ALTER TABLE camo.requirements ADD CONSTRAINT requirements_kind_check CHECK (kind IN ('TASK', 'AD', 'SB', 'LLP'));
-- NULL = every aircraft of the listed types; otherwise only these registrations (per-aircraft AD/SB applicability).
ALTER TABLE camo.requirements ADD COLUMN tails text[];

CREATE SEQUENCE camo.directive_seq START 1001;
CREATE TABLE camo.directives (
  id               text PRIMARY KEY,
  operator_id      text        NOT NULL,
  kind             text        NOT NULL CHECK (kind IN ('AD', 'SB')),
  ref              text        NOT NULL,
  revision         text        NOT NULL DEFAULT '',
  authority        text        NOT NULL,
  title            text        NOT NULL,
  ata              text        NOT NULL,
  types            text[]      NOT NULL,
  msn_ranges       jsonb,
  effective        date        NOT NULL,
  action           text        NOT NULL,
  interval         jsonb       NOT NULL,
  repetitive       boolean     NOT NULL,
  estimated_hours  double precision NOT NULL DEFAULT 1,
  steps            jsonb       NOT NULL DEFAULT '[]',
  supersedes       text        REFERENCES camo.directives (id),
  status           text        NOT NULL CHECK (status IN ('RECEIVED', 'EVALUATED', 'DEFERRED', 'NOT_APPLICABLE_PENDING', 'INCORPORATED', 'NOT_APPLICABLE', 'REJECTED', 'SUPERSEDED')),
  decision         text        CHECK (decision IN ('COMPLY', 'EMBODY', 'DEFER', 'REJECT', 'NOT_APPLICABLE')),
  decision_reason  text,
  received_by      text        NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  evaluated_by     text,
  evaluated_at     timestamptz,
  incorporated_by  text,
  incorporated_at  timestamptz,
  confirmed_by     text,
  confirmed_at     timestamptz,
  requirement_id   text        REFERENCES camo.requirements (id),
  version          integer     NOT NULL DEFAULT 1,
  CONSTRAINT directive_ref_unique UNIQUE (operator_id, ref, revision)
);
CREATE INDEX directives_open ON camo.directives (operator_id, status);

CREATE TABLE camo.directive_tails (
  directive_id text    NOT NULL REFERENCES camo.directives (id),
  tail         text    NOT NULL REFERENCES camo.fleet (reg),
  applicable   boolean NOT NULL,
  reason       text    NOT NULL,
  overridden   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (directive_id, tail)
);

-- Where an incorporated AD/SB starts counting for each aircraft (counters on its effective date).
CREATE TABLE camo.requirement_start (
  requirement_id text        NOT NULL REFERENCES camo.requirements (id),
  tail           text        NOT NULL REFERENCES camo.fleet (reg),
  at             timestamptz NOT NULL,
  fh             double precision NOT NULL,
  fc             integer     NOT NULL,
  PRIMARY KEY (requirement_id, tail)
);

-- ---------------------------------------------------------------- component history
CREATE TABLE camo.component_events (
  id          bigserial PRIMARY KEY,
  operator_id text        NOT NULL,
  part_no     text        NOT NULL,
  serial      text        NOT NULL,
  type        text        NOT NULL CHECK (type IN ('INSTALLED', 'REMOVED')),
  tail        text        NOT NULL,
  position    text        NOT NULL,
  at          timestamptz NOT NULL,
  tsn         double precision NOT NULL CHECK (tsn >= 0),
  csn         integer     NOT NULL CHECK (csn >= 0),
  reason      text        CHECK (reason IN ('UNSERVICEABLE', 'SCHEDULED', 'ROBBERY', 'LIFE_LIMIT', 'OTHER')),
  reference   text        NOT NULL,
  recorded_by text        NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX component_events_serial ON camo.component_events (part_no, serial, at);
-- A serial number can be installed in one place only.
CREATE UNIQUE INDEX components_serial_installed ON camo.components (part_no, serial) WHERE removed_at IS NULL;

-- Back-to-birth starts with what is installed today.
INSERT INTO camo.component_events (operator_id, part_no, serial, type, tail, position, at, tsn, csn, reference, recorded_by)
SELECT f.operator_id, c.part_no, c.serial, 'INSTALLED', c.tail, c.position, c.installed_at, c.part_tsn_at_install, c.part_csn_at_install, 'Records transfer', 'system:migration'
FROM camo.components c JOIN camo.fleet f ON f.reg = c.tail;

-- ---------------------------------------------------------------- document & manual control
CREATE TABLE org.controlled_documents (
  id          text PRIMARY KEY,                -- e.g. NKX-MOE
  operator_id text        NOT NULL,
  code        text        NOT NULL,            -- MOE, CAME, AMP, MEL, PROC-07 …
  title       text        NOT NULL,
  category    text        NOT NULL CHECK (category IN ('EXPOSITION', 'MANUAL', 'PROCEDURE', 'FORM')),
  owner       text        NOT NULL,
  audience    text[]      NOT NULL,            -- Keycloak roles that must read each revision
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT controlled_document_code UNIQUE (operator_id, code)
);

CREATE TABLE org.document_revisions (
  document_id    text        NOT NULL REFERENCES org.controlled_documents (id),
  revision       integer     NOT NULL CHECK (revision > 0),
  operator_id    text        NOT NULL,
  status         text        NOT NULL CHECK (status IN ('DRAFT', 'APPROVED', 'EFFECTIVE', 'SUPERSEDED')),
  summary        text        NOT NULL,
  effective_from date,
  authored_by    text        NOT NULL,
  authored_at    timestamptz NOT NULL DEFAULT now(),
  approved_by    text,
  approved_at    timestamptz,
  -- The file approved, pinned at approval: later uploads to the revision do not change what was approved.
  file_document_id text,
  file_sha256    text,
  PRIMARY KEY (document_id, revision),
  CONSTRAINT approved_by_other CHECK (approved_by IS NULL OR approved_by <> authored_by)
);

CREATE TABLE org.document_reads (
  document_id text        NOT NULL,
  revision    integer     NOT NULL,
  username    text        NOT NULL,
  name        text        NOT NULL,
  read_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, revision, username),
  FOREIGN KEY (document_id, revision) REFERENCES org.document_revisions (document_id, revision)
);

-- ---------------------------------------------------------------- grants
GRANT SELECT, INSERT, UPDATE ON camo.directives TO camo_svc;
GRANT SELECT, INSERT, UPDATE ON camo.directive_tails TO camo_svc;
GRANT SELECT, INSERT ON camo.requirement_start, camo.component_events TO camo_svc;
GRANT INSERT, UPDATE ON camo.requirements TO camo_svc;
GRANT INSERT, UPDATE ON camo.components TO camo_svc;
GRANT USAGE ON SEQUENCE camo.directive_seq, camo.component_events_id_seq TO camo_svc;

GRANT SELECT, INSERT, UPDATE ON org.controlled_documents TO org_svc;
GRANT SELECT, INSERT, UPDATE ON org.document_revisions TO org_svc;
GRANT SELECT, INSERT ON org.document_reads TO org_svc;

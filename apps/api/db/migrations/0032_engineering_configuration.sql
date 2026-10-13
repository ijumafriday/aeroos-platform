-- Engineering configuration management: approved/effective allowable baselines plus actual aircraft configuration.
CREATE SCHEMA IF NOT EXISTS engineering AUTHORIZATION aeroos_owner;

CREATE SEQUENCE IF NOT EXISTS engineering.baseline_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS engineering.position_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS engineering.item_seq START 1001;

CREATE TABLE engineering.configuration_baselines (
  id            text PRIMARY KEY,
  operator_id   text        NOT NULL,
  aircraft_type text        NOT NULL,
  name          text        NOT NULL,
  revision      integer     NOT NULL CHECK (revision > 0),
  status        text        NOT NULL CHECK (status IN ('DRAFT','APPROVED','EFFECTIVE','SUPERSEDED')),
  effective_from date,
  created_by    text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  approved_by   text,
  approved_at   timestamptz,
  version       integer     NOT NULL DEFAULT 1,
  UNIQUE (operator_id, aircraft_type, revision),
  CHECK (approved_by IS NULL OR approved_by <> created_by)
);
CREATE UNIQUE INDEX engineering_one_effective_baseline
  ON engineering.configuration_baselines(operator_id, aircraft_type) WHERE status='EFFECTIVE';

CREATE TABLE engineering.configuration_positions (
  id          text PRIMARY KEY,
  operator_id text        NOT NULL,
  baseline_id text        NOT NULL REFERENCES engineering.configuration_baselines(id) ON DELETE CASCADE,
  code        text        NOT NULL,
  parent_id   text        REFERENCES engineering.configuration_positions(id),
  ata         text        NOT NULL CHECK (ata ~ '^[0-9]{2}$'),
  title       text        NOT NULL,
  required    boolean     NOT NULL DEFAULT true,
  max_qty     integer     NOT NULL DEFAULT 1 CHECK (max_qty > 0),
  effectivity jsonb       NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (baseline_id, code)
);

CREATE TABLE engineering.allowable_parts (
  id            bigserial PRIMARY KEY,
  operator_id   text NOT NULL,
  position_id   text NOT NULL REFERENCES engineering.configuration_positions(id) ON DELETE CASCADE,
  part_no       text NOT NULL,
  description   text NOT NULL DEFAULT '',
  required_mods text[] NOT NULL DEFAULT '{}',
  UNIQUE (position_id, part_no)
);

CREATE TABLE engineering.installed_items (
  id                text PRIMARY KEY,
  operator_id       text        NOT NULL,
  tail              text        NOT NULL,
  aircraft_type     text        NOT NULL,
  position_id       text        NOT NULL REFERENCES engineering.configuration_positions(id),
  position_code     text        NOT NULL,
  part_no           text        NOT NULL,
  serial            text        NOT NULL,
  mods              text[]      NOT NULL DEFAULT '{}',
  installed_at      timestamptz NOT NULL,
  installation_ref  text        NOT NULL,
  installed_by      text        NOT NULL,
  removed_at        timestamptz,
  removal_ref       text,
  removed_by        text
);
CREATE UNIQUE INDEX engineering_active_serial ON engineering.installed_items(operator_id, part_no, serial) WHERE removed_at IS NULL;
CREATE INDEX engineering_actual_by_tail ON engineering.installed_items(operator_id, tail, position_id) WHERE removed_at IS NULL;

GRANT USAGE ON SCHEMA engineering TO engineering_svc;
GRANT SELECT, INSERT, UPDATE ON engineering.configuration_baselines, engineering.configuration_positions, engineering.allowable_parts, engineering.installed_items TO engineering_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA engineering TO engineering_svc;

ALTER TABLE engineering.configuration_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineering.configuration_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineering.allowable_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineering.installed_items ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['configuration_baselines','configuration_positions','allowable_parts','installed_items'] LOOP
    EXECUTE format('CREATE POLICY aeroos_tenant_isolation ON engineering.%I USING (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), '''')) WITH CHECK (current_setting(''aeroos.system'', true) = ''true'' OR operator_id = NULLIF(current_setting(''aeroos.operator_id'', true), ''''))', t);
  END LOOP;
END $$;

-- AMO depth: task-card requirements (tools, parts), hangar plan projection, tools register, stores.

ALTER TABLE amo.task_cards ADD COLUMN requirements jsonb NOT NULL DEFAULT '{"tools": [], "parts": []}';

-- Work-package slots, maintained from CAMO events (AMO never reads camo.*).
CREATE TABLE amo.wp_slots (
  wp_id         text PRIMARY KEY,
  tail          text NOT NULL,
  station       text NOT NULL,
  bay           text,
  planned_start timestamptz,
  planned_end   timestamptz,
  status        text NOT NULL,
  title         text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE amo.tools (
  id              text PRIMARY KEY,
  operator_id     text NOT NULL,
  description     text NOT NULL,
  serial          text NOT NULL,
  location        text NOT NULL,
  calibration_due date
);

CREATE TABLE amo.parts (
  part_no     text PRIMARY KEY,
  description text    NOT NULL,
  unit        text    NOT NULL DEFAULT 'EA',
  min_stock   integer NOT NULL DEFAULT 0
);

CREATE TABLE amo.stock (
  part_no  text    NOT NULL REFERENCES amo.parts (part_no),
  location text    NOT NULL,
  qty      integer NOT NULL CHECK (qty >= 0),
  PRIMARY KEY (part_no, location)
);

CREATE TABLE amo.reservations (
  id           serial PRIMARY KEY,
  task_card_id text    NOT NULL REFERENCES amo.task_cards (id),
  part_no      text    NOT NULL,
  location     text,
  qty          integer NOT NULL CHECK (qty > 0),
  status       text    NOT NULL CHECK (status IN ('RESERVED', 'ISSUED', 'SHORT')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reservations_card ON amo.reservations (task_card_id);

GRANT SELECT, INSERT, UPDATE ON amo.wp_slots TO amo_svc;
GRANT SELECT ON amo.tools, amo.parts TO amo_svc;
GRANT SELECT, INSERT, UPDATE ON amo.stock, amo.reservations TO amo_svc;
GRANT USAGE ON SEQUENCE amo.reservations_id_seq TO amo_svc;

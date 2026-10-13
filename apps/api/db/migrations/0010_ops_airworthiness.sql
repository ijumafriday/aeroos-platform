-- Ops projections of CAMO state: airworthiness (overdue ADs/tasks/LLPs) and planned maintenance slots.
CREATE TABLE ops.tail_airworthiness (
  reg        text PRIMARY KEY,
  airworthy  boolean     NOT NULL,
  reasons    jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops.maintenance_slots (
  wp_id         text PRIMARY KEY,
  tail          text        NOT NULL,
  station       text        NOT NULL,
  bay           text,
  planned_start timestamptz NOT NULL,
  planned_end   timestamptz NOT NULL,
  status        text        NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX maintenance_slots_tail ON ops.maintenance_slots (tail, planned_start);

GRANT SELECT, INSERT, UPDATE, DELETE ON ops.tail_airworthiness, ops.maintenance_slots TO ops_svc;

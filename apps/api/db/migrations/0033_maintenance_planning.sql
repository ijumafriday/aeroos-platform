-- Maintenance planning depth: hangar resources, labour capacity, dependency graph, scope freeze.
CREATE TABLE camo.hangar_bays (
  id          text PRIMARY KEY,
  operator_id text NOT NULL,
  station     text NOT NULL,
  code        text NOT NULL,
  name        text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (operator_id, station, code)
);

ALTER TABLE camo.work_packages
  ADD COLUMN check_type text NOT NULL DEFAULT 'LINE' CHECK (check_type IN ('LINE','A_CHECK','C_CHECK','ENGINE','MOD','OTHER')),
  ADD COLUMN priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL','HIGH','AOG')),
  ADD COLUMN resource_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN dependencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN frozen_at timestamptz,
  ADD COLUMN frozen_by text;

-- Backfill labour demand for packages created before this migration. Availability stays zero until a planner commits capacity.
WITH demand AS (
  SELECT w.id,
         jsonb_agg(jsonb_build_object('trade', x.trade, 'requiredHours', x.hours, 'availableHours', 0) ORDER BY x.trade) AS plan
  FROM camo.work_packages w
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN left(r.ata,2) IN ('22','23','24','31','33','34','42','44','45','46') THEN 'AVIONICS'
      WHEN left(r.ata,2) IN ('49','61','71','72','73','74','75','76','77','78','79','80') THEN 'POWERPLANT'
      WHEN left(r.ata,2) IN ('51','52','53','54','55','56','57') THEN 'STRUCTURES'
      ELSE 'MECHANICAL' END AS trade,
      round(sum(r.estimated_hours)::numeric, 1)::double precision AS hours
    FROM jsonb_array_elements(w.items) i
    JOIN camo.requirements r ON r.id = i->>'requirementId'
    GROUP BY 1
  ) x
  GROUP BY w.id
)
UPDATE camo.work_packages w SET resource_plan = d.plan FROM demand d WHERE d.id = w.id;

GRANT SELECT, INSERT, UPDATE ON camo.hangar_bays TO camo_svc;
ALTER TABLE camo.hangar_bays ENABLE ROW LEVEL SECURITY;
CREATE POLICY aeroos_tenant_isolation ON camo.hangar_bays
  USING (current_setting('aeroos.system', true) = 'true' OR operator_id = NULLIF(current_setting('aeroos.operator_id', true), ''))
  WITH CHECK (current_setting('aeroos.system', true) = 'true' OR operator_id = NULLIF(current_setting('aeroos.operator_id', true), ''));

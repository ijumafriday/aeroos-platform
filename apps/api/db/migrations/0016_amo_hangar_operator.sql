-- The hangar plan (projection of CAMO work packages) is scoped per operator, like everything else.
-- Rows from before 0.5.0 take the operator of the aircraft's task cards, or the only operator; others stay hidden.
ALTER TABLE amo.wp_slots ADD COLUMN operator_id text;
UPDATE amo.wp_slots s SET operator_id = COALESCE(
  (SELECT t.operator_id FROM amo.task_cards t WHERE t.tail = s.tail LIMIT 1),
  -- single-operator installations (every earlier delivery): that operator
  (SELECT CASE WHEN count(DISTINCT operator_id) = 1 THEN min(operator_id) END FROM amo.tools)
) WHERE operator_id IS NULL;
CREATE INDEX wp_slots_operator ON amo.wp_slots (operator_id, planned_start);

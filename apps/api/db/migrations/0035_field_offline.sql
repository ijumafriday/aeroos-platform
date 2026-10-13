-- AeroOS 0.23.0 — field/offline maintenance support.
-- Server remains authoritative; offline clients replay idempotent field observations after reconnect.

CREATE TABLE amo.task_card_field_notes (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  task_card_id text NOT NULL REFERENCES amo.task_cards(id) ON DELETE CASCADE,
  author_subject text NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  client_mutation_id uuid NOT NULL,
  client_created_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, client_mutation_id)
);
CREATE INDEX task_card_field_notes_card_idx ON amo.task_card_field_notes(operator_id, task_card_id, created_at);
ALTER TABLE amo.task_card_field_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE amo.task_card_field_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY task_card_field_notes_tenant ON amo.task_card_field_notes
  USING (operator_id = current_setting('aeroos.operator_id', true) OR current_setting('aeroos.system', true) = 'true')
  WITH CHECK (operator_id = current_setting('aeroos.operator_id', true) OR current_setting('aeroos.system', true) = 'true');
GRANT SELECT, INSERT ON amo.task_card_field_notes TO amo_svc;

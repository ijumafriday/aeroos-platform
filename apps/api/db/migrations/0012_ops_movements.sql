-- Movement messages (IATA MVT, ACARS OOOI, OCC entries): actual times on flights and a log of every message.
ALTER TABLE ops.flights ADD COLUMN off_block timestamptz;
ALTER TABLE ops.flights ADD COLUMN airborne timestamptz;
ALTER TABLE ops.flights ADD COLUMN touchdown timestamptz;
ALTER TABLE ops.flights ADD COLUMN on_block timestamptz;
ALTER TABLE ops.flights ADD COLUMN delay_codes jsonb NOT NULL DEFAULT '[]';

CREATE TABLE ops.movements (
  id          bigserial PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now(),
  operator_id text        NOT NULL,             -- from the integration key or the controller's operator
  source      text        NOT NULL CHECK (source IN ('MVT', 'ACARS', 'OCC')),
  raw         text        NOT NULL,
  flight_id   text,
  status      text        NOT NULL CHECK (status IN ('APPLIED', 'IGNORED', 'REJECTED')),
  detail      text,
  received_by text        NOT NULL
);
CREATE INDEX movements_flight ON ops.movements (flight_id, received_at DESC);
CREATE INDEX movements_recent ON ops.movements (operator_id, received_at DESC);

GRANT SELECT, INSERT ON ops.movements TO ops_svc;
GRANT USAGE ON SEQUENCE ops.movements_id_seq TO ops_svc;

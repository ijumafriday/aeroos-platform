-- Irregular movements: where the aircraft actually ended up (diversion, forced return), and the DIVERTED status.
ALTER TABLE ops.flights ADD COLUMN actual_arr text;      -- confirmed: diversion / forced return
ALTER TABLE ops.flights ADD COLUMN diverting_to text;    -- announced (EA to another station), not yet confirmed
ALTER TABLE ops.flights DROP CONSTRAINT IF EXISTS flights_status_check;
ALTER TABLE ops.flights ADD CONSTRAINT flights_status_check
  CHECK (status IN ('SCHEDULED', 'DELAYED', 'CANCELLED', 'DEPARTED', 'ARRIVED', 'DIVERTED'));

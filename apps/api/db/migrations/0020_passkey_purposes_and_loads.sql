-- Passkeys can also confirm task-card step stamps, MEL extensions and the revocation of a passkey.
ALTER TABLE platform.webauthn_challenges DROP CONSTRAINT IF EXISTS webauthn_challenges_purpose_check;
ALTER TABLE platform.webauthn_challenges ADD CONSTRAINT webauthn_challenges_purpose_check
  CHECK (purpose IN ('register', 'enrol', 'crs', 'stamp', 'mel_extension', 'revoke'));

-- Passenger load per flight (from the reservation system; demo: synthetic). Positioning crew need a free seat.
ALTER TABLE ops.flights ADD COLUMN booked_pax integer NOT NULL DEFAULT 0 CHECK (booked_pax >= 0);

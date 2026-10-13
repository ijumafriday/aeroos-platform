-- Passkeys (WebAuthn) for signature-grade confirmation of regulated actions (first: CRS issue).
CREATE TABLE platform.passkeys (
  credential_id  text PRIMARY KEY,               -- base64url
  subject        text        NOT NULL,           -- OIDC subject
  username       text        NOT NULL,
  label          text        NOT NULL,
  public_key_pem text        NOT NULL,
  alg            integer     NOT NULL CHECK (alg IN (-7, -8, -257)),
  sign_count     bigint      NOT NULL DEFAULT 0,
  aaguid         text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz,
  revoked_at     timestamptz
);
CREATE INDEX passkeys_subject ON platform.passkeys (subject) WHERE revoked_at IS NULL;

-- Single-use challenges, bound to who asked, for what, and about which record.
CREATE TABLE platform.webauthn_challenges (
  id         uuid PRIMARY KEY,
  subject    text        NOT NULL,
  purpose    text        NOT NULL CHECK (purpose IN ('register', 'enrol', 'crs')),
  context    jsonb       NOT NULL,
  nonce      text        NOT NULL,               -- base64url; challenge = sha256(nonce ‖ canonical{purpose, subject, context})
  challenge  text        NOT NULL,               -- base64url, what the authenticator signs over
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE INDEX webauthn_challenges_expiry ON platform.webauthn_challenges (expires_at);

GRANT SELECT, INSERT, UPDATE ON platform.passkeys, platform.webauthn_challenges TO platform_svc;
GRANT DELETE ON platform.webauthn_challenges TO platform_svc;

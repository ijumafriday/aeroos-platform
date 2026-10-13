import { hostname } from 'node:os';
import { z } from 'zod';

const bool = z.enum(['true', 'false']).default('false').transform(v => v === 'true');

const integrationKeys = z.string().optional().transform((v, ctx) => {
  const out: { operatorId: string; key: string }[] = [];
  for (const part of (v ?? '').split(',').map(x => x.trim()).filter(Boolean)) {
    const [operatorId, key] = part.split('=').map(x => x?.trim());
    if (!operatorId || !key || key.length < 16) {
      ctx.addIssue({ code: 'custom', message: 'integration key entries must be OPERATOR=key with keys of at least 16 characters' });
      return z.NEVER;
    }
    out.push({ operatorId, key });
  }
  return out;
});

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  INSTANCE_ID: z.string().default(hostname()),

  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().default(5432),
  DB_NAME: z.string().default('aeroos'),
  DB_POOL_SIZE: z.coerce.number().int().positive().default(10),

  KAFKA_BROKERS: z.string().default('localhost:29092').transform(s => s.split(',').map(x => x.trim()).filter(Boolean)),
  KAFKA_CLIENT_ID: z.string().default('aeroos-api'),
  KAFKA_PARTITIONS: z.coerce.number().int().positive().default(6),
  KAFKA_REPLICATION: z.coerce.number().int().positive().default(1),

  TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().default('default'),

  OIDC_ISSUER: z.string().url().default('http://localhost:8081/realms/aeroos'),
  OIDC_JWKS_URL: z.string().url().default('http://localhost:8081/realms/aeroos/protocol/openid-connect/certs'),
  OIDC_AUDIENCE: z.string().default('aeroos-api'),
  /** Operator a multi-operator user acts for when the request has no X-Operator header. */
  DEFAULT_OPERATOR: z.string().min(2).max(10).optional(),

  CERBOS_URL: z.string().url().default('http://localhost:3592'),

  /**
   * local — Ed25519 key file (development only)
   * transit — OpenBao / HashiCorp Vault Transit engine; key never leaves it, and it can be HSM-backed (ADR-0006)
   */
  SIGNING_PROVIDER: z.enum(['local', 'transit']).default('local'),
  TRANSIT_ADDR: z.string().url().default('http://localhost:8200'),
  TRANSIT_TOKEN: z.string().optional(),
  TRANSIT_TOKEN_FILE: z.string().optional(),
  TRANSIT_MOUNT: z.string().default('transit'),
  TRANSIT_KEY: z.string().default('aeroos-signing'),

  /** Re-authentication required before a CRS can be issued (OIDC auth_time), in seconds. 0 disables. */
  STEP_UP_MAX_AGE_SECONDS: z.coerce.number().int().min(0).default(300),
  /** WebAuthn relying party: the site's registrable domain, and the exact origins the browser app is served from. */
  WEBAUTHN_RP_ID: z.string().default('localhost'),
  WEBAUTHN_RP_NAME: z.string().default('AeroOS'),
  /** Signatures that must be confirmed with a passkey once the signer has one (the CRS always is). */
  PASSKEY_REQUIRED_FOR: z.string().default('stamp,mel_extension').transform(v => new Set(v.split(',').map(s => s.trim()).filter(Boolean))),
  WEBAUTHN_ORIGINS: z.string().default('http://localhost:8080,http://localhost:5173').transform(v => v.split(',').map(s => s.trim()).filter(Boolean)),

  /** S3-compatible object storage (MinIO, Ceph RGW, any cloud S3). */
  S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
  /** Endpoint browsers use for presigned URLs (may differ from the in-cluster endpoint). */
  S3_PUBLIC_ENDPOINT: z.string().url().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().default('aeroos'),
  S3_SECRET_KEY: z.string().default('aeroos-dev-secret'),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true').transform(v => v === 'true'),
  S3_BUCKET_DOCUMENTS: z.string().default('aeroos-documents'),
  S3_BUCKET_ANCHORS: z.string().default('aeroos-audit-anchors'),
  /** Object Lock retention for audit anchors (COMPLIANCE mode). Short in development, years in production. */
  ANCHOR_RETENTION_DAYS: z.coerce.number().int().positive().default(1),
  DOCUMENT_MAX_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),

  /** Simulate DEPARTED/ARRIVED from estimated times for flights no movement message has reported. */
  MOVEMENT_SIMULATION: z.enum(['true', 'false']).default('true').transform(v => v === 'true'),
  /** API key for the movement-message integration (MVT via SITA/ARINC gateway, ACARS OOOI). Unset = endpoint disabled. */
  /**
   * Integration keys per operator, "NKX=key1,FJR=key2" (each key ≥ 16 characters). A gateway authenticated
   * with an operator's key can only report that operator's flights.
   */
  MOVEMENT_API_KEYS: integrationKeys,
  /** Per-operator credentials for an operational-flight-planning provider/gateway. */
  OPS_PROVIDER_API_KEYS: integrationKeys,
  /** Per-operator credentials for a validated FRMS / biomathematical fatigue provider. */
  FRMS_PROVIDER_API_KEYS: integrationKeys,

  RATE_LIMIT_ENABLED: z.enum(['true', 'false']).default('true').transform(v => v === 'true'),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),
  RATE_LIMIT_AUTHENTICATED: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_ANONYMOUS: z.coerce.number().int().min(1).default(60),

  OTEL_ENABLED: bool,
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().default('http://localhost:4318'),
  ALLOW_LOCAL_SIGNING: bool,
  SIGNING_KEY_ID: z.string().default('dev-local-1'),
  SIGNING_KEY_PEM: z.string().optional(),
  SIGNING_KEY_FILE: z.string().optional(),

  ALLOW_DRAFT_RULEPACKS: bool,
  SEED_DEMO: bool
});

export type Config = z.infer<typeof schema> & { dbPassword(role: string): string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${lines}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === 'production' && c.SIGNING_PROVIDER === 'local' && !c.ALLOW_LOCAL_SIGNING) {
    throw new Error('SIGNING_PROVIDER=local is not allowed in production. Use SIGNING_PROVIDER=transit (OpenBao/Vault, optionally HSM-backed) or set ALLOW_LOCAL_SIGNING=true for a non-production stack.');
  }
  if (c.NODE_ENV === 'production' && c.SEED_DEMO) {
    throw new Error('SEED_DEMO=true is forbidden in production. Demo/illustrative records must never enter a production tenant.');
  }
  if (c.NODE_ENV === 'production' && c.ALLOW_DRAFT_RULEPACKS) {
    throw new Error('ALLOW_DRAFT_RULEPACKS=true is forbidden in production. Only independently approved/effective authority rulepacks may be used.');
  }
  if (c.NODE_ENV === 'production' && c.MOVEMENT_SIMULATION) {
    throw new Error('MOVEMENT_SIMULATION=true is forbidden in production. Production movement state must come from an authoritative integration or controlled manual action.');
  }
  return {
    ...c,
    /** Passwords come from DB_PASSWORD_<ROLE>; in development they default to the role name. */
    dbPassword(role: string) {
      const v = env[`DB_PASSWORD_${role.toUpperCase()}`];
      if (v) return v;
      if (c.NODE_ENV === 'production') throw new Error(`Missing DB_PASSWORD_${role.toUpperCase()}`);
      return role;
    }
  };
}

export const CONFIG = Symbol('CONFIG');

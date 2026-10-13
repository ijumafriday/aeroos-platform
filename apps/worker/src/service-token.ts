const TOKEN_URL = process.env.OIDC_TOKEN_URL ?? 'http://localhost:8081/realms/aeroos/protocol/openid-connect/token';
const CLIENT_ID = process.env.SERVICE_CLIENT_ID ?? 'aeroos-worker';
const CLIENT_SECRET = process.env.SERVICE_CLIENT_SECRET ?? 'dev-aeroos-worker-secret-change-me';

let cached: { token: string; expiresAt: number } | undefined;

export async function serviceToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - 30 > now) return cached.token;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Service authentication failed: HTTP ${res.status} ${await res.text()}`);
  const token = await res.json() as { access_token?: string; expires_in?: number };
  if (!token.access_token) throw new Error('Service authentication returned no access_token');
  cached = { token: token.access_token, expiresAt: now + Math.max(60, token.expires_in ?? 300) };
  return cached.token;
}

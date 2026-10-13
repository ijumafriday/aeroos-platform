import type { Level } from './schedule';
import { serviceToken } from './service-token';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

/**
 * Activities never touch the database. State changes go through the API's internal endpoints so
 * every write still passes the owning module's rules, audit chain and outbox.
 * Failures throw, and Temporal retries with backoff.
 */
async function internalPost<T>(path: string, body: unknown, what: string): Promise<T> {
  const res = await fetch(`${API_URL}/api/internal/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await serviceToken()}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000)
  });
  if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Expire authorisations and send T-90/T-30/T-7/EXPIRED warnings (Org Core). */
export function orgSweep(): Promise<{ expired: number; warnings: number }> {
  return internalPost('org/sweep', {}, 'Org expiry sweep');
}

/** Sign each audit chain head and write it to the write-once bucket. */
export function anchorAuditChains(): Promise<{ chain: string; seq: number | null; anchored: boolean }[]> {
  return internalPost('platform/anchors', {}, 'Audit anchoring');
}

/** Hourly: publish aircraft that became unairworthy (calendar-limited items, overdue ADs). */
export function camoAirworthinessSweep(): Promise<{ changed: string[] }> {
  return internalPost('camo/airworthiness/sweep', {}, 'CAMO airworthiness sweep');
}

/** Hourly: abandoned document uploads are stored (if the file arrived) or marked expired. */
export function documentsSweep(): Promise<{ stored: number; expired: number }> {
  return internalPost('platform/documents/sweep', {}, 'Upload sweep');
}

/** Every 5 minutes: simulated movement for flights no MVT/ACARS message has reported (MOVEMENT_SIMULATION). */
export function opsMovement(): Promise<{ departed: number; arrived: number }> {
  return internalPost('ops/progress', {}, 'Ops movement');
}

export async function escalate(melItemId: string, level: Level): Promise<{ active: boolean }> {
  const res = await fetch(`${API_URL}/api/internal/camo/mel-items/${encodeURIComponent(melItemId)}/escalations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await serviceToken()}` },
    body: JSON.stringify({ level }),
    signal: AbortSignal.timeout(20_000)
  });
  if (res.status === 404) return { active: false };
  if (!res.ok) throw new Error(`Escalation ${level} for ${melItemId} failed: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as { active: boolean };
}

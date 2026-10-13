import type { ApiError } from '@aeroos/contracts';
import { accessToken } from './auth';
import { selectedOperator, selectOperator } from './operator';
import { loadSnapshot, saveSnapshot } from './offline';

export class ApiRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

/**
 * Typed fetch for the AeroOS API. Every POST carries a fresh Idempotency-Key, so a retry after a
 * dropped connection can never issue a second CRS or engineering order.
 */
export async function api<T>(path: string, opts: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown } = {}, retried = false): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { authorization: `Bearer ${await accessToken()}` };
  const operator = selectedOperator();
  if (operator) headers['x-operator'] = operator;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (method === 'POST') headers['idempotency-key'] = crypto.randomUUID();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch {
    if (method === 'GET') {
      const cached = await loadSnapshot<T>(path);
      if (cached !== undefined) return cached;
    }
    throw new ApiRequestError(0, 'NETWORK', 'Cannot reach AeroOS. Check your connection; nothing was changed.');
  }
  if (!res.ok) {
    let body: Partial<ApiError> = {};
    try {
      body = await res.json();
    } catch {
      /* non-JSON error */
    }
    // A remembered operator the user no longer belongs to: fall back to their default and retry once.
    if (res.status === 403 && operator && !retried && /not a member of operator/.test(body.message ?? '')) {
      selectOperator(null);
      return api<T>(path, opts, true);
    }
    throw new ApiRequestError(res.status, body.code ?? 'HTTP', body.message ?? `Request failed (${res.status})`);
  }
  const value = (await res.json()) as T;
  if (method === 'GET') void saveSnapshot(path, value).catch(() => undefined);
  return value;
}

export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

/** Download a file from the API (authenticated, operator-scoped) and hand it to the browser to save. */
export async function download(path: string, fallbackName: string): Promise<{ name: string; bytes: number; manifestSha256: string | null }> {
  const headers: Record<string, string> = { authorization: `Bearer ${await accessToken()}` };
  const operator = selectedOperator();
  if (operator) headers['x-operator'] = operator;
  const res = await fetch(`/api${path}`, { headers });
  if (!res.ok) {
    let body: Partial<ApiError> = {};
    try {
      body = await res.json();
    } catch {
      /* non-JSON error */
    }
    throw new ApiRequestError(res.status, body.code ?? 'HTTP', body.message ?? `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { name, bytes: blob.size, manifestSha256: res.headers.get('x-manifest-sha256') };
}

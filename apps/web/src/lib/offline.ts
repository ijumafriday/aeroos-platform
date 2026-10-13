import { accessToken } from './auth';
import { selectedOperator } from './operator';

const DB_NAME = 'aeroos-field-v1';
const DB_VERSION = 1;
const KEY_ID = 'device-aes-gcm';

type Enc = { iv: ArrayBuffer; data: ArrayBuffer };
type QueueState = 'PENDING' | 'CONFLICT' | 'FAILED';
type JsonItem = { id: string; kind: 'json'; operatorId: string; path: string; label: string; idempotencyKey: string; createdAt: string; state: QueueState; error?: string; payload: Enc };
type FileItem = { id: string; kind: 'attachment'; operatorId: string; ownerType: string; ownerId: string; label: string; fileName: string; contentType: string; sizeBytes: number; createdAt: string; state: QueueState; error?: string; payload: Enc };
export type OfflineQueueItem = JsonItem | FileItem;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots');
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function req<T>(r: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
async function txStore(name: string, mode: IDBTransactionMode = 'readonly') { const db = await openDb(); return db.transaction(name, mode).objectStore(name); }

async function deviceKey(): Promise<CryptoKey> {
  const s = await txStore('keys');
  const existing = await req(s.get(KEY_ID)) as CryptoKey | undefined;
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const ws = await txStore('keys', 'readwrite'); await req(ws.put(key, KEY_ID)); return key;
}
async function encryptBytes(bytes: ArrayBuffer): Promise<Enc> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deviceKey(), bytes);
  return { iv: iv.buffer, data };
}
async function decryptBytes(enc: Enc): Promise<ArrayBuffer> { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(enc.iv) }, await deviceKey(), enc.data); }
async function encryptJson(value: unknown): Promise<Enc> { return encryptBytes(new TextEncoder().encode(JSON.stringify(value)).buffer); }
async function decryptJson<T>(enc: Enc): Promise<T> { return JSON.parse(new TextDecoder().decode(await decryptBytes(enc))) as T; }
const scope = (key: string) => `${selectedOperator() ?? '_'}:${key}`;

export async function saveSnapshot(key: string, value: unknown) { const s = await txStore('snapshots', 'readwrite'); await req(s.put(await encryptJson({ at: new Date().toISOString(), value }), scope(key))); }
export async function loadSnapshot<T>(key: string): Promise<T | undefined> { const s = await txStore('snapshots'); const v = await req(s.get(scope(key))) as Enc | undefined; return v ? (await decryptJson<{ value: T }>(v)).value : undefined; }

export async function queueJson(path: string, body: unknown, label: string) {
  const operatorId = selectedOperator(); if (!operatorId) throw new Error('Select an operator before working offline');
  const item: JsonItem = { id: crypto.randomUUID(), kind: 'json', operatorId, path, label, idempotencyKey: crypto.randomUUID(), createdAt: new Date().toISOString(), state: 'PENDING', payload: await encryptJson(body) };
  const s = await txStore('queue', 'readwrite'); await req(s.add(item)); window.dispatchEvent(new Event('aeroos-offline-queue')); return item.id;
}
export async function queueAttachment(ownerType: string, ownerId: string, file: File) {
  const operatorId = selectedOperator(); if (!operatorId) throw new Error('Select an operator before working offline');
  const item: FileItem = { id: crypto.randomUUID(), kind: 'attachment', operatorId, ownerType, ownerId, label: `Attach ${file.name}`, fileName: file.name, contentType: file.type, sizeBytes: file.size, createdAt: new Date().toISOString(), state: 'PENDING', payload: await encryptBytes(await file.arrayBuffer()) };
  const s = await txStore('queue', 'readwrite'); await req(s.add(item)); window.dispatchEvent(new Event('aeroos-offline-queue')); return item.id;
}
export async function listQueue(): Promise<OfflineQueueItem[]> { const s = await txStore('queue'); return (await req(s.getAll()) as OfflineQueueItem[]).sort((a,b) => a.createdAt.localeCompare(b.createdAt)); }
export async function discardQueueItem(id: string) { const s = await txStore('queue', 'readwrite'); await req(s.delete(id)); window.dispatchEvent(new Event('aeroos-offline-queue')); }
async function updateItem(item: OfflineQueueItem) { const s = await txStore('queue', 'readwrite'); await req(s.put(item)); }
async function authHeaders(operatorId: string, extra: Record<string,string> = {}) { return { authorization: `Bearer ${await accessToken()}`, 'x-operator': operatorId, ...extra }; }

async function sendJson(item: JsonItem) {
  const body = await decryptJson(item.payload);
  const res = await fetch(`/api${item.path}`, { method: 'POST', headers: await authHeaders(item.operatorId, { 'content-type': 'application/json', 'idempotency-key': item.idempotencyKey }), body: JSON.stringify(body) });
  if (res.ok) return;
  let msg = `HTTP ${res.status}`; try { msg = (await res.json()).message ?? msg; } catch { /* response body may not be JSON */ }
  if (res.status === 409) { item.state = 'CONFLICT'; item.error = msg; await updateItem(item); return; }
  if (res.status >= 400 && res.status < 500) { item.state = 'FAILED'; item.error = msg; await updateItem(item); return; }
  throw new Error(msg);
}
async function sendAttachment(item: FileItem) {
  const headers = await authHeaders(item.operatorId, { 'content-type': 'application/json', 'idempotency-key': item.id });
  const ticketRes = await fetch('/api/documents/uploads', { method: 'POST', headers, body: JSON.stringify({ ownerType: item.ownerType, ownerId: item.ownerId, fileName: item.fileName, contentType: item.contentType, sizeBytes: item.sizeBytes }) });
  if (!ticketRes.ok) { if (ticketRes.status === 409) { item.state='CONFLICT'; item.error='Attachment owner changed'; await updateItem(item); return; } throw new Error(`Upload registration failed (${ticketRes.status})`); }
  const ticket = await ticketRes.json();
  const bytes = await decryptBytes(item.payload);
  const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: bytes });
  if (!put.ok) throw new Error(`Object storage refused upload (${put.status})`);
  const confirm = await fetch(`/api/documents/${ticket.document.id}/confirm`, { method: 'POST', headers: await authHeaders(item.operatorId, { 'content-type':'application/json', 'idempotency-key': `${item.id}-confirm` }), body: '{}' });
  if (!confirm.ok) throw new Error(`Document confirmation failed (${confirm.status})`);
}

export async function flushOfflineQueue(): Promise<{ sent: number; blocked: number }> {
  if (!navigator.onLine) return { sent: 0, blocked: (await listQueue()).length };
  let sent = 0;
  for (const item of await listQueue()) {
    if (item.state !== 'PENDING') continue;
    try {
      if (item.kind === 'json') await sendJson(item); else await sendAttachment(item);
      if (item.state === 'PENDING') { await discardQueueItem(item.id); sent++; }
    } catch { break; }
  }
  const blocked = (await listQueue()).length;
  window.dispatchEvent(new Event('aeroos-offline-queue'));
  return { sent, blocked };
}

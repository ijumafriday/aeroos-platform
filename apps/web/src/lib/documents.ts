import type { DocumentDto, UploadTicketDto } from '@aeroos/contracts';
import { api, post } from './api';

export const ACCEPTED = 'application/pdf,image/png,image/jpeg';
export const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Upload in three steps: register (API) → PUT bytes straight to object storage (presigned URL,
 * never through the API) → confirm (API hashes what was stored and records it in the audit chain).
 */
export async function uploadDocument(ownerType: string, ownerId: string, file: File): Promise<DocumentDto> {
  if (!ACCEPTED.split(',').includes(file.type)) throw new Error('Only PDF, PNG or JPEG files can be stored');
  if (file.size > MAX_BYTES) throw new Error('Files must be 25 MB or smaller');
  const ticket = await post<UploadTicketDto>('/documents/uploads', {
    ownerType, ownerId, fileName: file.name, contentType: file.type, sizeBytes: file.size
  });
  let res: Response;
  try {
    res = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: file });
  } catch {
    throw new Error('Could not reach document storage. Check your connection and try again.');
  }
  if (!res.ok) throw new Error(`Document storage refused the upload (${res.status})`);
  return post<DocumentDto>(`/documents/${ticket.document.id}/confirm`);
}

/** Open a stored document in a new tab via a short-lived presigned URL. */
export async function openDocument(id: string) {
  const tab = window.open('about:blank', '_blank');
  try {
    const { url } = await api<{ url: string }>(`/documents/${id}/url`);
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (e) {
    tab?.close();
    throw e;
  }
}

export const size = (n: number | null) => (n === null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

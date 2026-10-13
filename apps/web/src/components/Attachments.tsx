import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocumentDto } from '@aeroos/contracts';
import { api } from '../lib/api';
import { ACCEPTED, openDocument, size, uploadDocument } from '../lib/documents';
import { queueAttachment } from '../lib/offline';
import { zulu } from '../lib/format';
import { useUi } from '../lib/store';
import { ErrorNote } from './ui';

/** Stored documents for one owner, with an upload button when the user may attach. */
export function Attachments({ ownerType, ownerId, canAttach, initial }: { ownerType: string; ownerId: string; canAttach: boolean; initial?: DocumentDto[] }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const input = useRef<HTMLInputElement>(null);
  const [openError, setOpenError] = useState<unknown>(null);
  const key = ['documents', ownerType, ownerId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api<DocumentDto[]>(`/documents?ownerType=${encodeURIComponent(ownerType)}&ownerId=${encodeURIComponent(ownerId)}`),
    initialData: initial
  });
  const upload = useMutation({
    mutationFn: async (f: File) => {
      if (!navigator.onLine) { await queueAttachment(ownerType, ownerId, f); return { queued: true as const, fileName: f.name }; }
      try { return { queued: false as const, doc: await uploadDocument(ownerType, ownerId, f), fileName: f.name }; }
      catch (e) { if (!navigator.onLine) { await queueAttachment(ownerType, ownerId, f); return { queued: true as const, fileName: f.name }; } throw e; }
    },
    onSuccess: r => { if (r.queued) toast(`${r.fileName} encrypted and queued for upload`, 'cyan'); else { toast(`${r.doc.fileName} stored · sha256 ${r.doc.sha256?.slice(0, 10)}…`, 'green'); void qc.invalidateQueries({ queryKey: key }); } }
  });

  return (
    <div className="stack" style={{ gap: 6 }}>
      {(q.data ?? []).map(d => (
        <button key={d.id} className="doc" onClick={() => openDocument(d.id).catch(setOpenError)} title={`sha256 ${d.sha256}`}>
          <span className="doc-ic" aria-hidden="true">{d.contentType === 'application/pdf' ? 'PDF' : 'IMG'}</span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <b>{d.fileName}</b>
            <span className="note"> {size(d.sizeBytes)} · {zulu(d.createdAt)} · {d.uploadedBy.replace(/^user:/, '')}</span>
          </span>
        </button>
      ))}
      {q.data?.length === 0 && !canAttach && <span className="note">No documents.</span>}
      {canAttach && (
        <div className="row">
          <input ref={input} type="file" accept={ACCEPTED} hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
          <button className="btn sm" disabled={upload.isPending} onClick={() => input.current?.click()}>{upload.isPending ? 'Uploading…' : '+ Attach PDF or image'}</button>
          <span className="note">Stored in object storage; its SHA-256 goes into the audit trail.</span>
        </div>
      )}
      <ErrorNote error={upload.error ?? openError} />
    </div>
  );
}

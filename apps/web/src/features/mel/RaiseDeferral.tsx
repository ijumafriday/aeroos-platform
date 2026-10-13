import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FleetTailDto, MelCatalogueEntryDto, MelItemDto } from '@aeroos/contracts';
import { api, post } from '../../lib/api';
import { useUi } from '../../lib/store';
import { Dialog, ErrorNote } from '../../components/ui';

export function RaiseDeferral({ onClose }: { onClose(id?: string): void }) {
  const qc = useQueryClient();
  const fleet = useQuery({ queryKey: ['fleet'], queryFn: () => api<FleetTailDto[]>('/camo/fleet') });
  const mel = useQuery({ queryKey: ['mel-catalogue'], queryFn: () => api<MelCatalogueEntryDto[]>('/compliance/mel-catalogue') });
  const [tail, setTail] = useState('');
  const [melRef, setMelRef] = useState('');
  const [description, setDescription] = useState('');
  const entry = mel.data?.find(m => m.ref === melRef);

  const raise = useMutation({
    mutationFn: () => post<MelItemDto>('/camo/mel-items', { tail, melRef, description }),
    onSuccess: item => {
      void qc.invalidateQueries({ queryKey: ['mel'] });
      useUi.getState().toast(`${item.id} raised — due ${item.deadline.slice(0, 16).replace('T', ' ')}Z (${item.deadlineRule})`, 'amber');
      onClose(item.id);
    },
    onError: () => undefined
  });

  const valid = tail && melRef && description.trim().length >= 3;

  return (
    <Dialog
      title="Raise MEL deferral"
      onClose={() => onClose()}
      footer={<>
        <button className="btn ghost" onClick={() => onClose()}>Cancel</button>
        <button className="btn pri" disabled={!valid || raise.isPending} onClick={() => raise.mutate()}>{raise.isPending ? 'Raising…' : 'Raise deferral'}</button>
      </>}
    >
      <div className="field">
        <label htmlFor="rd-tail">Aircraft</label>
        <select id="rd-tail" className="inp" value={tail} onChange={e => setTail(e.target.value)}>
          <option value="">Select tail…</option>
          {fleet.data?.map(t => <option key={t.reg} value={t.reg}>{t.reg} · {t.type}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="rd-mel">MEL item (operator's approved MEL)</label>
        <select id="rd-mel" className="inp" value={melRef} onChange={e => setMelRef(e.target.value)}>
          <option value="">Select item…</option>
          {mel.data?.map(m => <option key={m.ref} value={m.ref}>{m.ref} · Cat {m.category} · {m.title}</option>)}
        </select>
      </div>
      {entry && (
        <div className="callout">
          Category {entry.category}{entry.intervalHours ? ` · ${entry.intervalHours} h interval` : ''} · extension {entry.extensionPermitted ? 'permitted' : 'not permitted'}.
          The deadline is calculated by the rulepack when you raise it.
        </div>
      )}
      <div className="field">
        <label htmlFor="rd-desc">Defect as written in the technical log</label>
        <textarea id="rd-desc" className="inp" value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. LDG LIGHT L INOP" />
      </div>
      <ErrorNote error={raise.error} />
    </Dialog>
  );
}

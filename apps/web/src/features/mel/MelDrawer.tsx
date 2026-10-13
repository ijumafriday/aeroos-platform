import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { AuditEntryDto, MelCatalogueEntryDto, MelItemDto, PasskeyAssertionOptionsDto, PasskeyDto } from '@aeroos/contracts';
import { signWithPasskey } from '../../lib/passkey';
import { api, post } from '../../lib/api';
import { catTone, short, zulu } from '../../lib/format';
import { useUi } from '../../lib/store';
import { Countdown, DL, Drawer, ErrorNote, Pill } from '../../components/ui';

interface MelDetail {
  item: MelItemDto;
  engineeringOrder: { id: string; title: string; trade: string; steps: string[]; createdAt: string } | null;
  audit: AuditEntryDto[];
  permissions: { generateEo: boolean; approveExtension: boolean };
  melEntry: (MelCatalogueEntryDto & { opsProcedure?: string; maintProcedure?: string }) | null;
}

export function MelDrawer({ id, onClose }: { id: string | null; onClose(): void }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const [justification, setJustification] = useState('');
  const q = useQuery({ queryKey: ['mel', 'detail', id], queryFn: () => api<MelDetail>(`/camo/mel-items/${id}`), enabled: !!id });
  const refresh = () => qc.invalidateQueries({ queryKey: ['mel'] });

  const eo = useMutation({
    mutationFn: () => post<{ engineeringOrderId: string }>(`/camo/mel-items/${id}/engineering-order`),
    onSuccess: r => { toast(`${r.engineeringOrderId} released — task card on its way to AMO`, 'green'); void refresh(); }
  });
  const passkeys = useQuery({ queryKey: ['passkeys'], queryFn: () => api<PasskeyDto[]>('/platform/passkeys'), staleTime: 60_000 });
  const extend = useMutation({
    // With a passkey, the extension is confirmed on the device, bound to this item and this exact justification.
    mutationFn: () => signWithPasskey((passkeys.data?.length ?? 0) > 0,
      () => post<PasskeyAssertionOptionsDto>(`/camo/mel-items/${id}/extension/challenge`, { justification }),
      passkey => post<MelItemDto>(`/camo/mel-items/${id}/extension`, { justification, passkey })),
    onSuccess: r => { toast(`Extended to ${zulu(r.deadline)} under ${r.deadlineRule}`, 'cyan'); setJustification(''); void refresh(); }
  });

  const d = q.data;
  const m = d?.item;
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      eyebrow={m ? `MEL ${m.melRef} · ${m.aircraftType}` : 'Deferral'}
      title={m ? `${m.id} · ${m.tail}` : id ?? ''}
      tags={m && <>
        <Pill tone={catTone(m.category)}>Cat {m.category}</Pill>
        <Pill tone={m.status === 'OPEN' ? 'amber' : m.status === 'CLOSED' ? 'green' : 'red'}>{m.status}</Pill>
        {m.extensions > 0 && <Pill tone="cyan">Extended ×{m.extensions}</Pill>}
      </>}
    >
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      {m && d && (
        <>
          {m.status !== 'CLOSED' && (
            <div className={`callout ${Date.parse(m.deadline) - Date.now() < 6 * 3_600_000 ? 'red' : 'amber'}`}>
              <div className="lbl">Rectification interval remaining</div>
              <div style={{ marginTop: 2 }}><Countdown until={m.deadline} size={28} /></div>
              <div className="note">Due {zulu(m.deadline)} · {m.deadlineBasis}</div>
              <div className="note mono">Decided by {m.deadlineRule}</div>
            </div>
          )}
          {m.status === 'CLOSED' && <div className="callout green">Closed {m.closedAt && zulu(m.closedAt)} under <b>{m.closureRef}</b>.</div>}
          <DL items={[
            ['Item', m.title],
            ['Defect', m.description],
            ['Raised', `${zulu(m.raisedAt)} by ${m.raisedBy}`],
            ['Original deadline', zulu(m.originalDeadline)],
            ['Operational procedure', d.melEntry?.opsProcedure ?? '—'],
            ['Maintenance procedure', d.melEntry?.maintProcedure ?? '—']
          ]} />

          <section className="dsec">
            <h3>Engineering order</h3>
            {d.engineeringOrder ? (
              <div className="callout">
                <b className="mono">{d.engineeringOrder.id}</b> · {d.engineeringOrder.trade.toLowerCase()} · released {zulu(d.engineeringOrder.createdAt)}
                <ol style={{ margin: '8px 0 0', paddingLeft: 18 }}>{d.engineeringOrder.steps.map(s => <li key={s}>{s}</li>)}</ol>
                <div style={{ marginTop: 8 }}><Link to="/amo/task-cards" search={{ card: undefined }} className="btn sm">Open hangar floor</Link></div>
              </div>
            ) : m.status === 'OPEN' ? (
              d.permissions.generateEo
                ? <button className="btn warn big-btn" disabled={eo.isPending} onClick={() => eo.mutate()}>{eo.isPending ? 'Releasing…' : 'Generate AMO engineering order'}</button>
                : <p className="note">A CAMO engineer releases the engineering order.</p>
            ) : <p className="note">None.</p>}
            <ErrorNote error={eo.error} />
          </section>

          {m.status === 'OPEN' && d.permissions.approveExtension && (
            <section className="dsec">
              <h3>Rectification interval extension</h3>
              <p className="note">Eligibility is decided by the rulepack and the operator's MEL ({d.melEntry?.extensionPermitted ? 'extension permitted for this item' : 'extension not permitted for this item'}).</p>
              <textarea className="inp" value={justification} onChange={e => setJustification(e.target.value)} placeholder="Operational justification (parts on order, aircraft routing, …)" />
              <button className="btn" style={{ marginTop: 8 }} disabled={justification.trim().length < 10 || extend.isPending} onClick={() => extend.mutate()}>Approve extension</button>
              <ErrorNote error={extend.error} />
            </section>
          )}

          <section className="dsec">
            <h3>Audit trail <span className="note mono">chain: camo</span></h3>
            <div className="timeline">
              {d.audit.map(a => (
                <div key={a.seq} className="tl">
                  <i />
                  <div>
                    <b>{a.action}</b> <span className="note">{zulu(a.at)} · {a.actor}</span>
                    {a.rule && <div className="note mono">{a.rule}</div>}
                    <div className="h">#{a.seq} {short(a.hash)}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </Drawer>
  );
}

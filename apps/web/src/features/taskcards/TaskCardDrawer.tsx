import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuditEntryDto, CertificationCheckDto, PasskeyAssertionOptionsDto, PasskeyDto, TaskCardDto, ToolDto } from '@aeroos/contracts';
import { Attachments } from '../../components/Attachments';
import { api, ApiRequestError, post } from '../../lib/api';
import { reauthenticate, takePendingStepUp } from '../../lib/auth';
import { confirmWithPasskey, passkeysSupported, signWithPasskey } from '../../lib/passkey';
import { openDocument } from '../../lib/documents';
import { short, zulu } from '../../lib/format';
import { useUi } from '../../lib/store';
import { DL, Drawer, ErrorNote, Pill } from '../../components/ui';
import { queueJson } from '../../lib/offline';

interface CardDetail {
  card: TaskCardDto;
  certification: CertificationCheckDto;
  permissions: { signStep: boolean; issueCrs: boolean };
  audit: AuditEntryDto[];
}

interface ExecutionRecord { id:string; stepNo:number; recordType:string; valueText:string|null; valueNumber:number|null; unit:string|null; lowerLimit:number|null; upperLimit:number|null; result:string|null; reference:string|null; recordedBy:string; recordedAt:string; inspectedBy:string|null; inspectedAt:string|null }

export function TaskCardDrawer({ id, onClose }: { id: string | null; onClose(): void }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const q = useQuery({
    queryKey: ['task-cards', 'detail', id],
    queryFn: () => api<CardDetail>(`/amo/task-cards/${id}`),
    enabled: !!id,
    // The CRS PDF is generated asynchronously from the CRS event; poll briefly until it is linked.
    refetchInterval: query => (query.state.data?.card.crs && !query.state.data.card.crs.documentId ? 2000 : false)
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['task-cards'] });

  const [fieldNote, setFieldNote] = useState('');
  const notes = useQuery({ queryKey: ['task-cards','field-notes',id], queryFn: () => api<any[]>(`/amo/task-cards/${id}/field-notes`), enabled: !!id });
  const execution = useQuery({ queryKey: ['task-cards','execution',id], queryFn: () => api<ExecutionRecord[]>(`/amo/maintenance/task-cards/${id}/execution`), enabled: !!id, retry: false });
  const [execForm,setExecForm]=useState({stepNo:'1',recordType:'MEASUREMENT',valueText:'',valueNumber:'',unit:'',lowerLimit:'',upperLimit:'',reference:''});
  const recordExecution=useMutation({mutationFn:()=>post<{id:string;result:string|null}>(`/amo/maintenance/task-cards/${id}/execution`,{stepNo:Number(execForm.stepNo),recordType:execForm.recordType,valueText:execForm.valueText||null,valueNumber:execForm.valueNumber===''?null:Number(execForm.valueNumber),unit:execForm.unit||null,lowerLimit:execForm.lowerLimit===''?null:Number(execForm.lowerLimit),upperLimit:execForm.upperLimit===''?null:Number(execForm.upperLimit),reference:execForm.reference||null}),onSuccess:r=>{toast(`Execution evidence recorded${r.result?` · ${r.result}`:''}`,r.result==='FAIL'?'red':'green');setExecForm(x=>({...x,valueText:'',valueNumber:'',reference:''}));void qc.invalidateQueries({queryKey:['task-cards','execution',id]})}});
  const inspectExecution=useMutation({mutationFn:(x:{recordId:string;result:'ACCEPTED'|'REJECTED'})=>post(`/amo/maintenance/task-cards/${id}/execution/${x.recordId}/inspect`,{result:x.result,reference:'Independent inspection',note:null}),onSuccess:()=>{toast('Independent inspection recorded','green');void qc.invalidateQueries({queryKey:['task-cards','execution',id]})}});
  const addNote = useMutation({
    mutationFn: async () => {
      const body = { clientMutationId: crypto.randomUUID(), body: fieldNote.trim(), clientCreatedAt: new Date().toISOString() };
      if (!navigator.onLine) { await queueJson(`/amo/task-cards/${id}/field-notes`, body, `Field note for ${id}`); return { queued: true }; }
      await post(`/amo/task-cards/${id}/field-notes`, body); return { queued: false };
    },
    onSuccess: r => { toast(r.queued ? 'Field note encrypted and queued for sync' : 'Field note recorded', r.queued ? 'cyan' : 'green'); setFieldNote(''); if (!r.queued) void qc.invalidateQueries({ queryKey: ['task-cards','field-notes',id] }); }
  });

  const [toolIds, setToolIds] = useState<string[]>([]);
  const tools = useQuery({ queryKey: ['stores', 'tools'], queryFn: () => api<ToolDto[]>('/amo/tools'), enabled: !!id, retry: false });
  const passkeys = useQuery({ queryKey: ['passkeys'], queryFn: () => api<PasskeyDto[]>('/platform/passkeys'), staleTime: 60_000 });
  const withPasskey = passkeysSupported() && (passkeys.data?.length ?? 0) > 0;
  const sign = useMutation({
    // With a passkey, each stamp is confirmed on the device (bound to this step and these tools).
    mutationFn: (n: number) => signWithPasskey(withPasskey,
      () => post<PasskeyAssertionOptionsDto>(`/amo/task-cards/${id}/steps/${n}/sign/challenge`, { toolIds }),
      passkey => post<TaskCardDto>(`/amo/task-cards/${id}/steps/${n}/sign`, { toolIds, passkey })),
    onSuccess: (_c, n) => { toast(`Step ${n} stamped and signed`, 'cyan'); void refresh(); }
  });
  // Two steps with a passkey: fetch the challenge and show exactly what is being approved, then the device signs it.
  const [approval, setApproval] = useState<PasskeyAssertionOptionsDto | null>(null);
  const prepare = useMutation({
    mutationFn: () => post<PasskeyAssertionOptionsDto>(`/amo/task-cards/${id}/crs/challenge`),
    onSuccess: o => setApproval(o)
  });
  const crs = useMutation({
    // With a passkey: the device signs a challenge bound to this card version (no re-login). Otherwise a
    // fresh password sign-in is required (STEP_UP_REQUIRED → reauthenticate).
    mutationFn: async () => {
      if (!withPasskey || !approval) return post<TaskCardDto>(`/amo/task-cards/${id}/crs`);
      const assertion = await confirmWithPasskey(approval);
      return post<TaskCardDto>(`/amo/task-cards/${id}/crs`, { passkey: { challengeId: approval.challengeId, assertion } });
    },
    onSettled: () => setApproval(null),
    onSuccess: c => { toast(`${c.crs?.number} issued — CAMO deferral will close`, 'green'); void refresh(); void qc.invalidateQueries({ queryKey: ['mel'] }); }
  });

  const d = q.data;
  const c = d?.card;
  const allStamped = c?.steps.every(s => s.stamp) ?? false;
  const stepUp = crs.error instanceof ApiRequestError && crs.error.code === 'STEP_UP_REQUIRED';
  const [resumed, setResumed] = useState(false);
  const [docError, setDocError] = useState<unknown>(null);

  // Back from re-authentication for this card: say so, and let the user issue the CRS in one click.
  useEffect(() => {
    if (id && takePendingStepUp('issue-crs', id)) setResumed(true);
  }, [id]);

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      eyebrow={c ? `Task card · ATA ${c.ata} · ${c.source.id}` : 'Task card'}
      title={c ? `${c.id} · ${c.tail}` : id ?? ''}
      tags={c && <><Pill tone={c.status === 'CERTIFIED' ? 'green' : 'mag'}>{c.status.replace('_', ' ')}</Pill><Pill>{c.trade.toLowerCase()}</Pill></>}
    >
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      {c && d && (
        <>
          <h3 style={{ margin: 0, font: '700 20px var(--f-disp)' }}>{c.title}</h3>
          <DL items={[['Aircraft', `${c.tail} · ${c.aircraftType}`], ['Issued', zulu(c.createdAt)]]} />

          {c.status !== 'CERTIFIED' && (
            <div className={`callout ${d.certification.allowed ? 'green' : 'red'}`}>
              <b>{d.certification.allowed ? 'You may certify this work' : 'You may not certify this work'}</b>
              <div className="sub">{d.certification.allowed ? d.certification.via : d.certification.reason}</div>
              <div className="note mono">{d.certification.rule} · {d.certification.basis}</div>
            </div>
          )}

          {(c.requirements.tools.length > 0 || c.requirements.parts.length > 0) && (
            <section className="dsec">
              <h3>Tools and parts</h3>
              {c.requirements.parts.length > 0 && (
                <div className="stack" style={{ gap: 4 }}>
                  {c.reservations.map((r, i) => (
                    <div key={i} className="row"><Pill tone={r.status === 'SHORT' ? 'red' : r.status === 'ISSUED' ? 'green' : 'cyan'}>{r.status.toLowerCase()}</Pill>
                      <span className="mono">{r.qty} × {r.partNo}</span><span className="note">{r.location}</span></div>
                  ))}
                </div>
              )}
              {c.requirements.tools.length > 0 && c.status !== 'CERTIFIED' && (
                <>
                  <p className="note" style={{ marginBottom: 0 }}>Required: {c.requirements.tools.join(', ')}. Tick the tools you use — they are recorded in the stamp, and an out-of-calibration tool is refused (Part-145.A.40).</p>
                  <div className="toolpick">
                    {(tools.data ?? []).filter(t => c.requirements.tools.some(rt => t.description.toLowerCase().includes(rt.toLowerCase().split(' ')[0]))).map(t => (
                      <label key={t.id} className={t.status === 'EXPIRED' ? 'bad' : ''}>
                        <input type="checkbox" checked={toolIds.includes(t.id)} onChange={e => setToolIds(ids => e.target.checked ? [...ids, t.id] : ids.filter(x => x !== t.id))} />
                        <span className="mono">{t.id}</span> {t.description} · {t.calibrationDue ? `cal. ${t.calibrationDue}` : 'no cal.'}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}

          <section className="dsec">
            <h3>Digital sign-off</h3>
            <div className="stack">
              {c.steps.map(s => (
                <div key={s.n} className={`step ${s.stamp ? 'done' : ''}`}>
                  <span className={`chk ${s.stamp ? 'on' : ''}`}>{s.stamp ? '✓' : ''}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{s.n}. {s.text}</b>
                    {s.stamp && (
                      <div className="stamp">
                        {s.stamp.name} · {s.stamp.licence} · {zulu(s.stamp.at)}{s.stamp.tools?.length ? ` · tools ${s.stamp.tools.join(', ')}` : ''} · sig {short(s.stamp.signature.payloadSha256)}
                      </div>
                    )}
                  </div>
                  {!s.stamp && c.status !== 'CERTIFIED' && (
                    <button className="btn pri" style={{ minHeight: 44 }} disabled={!d.permissions.signStep || sign.isPending} onClick={() => sign.mutate(s.n)}>Sign</button>
                  )}
                </div>
              ))}
            </div>
            <ErrorNote error={sign.error} />
          </section>

          {c.crs ? (
            <section className="dsec">
              <h3>Certificate of Release to Service</h3>
              <div className="callout green">
                <b>{c.crs.number}</b> issued {zulu(c.crs.at)} by {c.crs.name} ({c.crs.via})
              </div>
              <div className="row">
                {c.crs.documentId
                  ? <button className="btn" onClick={() => openDocument(c.crs!.documentId!).catch(setDocError)}>Open CRS (PDF)</button>
                  : <span className="note">Generating the CRS PDF…</span>}
              </div>
              <ErrorNote error={docError} />
              <div className="sigbox">
                alg {c.crs.signature.alg} · key {c.crs.signature.keyId}<br />
                payload sha256 {c.crs.signature.payloadSha256}<br />
                signature {c.crs.signature.signature}
              </div>
            </section>
          ) : (
            <>
              {resumed && !crs.isPending && (
                <div className="callout green"><b>Identity confirmed.</b> You can issue the CRS now.</div>
              )}
              <button className={`btn ${allStamped ? 'pri' : ''} big-btn`} disabled={!d.permissions.issueCrs || crs.isPending || prepare.isPending} onClick={() => (withPasskey ? prepare.mutate() : crs.mutate())}>
                {crs.isPending ? (withPasskey ? 'Confirm with your passkey…' : 'Issuing…') : withPasskey ? 'Issue CRS — confirm with passkey' : 'Issue Certificate of Release to Service'}
              </button>
              {!allStamped && <p className="note">Every step must be stamped before the CRS can be issued.</p>}
              {approval && (
                <div className="callout cyan">
                  <b>You are about to sign:</b>
                  <div className="sub">{approval.approving}</div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="btn pri" disabled={crs.isPending} onClick={() => crs.mutate()}>Confirm with passkey</button>
                    <button className="btn ghost" onClick={() => setApproval(null)}>Cancel</button>
                  </div>
                </div>
              )}
              <ErrorNote error={prepare.error} />
              {stepUp ? (
                <div className="callout amber">
                  <b>Confirm your identity to release the aircraft.</b>
                  <div className="sub">A CRS needs a sign-in from the last few minutes — or a passkey (add one under Passkeys in the top bar, then no re-login is needed). You will come straight back to this card.</div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="btn pri" onClick={() => void reauthenticate({ action: 'issue-crs', target: c.id })}>Sign in again</button>
                  </div>
                </div>
              ) : <ErrorNote error={crs.error} />}
            </>
          )}

          <section className="dsec">
            <h3>Structured execution evidence</h3>
            <p className="note">Measurements, interruptions, part changes, consumables, ground tests and rework are recorded separately from certification stamps. Failed/rejected evidence and unresolved interruptions block CRS issuance.</p>
            <div className="stack" style={{gap:6}}>{(execution.data??[]).map(r=><div key={r.id} className="step"><div className="row"><Pill tone={r.result==='FAIL'||r.result==='REJECTED'?'red':r.result==='PASS'||r.result==='ACCEPTED'?'green':'cyan'}>{r.recordType}</Pill><b>Step {r.stepNo}</b>{r.valueNumber!==null&&<span className="mono">{r.valueNumber} {r.unit??''}</span>}{r.valueText&&<span>{r.valueText}</span>}{r.result&&<Pill tone={r.result==='FAIL'||r.result==='REJECTED'?'red':'green'}>{r.result}</Pill>}</div><div className="sub">{zulu(r.recordedAt)} · {r.recordedBy}{r.reference?` · ${r.reference}`:''}{r.inspectedBy?` · inspected ${r.inspectedBy}`:''}</div>{!r.inspectedBy&&(r.result==='FAIL'||r.recordType==='REWORK')&&<div className="row" style={{marginTop:5}}><button className="btn sm" onClick={()=>inspectExecution.mutate({recordId:r.id,result:'ACCEPTED'})}>Accept inspection</button><button className="btn sm" onClick={()=>inspectExecution.mutate({recordId:r.id,result:'REJECTED'})}>Reject</button></div>}</div>)}</div>
            {c.status!=='CERTIFIED'&&<div className="form-grid" style={{marginTop:8}}><select className="inp" value={execForm.stepNo} onChange={e=>setExecForm({...execForm,stepNo:e.target.value})}>{c.steps.map(s=><option key={s.n} value={s.n}>Step {s.n}</option>)}</select><select className="inp" value={execForm.recordType} onChange={e=>setExecForm({...execForm,recordType:e.target.value})}>{['MEASUREMENT','INTERRUPTION','RESUME','PART_CHANGE','CONSUMABLE','GROUND_TEST','REWORK'].map(x=><option key={x}>{x}</option>)}</select><input className="inp" placeholder="Text / finding" value={execForm.valueText} onChange={e=>setExecForm({...execForm,valueText:e.target.value})}/><input className="inp" type="number" step="any" placeholder="Value" value={execForm.valueNumber} onChange={e=>setExecForm({...execForm,valueNumber:e.target.value})}/><input className="inp" placeholder="Unit" value={execForm.unit} onChange={e=>setExecForm({...execForm,unit:e.target.value})}/><input className="inp" type="number" step="any" placeholder="Lower limit" value={execForm.lowerLimit} onChange={e=>setExecForm({...execForm,lowerLimit:e.target.value})}/><input className="inp" type="number" step="any" placeholder="Upper limit" value={execForm.upperLimit} onChange={e=>setExecForm({...execForm,upperLimit:e.target.value})}/><input className="inp" placeholder="Reference" value={execForm.reference} onChange={e=>setExecForm({...execForm,reference:e.target.value})}/><button className="btn" disabled={recordExecution.isPending} onClick={()=>recordExecution.mutate()}>Record evidence</button></div>}
            <ErrorNote error={execution.error??recordExecution.error??inspectExecution.error}/>
          </section>

          <section className="dsec">
            <h3>Field notes</h3>
            <p className="note">Operational notes may be captured offline and synchronize later. They are not certification signatures and cannot replace a step stamp or CRS.</p>
            <div className="stack" style={{ gap: 6 }}>
              {(notes.data ?? []).map((n: any) => <div key={n.id} className="callout"><b>{n.authorSubject.replace(/^user:/,'')}</b><div>{n.body}</div><div className="note mono">{zulu(n.clientCreatedAt)}</div></div>)}
            </div>
            {c.status !== 'CERTIFIED' && <div className="row" style={{ marginTop: 8 }}><textarea className="inp" style={{ minHeight: 72, flex: 1 }} maxLength={4000} value={fieldNote} onChange={e => setFieldNote(e.target.value)} placeholder="Finding, measurement, access note, or handover information…"/><button className="btn" disabled={!fieldNote.trim() || addNote.isPending} onClick={() => addNote.mutate()}>Add note</button></div>}
            <ErrorNote error={addNote.error} />
          </section>

          <section className="dsec">
            <h3>Attachments</h3>
            <Attachments ownerType="task_card" ownerId={c.id} canAttach={c.status !== 'CERTIFIED'} initial={c.attachments} />
          </section>

          <section className="dsec">
            <h3>Audit trail <span className="note mono">chain: amo</span></h3>
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

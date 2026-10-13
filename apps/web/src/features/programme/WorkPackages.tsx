import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { AuditEntryDto, HangarBayDto, WorkPackageDto } from '@aeroos/contracts';
import { api, post } from '../../lib/api';
import { short, zulu } from '../../lib/format';
import { useUi } from '../../lib/store';
import { Card, DL, Drawer, ErrorNote, Head, Pill } from '../../components/ui';

const tone: Record<string, string> = { DRAFT: '', PLANNED: 'cyan', RELEASED: 'mag', COMPLETED: 'green', CANCELLED: 'red' };
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function WorkPackages() {
  const { wp } = useSearch({ from: '/camo/work-packages' });
  const navigate = useNavigate({ from: '/camo/work-packages' });
  const q = useQuery({ queryKey: ['programme', 'wps'], queryFn: () => api<WorkPackageDto[]>('/camo/work-packages') });
  const bays = useQuery({ queryKey: ['programme','bays'], queryFn: () => api<HangarBayDto[]>('/camo/planning/bays') });
  const qc = useQueryClient(); const toast = useUi(s => s.toast); const [station,setStation]=useState('ENGM'); const [bayCode,setBayCode]=useState(''); const [bayName,setBayName]=useState('');
  const refreshBays = () => qc.invalidateQueries({ queryKey:['programme','bays'] });
  const addBay = useMutation({ mutationFn: () => post<HangarBayDto>('/camo/planning/bays', { station, code: bayCode, name: bayName }), onSuccess: b => { toast(`${b.code} configured`, 'green'); setBayCode(''); setBayName(''); void refreshBays(); } });
  const bayState = useMutation({ mutationFn: (b: HangarBayDto) => post<HangarBayDto>(`/camo/planning/bays/${b.id}/state`, { active: !b.active }), onSuccess: b => { toast(`${b.code} ${b.active ? 'activated' : 'deactivated'}`, b.active ? 'green' : 'amber'); void refreshBays(); } });
  return (
    <>
      <Head crumb="CAMO / Planning" title="Work Packages"
        desc="Due items grouped for a hangar slot. Releasing a package sends every item to the AMO as a task card; each CRS records compliance and resets the item's interval." />
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      <Card title="Packages" meta={`${q.data?.length ?? 0}`} flush>
        <div className="tbl-wrap">
          <table className="t">
            <thead><tr><th>Package</th><th>Aircraft</th><th>Status</th><th>Slot</th><th>Items</th></tr></thead>
            <tbody>
              {(q.data ?? []).map(w => (
                <tr key={w.id} className="click" tabIndex={0} onClick={() => navigate({ search: { wp: w.id } })} onKeyDown={e => e.key === 'Enter' && navigate({ search: { wp: w.id } })}>
                  <td><b className="mono">{w.id}</b> {w.title}</td>
                  <td className="mono">{w.tail}</td>
                  <td><Pill tone={tone[w.status]}>{w.status.toLowerCase()}</Pill></td>
                  <td className="mono">{w.plannedStart ? `${w.bay} · ${zulu(w.plannedStart)} → ${zulu(w.plannedEnd!)}` : '—'}</td>
                  <td>{w.items.filter(i => i.complied).length}/{w.items.length} certified</td>
                </tr>
              ))}
              {q.data?.length === 0 && <tr><td colSpan={5} className="empty">No work packages yet — create one from the due list.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Hangar resources" meta={`${bays.data?.filter(b=>b.active).length ?? 0} active bays`}>
        <div className="stack" style={{gap:6}}>{(bays.data??[]).map(b=><div className="row" key={b.id}><Pill tone={b.active?'green':''}>{b.station} · {b.code}</Pill><span className="note">{b.name}</span><button className="btn sm ghost" disabled={bayState.isPending} onClick={()=>bayState.mutate(b)}>{b.active?'Deactivate':'Activate'}</button></div>)}</div>
        <div className="row" style={{marginTop:10,alignItems:'end'}}><div className="field"><label>Station</label><input className="inp" value={station} maxLength={4} onChange={e=>setStation(e.target.value.toUpperCase())}/></div><div className="field"><label>Bay code</label><input className="inp" value={bayCode} onChange={e=>setBayCode(e.target.value.toUpperCase())}/></div><div className="field"><label>Name</label><input className="inp" value={bayName} onChange={e=>setBayName(e.target.value)}/></div><button className="btn" disabled={station.length!==4||!bayCode||!bayName||addBay.isPending} onClick={()=>addBay.mutate()}>Add bay</button></div>
        <ErrorNote error={addBay.error ?? bayState.error}/>
      </Card>
      <MaintenanceShifts defaultStation={station} />
      <WpDrawer id={wp ?? null} onClose={() => navigate({ search: { wp: undefined } })} />
    </>
  );
}


type MaintenanceShift={id:string;station:string;name:string;startsAt:string;endsAt:string;capacity:{trade:string;hours:number}[]};
function MaintenanceShifts({defaultStation}:{defaultStation:string}){
  const qc=useQueryClient(),toast=useUi(s=>s.toast);const [station,setStation]=useState(defaultStation);const [name,setName]=useState('');
  const now=new Date(),later=new Date(Date.now()+8*3600000);const [start,setStart]=useState(local(now)),[end,setEnd]=useState(local(later));
  const [cap,setCap]=useState<Record<string,string>>({MECHANICAL:'',POWERPLANT:'',AVIONICS:'',STRUCTURES:''});
  const q=useQuery({queryKey:['production','shifts',station],queryFn:()=>api<MaintenanceShift[]>(`/amo/production/shifts?station=${encodeURIComponent(station)}`),enabled:station.length===4});
  const add=useMutation({mutationFn:()=>post('/amo/production/shifts',{station,name,startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString(),capacity:Object.entries(cap).filter(([,v])=>Number(v)>0).map(([trade,hours])=>({trade,hours:Number(hours)}))}),onSuccess:()=>{toast('Maintenance shift created','green');setName('');void qc.invalidateQueries({queryKey:['production','shifts']})}});
  const capacity=Object.entries(cap).filter(([,v])=>Number(v)>0);
  return <Card title="Maintenance shifts" meta={`${q.data?.length??0} configured for ${station}`}>
    <div className="row" style={{flexWrap:'wrap',alignItems:'end'}}><div className="field"><label>Station</label><input className="inp mono" maxLength={4} value={station} onChange={e=>setStation(e.target.value.toUpperCase())}/></div><div className="field"><label>Shift name</label><input className="inp" value={name} onChange={e=>setName(e.target.value)}/></div><div className="field"><label>Start</label><input className="inp" type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></div><div className="field"><label>End</label><input className="inp" type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/></div></div>
    <div className="row" style={{marginTop:8,flexWrap:'wrap'}}>{Object.keys(cap).map(t=><div className="field" key={t}><label>{t} hours</label><input className="inp" style={{width:110}} type="number" min="0" step="0.5" value={cap[t]} onChange={e=>setCap(x=>({...x,[t]:e.target.value}))}/></div>)}<button className="btn" disabled={station.length!==4||name.trim().length<2||capacity.length===0||new Date(end)<=new Date(start)||add.isPending} onClick={()=>add.mutate()}>Add shift</button></div>
    <div className="stack" style={{gap:6,marginTop:10}}>{(q.data??[]).map(x=><div className="row" key={x.id}><Pill tone="cyan">{x.name}</Pill><span className="note">{zulu(x.startsAt)} → {zulu(x.endsAt)} · {x.capacity.map(c=>`${c.trade} ${c.hours}h`).join(' · ')}</span></div>)}</div><ErrorNote error={q.error??add.error}/>
  </Card>
}

function WpDrawer({ id, onClose }: { id: string | null; onClose(): void }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const q = useQuery({ queryKey: ['programme', 'wp', id], queryFn: () => api<{ wp: WorkPackageDto; permissions: { manage: boolean }; audit: AuditEntryDto[] }>(`/camo/work-packages/${id}`), enabled: !!id });
  const bays = useQuery({ queryKey: ['programme','bays', q.data?.wp.station], queryFn: () => api<HangarBayDto[]>(`/camo/planning/bays?station=${encodeURIComponent(q.data!.wp.station)}`), enabled: !!q.data?.wp.station });
  const [bay, setBay] = useState('');
  const [available, setAvailable] = useState<Record<string, number>>({});
  const [depBefore, setDepBefore] = useState(''); const [depAfter, setDepAfter] = useState(''); const [unfreezeReason, setUnfreezeReason] = useState('');
  const [start, setStart] = useState(() => { const d = new Date(); d.setHours(22, 0, 0, 0); return local(d); });
  const [end, setEnd] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(5, 0, 0, 0); return local(d); });
  const refresh = () => qc.invalidateQueries({ queryKey: ['programme'] });
  const plan = useMutation({
    mutationFn: () => post<WorkPackageDto>(`/camo/work-packages/${id}/plan`, { bay: bay || bays.data?.[0]?.code || '', start: new Date(start).toISOString(), end: new Date(end).toISOString() }),
    onSuccess: w => { toast(`${w.id} planned in ${w.bay}`, 'cyan'); void refresh(); }
  });
  const readiness = useMutation({
    mutationFn: (dependencies?: WorkPackageDto['dependencies']) => post<WorkPackageDto>(`/camo/work-packages/${id}/readiness`, { resources: (w?.resourcePlan ?? []).map(r => ({ ...r, availableHours: available[r.trade] ?? r.availableHours })), dependencies: dependencies ?? w?.dependencies ?? [] }),
    onSuccess: x => { toast(`${x.id} readiness plan saved`, 'cyan'); setDepBefore(''); setDepAfter(''); void refresh(); }
  });
  const freeze = useMutation({ mutationFn: () => post<WorkPackageDto>(`/camo/work-packages/${id}/freeze`), onSuccess: x => { toast(`${x.id} scope frozen`, 'green'); void refresh(); } });
  const unfreeze = useMutation({ mutationFn: () => post<WorkPackageDto>(`/camo/work-packages/${id}/unfreeze`, { reason: unfreezeReason }), onSuccess: x => { setUnfreezeReason(''); toast(`${x.id} reopened for planning`, 'amber'); void refresh(); } });
  const release = useMutation({
    mutationFn: () => post<WorkPackageDto>(`/camo/work-packages/${id}/release`),
    onSuccess: w => { toast(`${w.id} released — task cards on their way to the hangar`, 'green'); void refresh(); }
  });
  const d = q.data;
  const w = d?.wp;
  return (
    <Drawer open={!!id} onClose={onClose} eyebrow={w ? `Work package · ${w.station}` : 'Work package'} title={w ? `${w.id} · ${w.tail}` : id ?? ''}
      tags={w && <Pill tone={tone[w.status]}>{w.status}</Pill>}>
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      {w && d && (
        <>
          <h3 style={{ margin: 0, font: '700 20px var(--f-disp)' }}>{w.title}</h3>
          <DL items={[['Aircraft', `${w.tail} · ${w.aircraftType}`], ['Slot', w.plannedStart ? `${w.bay} · ${zulu(w.plannedStart)} → ${zulu(w.plannedEnd!)}` : 'not planned'], ['Created', `${zulu(w.createdAt)} · ${w.createdBy.replace(/^user:/, '')}`]]} />
          <section className="dsec">
            <h3>Items</h3>
            <div className="stack" style={{ gap: 6 }}>
              {w.items.map(i => (
                <div key={i.requirementId} className={`step ${i.complied ? 'done' : ''}`}>
                  <span className={`chk ${i.complied ? 'on' : ''}`}>{i.complied ? '✓' : ''}</span>
                  <div style={{ flex: 1 }}><b>{i.ref}</b> <span className="note">ATA {i.ata}</span><div className="sub">{i.title}</div>
                    {i.complied && <div className="stamp">{i.complied.crsNumber} · {zulu(i.complied.at)}</div>}</div>
                </div>
              ))}
            </div>
          </section>
          {d.permissions.manage && (w.status === 'DRAFT' || w.status === 'PLANNED') && (
            <section className="dsec">
              <h3>Hangar slot</h3>
              <div className="form-grid">
                <div className="field"><label htmlFor="wp-bay">Bay</label>
                  <select id="wp-bay" className="inp" value={bay || bays.data?.[0]?.code || ''} onChange={e => setBay(e.target.value)}>{(bays.data ?? []).filter(b=>b.active).map(b => <option key={b.id} value={b.code}>{b.code} — {b.name}</option>)}</select></div>
                <div className="field"><label htmlFor="wp-s">Start (local)</label><input id="wp-s" type="datetime-local" className="inp" value={start} onChange={e => setStart(e.target.value)} /></div>
                <div className="field"><label htmlFor="wp-e">End (local)</label><input id="wp-e" type="datetime-local" className="inp" value={end} onChange={e => setEnd(e.target.value)} /></div>
              </div>
              {(bays.data ?? []).length === 0 && <div className="callout amber">No active bay is configured at {w.station}. A maintenance planner must configure one before the package can be planned.</div>}
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn" disabled={plan.isPending || !(bays.data ?? []).length || !!w.frozenAt} onClick={() => plan.mutate()}>{w.status === 'PLANNED' ? 'Re-plan' : 'Plan'}</button>
                <span className="note">The OCC sees the slot on its timeline; flights inside it get a warning.</span>
              </div>
              <ErrorNote error={plan.error} />
            </section>
          )}
          {d.permissions.manage && w.status === 'PLANNED' && <section className="dsec">
            <h3>Release readiness</h3>
            <div className="stack" style={{gap:8}}>{w.resourcePlan.map(r => <div className="row" key={r.trade}><b style={{width:120}}>{r.trade}</b><span className="note">required {r.requiredHours} h</span><label className="row">available <input className="inp sm" style={{width:90}} type="number" min="0" step="0.5" value={available[r.trade] ?? r.availableHours} disabled={!!w.frozenAt} onChange={e=>setAvailable(v=>({...v,[r.trade]:Number(e.target.value)}))}/></label></div>)}</div>
            <h4>Task dependencies</h4>
            {w.dependencies.length ? <div className="stack" style={{gap:6}}>{w.dependencies.map((dep,n) => { const before=w.items.find(i=>i.requirementId===dep.beforeRequirementId); const after=w.items.find(i=>i.requirementId===dep.afterRequirementId); return <div className="row" key={`${dep.beforeRequirementId}-${dep.afterRequirementId}`}><span className="mono">{before?.ref ?? dep.beforeRequirementId}</span><span>must precede</span><span className="mono">{after?.ref ?? dep.afterRequirementId}</span>{!w.frozenAt&&<button className="btn sm ghost" disabled={readiness.isPending} onClick={()=>readiness.mutate(w.dependencies.filter((_,i)=>i!==n))}>Remove</button>}</div>})}</div> : <div className="note">No execution dependencies defined.</div>}
            {!w.frozenAt && <div className="row" style={{marginTop:8}}><select className="inp" value={depBefore} onChange={e=>setDepBefore(e.target.value)}><option value="">Predecessor task…</option>{w.items.map(i=><option value={i.requirementId} key={i.requirementId}>{i.ref} — {i.title}</option>)}</select><select className="inp" value={depAfter} onChange={e=>setDepAfter(e.target.value)}><option value="">Successor task…</option>{w.items.map(i=><option value={i.requirementId} key={i.requirementId}>{i.ref} — {i.title}</option>)}</select><button className="btn" disabled={!depBefore||!depAfter||depBefore===depAfter||readiness.isPending} onClick={()=>readiness.mutate([...(w.dependencies??[]),{beforeRequirementId:depBefore,afterRequirementId:depAfter}])}>Add dependency</button></div>}
            <div className="row" style={{marginTop:10}}>
              {!w.frozenAt && <button className="btn" disabled={readiness.isPending} onClick={()=>readiness.mutate()}>Save readiness</button>}
              {!w.frozenAt && <button className="btn pri" disabled={freeze.isPending} onClick={()=>freeze.mutate()}>Freeze scope</button>}
              {w.frozenAt && <><Pill tone="green">scope frozen</Pill><span className="note">{w.frozenBy} · {zulu(w.frozenAt)}</span><input className="inp" style={{maxWidth:280}} value={unfreezeReason} onChange={e=>setUnfreezeReason(e.target.value)} placeholder="Reason to reopen planning"/><button className="btn" disabled={unfreezeReason.trim().length<5||unfreeze.isPending} onClick={()=>unfreeze.mutate()}>Unfreeze</button><button className="btn pri" disabled={release.isPending} onClick={()=>release.mutate()}>Release to AMO</button></>}
            </div>
            <ErrorNote error={readiness.error ?? freeze.error ?? unfreeze.error ?? release.error}/>
          </section>}
          {(w.status === 'RELEASED' || w.status === 'COMPLETED') && <ProductionPanel wpId={w.id} canManage={d.permissions.manage}/>}
          <section className="dsec">
            <h3>Audit trail <span className="note mono">chain: camo</span></h3>
            <div className="timeline">
              {d.audit.map(a => <div key={a.seq} className="tl"><i /><div><b>{a.action}</b> <span className="note">{zulu(a.at)} · {a.actor}</span><div className="h">#{a.seq} {short(a.hash)}</div></div></div>)}
            </div>
          </section>
        </>
      )}
    </Drawer>
  );
}

type ProductionDetail={production:{status:string;holdReason:string|null;plannedHours:{trade:string;hours:number}[]};shifts:{id:string;name:string;startsAt:string;endsAt:string;capacity:{trade:string;hours:number}[]}[];allocations:{id:number;shiftId:string;trade:string;hours:number}[];criticalPath:{hours:number;requirementIds:string[]};milestones:{id:number;code:string;title:string;plannedAt:string;status:string;actualAt:string|null}[];nonRoutines:{id:string;title:string;description:string;status:string;trade:string;estimatedHours:number;actualMinutes:number;disposition:string|null;taskCardId:string|null}[];labour:{id:number;taskCardId:string|null;nonRoutineId:string|null;personnelId:string;trade:string;startedAt:string;endedAt:string;minutes:number;note:string|null}[];cards:{id:string;title:string;trade:string;status:string;requirementId:string;critical:boolean;partsReady:boolean;toolsReady:boolean;predecessors:string[]}[];readyNow:string[];metrics:{cards:number;certified:number;openNonRoutines:number;actualHours:number;plannedShiftHours:number}};
function ProductionPanel({wpId,canManage}:{wpId:string;canManage:boolean}){
  const qc=useQueryClient();const q=useQuery({queryKey:['production',wpId],queryFn:()=>api<ProductionDetail>(`/amo/production/work-packages/${wpId}`)});const [hold,setHold]=useState('');const [shiftId,setShiftId]=useState('');const [trade,setTrade]=useState('MECHANICAL');const [hours,setHours]=useState('0');const [nr,setNr]=useState({taskCardId:'',title:'',description:'',ata:'',trade:'MECHANICAL',estimatedHours:'0'});const [nrDisposition,setNrDisposition]=useState<Record<string,string>>({});const [lab,setLab]=useState({sourceType:'TASK' as 'TASK'|'NR',sourceId:'',personnelId:'',trade:'MECHANICAL',startedAt:local(new Date()),endedAt:local(new Date(Date.now()+3600000)),note:''});const refresh=()=>qc.invalidateQueries({queryKey:['production',wpId]});
  const floor=useQuery({queryKey:['production','floor',wpId],queryFn:()=>api<{zones:{id:string;zone:string;plannedHours:number;actualMinutes:number;status:string}[];panels:{id:string;panel:string;zone:string|null;status:string}[]}>(`/amo/maintenance/work-packages/${wpId}/floor`)});const [zone,setZone]=useState({zone:'',plannedHours:'0'});const [panel,setPanel]=useState({panel:'',zone:''});
  const addZone=useMutation({mutationFn:()=>post(`/amo/maintenance/work-packages/${wpId}/zones`,{zone:zone.zone,plannedHours:Number(zone.plannedHours)}),onSuccess:()=>{setZone({zone:'',plannedHours:'0'});void qc.invalidateQueries({queryKey:['production','floor',wpId]})}});const zoneState=useMutation({mutationFn:(x:{zone:string,state:string;actualMinutes?:number})=>post(`/amo/maintenance/work-packages/${wpId}/zones/${encodeURIComponent(x.zone)}/state`,{state:x.state,actualMinutes:x.actualMinutes}),onSuccess:()=>void qc.invalidateQueries({queryKey:['production','floor',wpId]})});const addPanel=useMutation({mutationFn:()=>post(`/amo/maintenance/work-packages/${wpId}/panels`,{panel:panel.panel,zone:panel.zone||null}),onSuccess:()=>{setPanel({panel:'',zone:''});void qc.invalidateQueries({queryKey:['production','floor',wpId]})}});const panelState=useMutation({mutationFn:(x:{panel:string,state:string})=>post(`/amo/maintenance/work-packages/${wpId}/panels/${encodeURIComponent(x.panel)}/state`,{state:x.state}),onSuccess:()=>void qc.invalidateQueries({queryKey:['production','floor',wpId]})});
  const allocate=useMutation({mutationFn:()=>post(`/amo/production/work-packages/${wpId}/shifts`,{shiftId,trade,hours:Number(hours)}),onSuccess:()=>void refresh()});const raiseNr=useMutation({mutationFn:()=>post(`/amo/production/work-packages/${wpId}/non-routines`,{...nr,taskCardId:nr.taskCardId||null,ata:nr.ata||null,estimatedHours:Number(nr.estimatedHours)}),onSuccess:()=>{setNr(x=>({...x,taskCardId:'',title:'',description:'',ata:'',estimatedHours:'0'}));void refresh()}});const nrState=useMutation({mutationFn:(x:{id:string;state:'IN_WORK'|'CLOSED'|'CANCELLED'})=>post(`/amo/production/work-packages/${wpId}/non-routines/${x.id}/state`,{state:x.state,disposition:nrDisposition[x.id]||undefined}),onSuccess:()=>void refresh()});const labour=useMutation({mutationFn:()=>post(`/amo/production/work-packages/${wpId}/labour`,{taskCardId:lab.sourceType==='TASK'?lab.sourceId:null,nonRoutineId:lab.sourceType==='NR'?lab.sourceId:null,personnelId:lab.personnelId,trade:lab.trade,startedAt:new Date(lab.startedAt).toISOString(),endedAt:new Date(lab.endedAt).toISOString(),note:lab.note||null}),onSuccess:()=>{setLab(x=>({...x,sourceId:'',personnelId:'',note:''}));void refresh()}});const state=useMutation({mutationFn:(x:'START'|'HOLD'|'RESUME')=>post(`/amo/production/work-packages/${wpId}/state`,{state:x,reason:x==='HOLD'?hold||undefined:undefined}),onSuccess:()=>void refresh()});const milestone=useMutation({mutationFn:(code:string)=>post(`/amo/production/work-packages/${wpId}/milestones/${code}/complete`),onSuccess:()=>void refresh()});
  const x=q.data;if(q.error)return <section className="dsec"><h3>Production control</h3><ErrorNote error={q.error}/></section>;if(!x)return null;
  return <section className="dsec"><h3>Production control</h3><div className="row"><Pill tone={x.production.status==='COMPLETE'?'green':x.production.status==='HOLD'?'amber':'cyan'}>{x.production.status}</Pill><span className="note">{x.metrics.certified}/{x.metrics.cards} cards certified · {x.metrics.openNonRoutines} open non-routines · critical path {x.criticalPath.hours} h · {x.metrics.actualHours} h actual / {x.metrics.plannedShiftHours} h shift capacity</span></div>
  {canManage&&<div className="row" style={{marginTop:8}}>{x.production.status==='READY'&&<button className="btn pri" onClick={()=>state.mutate('START')}>Start production</button>}{x.production.status==='IN_PROGRESS'&&<><input className="inp" placeholder="Hold reason" value={hold} onChange={e=>setHold(e.target.value)}/><button className="btn" disabled={hold.trim().length<5} onClick={()=>state.mutate('HOLD')}>Place on hold</button></>}{x.production.status==='HOLD'&&<button className="btn" onClick={()=>state.mutate('RESUME')}>Resume</button>}</div>}
  <h4>Labour allocation</h4><div className="stack" style={{gap:5}}>{x.production.plannedHours.map(d=>{const a=x.allocations.filter(v=>v.trade===d.trade).reduce((n,v)=>n+v.hours,0);return <div className="row" key={d.trade}><b style={{width:120}}>{d.trade}</b><span className="note">allocated {a} / required {d.hours} h</span><Pill tone={a>=d.hours?'green':'amber'}>{a>=d.hours?'covered':'short'}</Pill></div>})}</div>{canManage&&['READY','HOLD'].includes(x.production.status)&&<div className="row" style={{marginTop:7,flexWrap:'wrap'}}><select className="inp" value={shiftId} onChange={e=>setShiftId(e.target.value)}><option value="">Maintenance shift…</option>{x.shifts.map(v=><option key={v.id} value={v.id}>{v.name} · {zulu(v.startsAt)}–{zulu(v.endsAt)}</option>)}</select><select className="inp" value={trade} onChange={e=>setTrade(e.target.value)}>{['MECHANICAL','POWERPLANT','AVIONICS','STRUCTURES'].map(v=><option key={v}>{v}</option>)}</select><input className="inp" style={{width:90}} type="number" min="0" step="0.5" value={hours} onChange={e=>setHours(e.target.value)}/><button className="btn sm" disabled={!shiftId||allocate.isPending} onClick={()=>allocate.mutate()}>Set allocation</button></div>}<ErrorNote error={allocate.error}/>
  <h4>Milestones</h4><div className="stack" style={{gap:6}}>{x.milestones.map(m=><div className="row" key={m.id}><Pill tone={m.status==='COMPLETE'?'green':''}>{m.status}</Pill><span style={{flex:1}}>{m.title} <span className="note">target {zulu(m.plannedAt)}</span></span>{canManage&&m.status!=='COMPLETE'&&<button className="btn sm ghost" onClick={()=>milestone.mutate(m.code)}>Complete</button>}</div>)}</div>
  <h4>Non-routines</h4>{canManage&&<div className="stack" style={{gap:6}}><div className="row" style={{flexWrap:'wrap'}}><select className="inp" value={nr.taskCardId} onChange={e=>setNr({...nr,taskCardId:e.target.value})}><option value="">Package-level finding</option>{x.cards.map(c=><option key={c.id} value={c.id}>{c.id} · {c.title}</option>)}</select><input className="inp" placeholder="ATA" value={nr.ata} onChange={e=>setNr({...nr,ata:e.target.value})}/><select className="inp" value={nr.trade} onChange={e=>setNr({...nr,trade:e.target.value})}>{['MECHANICAL','POWERPLANT','AVIONICS','STRUCTURES'].map(v=><option key={v}>{v}</option>)}</select><input className="inp" type="number" min="0" step="0.5" placeholder="Estimated hours" value={nr.estimatedHours} onChange={e=>setNr({...nr,estimatedHours:e.target.value})}/></div><input className="inp" placeholder="Finding title" value={nr.title} onChange={e=>setNr({...nr,title:e.target.value})}/><textarea className="inp" placeholder="Finding / non-routine description" value={nr.description} onChange={e=>setNr({...nr,description:e.target.value})}/><button className="btn sm" disabled={nr.title.trim().length<3||nr.description.trim().length<10||raiseNr.isPending} onClick={()=>raiseNr.mutate()}>Raise non-routine</button></div>}<div className="stack" style={{gap:6,marginTop:8}}>{x.nonRoutines.map(n=><div key={n.id} className="step"><div className="row"><b className="mono">{n.id}</b><Pill tone={n.status==='CLOSED'?'green':n.status==='IN_WORK'?'cyan':'amber'}>{n.status}</Pill><span>{n.title}</span><span className="note">{n.trade} · {n.estimatedHours} h planned · {(n.actualMinutes/60).toFixed(1)} h actual</span></div><div className="note">{n.description}</div>{canManage&&!['CLOSED','CANCELLED'].includes(n.status)&&<div className="row" style={{marginTop:5}}>{n.status==='OPEN'&&<button className="btn sm" onClick={()=>nrState.mutate({id:n.id,state:'IN_WORK'})}>Start</button>}<input className="inp" placeholder="Disposition / cancellation reason" value={nrDisposition[n.id]??''} onChange={e=>setNrDisposition(v=>({...v,[n.id]:e.target.value}))}/>{n.status==='IN_WORK'&&<button className="btn sm pri" disabled={(nrDisposition[n.id]??'').trim().length<5} onClick={()=>nrState.mutate({id:n.id,state:'CLOSED'})}>Close</button>}<button className="btn sm" disabled={(nrDisposition[n.id]??'').trim().length<5} onClick={()=>nrState.mutate({id:n.id,state:'CANCELLED'})}>Cancel</button></div>}</div>)}</div><ErrorNote error={raiseNr.error??nrState.error}/>
  <h4>Labour actuals</h4>{canManage&&<div className="row" style={{flexWrap:'wrap',alignItems:'end'}}><select className="inp" value={lab.sourceType} onChange={e=>setLab({...lab,sourceType:e.target.value as 'TASK'|'NR',sourceId:''})}><option value="TASK">Task card</option><option value="NR">Non-routine</option></select><select className="inp" value={lab.sourceId} onChange={e=>setLab({...lab,sourceId:e.target.value})}><option value="">Work item…</option>{(lab.sourceType==='TASK'?x.cards:x.nonRoutines).map(v=><option key={v.id} value={v.id}>{v.id} · {v.title}</option>)}</select><input className="inp" placeholder="Personnel ID" value={lab.personnelId} onChange={e=>setLab({...lab,personnelId:e.target.value})}/><select className="inp" value={lab.trade} onChange={e=>setLab({...lab,trade:e.target.value})}>{['MECHANICAL','POWERPLANT','AVIONICS','STRUCTURES'].map(v=><option key={v}>{v}</option>)}</select><input className="inp" type="datetime-local" value={lab.startedAt} onChange={e=>setLab({...lab,startedAt:e.target.value})}/><input className="inp" type="datetime-local" value={lab.endedAt} onChange={e=>setLab({...lab,endedAt:e.target.value})}/><input className="inp" placeholder="Work note" value={lab.note} onChange={e=>setLab({...lab,note:e.target.value})}/><button className="btn sm" disabled={!lab.sourceId||lab.personnelId.trim().length<2||new Date(lab.endedAt)<=new Date(lab.startedAt)||labour.isPending} onClick={()=>labour.mutate()}>Record labour</button></div>}<div className="stack" style={{gap:4,marginTop:6}}>{x.labour.slice(0,20).map(l=><div className="row note" key={l.id}><span className="mono">{l.personnelId}</span><span>{l.trade}</span><span>{l.taskCardId??l.nonRoutineId}</span><span>{(l.minutes/60).toFixed(1)} h</span><span>{l.note}</span></div>)}</div><ErrorNote error={labour.error}/>
  <h4>Zones & access</h4><div className="stack" style={{gap:5}}>{(floor.data?.zones??[]).map(z=><div className="row" key={z.id}><b className="mono" style={{width:90}}>{z.zone}</b><Pill tone={z.status==='CLOSED'?'green':z.status==='IN_PROGRESS'?'cyan':'amber'}>{z.status}</Pill><span className="note">{z.plannedHours} h planned · {(z.actualMinutes/60).toFixed(1)} h actual</span>{canManage&&z.status!=='CLOSED'&&<><button className="btn sm" onClick={()=>zoneState.mutate({zone:z.zone,state:'IN_PROGRESS'})}>Work</button><button className="btn sm" onClick={()=>zoneState.mutate({zone:z.zone,state:'INSPECTION'})}>Inspect</button><button className="btn sm" onClick={()=>zoneState.mutate({zone:z.zone,state:'CLOSED'})}>Close</button></>}</div>)}{canManage&&<div className="row"><input className="inp" placeholder="Zone" value={zone.zone} onChange={e=>setZone({...zone,zone:e.target.value})}/><input className="inp" type="number" min="0" step="0.5" placeholder="Planned h" value={zone.plannedHours} onChange={e=>setZone({...zone,plannedHours:e.target.value})}/><button className="btn sm" disabled={!zone.zone} onClick={()=>addZone.mutate()}>Add zone</button></div>}</div><div className="stack" style={{gap:5,marginTop:8}}>{(floor.data?.panels??[]).map(p=><div className="row" key={p.id}><span className="mono" style={{width:120}}>{p.panel}</span><span className="note">{p.zone??'unassigned'}</span><Pill tone={p.status==='CLOSED'?'green':'amber'}>{p.status}</Pill>{canManage&&<><button className="btn sm" onClick={()=>panelState.mutate({panel:p.panel,state:'OPEN'})}>Open</button><button className="btn sm" onClick={()=>panelState.mutate({panel:p.panel,state:'TEMP_CLOSED'})}>Temp close</button><button className="btn sm" onClick={()=>panelState.mutate({panel:p.panel,state:'CLOSED'})}>Close</button></>}</div>)}{canManage&&<div className="row"><input className="inp" placeholder="Access panel" value={panel.panel} onChange={e=>setPanel({...panel,panel:e.target.value})}/><input className="inp" placeholder="Zone" value={panel.zone} onChange={e=>setPanel({...panel,zone:e.target.value})}/><button className="btn sm" disabled={!panel.panel} onClick={()=>addPanel.mutate()}>Add panel</button></div>}</div><ErrorNote error={floor.error??addZone.error??zoneState.error??addPanel.error??panelState.error}/>
  <h4>Execution readiness</h4><div className="stack" style={{gap:5}}>{x.cards.map(c=><div key={c.id} className="row"><span className="mono" style={{width:100}}>{c.id}</span><span style={{flex:1}}>{c.title}</span>{c.critical&&<Pill tone="mag">critical</Pill>}<Pill tone={c.partsReady?'green':'red'}>parts</Pill><Pill tone={c.toolsReady?'green':'red'}>tools</Pill><Pill tone={x.readyNow.includes(c.id)?'green':''}>{c.status}</Pill></div>)}</div><ErrorNote error={state.error??milestone.error??allocate.error}/></section>
}

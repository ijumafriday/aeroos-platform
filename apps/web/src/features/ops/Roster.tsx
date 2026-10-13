import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { CabinStaffingDto, RosterCrewRowDto, RosterDutyDto, RosterGridDto, RosterPublicationDto, RosterRunDto, UnavailabilityKind } from '@aeroos/contracts';
import { api, post } from '../../lib/api';
import { useUi } from '../../lib/store';
import { Card, ErrorNote, Head, Pill } from '../../components/ui';

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => isoDay(new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY));
const hhmm = (iso: string) => iso.slice(11, 16);
const hours = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const who = (s: string | null) => (s ?? '').replace(/^user:/, '');
export const fatigueTone: Record<string, string> = { LOW: 'green', MODERATE: 'amber', HIGH: 'red' };
const ftlTone: Record<string, string> = { OK: 'green', DISCRETION: 'amber', VIOLATION: 'red' };

/** Crew rostering: the period grid, the roster builder, leave and days off, and publication. */
export function Roster() {
  const search = useSearch({ from: '/ops/roster' });
  const navigate = useNavigate({ from: '/ops/roster' });
  const from = search.from ?? isoDay(new Date());
  const to = search.to ?? addDays(from, 6);
  const q = useQuery({ queryKey: ['roster', from, to], queryFn: () => api<RosterGridDto>(`/ops/roster?from=${from}&to=${to}`) });
  const g = q.data;
  const days = Array.from({ length: Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1) }, (_, i) => addDays(from, i));
  return (
    <>
      <Head crumb="Flight Ops / Crew Rostering" title="Crew Rostering"
        desc="The roster for a period: each crew member's duties with their flight-time-limitation status and an advisory fatigue indicator (window of circadian low, early starts, long duties, short rest); validated external FRMS assessments remain separate and can block publication when critical. The builder proposes crew for flights that have none — rank, type rating, base, leave and the FTL rulepack respected, flying spread fairly; nothing is booked until you accept. Publish at least 14 days ahead (ORO.FTL.110); later changes are shown to crew until acknowledged."
        actions={<>
          <input type="date" className="inp" value={from} aria-label="From" onChange={e => e.target.value && navigate({ search: { from: e.target.value, to: addDays(e.target.value, 6) } })} />
          <input type="date" className="inp" value={to} aria-label="To" onChange={e => e.target.value && navigate({ search: { from, to: e.target.value } })} />
        </>} />
      <ErrorNote error={q.error} />
      {g && <>
        <Actions g={g} />
        <Card title="Roster" meta={`${g.crew.length} crew · ${g.openFlights.length} flights without full crew`} flush>
          <div className="tbl-wrap"><table className="t roster">
            <thead><tr><th>Crew</th><th>Block</th>{days.map(d => <th key={d} className="mono">{d.slice(5)}</th>)}</tr></thead>
            <tbody>{g.crew.map(c => <CrewRow key={c.id} c={c} days={days} />)}</tbody>
          </table></div>
        </Card>
        <OpenFlights g={g} />
        <CabinComplement g={g} />
        <Runs g={g} />
        <Pairings g={g} />
        <Preferences g={g} />
        <Reserves g={g} />
        <Away g={g} />
      </>}
    </>
  );
}

function CrewRow({ c, days }: { c: RosterCrewRowDto; days: string[] }) {
  return (
    <tr>
      <td><b>{c.name}</b> <span className="note mono">{c.id} · {c.rank} · {c.base} · {c.qualifications.join('/')}</span> <Pill tone={ftlTone[c.status]}>{c.status.toLowerCase()}</Pill></td>
      <td className="mono">{hours(c.blockMinutes)}</td>
      {days.map(d => {
        const duties = c.duties.filter(x => x.legs[0] && x.legs[0].etd.slice(0, 10) === d);
        const dayMs = Date.parse(`${d}T00:00:00Z`);
        const away = c.away.find(a => Date.parse(a.start) < dayMs + DAY && Date.parse(a.end) > dayMs);
        return (
          <td key={d} className="mono" style={{ minWidth: 110, verticalAlign: 'top' }}>
            {away && !duties.length && <Pill tone="cyan">{away.kind.toLowerCase()}</Pill>}
            {duties.map(x => <DutyCell key={x.id} d={x} />)}
          </td>
        );
      })}
    </tr>
  );
}

function DutyCell({ d }: { d: RosterDutyDto }) {
  return (
    <div title={`${d.legs.map(l => `${l.flightNo} ${l.dep}-${l.arr} ${hhmm(l.etd)}Z`).join('\n')}\nFatigue ${d.fatigue}: ${d.fatigueReasons.join('; ') || 'nothing notable'}`}>
      <span>{hhmm(d.report)}–{hhmm(d.dutyEnd)}</span> <Pill tone={fatigueTone[d.fatigueBand]}>{d.fatigue}</Pill>
      <div className="note">{d.legs.map(l => l.flightNo).join(' ')}</div>
    </div>
  );
}

function Actions({ g }: { g: RosterGridDto }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const [note, setNote] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['roster'] });
  const build = useMutation({ mutationFn: () => post<RosterRunDto>('/ops/roster/build', { from: g.from, to: g.to }),
    onSuccess: r => { toast(`${r.id}: ${r.assignments.length} assignments proposed, ${r.unfilled.length} open`, 'cyan'); void refresh(); } });
  const publish = useMutation({ mutationFn: () => post<RosterPublicationDto>('/ops/roster/publish', { from: g.from, to: g.to, note: note || undefined }),
    onSuccess: r => { toast(`Roster ${r.from} – ${r.to} published${r.notice ? ' (short notice)' : ''}`, r.notice ? 'amber' : 'green'); setNote(''); void refresh(); } });
  const published = g.publications[0];
  return (
    <Card title="Plan & publish" meta={published ? `published ${published.publishedAt.slice(0, 10)} by ${who(published.publishedBy)}` : 'not published'}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {g.permissions.build && <button className="btn" disabled={build.isPending} onClick={() => build.mutate()}>Build roster proposal for {g.from} – {g.to}</button>}
        {g.permissions.publish && <>
          <div className="field" style={{ flex: 1, minWidth: 240 }}><label htmlFor="pub-note">Note (required when less than 14 days ahead)</label>
            <input id="pub-note" className="inp" value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></div>
          <button className="btn pri" disabled={publish.isPending} onClick={() => publish.mutate()}>Publish {g.from} – {g.to}</button>
        </>}
      </div>
      {published?.notice && <div className="callout amber">{published.notice}{published.note ? ` Reason: ${published.note}` : ''}</div>}
      <ErrorNote error={build.error ?? publish.error} />
    </Card>
  );
}

function OpenFlights({ g }: { g: RosterGridDto }) {
  if (!g.openFlights.length) return null;
  return (
    <Card title="Flights without full crew" meta={`${g.openFlights.length}`} flush>
      <div className="tbl-wrap"><table className="t">
        <thead><tr><th>Flight</th><th>Date</th><th>Route</th><th>ETD</th><th>Aircraft</th><th>Missing</th></tr></thead>
        <tbody>{g.openFlights.slice(0, 200).map(f => (
          <tr key={f.flightId}><td className="mono"><b>{f.flightNo}</b></td><td className="mono">{f.date}</td><td className="mono">{f.dep}–{f.arr}</td>
            <td className="mono">{hhmm(f.etd)}Z</td><td className="mono">{f.tail} · {f.aircraftType}</td><td>{f.missing.map(m => <Pill key={m} tone="amber">{m}</Pill>)}</td></tr>
        ))}</tbody>
      </table></div>
    </Card>
  );
}

function Runs({ g }: { g: RosterGridDto }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const [open, setOpen] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: (x: { id: string; accept: boolean }) => (x.accept ? post<RosterRunDto>(`/ops/roster/runs/${x.id}/accept`) : post<RosterRunDto>(`/ops/roster/runs/${x.id}/reject`)),
    onSuccess: r => { toast(`${r.id} ${r.status.toLowerCase()}`, r.status === 'ACCEPTED' ? 'green' : 'cyan'); void qc.invalidateQueries({ queryKey: ['roster'] }); void qc.invalidateQueries({ queryKey: ['crew'] }); }
  });
  if (!g.runs.length) return null;
  return (
    <Card title="Roster proposals" meta={`${g.runs.length}`}>
      <ErrorNote error={decide.error} />
      {g.runs.map(r => (
        <div key={r.id} className="block" style={{ marginBottom: 12 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <b className="mono">{r.id}</b> <span className="note">{r.from} – {r.to} · by {who(r.createdBy)} {r.createdAt.slice(0, 16).replace('T', ' ')}Z</span>
            <Pill tone={r.status === 'ACCEPTED' ? 'green' : r.status === 'REJECTED' ? '' : 'amber'}>{r.status.toLowerCase()}</Pill>
            <span className="note">{r.assignments.length} assignments · {r.unfilled.length} open</span>
            <button className="btn sm" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'Show'}</button>
            {r.status === 'PROPOSED' && g.permissions.build && <>
              {r.assignments.length > 0 && <button className="btn sm pri" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, accept: true })}>Accept</button>}
              <button className="btn sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, accept: false })}>Reject</button>
            </>}
          </div>
          {open === r.id && <div className="tbl-wrap"><table className="t">
            <thead><tr><th>Pairing</th><th>Flights</th><th>Role</th><th>Crew</th><th>Fatigue</th><th>Note</th></tr></thead>
            <tbody>
              {r.assignments.map(a => <tr key={`${a.pairingKey}-${a.role}`}><td className="mono">{a.pairingKey}</td><td className="mono">{a.flightNos}</td><td>{a.role}</td><td>{a.crewName}</td>
                <td><Pill tone={a.fatigue >= 60 ? 'red' : a.fatigue >= 30 ? 'amber' : 'green'}>{a.fatigue}</Pill></td><td className="note">{a.note}</td></tr>)}
              {r.unfilled.map(u => <tr key={`${u.pairingKey}-${u.role}-u`}><td className="mono">{u.pairingKey}</td><td className="mono">{u.flightNos}</td><td>{u.role}</td><td colSpan={3}><Pill tone="red">open</Pill> <span className="note">{u.reason}</span></td></tr>)}
            </tbody>
          </table></div>}
        </div>
      ))}
    </Card>
  );
}

function Away({ g }: { g: RosterGridDto }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const [f, setF] = useState({ crewId: '', kind: 'LEAVE' as UnavailabilityKind, start: g.from, end: g.from, note: '' });
  const add = useMutation({
    mutationFn: () => post<{ clashes: { flightNo: string }[] }>('/ops/roster/unavailability', {
      crewId: f.crewId, kind: f.kind, start: `${f.start}T00:00:00Z`, end: `${addDays(f.end, 1)}T00:00:00Z`, note: f.note || undefined
    }),
    onSuccess: r => { toast(r.clashes.length ? `Recorded — clashes with ${r.clashes.map(c => c.flightNo).join(', ')}: re-crew them` : 'Recorded', r.clashes.length ? 'amber' : 'green'); void qc.invalidateQueries({ queryKey: ['roster'] }); }
  });
  const cancel = useMutation({ mutationFn: (id: number) => post(`/ops/roster/unavailability/${id}/cancel`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['roster'] }) });
  const all = g.crew.flatMap(c => c.away);
  return (
    <Card title="Leave, days off, sickness & training" meta={`${all.length} in this period`}>
      {all.length > 0 && <div className="tbl-wrap"><table className="t">
        <thead><tr><th>Crew</th><th>Kind</th><th>From</th><th>To</th><th>Note</th><th /></tr></thead>
        <tbody>{all.map(a => (
          <tr key={a.id}><td>{a.crewName}</td><td>{a.kind.toLowerCase()}</td><td className="mono">{a.start.slice(0, 16).replace('T', ' ')}Z</td><td className="mono">{a.end.slice(0, 16).replace('T', ' ')}Z</td><td className="note">{a.note}</td>
            <td>{g.permissions.manageUnavailability && <button className="btn sm" disabled={cancel.isPending} onClick={() => cancel.mutate(a.id)}>Cancel</button>}</td></tr>
        ))}</tbody>
      </table></div>}
      {g.permissions.manageUnavailability && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
          <div className="field"><label htmlFor="aw-crew">Crew member</label>
            <select id="aw-crew" className="inp" value={f.crewId} onChange={e => setF({ ...f, crewId: e.target.value })}>
              <option value="">—</option>{g.crew.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
            </select></div>
          <div className="field"><label htmlFor="aw-kind">Kind</label>
            <select id="aw-kind" className="inp" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as UnavailabilityKind })}>
              {(['LEAVE', 'OFF', 'SICK', 'TRAINING'] as const).map(k => <option key={k} value={k}>{k.toLowerCase()}</option>)}
            </select></div>
          <div className="field"><label htmlFor="aw-start">First day</label><input id="aw-start" type="date" className="inp" value={f.start} onChange={e => setF({ ...f, start: e.target.value })} /></div>
          <div className="field"><label htmlFor="aw-end">Last day</label><input id="aw-end" type="date" className="inp" value={f.end} onChange={e => setF({ ...f, end: e.target.value })} /></div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}><label htmlFor="aw-note">Note</label><input id="aw-note" className="inp" value={f.note} maxLength={300} onChange={e => setF({ ...f, note: e.target.value })} /></div>
          <button className="btn" disabled={!f.crewId || f.end < f.start || add.isPending} onClick={() => add.mutate()}>Record</button>
        </div>
      )}
      <ErrorNote error={add.error ?? cancel.error} />
    </Card>
  );
}


function Pairings({ g }: { g: RosterGridDto }) {
  const qc = useQueryClient(); const toast = useUi(s => s.toast);
  const [name,setName]=useState(''); const [base,setBase]=useState(''); const [legs,setLegs]=useState('');
  const create=useMutation({ mutationFn:()=>post('/ops/roster/pairings',{name,base:base.toUpperCase(),flightIds:legs.split(',').map(x=>x.trim()).filter(Boolean)}), onSuccess:()=>{toast('Pairing created for independent approval','cyan'); setName(''); setLegs(''); void qc.invalidateQueries({queryKey:['roster']});} });
  const approve=useMutation({ mutationFn:(id:string)=>post(`/ops/roster/pairings/${id}/approve`), onSuccess:()=>{toast('Pairing approved','green'); void qc.invalidateQueries({queryKey:['roster']});} });
  const rows=g.pairings??[];
  return <Card title="Pairings" meta={`${rows.length} in period`}>
    {rows.length>0 && <div className="tbl-wrap"><table className="t"><thead><tr><th>Pairing</th><th>Period</th><th>Base</th><th>Legs</th><th>Status</th><th/></tr></thead><tbody>{rows.map(p=><tr key={p.id}><td><b>{p.name}</b><div className="note mono">{p.id}</div></td><td className="mono">{p.startsOn} → {p.endsOn}</td><td className="mono">{p.base}</td><td className="mono">{p.legs.map(l=>l.flightNo).join(' · ')}</td><td><Pill tone={p.status==='APPROVED'?'green':p.status==='DRAFT'?'amber':''}>{p.status.toLowerCase()}</Pill></td><td>{p.status==='DRAFT'&&g.permissions.build&&<button className="btn sm" disabled={approve.isPending} onClick={()=>approve.mutate(p.id)}>Approve</button>}</td></tr>)}</tbody></table></div>}
    {g.permissions.build&&<div className="row" style={{flexWrap:'wrap',alignItems:'flex-end',marginTop:8}}><div className="field"><label>Name</label><input className="inp" value={name} onChange={e=>setName(e.target.value)}/></div><div className="field"><label>Base</label><input className="inp mono" maxLength={4} value={base} onChange={e=>setBase(e.target.value.toUpperCase())}/></div><div className="field" style={{flex:1,minWidth:260}}><label>Flight IDs in pairing order (comma separated)</label><input className="inp mono" value={legs} onChange={e=>setLegs(e.target.value)}/></div><button className="btn" disabled={create.isPending||name.trim().length<3||base.length!==4||!legs.trim()} onClick={()=>create.mutate()}>Create pairing</button></div>}
    <ErrorNote error={create.error??approve.error}/>
  </Card>;
}

function Preferences({ g }: { g: RosterGridDto }) {
  const qc=useQueryClient(); const toast=useUi(s=>s.toast); const rows=g.preferences??[];
  const [f,setF]=useState({crewId:'',kind:'PREFER_OFF',startsAt:`${g.from}T00:00`,endsAt:`${addDays(g.from,1)}T00:00`,weight:'3',note:''});
  const add=useMutation({mutationFn:()=>post('/ops/roster/preferences',{crewId:f.crewId,kind:f.kind,startsAt:new Date(f.startsAt).toISOString(),endsAt:new Date(f.endsAt).toISOString(),weight:Number(f.weight),note:f.note||undefined}),onSuccess:()=>{toast('Crew preference recorded','cyan');void qc.invalidateQueries({queryKey:['roster']});}});
  const cancel=useMutation({mutationFn:(id:number)=>post(`/ops/roster/preferences/${id}/cancel`),onSuccess:()=>void qc.invalidateQueries({queryKey:['roster']})});
  return <Card title="Crew preferences" meta="soft optimisation constraints">
    {rows.length>0&&<div className="tbl-wrap"><table className="t"><thead><tr><th>Crew</th><th>Preference</th><th>Window</th><th>Weight</th><th>Note</th><th/></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.crewName}</td><td>{r.kind.toLowerCase().replaceAll('_',' ')}</td><td className="mono">{r.startsAt.slice(0,16).replace('T',' ')} → {r.endsAt.slice(0,16).replace('T',' ')}</td><td>{r.weight}</td><td className="note">{r.note}</td><td>{g.permissions.manageUnavailability&&<button className="btn sm" onClick={()=>cancel.mutate(r.id)}>Cancel</button>}</td></tr>)}</tbody></table></div>}
    {g.permissions.manageUnavailability&&<div className="row" style={{flexWrap:'wrap',alignItems:'flex-end',marginTop:8}}><div className="field"><label>Crew</label><select className="inp" value={f.crewId} onChange={e=>setF({...f,crewId:e.target.value})}><option value="">—</option>{g.crew.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div><div className="field"><label>Preference</label><select className="inp" value={f.kind} onChange={e=>setF({...f,kind:e.target.value})}>{['PREFER_OFF','PREFER_FLY','PREFER_EARLY','PREFER_LATE','AVOID_NIGHT'].map(k=><option key={k}>{k}</option>)}</select></div><div className="field"><label>From</label><input type="datetime-local" className="inp" value={f.startsAt} onChange={e=>setF({...f,startsAt:e.target.value})}/></div><div className="field"><label>To</label><input type="datetime-local" className="inp" value={f.endsAt} onChange={e=>setF({...f,endsAt:e.target.value})}/></div><div className="field"><label>Weight 1–5</label><input className="inp mono" style={{maxWidth:70}} value={f.weight} onChange={e=>setF({...f,weight:e.target.value.replace(/\D/g,'')})}/></div><div className="field"><label>Note</label><input className="inp" value={f.note} onChange={e=>setF({...f,note:e.target.value})}/></div><button className="btn" disabled={add.isPending||!f.crewId||Number(f.weight)<1||Number(f.weight)>5} onClick={()=>add.mutate()}>Record preference</button></div>}
    <ErrorNote error={add.error??cancel.error}/>
  </Card>;
}

function Reserves({ g }: { g: RosterGridDto }) {
  const qc=useQueryClient(); const toast=useUi(s=>s.toast); const rows=g.reserves??[];
  const [f,setF]=useState({crewId:'',base:'',start:`${g.from}T06:00`,end:`${g.from}T18:00`}); const [flight,setFlight]=useState('');
  const add=useMutation({mutationFn:()=>post('/ops/roster/reserves',{crewId:f.crewId,base:f.base.toUpperCase(),start:new Date(f.start).toISOString(),end:new Date(f.end).toISOString()}),onSuccess:()=>{toast('Reserve period created','cyan');void qc.invalidateQueries({queryKey:['roster']});}});
  const call=useMutation({mutationFn:(r:{crewId:string;start:string})=>post('/ops/roster/reserves/call',{crewId:r.crewId,start:r.start,flightId:flight}),onSuccess:()=>{toast('Reserve called; run crew recovery before assignment','amber');void qc.invalidateQueries({queryKey:['roster']});}});
  return <Card title="Reserve / standby" meta={`${rows.filter(r=>r.status==='AVAILABLE').length} available`}>
    {rows.length>0&&<div className="tbl-wrap"><table className="t"><thead><tr><th>Crew</th><th>Base</th><th>Window</th><th>Status</th><th>Flight</th><th/></tr></thead><tbody>{rows.map(r=><tr key={`${r.crewId}-${r.start}`}><td>{r.crewName}</td><td className="mono">{r.base}</td><td className="mono">{r.start.slice(0,16).replace('T',' ')} → {r.end.slice(0,16).replace('T',' ')}</td><td><Pill tone={r.status==='AVAILABLE'?'green':r.status==='CALLED'?'amber':''}>{r.status.toLowerCase()}</Pill></td><td className="mono">{r.calledFlightId??'—'}</td><td>{r.status==='AVAILABLE'&&g.permissions.build&&<div className="row"><input className="inp mono" style={{maxWidth:130}} placeholder="Flight ID" value={flight} onChange={e=>setFlight(e.target.value)}/><button className="btn sm" disabled={!flight||call.isPending} onClick={()=>call.mutate({crewId:r.crewId,start:r.start})}>Call</button></div>}</td></tr>)}</tbody></table></div>}
    {g.permissions.manageUnavailability&&<div className="row" style={{flexWrap:'wrap',alignItems:'flex-end',marginTop:8}}><div className="field"><label>Crew</label><select className="inp" value={f.crewId} onChange={e=>setF({...f,crewId:e.target.value})}><option value="">—</option>{g.crew.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div><div className="field"><label>Base</label><input className="inp mono" maxLength={4} value={f.base} onChange={e=>setF({...f,base:e.target.value.toUpperCase()})}/></div><div className="field"><label>Start</label><input type="datetime-local" className="inp" value={f.start} onChange={e=>setF({...f,start:e.target.value})}/></div><div className="field"><label>End</label><input type="datetime-local" className="inp" value={f.end} onChange={e=>setF({...f,end:e.target.value})}/></div><button className="btn" disabled={add.isPending||!f.crewId||f.base.length!==4} onClick={()=>add.mutate()}>Add reserve</button></div>}
    <ErrorNote error={add.error??call.error}/>
  </Card>;
}

function CabinComplement({g}:{g:RosterGridDto}){
  const qc=useQueryClient();const toast=useUi(s=>s.toast);const [aircraftType,setType]=useState('');const [sccm,setSccm]=useState('1');const [cc,setCc]=useState('');
  const save=useMutation({mutationFn:()=>post('/ops/planning/cabin-requirements',{aircraftType,sccmRequired:Number(sccm),ccRequired:Number(cc)}),onSuccess:()=>{toast(`Cabin complement saved for ${aircraftType}`,'green');void qc.invalidateQueries({queryKey:['roster']})}});
  const gaps=(g.cabin??[]).filter(x=>!x.configured||x.assignedSccm<x.requiredSccm||x.assignedCc<x.requiredCc);
  return <Card title="Cabin crew complement" meta={`${gaps.length} flight${gaps.length===1?'':'s'} needing attention`}><div className="row" style={{flexWrap:'wrap',alignItems:'end'}}>{g.permissions.build&&<><div className="field"><label>Aircraft type</label><input className="inp" value={aircraftType} onChange={e=>setType(e.target.value.toUpperCase())}/></div><div className="field"><label>SCCM required</label><input type="number" min="0" className="inp" value={sccm} onChange={e=>setSccm(e.target.value)}/></div><div className="field"><label>CC required</label><input type="number" min="0" className="inp" value={cc} onChange={e=>setCc(e.target.value)}/></div><button className="btn" disabled={!aircraftType||Number(sccm)+Number(cc)<1||save.isPending} onClick={()=>save.mutate()}>Save complement</button></>}</div>
  <div className="stack" style={{gap:6,marginTop:10}}>{(g.cabin??[]).map(x=><CabinFlight key={x.flightId} x={x} canBuild={g.permissions.build}/>)}</div><ErrorNote error={save.error}/></Card>
}
function CabinFlight({x,canBuild}:{x:NonNullable<RosterGridDto['cabin']>[number];canBuild:boolean}){
 const qc=useQueryClient();const q=useQuery({queryKey:['cabin',x.flightId],queryFn:()=>api<CabinStaffingDto>(`/ops/planning/cabin/${x.flightId}`),enabled:canBuild&&x.configured&&(x.assignedSccm<x.requiredSccm||x.assignedCc<x.requiredCc)});const [selected,setSelected]=useState<string[]>([]);const assign=useMutation({mutationFn:()=>post(`/ops/planning/cabin/${x.flightId}/assign`,{crewIds:selected}),onSuccess:()=>{setSelected([]);void qc.invalidateQueries({queryKey:['roster']});void qc.invalidateQueries({queryKey:['cabin',x.flightId]})}});const ok=x.configured&&x.assignedSccm>=x.requiredSccm&&x.assignedCc>=x.requiredCc;return <div><div className="row"><Pill tone={ok?'green':'amber'}>{ok?'complete':'attention'}</Pill><b className="mono">{x.flightNo}</b><span>{x.aircraftType}</span><span className="note">SCCM {x.assignedSccm}/{x.requiredSccm} · CC {x.assignedCc}/{x.requiredCc}{!x.configured?' · complement not configured':''}</span></div>{q.data&&q.data.missing.length>0&&<div className="row" style={{margin:'6px 0 0 36px',flexWrap:'wrap'}}>{q.data.candidates.map(c=><label key={c.crewId} className="row"><input type="checkbox" checked={selected.includes(c.crewId)} onChange={e=>setSelected(v=>e.target.checked?[...v,c.crewId]:v.filter(id=>id!==c.crewId))}/>{c.name} · {c.rank} · {c.ftl}</label>)}<button className="btn sm" disabled={!selected.length||assign.isPending} onClick={()=>assign.mutate()}>Assign selected</button></div>}<ErrorNote error={q.error??assign.error}/></div>
}

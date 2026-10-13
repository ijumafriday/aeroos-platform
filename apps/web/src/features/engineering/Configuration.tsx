import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import type { AircraftConfigurationDto, ConfigurationBaselineDto, FleetTailDto, InstalledConfigurationItemDto } from '@aeroos/contracts';
import { api, post } from '../../lib/api';
import { Card, ErrorNote, Head, Pill } from '../../components/ui';
import { zulu } from '../../lib/format';
import { useUi } from '../../lib/store';

const today = () => new Date().toISOString().slice(0, 10);
export function Configuration() {
  const qc = useQueryClient(); const toast = useUi(s => s.toast); const search = useSearch({ from: '/engineering/configuration' });
  const fleet = useQuery({ queryKey: ['fleet'], queryFn: () => api<FleetTailDto[]>('/camo/fleet') });
  const [tail, setTail] = useState('');
  const selectedTail = tail || search.tail || fleet.data?.[0]?.reg || '';
  const ac = useQuery({ queryKey: ['engineering','configuration',selectedTail], queryFn: () => api<AircraftConfigurationDto>(`/engineering/configuration/aircraft/${selectedTail}`), enabled: !!selectedTail });
  const history = useQuery({ queryKey: ['engineering','configuration-history',selectedTail], queryFn: () => api<InstalledConfigurationItemDto[]>(`/engineering/configuration/aircraft/${selectedTail}/history`), enabled: !!selectedTail });
  const baselines = useQuery({ queryKey: ['engineering','baselines'], queryFn: () => api<ConfigurationBaselineDto[]>('/engineering/configuration/baselines') });
  const [baselineId, setBaselineId] = useState('');
  const draft = useMemo(() => baselines.data?.find(b => b.id === baselineId) ?? baselines.data?.find(b => b.status === 'DRAFT') ?? null, [baselines.data, baselineId]);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['engineering'] }); };

  const [newType, setNewType] = useState(''); const [newName, setNewName] = useState('');
  const create = useMutation({ mutationFn: () => post<ConfigurationBaselineDto>('/engineering/configuration/baselines', { aircraftType: newType, name: newName }), onSuccess: b => { setBaselineId(b.id); setNewName(''); toast(`${b.id} created`, 'green'); refresh(); } });
  const [code,setCode]=useState(''); const [ata,setAta]=useState(''); const [title,setTitle]=useState(''); const [parentId,setParentId]=useState('');
  const [required,setRequired]=useState(true); const [maxQty,setMaxQty]=useState(1); const [effectTails,setEffectTails]=useState(''); const [msnFrom,setMsnFrom]=useState(''); const [msnTo,setMsnTo]=useState('');
  const addPos = useMutation({ mutationFn: () => post(`/engineering/configuration/baselines/${draft!.id}/positions`, { code, ata, title, parentId: parentId || null, required, maxQty, effectivity: { tails: effectTails.split(',').map(x=>x.trim().toUpperCase()).filter(Boolean), msnRanges: msnFrom || msnTo ? [{ from: msnFrom || msnTo, to: msnTo || msnFrom }] : undefined } }), onSuccess: () => { setCode(''); setAta(''); setTitle(''); setParentId(''); setRequired(true); setMaxQty(1); setEffectTails(''); setMsnFrom(''); setMsnTo(''); toast('Position added','green'); refresh(); } });
  const [partPosition,setPartPosition]=useState(''); const [partNo,setPartNo]=useState(''); const [partDesc,setPartDesc]=useState(''); const [mods,setMods]=useState('');
  const addPart = useMutation({ mutationFn: () => post(`/engineering/configuration/baselines/${draft!.id}/positions/${partPosition}/allowable-parts`, { partNo, description: partDesc, requiredMods: mods.split(',').map(x=>x.trim()).filter(Boolean) }), onSuccess: () => { setPartNo(''); setPartDesc(''); setMods(''); toast('Allowable part added','green'); refresh(); } });
  const approve = useMutation({ mutationFn: (b: ConfigurationBaselineDto) => post(`/engineering/configuration/baselines/${b.id}/approve`, { version: b.version }), onSuccess: () => { toast('Baseline approved','green'); refresh(); } });
  const activate = useMutation({ mutationFn: (b: ConfigurationBaselineDto) => post(`/engineering/configuration/baselines/${b.id}/activate`, { version: b.version, effectiveFrom: today() }), onSuccess: () => { toast('Baseline effective','green'); refresh(); } });

  const [installPos,setInstallPos]=useState(''); const [installPn,setInstallPn]=useState(''); const [serial,setSerial]=useState(''); const [installMods,setInstallMods]=useState(''); const [reference,setReference]=useState('');
  const install = useMutation({ mutationFn: () => post(`/engineering/configuration/aircraft/${selectedTail}/items`, { positionId: installPos, partNo: installPn, serial, mods: installMods.split(',').map(x=>x.trim()).filter(Boolean), installedAt: new Date().toISOString(), reference }), onSuccess: () => { setSerial(''); setReference(''); toast('Configuration item installed','green'); refresh(); } });
  const [removalReference,setRemovalReference]=useState('');
  const remove = useMutation({ mutationFn: (id: string) => post(`/engineering/configuration/aircraft/${selectedTail}/items/${id}/remove`, { reference: removalReference }), onSuccess: () => { setRemovalReference(''); toast('Configuration item removed','green'); refresh(); } });

  const selectedPosition = ac.data?.baseline?.positions.find(p => p.id === installPos);
  return <>
    <Head crumb="Engineering / Configuration" title="Aircraft Configuration" desc="Approved allowable configuration and the actual installed aircraft build. Configuration is object-centric: baselines define what may be installed; each aircraft shows what is installed and any conformity gaps." />
    <Card title="Aircraft" meta={ac.data ? `${ac.data.aircraftType} · MSN ${ac.data.msn}` : ''}>
      <div className="row"><select className="inp" value={selectedTail} onChange={e=>setTail(e.target.value)}>{(fleet.data??[]).map(a=><option key={a.reg}>{a.reg}</option>)}</select>
        {ac.data && <Pill tone={ac.data.conforming ? 'green':'red'}>{ac.data.conforming ? 'configuration conforming':'configuration exceptions'}</Pill>}
        {ac.data?.baseline && <span className="note">{ac.data.baseline.id} · rev {ac.data.baseline.revision} · effective {ac.data.baseline.effectiveFrom}</span>}</div>
      {ac.error && <ErrorNote error={ac.error}/>} 
      {ac.data?.issues.length ? <div className="stack" style={{marginTop:12}}>{ac.data.issues.map((i,n)=><div className="callout red" key={`${i.code}-${n}`}><b>{i.code.replaceAll('_',' ')}</b> — {i.detail}</div>)}</div> : ac.data && <div className="callout green" style={{marginTop:12}}>All applicable positions conform to the effective allowable baseline.</div>}
    </Card>

    {ac.data?.baseline && <Card title="Actual configuration" meta={`${ac.data.items.length} installed`} flush>
      <div className="tbl-wrap"><table className="t"><thead><tr><th>Position</th><th>Part</th><th>Serial</th><th>Mods</th><th>Installed</th><th /></tr></thead><tbody>
        {ac.data.items.map(i=><tr key={i.id}><td><b>{i.positionCode}</b><div className="sub">{i.positionTitle}</div></td><td className="mono">{i.partNo}</td><td className="mono">{i.serial}</td><td>{i.mods.join(', ')||'—'}</td><td>{zulu(i.installedAt)}<div className="sub">{i.installationRef}</div></td><td>{ac.data!.permissions.install && <button className="btn sm ghost" disabled={!removalReference||remove.isPending} onClick={()=>remove.mutate(i.id)}>Remove</button>}</td></tr>)}
        {!ac.data.items.length && <tr><td colSpan={6} className="empty">No actual configuration items recorded yet.</td></tr>}
      </tbody></table></div>
      {ac.data.permissions.install && <div className="dsec"><div className="field" style={{marginBottom:12}}><label>Removal reference</label><input className="inp" value={removalReference} onChange={e=>setRemovalReference(e.target.value)} placeholder="Work order, CRS or engineering reference required before removal"/><div className="sub">Used by the Remove action above; removals cannot be recorded without traceable evidence.</div></div><h3>Install item</h3><div className="form-grid">
        <div className="field"><label>Position</label><select className="inp" value={installPos} onChange={e=>{setInstallPos(e.target.value);setInstallPn('')}}><option value="">Select…</option>{ac.data.baseline.positions.map(p=><option value={p.id} key={p.id}>{p.code} — {p.title}</option>)}</select></div>
        <div className="field"><label>Allowable part</label><select className="inp" value={installPn} onChange={e=>setInstallPn(e.target.value)}><option value="">Select…</option>{(selectedPosition?.allowableParts??[]).map(a=><option key={a.partNo}>{a.partNo}</option>)}</select></div>
        <div className="field"><label>Serial</label><input className="inp" value={serial} onChange={e=>setSerial(e.target.value)}/></div>
        <div className="field"><label>Mod status (comma separated)</label><input className="inp" value={installMods} onChange={e=>setInstallMods(e.target.value)}/></div>
        <div className="field"><label>Installation reference</label><input className="inp" value={reference} onChange={e=>setReference(e.target.value)}/></div>
      </div><button className="btn pri" disabled={!installPos||!installPn||!serial||!reference||install.isPending} onClick={()=>install.mutate()}>Record installation</button><ErrorNote error={install.error??remove.error}/></div>}
    </Card>}

    {history.data && <Card title="Configuration history" meta={`${history.data.length} installation record${history.data.length===1?'':'s'}`} flush>
      <div className="tbl-wrap"><table className="t"><thead><tr><th>Position</th><th>Part / serial</th><th>Installed</th><th>Removed</th></tr></thead><tbody>
        {history.data.map(i=><tr key={i.id}><td><b>{i.positionCode}</b><div className="sub">{i.positionTitle}</div></td><td className="mono">{i.partNo}<div className="sub">S/N {i.serial}</div></td><td>{zulu(i.installedAt)}<div className="sub">{i.installationRef} · {i.installedBy}</div></td><td>{i.removedAt ? <>{zulu(i.removedAt)}<div className="sub">{i.removalRef} · {i.removedBy}</div></> : <Pill tone="green">installed</Pill>}</td></tr>)}
        {!history.data.length && <tr><td colSpan={4} className="empty">No configuration history recorded for this aircraft.</td></tr>}
      </tbody></table></div><ErrorNote error={history.error}/>
    </Card>}

    <Card title="Allowable configuration baselines" meta={`${baselines.data?.length??0} revisions`}>
      <div className="row" style={{alignItems:'end'}}><div className="field"><label>Aircraft type</label><input className="inp" value={newType} onChange={e=>setNewType(e.target.value)} placeholder="B737-800"/></div><div className="field"><label>Baseline name</label><input className="inp" value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Fleet standard"/></div><button className="btn" disabled={!newType||!newName||create.isPending} onClick={()=>create.mutate()}>New draft</button></div>
      <div className="tbl-wrap" style={{marginTop:12}}><table className="t"><thead><tr><th>Baseline</th><th>Type</th><th>Revision</th><th>Status</th><th>Positions</th><th /></tr></thead><tbody>{(baselines.data??[]).map(b=><tr key={b.id} className={draft?.id===b.id?'sel':''}><td><button className="link" onClick={()=>setBaselineId(b.id)}>{b.id} · {b.name}</button></td><td>{b.aircraftType}</td><td>{b.revision}</td><td><Pill tone={b.status==='EFFECTIVE'?'green':b.status==='APPROVED'?'cyan':''}>{b.status}</Pill></td><td>{b.positions.length}</td><td className="row">{b.status==='DRAFT'&&<button className="btn sm" onClick={()=>approve.mutate(b)}>Approve</button>}{b.status==='APPROVED'&&<button className="btn sm pri" onClick={()=>activate.mutate(b)}>Make effective</button>}</td></tr>)}</tbody></table></div>
      <ErrorNote error={create.error??approve.error??activate.error}/>
    </Card>

    {draft?.status==='DRAFT' && <Card title={`Edit ${draft.id}`} meta="Draft only">
      <div className="form-grid"><div className="field"><label>Position code</label><input className="inp" value={code} onChange={e=>setCode(e.target.value)}/></div><div className="field"><label>ATA</label><input className="inp" maxLength={2} value={ata} onChange={e=>setAta(e.target.value)}/></div><div className="field"><label>Title</label><input className="inp" value={title} onChange={e=>setTitle(e.target.value)}/></div><div className="field"><label>Parent</label><select className="inp" value={parentId} onChange={e=>setParentId(e.target.value)}><option value="">Root</option>{draft.positions.map(p=><option value={p.id} key={p.id}>{p.code}</option>)}</select></div><div className="field"><label>Maximum installed quantity</label><input className="inp" type="number" min="1" max="100" value={maxQty} onChange={e=>setMaxQty(Number(e.target.value))}/></div><div className="field"><label>Applicable tails (optional)</label><input className="inp" value={effectTails} onChange={e=>setEffectTails(e.target.value)} placeholder="5Y-ABC, 5Y-DEF"/></div><div className="field"><label>MSN from (optional)</label><input className="inp" value={msnFrom} onChange={e=>setMsnFrom(e.target.value)}/></div><div className="field"><label>MSN to (optional)</label><input className="inp" value={msnTo} onChange={e=>setMsnTo(e.target.value)}/></div><label className="row"><input type="checkbox" checked={required} onChange={e=>setRequired(e.target.checked)}/> Required position</label></div><button className="btn" disabled={!code||!ata||!title||maxQty<1||addPos.isPending} onClick={()=>addPos.mutate()}>Add position</button>
      <hr/><div className="form-grid"><div className="field"><label>Position</label><select className="inp" value={partPosition} onChange={e=>setPartPosition(e.target.value)}><option value="">Select…</option>{draft.positions.map(p=><option value={p.id} key={p.id}>{p.code}</option>)}</select></div><div className="field"><label>Part number</label><input className="inp" value={partNo} onChange={e=>setPartNo(e.target.value)}/></div><div className="field"><label>Description</label><input className="inp" value={partDesc} onChange={e=>setPartDesc(e.target.value)}/></div><div className="field"><label>Required mods</label><input className="inp" value={mods} onChange={e=>setMods(e.target.value)} placeholder="SB-72-001, MOD-42"/></div></div><button className="btn" disabled={!partPosition||!partNo||addPart.isPending} onClick={()=>addPart.mutate()}>Add allowable part</button><ErrorNote error={addPos.error??addPart.error}/>
    </Card>}
  </>;
}

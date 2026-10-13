import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { MeDto, PersonnelSummaryDto } from '@aeroos/contracts';
import { api, ApiRequestError } from '../../lib/api';
import { useNow } from '../../lib/store';
import { Card, Head, Pill } from '../../components/ui';
import { PersonDrawer } from './PersonDrawer';
import { authTone, DAY, expiryTone, inDays } from './status';

export function Personnel() {
  const { person, q: query, status } = useSearch({ from: '/org/personnel' });
  const navigate = useNavigate({ from: '/org/personnel' });
  const now = useNow();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') });
  const q = useQuery({ queryKey: ['personnel', 'list'], queryFn: () => api<PersonnelSummaryDto[]>('/org/personnel'), retry: false });
  const forbidden = q.error instanceof ApiRequestError && q.error.status === 403;
  const allRows = q.data ?? [];
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const needle=(query??'').trim().toLowerCase();
  const rows=allRows.filter(r=>(!needle||`${r.name} ${r.id} ${r.licenceNo??''} ${r.authorisation?.reference??''}`.toLowerCase().includes(needle))&&(!status||status==='ALL'||(status==='CURRENT'?r.current===true:status==='NOT_CURRENT'?r.current===false:r.authorisation?.status===status)));
  const setFilter=(next:{q?:string;status?:string})=>navigate({search:{person:undefined,q:next.q??query,status:next.status??status}});
  const toggle=(id:string)=>setSelected(prev=>{const n=new Set(prev);if(n.has(id))n.delete(id);else n.add(id);return n;});
  const exportSelected=()=>{const picked=allRows.filter(r=>selected.has(r.id));const esc=(v:unknown)=>`"${String(v??'').replace(/"/g,'""')}"`;const csv=['id,name,licence,authorisation,authorisation_status,current,next_expiry',...picked.map(r=>[r.id,r.name,r.licenceNo??'',r.authorisation?.reference??'',r.authorisation?.status??'',r.current??'',r.nextExpiry?.at??''].map(esc).join(','))].join('\n');const blob=new Blob([csv+'\n'],{type:'text/csv'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`personnel-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const certifying = rows.filter(r => r.authorisation);
  const notCurrent = rows.filter(r => r.current === false).length;
  const suspended = rows.filter(r => r.authorisation?.status === 'SUSPENDED').length;
  const due30 = rows.filter(r => r.nextExpiry && Date.parse(r.nextExpiry.at) - now <= 30 * DAY).length;
  const open = (id: string) => navigate({ search: { person: id } });

  return (
    <>
      <Head
        crumb="Organization Core"
        title="Personnel & Authorisations"
        desc="Licences, company certification authorisations, continuation training and recent experience. Whether someone may certify is decided by the rulepack at the moment they sign."
        actions={forbidden && me.data?.personnel ? <button className="btn pri" onClick={() => open(me.data!.personnel!.id)}>Open my file</button> : !forbidden ? <div className="row"><input className="inp" placeholder="Filter personnel…" value={query??''} onChange={e=>setFilter({q:e.target.value})}/><select className="inp" value={status??'ALL'} onChange={e=>setFilter({status:e.target.value})}><option value="ALL">All statuses</option><option value="CURRENT">Current</option><option value="NOT_CURRENT">Not current</option><option value="ACTIVE">Authorisation active</option><option value="SUSPENDED">Suspended</option><option value="EXPIRED">Expired</option></select></div> : undefined}
      />
      {forbidden ? (
        <div className="callout">
          You can see your own personnel file. The full register is available to the quality manager, CAMO manager and auditors.
          {me.data?.personnel ? '' : ' You have no personnel record yet.'}
        </div>
      ) : q.error ? <div className="callout red">{(q.error as Error).message}</div> : (
        <>
          <div className="kpis">
            <div className="kpi cyan"><div className="l">Certifying staff</div><div className="v">{certifying.length}</div><div className="s">with a company authorisation</div></div>
            <div className={`kpi ${notCurrent ? 'red' : 'green'}`}><div className="l">Not current</div><div className="v">{notCurrent}</div><div className="s">experience or training lapsed</div></div>
            <div className={`kpi ${suspended ? 'red' : ''}`}><div className="l">Suspended</div><div className="v">{suspended}</div><div className="s">authorisations</div></div>
            <div className={`kpi ${due30 ? 'amber' : ''}`}><div className="l">Expiring ≤ 30 days</div><div className="v">{due30}</div><div className="s">licence, authorisation or training</div></div>
          </div>
          <Card title="Register" meta={<span className="row">{rows.length} people{selected.size>0&&<><span>· {selected.size} selected</span><button className="btn sm ghost" onClick={exportSelected}>Export selected</button><button className="btn sm ghost" onClick={()=>setSelected(new Set())}>Clear</button></>}</span>} flush>
            <div className="tbl-wrap">
              <table className="t">
                <thead><tr><th><input type="checkbox" aria-label="Select visible personnel" checked={rows.length>0&&rows.every(r=>selected.has(r.id))} onChange={e=>setSelected(e.target.checked?new Set(rows.map(r=>r.id)):new Set())}/></th><th>Name</th><th>Licence</th><th>Authorisation</th><th>Current</th><th>Next expiry</th></tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="click" onClick={() => open(r.id)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && open(r.id)}>
                      <td onClick={e=>e.stopPropagation()}><input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onChange={()=>toggle(r.id)}/></td>
                      <td><b>{r.name}</b> <span className="note mono">{r.id}</span></td>
                      <td className="mono">{r.licenceNo ?? <span className="note">—</span>}</td>
                      <td>{r.authorisation
                        ? <span className="row" style={{ gap: 6 }}><span className="mono">{r.authorisation.reference}</span><Pill tone={authTone(r.authorisation.status)}>{r.authorisation.status}</Pill></span>
                        : <span className="note">—</span>}</td>
                      <td>{r.current === null ? <span className="note">n/a</span> : <Pill tone={r.current ? 'green' : 'red'}>{r.current ? 'current' : 'not current'}</Pill>}</td>
                      <td>{r.nextExpiry
                        ? <span className="row" style={{ gap: 6 }}><Pill tone={expiryTone(r.nextExpiry.at, now)}>{inDays(r.nextExpiry.at, now)}</Pill><span className="note">{r.nextExpiry.what}</span></span>
                        : <span className="note">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      <PersonDrawer id={person ?? null} onClose={() => navigate({ search: { person: undefined } })} />
    </>
  );
}

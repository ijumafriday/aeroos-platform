import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { api, del, post } from '../lib/api';
import { useUi } from '../lib/store';

type UserView={id:string;route:string;name:string;search:Record<string,string>;isDefault:boolean};

const currentSearch=()=>Object.fromEntries(new URLSearchParams(window.location.search).entries());
const hrefOf=(v:UserView)=>{const qs=new URLSearchParams(v.search).toString();return `${v.route}${qs?`?${qs}`:''}`;};

/** Save and reopen filter/query state for any AeroOS screen without creating workflow navigation. */
export function WorkspaceViews(){
  const path=useRouterState({select:s=>s.location.pathname});
  const [open,setOpen]=useState(false);const qc=useQueryClient();const toast=useUi(s=>s.toast);
  const q=useQuery({queryKey:['workspace-views',path],queryFn:()=>api<UserView[]>(`/preferences/views?route=${encodeURIComponent(path)}`),enabled:true});
  const save=useMutation({mutationFn:(x:{name:string;isDefault:boolean})=>post<UserView>('/preferences/views',{route:path,name:x.name,search:currentSearch(),isDefault:x.isDefault}),onSuccess:()=>{toast('View saved','green');void qc.invalidateQueries({queryKey:['workspace-views',path]});}});
  const remove=useMutation({mutationFn:(id:string)=>del(`/preferences/views/${id}`),onSuccess:()=>void qc.invalidateQueries({queryKey:['workspace-views',path]})});
  const makeDefault=useMutation({mutationFn:(id:string)=>post(`/preferences/views/${id}/default`),onSuccess:()=>void qc.invalidateQueries({queryKey:['workspace-views',path]})});
  const saveCurrent=()=>{const name=window.prompt('Name this view');if(name?.trim())save.mutate({name:name.trim(),isDefault:false});};
  useEffect(()=>{if(window.location.search)return;const d=q.data?.find(v=>v.isDefault);if(d&&Object.keys(d.search).length)window.location.replace(hrefOf(d));},[path,q.data]);
  return <div style={{position:'relative'}}>
    <button className="btn sm ghost" onClick={()=>setOpen(v=>!v)} title="Saved views and filters">Views</button>
    {open&&<div className="card" style={{position:'absolute',right:0,top:36,width:340,zIndex:80,boxShadow:'var(--shadow)'}}>
      <div className="card-h"><h2>Views</h2><button className="btn sm" onClick={saveCurrent}>Save current</button></div>
      <div className="card-b" style={{padding:8}}>
        {(q.data??[]).map(v=><div className="row" key={v.id} style={{gap:6,padding:'5px 0'}}>
          <button className="btn sm ghost" style={{flex:1,textAlign:'left'}} onClick={()=>{window.location.assign(hrefOf(v));}}>{v.name}{v.isDefault?' ★':''}</button>
          {!v.isDefault&&<button className="icon-btn" title="Make default for this screen" onClick={()=>makeDefault.mutate(v.id)}>☆</button>}
          <button className="icon-btn" title="Delete saved view" onClick={()=>remove.mutate(v.id)}>×</button>
        </div>)}
        {q.isLoading&&<div className="empty">Loading…</div>}
        {!q.isLoading&&(q.data?.length??0)===0&&<div className="empty">No saved views for this screen.</div>}
      </div>
    </div>}
  </div>;
}

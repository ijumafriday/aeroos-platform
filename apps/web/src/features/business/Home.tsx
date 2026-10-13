import { useQuery } from '@tanstack/react-query';
import type { MeDto, NotificationDto } from '@aeroos/contracts';
import { api } from '../../lib/api';
import { Card, Head, Pill } from '../../components/ui';

type UserView={id:string;route:string;name:string;search:Record<string,string>;isDefault:boolean};
type LinkDef={to:string;title:string;detail:string;roles:string[]};
const LINKS:LinkDef[]=[
  {to:'/ops/occ',title:'Operations Control',detail:'Live flight operation and disruption picture',roles:['occ_controller']},
  {to:'/ops/dispatch',title:'Dispatch',detail:'Briefing, release and flight watch',roles:['occ_controller']},
  {to:'/ops/roster',title:'Crew Planning',detail:'Pairings, roster, reserve and fatigue controls',roles:['occ_controller']},
  {to:'/crew/me',title:'My Crew Day',detail:'Roster and operational briefing',roles:['flight_crew']},
  {to:'/camo/programme',title:'Airworthiness',detail:'Programme, due list and compliance status',roles:['camo_manager']},
  {to:'/engineering/configuration',title:'Engineering',detail:'Configuration, effectivity and conformity',roles:['camo_manager','engineering_manager','engineering_engineer']},
  {to:'/amo/maintenance',title:'Maintenance Control',detail:'Line, base, shop, tooling, handover and AOG control',roles:['maintenance_planner','maintenance_supervisor','mechanic','certifying_staff','tool_controller']},
  {to:'/camo/work-packages',title:'Maintenance Planning',detail:'Checks, resources and production readiness',roles:['camo_manager','maintenance_planner']},
  {to:'/amo/task-cards',title:'Maintenance Execution',detail:'Task cards and certification',roles:['certifying_staff','mechanic','maintenance_supervisor']},
  {to:'/amo/supply',title:'Supply Chain',detail:'Procurement, repair, transfers and logistics',roles:['storekeeper']},
  {to:'/records',title:'Technical Records',detail:'Record completeness and evidence packs',roles:['records_officer','records_manager','camo_manager','quality_manager','auditor']},
  {to:'/safety/reports',title:'Safety',detail:'Reports, hazards and investigations',roles:['safety_manager']},
  {to:'/quality/audits',title:'Quality',detail:'Audit programme, findings and CAPA',roles:['quality_manager','auditor']},
  {to:'/finance/executive',title:'Commercial / Finance',detail:'Commercial KPIs and finance control',roles:['finance_controller']}
];
const href=(v:UserView)=>{const qs=new URLSearchParams(v.search).toString();return `${v.route}${qs?`?${qs}`:''}`;};

/** Role-aware landing page: prioritises domains, not workflows. */
export function Home(){
  const me=useQuery({queryKey:['me'],queryFn:()=>api<MeDto>('/me')});
  const views=useQuery({queryKey:['workspace-views','all'],queryFn:()=>api<UserView[]>('/preferences/views')});
  const alerts=useQuery({queryKey:['notifications'],queryFn:()=>api<NotificationDto[]>('/notifications')});
  const roles=new Set(me.data?.roles??[]);
  const relevant=LINKS.filter(x=>x.roles.some(r=>roles.has(r)));
  const shown=(relevant.length?relevant:LINKS.slice(0,6)).slice(0,6);
  const defaults=(views.data??[]).filter(v=>v.isDefault).slice(0,6);
  const unread=(alerts.data??[]).filter(a=>!a.read);
  return <>
    <Head crumb="AeroOS" title={me.data?`Good day, ${me.data.name}`:'Workspace'} desc="Your role-aware operating workspace. Domain records remain authoritative in their own modules; this page only brings the most relevant entry points together."/>
    <div className="kpis"><div className={`kpi ${unread.some(a=>a.severity==='red')?'red':unread.length?'amber':'green'}`}><div className="l">Unread alerts</div><div className="v">{unread.length}</div><div className="s">across your permitted domains</div></div><div className="kpi cyan"><div className="l">Operator</div><div className="v" style={{fontSize:24}}>{me.data?.operatorId??'—'}</div><div className="s">current AOC context</div></div><div className="kpi"><div className="l">Saved default views</div><div className="v">{defaults.length}</div><div className="s">personal working views</div></div></div>
    <Card title="Your domains" meta="Role-prioritised">
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:10}}>{shown.map(x=><a key={x.to} href={x.to} className="block click" style={{padding:12,textDecoration:'none'}}><b>{x.title}</b><div className="sub">{x.detail}</div></a>)}</div>
    </Card>
    {defaults.length>0&&<Card title="Default views" meta="Your saved filters"><div className="stack" style={{gap:6}}>{defaults.map(v=><a key={v.id} className="row block click" href={href(v)} style={{padding:9,textDecoration:'none'}}><b style={{flex:1}}>{v.name}</b><Pill>{v.route}</Pill></a>)}</div></Card>}
    <Card title="Attention" meta={`${unread.length} unread`}><div className="stack" style={{gap:6}}>{unread.slice(0,8).map(a=><a key={a.id} href={a.link??'#'} className="row block click" style={{padding:9,textDecoration:'none'}}><Pill tone={a.severity}>{a.severity}</Pill><div><b>{a.title}</b><div className="sub">{a.body}</div></div></a>)}{unread.length===0&&<div className="empty">No unread alerts.</div>}</div></Card>
  </>;
}

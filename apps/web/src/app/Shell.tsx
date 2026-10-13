import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useRouter, useRouterState } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeDto, NotificationDto } from '@aeroos/contracts';
import { api, post } from '../lib/api';
import { signOut } from '../lib/auth';
import { selectOperator } from '../lib/operator';
import { useNow, useUi } from '../lib/store';
import { Toasts } from '../components/ui';
import { CommandPalette } from '../components/CommandPalette';
import { OfflineSync } from '../components/OfflineSync';
import { WorkspaceViews } from '../components/WorkspaceViews';

const DOMAINS = [
  { key: 'ops', tag: 'OPS', label: 'Operations', sub: 'Flight operations control', items: [{ to: '/ops/occ', label: 'Operations Control' }, { to: '/ops/dispatch', label: 'Dispatch & Load Control' }, { to: '/ops/control', label: 'Operations Data & Control' }, { to: '/ops/crew', label: 'Day-of-ops Crew' }, { to: '/ops/roster', label: 'Crew Rostering' }, { to: '/ops/fatigue', label: 'Fatigue Reports' }] },
  { key: 'crew', tag: 'CREW', label: 'Crew', sub: 'Crew planning and self-service', items: [{ to: '/crew/me', label: 'My Roster & Briefing' }, { to: '/crew/control', label: 'Crew Planning & Administration' }] },
  { key: 'airworthiness', tag: 'CAW', label: 'Continuing Airworthiness', sub: 'Airworthiness status and programme', items: [{ to: '/camo/mel', label: 'Defect & MEL Control' }, { to: '/camo/programme', label: 'Programme & Due List' }, { to: '/camo/reliability-control', label: 'Reliability & Condition Monitoring' }] },
  { key: 'engineering', tag: 'ENG', label: 'Engineering', sub: 'Configuration and technical engineering', items: [{ to: '/engineering/configuration', label: 'Aircraft Configuration' }, { to: '/engineering/control', label: 'Engineering Control & Configuration' }, { to: '/camo/directives', label: 'AD / SB & Engineering Orders' }, { to: '/camo/components', label: 'Components & Rotable History' }, { to: '/camo/health', label: 'Engine Health & Structures' }] },
  { key: 'records', tag: 'REC', label: 'Technical Records', sub: 'Evidence, completeness and delivery records', items: [{ to: '/records', label: 'Record Binders' }] },
  { key: 'maintenance', tag: 'MNT', label: 'Maintenance', sub: 'Line, base, shop and Part-145 production', items: [{ to: '/amo/maintenance', label: 'Maintenance Control' }, { to: '/camo/work-packages', label: 'Planning & Work Packages' }, { to: '/amo/task-cards', label: 'Task Cards & Certification' }] },
  { key: 'supply', tag: 'SUP', label: 'Supply Chain', sub: 'Material, tooling and procurement', items: [{ to: '/amo/stores', label: 'Stores & Tools' }, { to: '/amo/supply', label: 'Procurement & Logistics' }, { to: '/amo/ncr', label: 'Material Non-conformity' }] },
  { key: 'org', tag: 'ORG', label: 'Organization', sub: 'People, licences and controlled information', items: [{ to: '/org/personnel', label: 'Personnel & Authorisations' }, { to: '/org/documents', label: 'Document & Manual Control' }, { to: '/org/enterprise', label: 'Enterprise Structure' }] },
  { key: 'commercial', tag: 'COM', label: 'Commercial / Finance', sub: 'Aviation commercial and financial control', items: [{ to: '/amo/billing', label: 'Maintenance Billing' }, { to: '/finance/commercial-control', label: 'Commercial Contract & Cost Control' }, { to: '/finance/executive', label: 'Executive Dashboard' }, { to: '/finance/ledger', label: 'General Ledger' }] },
  { key: 'safety', tag: 'SMS', label: 'Safety', sub: 'Risk & occurrence management', items: [{ to: '/safety/reports', label: 'Reports & Investigations' }, { to: '/safety/actions', label: 'Safety Actions' }, { to: '/safety/control', label: 'Safety Assurance & Response' }] },
  { key: 'quality', tag: 'QA', label: 'Quality', sub: 'Assurance & conformity', items: [{ to: '/quality/audits', label: 'Audits, Findings & Non-Compliance' }, { to: '/quality/actions', label: 'Quality Actions' }, { to: '/quality/control', label: 'Quality Assurance & Surveillance' }, { to: '/quality/compliance', label: 'Compliance Matrix' }, { to: '/quality/compliance-control', label: 'Regulatory Compliance & Authority Control' }, { to: '/quality/audit', label: 'Audit Trail & Verification' }] },
  { key: 'analytics', tag: 'BI', label: 'Analytics', sub: 'Governed semantic reporting and management information', items: [{ to: '/analytics/control', label: 'Analytics & Report Designer' }] }
] as const;

export function Shell() {
  const path = useRouterState({ select: s => s.location.pathname });
  const active = DOMAINS.find(d => d.items.some(i => path === i.to || path.startsWith(`${i.to}/`)));
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') });

  return (
    <div id="app">
      <header id="top">
        <Link to="/home" className="brand" aria-label="AeroOS home"><div className="brand-mark">Æ</div></Link>
        <div className="brand-name">AeroOS<small>{me.data ? `${me.data.operatorId} · EASA` : 'Connecting…'}</small></div>
        {me.data && me.data.operators.length > 1 && <OperatorSwitch me={me.data} />}
        <div style={{ flex: 1 }} />
        <button className="cmd-trigger" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))} aria-label="Search (Ctrl+K)">
          <span>Search everything…</span><span style={{ marginLeft: 'auto', font: '600 11px var(--f-mono)' }}>Ctrl K</span>
        </button>
        <WorkspaceViews />
        <OfflineSync />
        <LiveStatus />
        <UtcClock />
        <Notifications />
        {me.data && (
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <div className="user-chip"><b>{me.data.name}</b><span>{me.data.roles.join(' · ')}</span></div>
            {me.data.roles.includes('platform_admin') && <Link to="/account/platform" className="btn sm ghost" title="Platform administration">Platform</Link>}
            <Link to="/account/passkeys" className="btn sm ghost" title="Passkeys for signing a CRS">Passkeys</Link>
            <button className="btn sm ghost" onClick={signOut}>Sign out</button>
          </div>
        )}
      </header>
      <nav id="rail" aria-label="Domains">
        {DOMAINS.map(d => (
          <Link key={d.key} to={d.items[0].to} className={`rail-btn ${active?.key === d.key ? 'on' : ''}`} title={d.label}>
            <span style={{ font: '700 13px var(--f-disp)' }}>{d.tag}</span>
          </Link>
        ))}
      </nav>
      <aside id="panel">
        {active ? <>
          <div className="pnl-head"><h2>{active.label}</h2><p>{active.sub}</p></div>
          <div className="pnl-group">{active.items.map(i => (
            <Link key={i.to} to={i.to} className={`nav-item ${path === i.to ? 'on' : ''}`}>{i.label}</Link>
          ))}</div>
        </> : <>
          <div className="pnl-head"><h2>Workspace</h2><p>Role-aware starting point</p></div>
          <div className="pnl-group"><Link to="/home" className="nav-item on">Overview</Link></div>
        </>}
      </aside>
      <section id="work">
        <main id="main"><Outlet /></main>
      </section>
      <Toasts />
      <CommandPalette />
    </div>
  );
}

function LiveStatus() {
  const live = useUi(s => s.live);
  return (
    <span className="pill" style={{ borderColor: live ? 'var(--green)' : 'var(--red)', color: live ? 'var(--green)' : 'var(--red)' }} title={live ? 'Live updates connected' : 'Reconnecting to live updates'}>
      {live ? '● LIVE' : '○ OFFLINE'}
    </span>
  );
}

function UtcClock() {
  const now = useNow();
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return <div className="clock">{p(d.getUTCHours())}:{p(d.getUTCMinutes())}:{p(d.getUTCSeconds())}Z</div>;
}

function Notifications() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['notifications'], queryFn: () => api<NotificationDto[]>('/notifications'), refetchInterval: 60_000 });
  const readAll = useMutation({ mutationFn: () => post('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const read = useMutation({ mutationFn: (id: string) => post(`/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const unread = list.data?.filter(n => !n.read).length ?? 0;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={() => setOpen(o => !o)} aria-label={`Notifications, ${unread} unread`}>
        <span aria-hidden="true">🔔︎</span>
        {unread > 0 && <span className="badge">{unread}</span>}
      </button>
      {open && (
        <div id="notif" style={{ position: 'absolute', top: 40, right: 0 }}>
          <div className="card-h"><h2>Alerts</h2><button className="btn sm ghost" onClick={() => readAll.mutate()}>Mark all read</button></div>
          <div className="list">
            {(list.data ?? []).map(n => (
              <button key={n.id} className="li click" style={{ width: '100%', textAlign: 'left', opacity: n.read ? 0.55 : 1 }}
                onClick={() => { read.mutate(n.id); setOpen(false); if (n.link) router.history.push(n.link); }}>
                <span className={`sev ${n.severity}`} />
                <div style={{ minWidth: 0 }}><b>{n.title}</b><div className="sub">{n.body}</div></div>
              </button>
            ))}
            {list.data?.length === 0 && <div className="empty">No alerts</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Users in several operators (AOCs) pick which one they are working for; every query refetches. */
function OperatorSwitch({ me }: { me: MeDto }) {
  const qc = useQueryClient();
  const router = useRouter();
  return (
    <label className="op-switch" title="Operator (AOC) you are working for">
      <span>AOC</span>
      <select className="inp sm" value={me.operatorId} onChange={e => {
        selectOperator(e.target.value);
        // Drop everything cached for the previous operator, then reload the current page's data.
        qc.clear();
        void router.navigate({ to: '/ops/occ' });
      }}>
        {me.operators.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

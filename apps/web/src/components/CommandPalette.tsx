import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import type { SearchResultDto } from '@aeroos/contracts';
import { api, post } from '../lib/api';

const COMMANDS: SearchResultDto[] = [
  { type: 'Go to', id: 'occ', title: 'Operations Control (OCC)', subtitle: 'Flight Ops', link: '/ops/occ' },
  { type: 'Go to', id: 'crew', title: 'Crew & FTL', subtitle: 'Flight Ops', link: '/ops/crew' },
  { type: 'Go to', id: 'mel', title: 'Defect & MEL Management', subtitle: 'CAMO', link: '/camo/mel' },
  { type: 'Go to', id: 'due', title: 'Due List & Airworthiness', subtitle: 'CAMO', link: '/camo/programme' },
  { type: 'Go to', id: 'cfg', title: 'Aircraft Configuration', subtitle: 'Engineering', link: '/engineering/configuration' },
  { type: 'Go to', id: 'wp', title: 'Planning & Work Packages', subtitle: 'Maintenance', link: '/camo/work-packages' },
  { type: 'Go to', id: 'cards', title: 'Hangar Floor — Task Cards', subtitle: 'AMO', link: '/amo/task-cards' },
  { type: 'Go to', id: 'stores', title: 'Hangar Plan, Stores & Tools', subtitle: 'AMO', link: '/amo/stores' },
  { type: 'Go to', id: 'people', title: 'Personnel & Authorisations', subtitle: 'Organization', link: '/org/personnel' },
  { type: 'Go to', id: 'safety-reports', title: 'Safety Reports & Investigations', subtitle: 'Safety', link: '/safety/reports' },
  { type: 'Go to', id: 'quality-audits', title: 'Quality Audits, Findings & Non-Compliance', subtitle: 'Quality', link: '/quality/audits' },
  { type: 'Go to', id: 'quality-control', title: 'Quality Assurance & Surveillance', subtitle: 'Quality', link: '/quality/control' },
  { type: 'Go to', id: 'compliance-control', title: 'Regulatory Compliance & Authority Control', subtitle: 'Quality', link: '/quality/compliance-control' },
  { type: 'Go to', id: 'audit', title: 'Audit Trail & Verification', subtitle: 'Quality', link: '/quality/audit' }
];

/** Cmd/Ctrl+K: jump anywhere, or search every domain you are allowed to see. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o); }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (open) { setQ(''); setActive(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 180); return () => clearTimeout(t); }, [q]);

  const search = useQuery({ queryKey: ['search', debounced], queryFn: () => api<SearchResultDto[]>(`/search?q=${encodeURIComponent(debounced)}`), enabled: open && debounced.length >= 2 });
  const saved = useQuery({ queryKey: ['saved-searches'], queryFn: () => api<{id:string;name:string;query:string}[]>('/search/saved'), enabled: open });
  const results = useMemo(() => {
    const cmds = COMMANDS.filter(c => !q || c.title.toLowerCase().includes(q.toLowerCase()));
    return [...cmds, ...(search.data ?? [])];
  }, [q, search.data]);
  const go = (r: SearchResultDto) => { setOpen(false); router.history.push(r.link); };

  if (!open) return null;
  return (
    <div className="cmd-scrim" onMouseDown={e => e.target === e.currentTarget && setOpen(false)}>
      <div className="cmd" role="dialog" aria-modal="true" aria-label="Search and commands">
        <div className="cmd-in">
          <span aria-hidden="true">⌘K</span>
          <input ref={input} value={q} placeholder="Search everything…  filters: type:flight domain:records" aria-label="Search"
            onChange={e => { setQ(e.target.value); setActive(0); }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(results.length - 1, a + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
              if (e.key === 'Enter' && results[active]) go(results[active]);
            }} />
        </div>
        <div className="cmd-list" role="listbox">
          {(saved.data ?? []).length > 0 && !q && (saved.data ?? []).map(s => <button key={s.id} className="cmd-item" onClick={() => setQ(s.query)}><span className="cmd-type">Saved</span><span><b>{s.name}</b><span className="sub">{s.query}</span></span></button>)}
          {results.map((r, i) => (
            <button key={`${r.type}:${r.id}`} role="option" aria-selected={i === active} className={`cmd-item ${i === active ? 'on' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => go(r)}>
              <span className="cmd-type">{r.type}</span>
              <span style={{ minWidth: 0 }}><b>{r.title}</b><span className="sub">{r.subtitle}</span></span>
            </button>
          ))}
          {debounced.length >= 2 && search.isFetching && <div className="empty">Searching…</div>}
          {debounced.length >= 2 && !search.isFetching && results.length === 0 && <div className="empty">No matches.</div>}
          {q.trim().length >= 2 && <div className="row" style={{padding:8}}><button className="btn sm ghost" onClick={() => { const name=window.prompt('Name this search'); if(name?.trim()) void post('/search/saved',{name:name.trim(),query:q.trim()}).then(()=>saved.refetch()); }}>Save search</button><span className="sub">Use type: and domain: filters to narrow results.</span></div>}
        </div>
      </div>
    </div>
  );
}

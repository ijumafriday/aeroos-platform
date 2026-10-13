import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { AircraftStatusDto, DueItemDto, ReliabilityDto, WorkPackageDto } from '@aeroos/contracts';
import { api, post } from '../../lib/api';
import { useUi } from '../../lib/store';
import { Card, Dialog, ErrorNote, Head, Pill } from '../../components/ui';

const statusTone: Record<string, string> = { OVERDUE: 'red', IN_TOLERANCE: 'amber', DUE_SOON: 'cyan', OK: 'green', COMPLIED: '' };
const kindLabel: Record<string, string> = { TASK: 'Task', AD: 'AD', SB: 'SB', LLP: 'LLP' };
const num = (n: number) => n.toLocaleString('en-GB', { maximumFractionDigits: 1 });

function remaining(d: DueItemDto) {
  const parts: string[] = [];
  if (d.remaining.fh !== null) parts.push(`${num(d.remaining.fh)} FH`);
  if (d.remaining.fc !== null) parts.push(`${num(d.remaining.fc)} FC`);
  if (d.remaining.days !== null) parts.push(`${d.remaining.days} d`);
  return parts.join(' · ') || '—';
}

export function Programme() {
  const { tail } = useSearch({ from: '/camo/programme' });
  const navigate = useNavigate({ from: '/camo/programme' });
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const fleet = useQuery({ queryKey: ['programme', 'aircraft'], queryFn: () => api<AircraftStatusDto[]>('/camo/aircraft'), refetchInterval: 60_000 });
  const due = useQuery({ queryKey: ['programme', 'due', tail ?? ''], queryFn: () => api<DueItemDto[]>(`/camo/due${tail ? `?tail=${encodeURIComponent(tail)}` : ''}`), refetchInterval: 60_000 });
  const rel = useQuery({ queryKey: ['programme', 'reliability'], queryFn: () => api<ReliabilityDto>('/camo/reliability?days=90') });
  const items = useMemo(() => (due.data ?? []).filter(d => showAll || d.status !== 'OK' && d.status !== 'COMPLIED'), [due.data, showAll]);
  const selTail = selected.length ? due.data?.find(d => `${d.tail}|${d.requirementId}` === selected[0])?.tail : null;
  const toggle = (d: DueItemDto) => {
    const k = `${d.tail}|${d.requirementId}`;
    setSelected(s => (s.includes(k) ? s.filter(x => x !== k) : selTail && selTail !== d.tail ? [k] : [...s, k]));
  };

  return (
    <>
      <Head
        crumb="CAMO / Maintenance programme"
        title="Due List & Airworthiness"
        desc="Scheduled tasks, airworthiness directives and life-limited parts — whichever of hours, cycles or days comes first. Hours and cycles come from Flight Ops as flights land; compliance comes from AMO certificates of release."
      />
      <div className="kpis">
        {(fleet.data ?? []).map(a => (
          <button key={a.reg} className={`kpi ac ${a.airworthy ? '' : 'red'} ${tail === a.reg ? 'on' : ''}`} onClick={() => navigate({ search: { tail: tail === a.reg ? undefined : a.reg } })}>
            <div className="l">{a.reg} · {a.type}</div>
            <div className="v" style={{ fontSize: 17 }}>{num(a.counters.fh)} FH · {num(a.counters.fc)} FC</div>
            <div className="s">
              {a.airworthy ? <Pill tone="green">airworthy</Pill> : <Pill tone="red">not airworthy</Pill>}{' '}
              {a.due.overdue > 0 && <Pill tone="red">{a.due.overdue} overdue</Pill>}{' '}
              {a.due.inTolerance > 0 && <Pill tone="amber">{a.due.inTolerance} in tol.</Pill>}{' '}
              {a.due.dueSoon > 0 && <Pill tone="cyan">{a.due.dueSoon} due soon</Pill>}
            </div>
            {!a.airworthy && <div className="s" style={{ color: 'var(--red)' }}>{a.reasons.join('; ')}</div>}
          </button>
        ))}
      </div>
      {fleet.error && <div className="callout red">{(fleet.error as Error).message}</div>}
      <div className="grid g-wide">
        <Card title={tail ? `Due list · ${tail}` : 'Due list · fleet'} meta={`${items.length} item(s)`} flush>
          <div className="card-b row between">
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> <span className="note">show items that are not yet due</span></label>
            <button className="btn pri" disabled={!selected.length} onClick={() => setCreating(true)}>Create work package ({selected.length})</button>
          </div>
          <div className="tbl-wrap" style={{ maxHeight: '60vh' }}>
            <table className="t">
              <thead><tr><th /><th>Aircraft</th><th>Item</th><th>Status</th><th>Remaining</th><th>Forecast</th><th>Last done</th></tr></thead>
              <tbody>
                {items.map(d => {
                  const k = `${d.tail}|${d.requirementId}`;
                  const can = d.status !== 'COMPLIED' && !d.wpId;
                  return (
                    <tr key={k}>
                      <td>{can && <input type="checkbox" aria-label={`Select ${d.ref} on ${d.tail}`} checked={selected.includes(k)} onChange={() => toggle(d)} />}</td>
                      <td className="mono">{d.tail}</td>
                      <td>
                        <Pill tone={d.kind === 'AD' ? 'mag' : ''}>{kindLabel[d.kind]}</Pill> <b>{d.ref}</b>
                        <div className="sub">{d.title}{d.component ? ` · ${d.component.position} s/n ${d.component.serial}` : ''}</div>
                      </td>
                      <td><Pill tone={statusTone[d.status]}>{d.status.replace('_', ' ').toLowerCase()}</Pill>{d.wpId && <div className="note mono">{d.wpId}</div>}</td>
                      <td className="mono">{remaining(d)}{d.limiting && <div className="note">limit: {d.limiting}</div>}</td>
                      <td className="mono">{d.forecast ? d.forecast.slice(0, 10) : '—'}</td>
                      <td className="note">{d.lastDone ? `${d.lastDone.at.slice(0, 10)} · ${d.lastDone.reference}` : 'since delivery'}</td>
                    </tr>
                  );
                })}
                {items.length === 0 && !due.isLoading && <tr><td colSpan={7} className="empty">Nothing due. Tick “show items that are not yet due” for the full programme.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Reliability · defects / 1000 FH" meta={rel.data ? `${rel.data.windowDays} d · ${num(rel.data.fleetFh)} FH` : ''}>
          {(rel.data?.rates ?? []).map(r => {
            const max = Math.max(...(rel.data?.rates ?? []).map(x => Math.max(x.ratePer1000Fh, x.alertLevel)), 1);
            return (
              <div key={r.ata} className="rel">
                <span className="mono">ATA {r.ata}</span>
                <div className="relbar">
                  <i className={r.alert ? 'red' : 'cyan'} style={{ width: `${(100 * r.ratePer1000Fh) / max}%` }} />
                  <b style={{ left: `${(100 * r.alertLevel) / max}%` }} title={`Alert level ${r.alertLevel}`} />
                </div>
                <span className="mono">{r.ratePer1000Fh.toFixed(2)}</span>
                {r.alert && <Pill tone="red">alert</Pill>}
              </div>
            );
          })}
          {rel.data && rel.data.rates.length === 0 && <div className="empty">No defects in the window.</div>}
          <p className="note">Defects are technical-log deferrals. The marker is the operator's alert level for the chapter (AMC M.A.302(f) reliability programme).</p>
        </Card>
      </div>
      {creating && selTail && (
        <CreateWp tail={selTail} requirementIds={selected.map(k => k.split('|')[1])} onClose={() => setCreating(false)} onDone={wp => { setCreating(false); setSelected([]); void navigate({ to: '/camo/work-packages', search: { wp: wp.id } }); }} />
      )}
    </>
  );
}

function CreateWp({ tail, requirementIds, onClose, onDone }: { tail: string; requirementIds: string[]; onClose(): void; onDone(wp: WorkPackageDto): void }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const [title, setTitle] = useState(`Night stop ${tail}`);
  const m = useMutation({
    mutationFn: () => post<WorkPackageDto>('/camo/work-packages', { tail, requirementIds, title, station: 'ENGM' }),
    onSuccess: wp => { toast(`${wp.id} created for ${tail}`, 'green'); void qc.invalidateQueries({ queryKey: ['programme'] }); onDone(wp); }
  });
  return (
    <Dialog title={`New work package — ${tail}`} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn pri" disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Creating…' : 'Create'}</button>
    </>}>
      <div className="field"><label htmlFor="wp-title">Title</label><input id="wp-title" className="inp" value={title} onChange={e => setTitle(e.target.value)} /></div>
      <p className="note">{requirementIds.length} item(s) at Oslo (ENGM). Plan it into a hangar slot next, then release it to the AMO.</p>
      <ErrorNote error={m.error} />
    </Dialog>
  );
}

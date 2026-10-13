import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { MeDto, TaskCardDto } from '@aeroos/contracts';
import { api } from '../../lib/api';
import { Card, Head, Pill } from '../../components/ui';
import { TaskCardDrawer } from './TaskCardDrawer';

const statusTone = (s: TaskCardDto['status']) => (s === 'CERTIFIED' ? 'green' : s === 'IN_PROGRESS' ? 'mag' : 'cyan');

/** Tablet-first: large touch targets for gloved hands on the hangar floor. */
export function TaskCards() {
  const { card } = useSearch({ from: '/amo/task-cards' });
  const navigate = useNavigate({ from: '/amo/task-cards' });
  const q = useQuery({ queryKey: ['task-cards', 'list'], queryFn: () => api<TaskCardDto[]>('/amo/task-cards') });
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') });
  const open = (q.data ?? []).filter(c => c.status !== 'CERTIFIED');
  const done = (q.data ?? []).filter(c => c.status === 'CERTIFIED');
  const licence = me.data?.personnel?.licenceNo;

  return (
    <>
      <Head
        crumb="AMO / Part-145 production"
        title="Hangar Floor — Task Cards"
        desc="Each step is stamped with an electronic signature bound to your licence, after the rulepack confirms you may certify this work. The CRS closes the CAMO deferral automatically."
        actions={licence && <Pill tone="cyan">{me.data?.name} · {licence}</Pill>}
      />
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      <div className="tablet">
        {open.map(c => {
          const stamped = c.steps.filter(s => s.stamp).length;
          return (
            <button key={c.id} className="tcard" onClick={() => navigate({ search: { card: c.id } })}>
              <div className="row between"><Pill tone={statusTone(c.status)}>{c.status.replace('_', ' ')}</Pill><span className="mono note">{c.id}</span></div>
              <h3>{c.title}</h3>
              <div className="row"><b className="mono" style={{ color: 'var(--cyan)', fontSize: 16 }}>{c.tail}</b><span className="note">ATA {c.ata} · {c.trade.toLowerCase()} · {c.source.id}</span></div>
              <div className="pipe">{c.steps.map(s => <i key={s.n} className={s.stamp ? 'd' : ''} />)}</div>
              <div className="row between"><span className="sub">{stamped} of {c.steps.length} steps stamped</span><span className="btn sm pri">Open card</span></div>
            </button>
          );
        })}
        {!q.isLoading && open.length === 0 && (
          <div className="empty">No open task cards. Generate an engineering order from a MEL deferral to issue one.</div>
        )}
      </div>
      {done.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Card title="Certified" flush>
            <div className="list">
              {done.map(c => (
                <button key={c.id} className="li click" style={{ width: '100%', textAlign: 'left' }} onClick={() => navigate({ search: { card: c.id } })}>
                  <span className="sev green" />
                  <div className="row between" style={{ flex: 1 }}>
                    <span><b className="mono">{c.id}</b> {c.title}</span>
                    <Pill tone="green">{c.crs?.number}</Pill>
                  </div>
                </button>
              ))}
            </div>
          </Card>
        </div>
      )}
      <TaskCardDrawer id={card ?? null} onClose={() => navigate({ search: { card: undefined } })} />
    </>
  );
}

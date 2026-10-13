import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import type { MelItemDto } from '@aeroos/contracts';
import { api } from '../../lib/api';
import { catTone, zulu } from '../../lib/format';
import { useNow } from '../../lib/store';
import { Countdown, Head, Pill } from '../../components/ui';
import { MelDrawer } from './MelDrawer';
import { RaiseDeferral } from './RaiseDeferral';

const H = 3_600_000;

export function MelBoard() {
  const { item } = useSearch({ from: '/camo/mel' });
  const navigate = useNavigate({ from: '/camo/mel' });
  const [scope, setScope] = useState<'open' | 'closed'>('open');
  const [raising, setRaising] = useState(false);
  const q = useQuery({ queryKey: ['mel', 'list', scope], queryFn: () => api<MelItemDto[]>(`/camo/mel-items?scope=${scope}`) });
  const now = Math.floor(useNow() / 30_000) * 30_000;
  const rows = q.data ?? [];
  const open = rows.filter(r => r.status === 'OPEN');

  const cols = useMemo<ColDef<MelItemDto>[]>(() => [
    {
      headerName: 'Countdown', field: 'deadline', width: 160, sort: 'asc',
      cellRenderer: (p: ICellRendererParams<MelItemDto>) => p.data!.status === 'CLOSED' ? <Pill tone="green">Closed</Pill> : <Countdown until={p.data!.deadline} />
    },
    { headerName: 'Cat', field: 'category', width: 80, cellRenderer: (p: ICellRendererParams<MelItemDto>) => <Pill tone={catTone(p.value)}>Cat {p.value}</Pill> },
    { headerName: 'Deferral', field: 'id', width: 110, cellClass: 'mono' },
    { headerName: 'Tail', field: 'tail', width: 100, cellClass: 'mono' },
    { headerName: 'MEL', field: 'melRef', width: 100, cellClass: 'mono' },
    { headerName: 'Item', field: 'title', flex: 1, minWidth: 200 },
    { headerName: 'Due', field: 'deadline', width: 140, valueFormatter: p => zulu(p.value), cellClass: 'mono' },
    {
      headerName: 'Engineering order', field: 'eoId', width: 170,
      cellRenderer: (p: ICellRendererParams<MelItemDto>) => p.value ? <Pill tone="green">{p.value}</Pill> : <span className="note">—</span>
    },
    { headerName: 'Rule', field: 'deadlineRule', width: 130, cellClass: 'mono' }
  ], []);

  return (
    <>
      <Head
        crumb="CAMO / Airworthiness"
        title="Defect & MEL Management"
        desc="Deferred defects against the operator's approved MEL. Deadlines come from the rulepack in force, and escalations run as durable workflows even when nobody is watching."
        actions={<>
          <div className="seg">
            <button className={scope === 'open' ? 'on' : ''} onClick={() => setScope('open')}>Open</button>
            <button className={scope === 'closed' ? 'on' : ''} onClick={() => setScope('closed')}>Recently closed</button>
          </div>
          <button className="btn pri" onClick={() => setRaising(true)}>Raise deferral</button>
        </>}
      />
      {scope === 'open' && (
        <div className="kpis">
          <div className="kpi"><div className="l">Open deferrals</div><div className="v">{open.length}</div></div>
          <div className="kpi red"><div className="l">Due &lt; 6 h</div><div className="v">{open.filter(r => Date.parse(r.deadline) - now < 6 * H).length}</div></div>
          <div className="kpi amber"><div className="l">Due &lt; 24 h</div><div className="v">{open.filter(r => Date.parse(r.deadline) - now < 24 * H).length}</div></div>
          <div className="kpi red"><div className="l">Expired</div><div className="v">{rows.filter(r => r.status === 'EXPIRED').length}</div></div>
          <div className="kpi cyan"><div className="l">With engineering order</div><div className="v">{open.filter(r => r.eoId).length}</div></div>
        </div>
      )}
      {q.error && <div className="callout red">{(q.error as Error).message}</div>}
      <div className="ag-theme-quartz-dark grid-host">
        <AgGridReact<MelItemDto>
          rowData={rows}
          columnDefs={cols}
          getRowId={p => p.data.id}
          rowHeight={46}
          animateRows
          onRowClicked={e => e.data && navigate({ search: { item: e.data.id } })}
          overlayNoRowsTemplate={q.isLoading ? 'Loading…' : 'No deferrals'}
        />
      </div>
      <MelDrawer id={item ?? null} onClose={() => navigate({ search: { item: undefined } })} />
      {raising && <RaiseDeferral onClose={id => { setRaising(false); if (id) navigate({ search: { item: id } }); }} />}
    </>
  );
}

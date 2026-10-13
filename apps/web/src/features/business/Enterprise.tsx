import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EnterpriseDto } from '@aeroos/contracts';
import { api, post } from '../../lib/api';
import { useUi } from '../../lib/store';
import { Card, ErrorNote, Head, Pill } from '../../components/ui';

const KINDS = ['FLIGHT_OPS', 'MAINTENANCE', 'CAMO', 'MRO_SALES', 'STORES', 'ADMIN'] as const;

/** Enterprise structure: the group's legal entities, the approvals each holds and their cost centres. */
export function Enterprise() {
  const q = useQuery({ queryKey: ['enterprise'], queryFn: () => api<EnterpriseDto>('/org/enterprise') });
  const d = q.data;
  const depth = (id: string | null, n = 0): number => (id ? depth(d?.entities.find(e => e.id === id)?.parentId ?? null, n + 1) : n);
  return (
    <>
      <Head crumb="Organization / Enterprise structure" title="Enterprise Structure"
        desc="Legal entities of the group, the approvals each holds (AOC, Part-145, Part-CAMO…) with their expiry, and the cost centres the ledger and maintenance billing post to." />
      <ErrorNote error={q.error} />
      {d?.entities.map(e => (
        <div key={e.id} style={{ marginLeft: Math.max(0, depth(e.parentId)) * 24 }}>
          <Card title={`${e.name}`} meta={`${e.id} · ${e.country} · ${e.orgNumber ?? ''}${e.parentId ? ` · owned by ${e.parentId}` : ''}`}>
            {e.approvals.length > 0 && <div className="tbl-wrap"><table className="t">
              <thead><tr><th>Approval</th><th>Reference</th><th>Authority</th><th>Valid until</th><th>Scope</th></tr></thead>
              <tbody>{e.approvals.map(a => (
                <tr key={a.reference}><td>{a.kind}</td><td className="mono">{a.reference}</td><td>{a.authority}</td>
                  <td>{a.validUntil ? <><span className="mono">{a.validUntil}</span> <Pill tone={a.daysLeft! < 0 ? 'red' : a.daysLeft! <= 90 ? 'amber' : 'green'}>{a.daysLeft! < 0 ? 'expired' : `${a.daysLeft} days`}</Pill></> : 'unlimited'}</td>
                  <td className="note">{a.scope}</td></tr>
              ))}</tbody>
            </table></div>}
            <div className="note" style={{ marginTop: 6 }}>Cost centres: {e.costCentres.map(c => `${c.code} ${c.name}${c.manager ? ` (${c.manager})` : ''}`).join(' · ') || 'none'}</div>
          </Card>
        </div>
      ))}
      {d?.permissions.manage && <AddCostCentre d={d} />}
    </>
  );
}

function AddCostCentre({ d }: { d: EnterpriseDto }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const [f, setF] = useState({ code: '', entityId: d.entities[0]?.id ?? '', name: '', kind: 'ADMIN' as (typeof KINDS)[number], manager: '' });
  const add = useMutation({ mutationFn: () => post<EnterpriseDto>('/org/enterprise/cost-centres', { ...f, manager: f.manager || undefined }),
    onSuccess: r => { qc.setQueryData(['enterprise'], r); toast(`Cost centre ${f.code} added`, 'green'); setF({ ...f, code: '', name: '' }); } });
  return (
    <Card title="Add cost centre">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field"><label htmlFor="cc-code">Code</label><input id="cc-code" className="inp" value={f.code} onChange={e => setF({ ...f, code: e.target.value.toUpperCase() })} /></div>
        <div className="field"><label htmlFor="cc-ent">Entity</label><select id="cc-ent" className="inp" value={f.entityId} onChange={e => setF({ ...f, entityId: e.target.value })}>{d.entities.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        <div className="field" style={{ flex: 1 }}><label htmlFor="cc-name">Name</label><input id="cc-name" className="inp" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="cc-kind">Kind</label><select id="cc-kind" className="inp" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as (typeof KINDS)[number] })}>{KINDS.map(k => <option key={k} value={k}>{k.replace('_', ' ').toLowerCase()}</option>)}</select></div>
        <div className="field"><label htmlFor="cc-mgr">Manager</label><input id="cc-mgr" className="inp" value={f.manager} onChange={e => setF({ ...f, manager: e.target.value })} /></div>
        <button className="btn" disabled={f.code.length < 3 || f.name.trim().length < 3 || add.isPending} onClick={() => add.mutate()}>Add</button>
      </div>
      <ErrorNote error={add.error} />
    </Card>
  );
}

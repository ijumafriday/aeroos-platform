import { useQuery } from '@tanstack/react-query';
import type { CorrectiveActionDto, MeDto } from '@aeroos/contracts';
import { api } from '../../lib/api';
import { Card, Head } from '../../components/ui';
import { ActionRow } from '../shared/CorrectiveActions';

/** Safety-owned actions only. Quality findings never appear in this workspace. */
export function SafetyActions() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') });
  const isSafety = !!me.data?.roles.includes('safety_manager');
  const mine = useQuery({ queryKey: ['safety-actions', 'mine'], queryFn: () => api<CorrectiveActionDto[]>('/safety/actions?scope=mine') });
  const all = useQuery({ queryKey: ['safety-actions', 'open'], queryFn: () => api<CorrectiveActionDto[]>('/safety/actions?scope=open'), enabled: isSafety });
  const username = me.data?.username ?? '';
  const refresh = () => { void mine.refetch(); if (isSafety) void all.refetch(); };
  return <>
    <Head crumb="Safety" title="Safety Actions" desc="Risk controls and corrective actions arising from safety occurrences. Actions remain owned by Safety and are independently verified before occurrence closure." />
    <Card title="Assigned to you" meta={`${mine.data?.length ?? 0}`}>
      <div className="stack" style={{ gap: 6 }}>
        {(mine.data ?? []).map(a => <ActionRow key={a.id} a={a} me={username} canVerify={isSafety} onChange={refresh} />)}
        {mine.data?.length === 0 && <div className="empty">No safety actions assigned to you.</div>}
      </div>
    </Card>
    {isSafety && <Card title="All open safety actions" meta={`${all.data?.length ?? 0}`}>
      <div className="stack" style={{ gap: 6 }}>
        {(all.data ?? []).map(a => <ActionRow key={a.id} a={a} me={username} canVerify onChange={refresh} />)}
        {all.data?.length === 0 && <div className="empty">No open safety actions.</div>}
      </div>
    </Card>}
  </>;
}

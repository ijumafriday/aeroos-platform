import type { QueryClient } from '@tanstack/react-query';
import type { EventEnvelope } from '@aeroos/contracts';
import { accessToken, onTokenRenewed } from './auth';
import { selectedOperator } from './operator';
import { useUi } from './store';

interface Port { postMessage(m: unknown): void }

/** Which cached queries each event makes stale. The UI refetches only what changed. */
function staleKeys(e: EventEnvelope): string[][] {
  switch (e.type) {
    case 'camo.mel.deferred':
    case 'camo.mel.extended':
    case 'camo.mel.closed':
    case 'camo.mel.expired':
      return [['mel'], ['ops']]; // dispatchability shown in the OCC follows CAMO
    case 'camo.eo.released':
      return [['mel'], ['task-cards']];
    case 'amo.taskcard.created':
    case 'amo.taskcard.step_signed':
      return [['task-cards']];
    case 'amo.crs.issued':
      return [['task-cards'], ['mel']];
    case 'org.authorisation.issued':
    case 'org.authorisation.suspended':
    case 'org.authorisation.reinstated':
    case 'org.authorisation.revoked':
    case 'org.authorisation.expired':
      // Certification eligibility shown on task cards depends on the authorisation.
      return [['personnel'], ['task-cards']];
    case 'org.training.recorded':
      return [['personnel'], ['task-cards']];
    case 'camo.wp.planned':
    case 'camo.wp.released':
    case 'camo.wp.completed':
    case 'camo.requirement.complied':
      return [['programme'], ['stores'], ['task-cards'], ['ops']];
    case 'camo.airworthiness.changed':
      return [['programme'], ['ops']];
    case 'ops.flight.departed':
    case 'ops.flight.diverted':
    case 'ops.flight.arrived':
      return [['ops'], ['programme']];
    case 'ops.flight.delayed':
    case 'ops.flight.cancelled':
    case 'ops.flight.tail_changed':
    case 'ops.dispatch.changed':
    case 'ops.recovery.proposed':
    case 'ops.recovery.applied':
    case 'ops.crew.reassigned':
      return [['ops']];
    case 'platform.notification.raised':
      return [['notifications']];
    default:
      return [];
  }
}

export async function startLive(queryClient: QueryClient) {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const onMessage = (data: { type: string; connected?: boolean; events?: EventEnvelope[] }) => {
    if (data.type === 'status') useUi.getState().setLive(!!data.connected);
    if (data.type === 'events' && data.events) {
      const keys = new Map<string, string[]>();
      for (const e of data.events) {
        staleKeys(e).forEach(k => keys.set(k.join('/'), k));
        if (e.type === 'platform.notification.raised' && (!selectedOperator() || e.operatorId === selectedOperator())) {
          const n = (e as EventEnvelope<'platform.notification.raised'>).data;
          useUi.getState().toast(n.title, n.severity);
        }
      }
      keys.forEach(k => void queryClient.invalidateQueries({ queryKey: k }));
    }
  };

  let port: Port;
  if (typeof SharedWorker !== 'undefined') {
    const w = new SharedWorker(new URL('./live.worker.ts', import.meta.url), { type: 'module', name: 'aeroos-live' });
    w.port.onmessage = e => onMessage(e.data);
    w.port.start();
    port = w.port;
  } else {
    const w = new Worker(new URL('./live.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = e => onMessage(e.data);
    port = w;
  }
  port.postMessage({ type: 'init', url, token: await accessToken() });
  onTokenRenewed(token => port.postMessage({ type: 'token', token }));
}

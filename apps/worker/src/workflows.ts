import { condition, defineQuery, defineSignal, patched, proxyActivities, setHandler, type WorkflowInterceptorsFactory } from '@temporalio/workflow';
import { OpenTelemetryInboundInterceptor, OpenTelemetryInternalsInterceptor, OpenTelemetryOutboundInterceptor } from '@temporalio/interceptors-opentelemetry/lib/workflow';
import type * as activities from './activities';
import { plan, resetAfterExtension, type Level } from './schedule';

/** Tracing inside the sandbox: spans go to the worker's exporter sink (see otel.ts). */
export const interceptors: WorkflowInterceptorsFactory = () => ({
  inbound: [new OpenTelemetryInboundInterceptor()],
  outbound: [new OpenTelemetryOutboundInterceptor()],
  internals: [new OpenTelemetryInternalsInterceptor()]
});

const { escalate } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '2 seconds', backoffCoefficient: 2, maximumInterval: '1 minute' }
});

const { orgSweep, anchorAuditChains, camoAirworthinessSweep, opsMovement, documentsSweep } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: { initialInterval: '10 seconds', backoffCoefficient: 2, maximumInterval: '5 minutes', maximumAttempts: 10 }
});

/**
 * Hourly (cron set by the API). Each run is one short execution; Temporal keeps the history of
 * every sweep — what expired and how many warnings were sent — as operational evidence.
 */
export async function orgSweepWorkflow(): Promise<{ expired: number; warnings: number }> {
  return orgSweep();
}

/** Hourly: calendar-limited maintenance items fall due with time alone. */
export async function camoAirworthinessWorkflow(): Promise<{ changed: string[] }> {
  return camoAirworthinessSweep();
}

/** Hourly: abandoned uploads. */
export async function documentsSweepWorkflow(): Promise<{ stored: number; expired: number }> {
  return documentsSweep();
}

/** Every 5 minutes: movement simulation for flights without MVT/ACARS (MOVEMENT_SIMULATION=true). */
export async function opsMovementWorkflow(): Promise<{ departed: number; arrived: number }> {
  return opsMovement();
}

/** Hourly: anchor every audit chain head (ADR-0005). */
export async function auditAnchorWorkflow(): Promise<{ chain: string; seq: number | null; anchored: boolean }[]> {
  return anchorAuditChains();
}

export const closedSignal = defineSignal('closed');
export const extendedSignal = defineSignal<[string]>('extended');
export const stateQuery = defineQuery<{ deadline: string; sent: Level[]; closed: boolean }>('state');

export interface MelDeferralInput {
  melItemId: string;
  operatorId: string;
  deadline: string;
}

/**
 * One workflow per MEL deferral. Durable timers fire the T-24h, T-6h and expiry escalations even
 * across restarts and deployments. A "closed" signal (CRS issued) ends it; "extended" moves the
 * deadline. If CAMO reports the item is no longer open, the workflow ends on its own — so events
 * arriving out of order can never leave a workflow escalating a closed deferral.
 */
export async function melDeferralWorkflow(input: MelDeferralInput): Promise<string> {
  // Explicit Temporal patch ID keeps replay deterministic across long-running MEL histories.
  // Retire this patch only through the governed workflow-version migration plan.
  const extensionResetV2 = patched('mel-deferral-extension-reset-v2');
  let deadline = Date.parse(input.deadline);
  let closed = false;
  let changed = false;
  const sent = new Set<Level>();

  setHandler(closedSignal, () => {
    closed = true;
  });
  setHandler(extendedSignal, iso => {
    deadline = Date.parse(iso);
    changed = true;
  });
  setHandler(stateQuery, () => ({ deadline: new Date(deadline).toISOString(), sent: [...sent], closed }));

  while (!closed) {
    if (changed) {
      changed = false;
      if (extensionResetV2) resetAfterExtension(deadline, Date.now(), sent);
      else resetAfterExtension(deadline, Date.now(), sent);
    }
    const step = plan(deadline, Date.now(), sent);
    if (step.send) {
      step.markSent.forEach(l => sent.add(l));
      const { active } = await escalate(input.melItemId, step.send);
      if (!active) return 'ended: deferral no longer open';
      continue;
    }
    if (step.waitMs === null) await condition(() => closed || changed);
    else await condition(() => closed || changed, step.waitMs);
  }
  return 'ended: deferral closed';
}

import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Client, Connection, WorkflowExecutionAlreadyStartedError, WorkflowNotFoundError } from '@temporalio/client';
import { OpenTelemetryWorkflowClientInterceptor } from '@temporalio/interceptors-opentelemetry';
import { CONFIG, type Config } from '../../config';

export const CAMO_TASK_QUEUE = 'camo';
export const PLATFORM_TASK_QUEUE = 'platform';
/** Served by the Python optimiser (services/optimiser). */
export const OPTIMISER_TASK_QUEUE = 'optimiser';

/** Recurring platform workflows: [workflow type, fixed workflow id, cron]. */
export const RECURRING = [
  ['orgSweepWorkflow', 'org-expiry-sweep', '7 * * * *'],
  ['auditAnchorWorkflow', 'audit-anchor', '17 * * * *'],
  ['camoAirworthinessWorkflow', 'camo-airworthiness-sweep', '27 * * * *'],
  ['opsMovementWorkflow', 'ops-movement', '*/5 * * * *'],
  ['documentsSweepWorkflow', 'documents-upload-sweep', '41 * * * *']
] as const;
export const melWorkflowId = (melItemId: string) => `mel-deferral-${melItemId}`;

/**
 * Commands go to Temporal; facts go to Kafka. This service starts and signals durable workflows.
 * Connection is lazy so the API boots even while Temporal is still starting; callers run inside
 * Kafka consumers, which retry with backoff.
 */
@Injectable()
export class TemporalService implements OnApplicationShutdown {
  private readonly log = new Logger('Temporal');
  private client: Promise<Client> | null = null;
  private connection: Connection | null = null;

  constructor(@Inject(CONFIG) private readonly config: Config) {}

  private getClient(): Promise<Client> {
    this.client ??= (async () => {
      const connection = await Connection.connect({ address: this.config.TEMPORAL_ADDRESS });
      this.connection = connection;
      // Trace context travels in workflow headers, so the worker's spans join the API request's trace.
      return new Client({ connection, namespace: this.config.TEMPORAL_NAMESPACE, interceptors: { workflow: [new OpenTelemetryWorkflowClientInterceptor()] } });
    })().catch(e => {
      this.client = null;
      throw e;
    });
    return this.client;
  }

  async startMelDeferral(input: { melItemId: string; operatorId: string; deadline: string }) {
    const client = await this.getClient();
    try {
      await client.workflow.start('melDeferralWorkflow', {
        taskQueue: CAMO_TASK_QUEUE,
        workflowId: melWorkflowId(input.melItemId),
        args: [input]
      });
    } catch (e) {
      if (e instanceof WorkflowExecutionAlreadyStartedError) return; // redelivered event — already running
      throw e;
    }
  }

  /** Cross-language: the workflow is implemented in Python; arguments travel as JSON. */
  async startRecovery(runId: string, problem: unknown) {
    const client = await this.getClient();
    try {
      await client.workflow.start('RecoveryWorkflow', {
        taskQueue: OPTIMISER_TASK_QUEUE, workflowId: `recovery-${runId}`, args: [problem], workflowExecutionTimeout: '15 minutes'
      });
    } catch (e) {
      if (e instanceof WorkflowExecutionAlreadyStartedError) return;
      throw e;
    }
  }

  async startCrewRecovery(runId: string, problem: unknown) {
    const client = await this.getClient();
    try {
      await client.workflow.start('CrewRecoveryWorkflow', {
        taskQueue: OPTIMISER_TASK_QUEUE, workflowId: `crew-recovery-${runId}`, args: [problem], workflowExecutionTimeout: '15 minutes'
      });
    } catch (e) {
      if (e instanceof WorkflowExecutionAlreadyStartedError) return;
      throw e;
    }
  }

  async signalMel(melItemId: string, signal: 'closed' | 'extended', arg?: string) {
    const client = await this.getClient();
    try {
      const handle = client.workflow.getHandle(melWorkflowId(melItemId));
      if (arg === undefined) await handle.signal(signal);
      else await handle.signal(signal, arg);
    } catch (e) {
      if (e instanceof WorkflowNotFoundError) {
        this.log.warn(`no workflow for ${melItemId}; nothing to signal`);
        return;
      }
      throw e;
    }
  }

  /**
   * Start a cron workflow once (a running instance with the fixed id means it is already scheduled),
   * plus one immediate run per hour of start-up so a fresh stack does not wait for the first cron tick.
   * Ids are deterministic, so several API replicas starting together schedule each run only once.
   */
  async ensureRecurring(workflowType: string, workflowId: string, cronSchedule: string) {
    const client = await this.getClient();
    const startOnce = async (id: string, cron?: string) => {
      try {
        await client.workflow.start(workflowType, { taskQueue: PLATFORM_TASK_QUEUE, workflowId: id, args: [], ...(cron ? { cronSchedule: cron } : {}) });
        return true;
      } catch (e) {
        if (e instanceof WorkflowExecutionAlreadyStartedError) return false;
        throw e;
      }
    };
    if (await startOnce(workflowId, cronSchedule)) this.log.log(`scheduled ${workflowType} (${cronSchedule})`);
    await startOnce(`${workflowId}-startup-${new Date().toISOString().slice(0, 13)}`);
  }

  async ready(): Promise<boolean> {
    try {
      await this.getClient();
      return true;
    } catch {
      return false;
    }
  }

  async onApplicationShutdown() {
    await this.connection?.close().catch(() => undefined);
  }
}

/** Schedules the recurring workflows in the background, retrying until Temporal is reachable. */
@Injectable()
export class RecurringWorkflows implements OnApplicationBootstrap {
  private readonly log = new Logger('RecurringWorkflows');
  constructor(private readonly temporal: TemporalService) {}

  onApplicationBootstrap() {
    void this.run(1);
  }

  private async run(attempt: number): Promise<void> {
    try {
      for (const [type, id, cron] of RECURRING) await this.temporal.ensureRecurring(type, id, cron);
    } catch (e) {
      const delay = Math.min(60_000, 2_000 * attempt);
      this.log.warn(`could not schedule recurring workflows yet (${(e as Error).message}); retrying in ${delay / 1000}s`);
      setTimeout(() => void this.run(attempt + 1), delay).unref();
    }
  }
}

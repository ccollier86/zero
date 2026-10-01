/**
 * Durable workflow lifecycle orchestration.
 *
 * Each instance has one coalesced frontier pump. Different instances remain
 * concurrent, while retries, event waits, and later steps cannot pass an
 * unfinished earlier step.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { WorkflowInstanceRecord, WorkflowStepRecord } from './types';
import {
  WorkflowExecutor,
  type WorkflowClock,
} from './workflow-executor';
import { WorkflowError, workflowNotFound } from './workflow-error';
import { WorkflowFrontierPump } from './workflow-frontier-pump';
import { WorkflowInstanceFactory } from './workflow-instance-factory';
import {
  WorkflowLifecycleCoordinator,
  type WorkflowDispatchPhase,
} from './workflow-lifecycle-coordinator';
import {
  WorkflowRepository,
  type WorkflowInstanceListFilter,
} from './workflow-repository';
import type { WorkflowRegistry } from './workflow-registry';
import { WorkflowRuntimeStore } from './workflow-runtime-store';
import { resolveWorkflowShutdownGraceMs } from './workflow-shutdown-policy';
import { WorkflowTransitionController } from './workflow-transition-controller';
import {
  createNativeWorkflowWakeTimer,
  WorkflowWakeCoordinator,
  type WorkflowWakeTimer,
} from './workflow-wake-coordinator';

const systemClock: WorkflowClock = { now: () => new Date() };

export interface WorkflowServiceOptions {
  clock?: WorkflowClock;
  runtime?: WorkflowRuntimeStore;
  /**
   * Exact in-process retry/deadline timer. Custom clocks disable native timers
   * unless a deterministic timer is supplied explicitly.
   */
  wakeTimer?: WorkflowWakeTimer | false;
  /** Maximum wall-clock wait for abort-ignoring handlers during shutdown. */
  shutdownGraceMs?: number;
}

export class WorkflowService {
  private readonly runtime: WorkflowRuntimeStore;
  private readonly repository: WorkflowRepository;
  private readonly executor: WorkflowExecutor;
  private readonly lifecycle: WorkflowLifecycleCoordinator;
  private readonly transitions: WorkflowTransitionController;
  private readonly instanceFactory: WorkflowInstanceFactory;
  private readonly frontier: WorkflowFrontierPump;
  private readonly wakes: WorkflowWakeCoordinator;
  private readonly clock: WorkflowClock;
  private disposed = false;
  private disposalPromise: Promise<void> | null = null;

  constructor(
    db: ReactiveDB,
    registry: WorkflowRegistry,
    options: WorkflowServiceOptions = {},
  ) {
    this.clock = options.clock ?? systemClock;
    const shutdownGraceMs = resolveWorkflowShutdownGraceMs(options.shutdownGraceMs);
    this.runtime = options.runtime ?? new WorkflowRuntimeStore(db);
    this.repository = new WorkflowRepository(db);
    const wakeTimer = options.wakeTimer === undefined
      ? (options.clock ? false : createNativeWorkflowWakeTimer())
      : options.wakeTimer;
    this.wakes = new WorkflowWakeCoordinator(this.clock, wakeTimer, {
      retry: (wake) => this.dispatchAdvance(wake.instanceId, 'retry'),
      timeout: (wake) => this.lifecycle.handleTimeoutWake(wake),
    });
    this.executor = new WorkflowExecutor(
      db,
      registry,
      this.runtime,
      this.clock,
      this.repository,
      this.wakes,
      shutdownGraceMs,
    );
    this.lifecycle = new WorkflowLifecycleCoordinator(
      this.repository,
      registry,
      this.runtime,
      this.executor,
      this.clock,
      this.wakes,
    );
    this.transitions = new WorkflowTransitionController(
      this.repository,
      this.runtime,
      this.executor,
      this.lifecycle,
      this.clock,
      this.wakes,
    );
    this.instanceFactory = new WorkflowInstanceFactory(
      registry,
      this.repository,
      this.clock,
    );
    this.frontier = new WorkflowFrontierPump(
      this.repository,
      this.runtime,
      this.executor,
      this.clock,
      this.wakes,
    );
  }

  /** Create an instance and drive its first legal frontier. */
  async start(name: string, input?: unknown, startedBy?: string): Promise<string> {
    this.assertAvailable();
    this.markOperationStarted();
    const created = this.instanceFactory.create(name, input, startedBy);

    emitPlatformCode(OBS_CODES.WORKFLOW_INSTANCE_STARTED, {
      metadata: {
        instanceId: created.instanceId,
        name: created.name,
        startedBy: startedBy ?? null,
      },
    });
    await this.advance(created.instanceId);
    return created.instanceId;
  }

  async run(name: string, input?: unknown, startedBy?: string): Promise<string> {
    return this.start(name, input, startedBy);
  }

  /** Coalesce concurrent triggers into one per-instance frontier pump. */
  async advance(instanceId: string): Promise<void> {
    if (this.disposed) return;
    this.markOperationStarted();
    return this.frontier.advance(instanceId, () => this.advance(instanceId));
  }

  /** Persist an event as an inbox item, then let the legal frontier claim it. */
  async sendEvent(
    instanceId: string,
    eventName: string,
    payload?: unknown,
    sentBy?: string,
  ): Promise<boolean> {
    this.assertAvailable();
    this.markOperationStarted();
    if (!eventName.trim()) {
      throw new WorkflowError('Event name is required', 'WORKFLOW_EVENT_INVALID', 422);
    }
    if (eventName !== eventName.trim()) {
      throw new WorkflowError(
        'Event name must not include surrounding whitespace',
        'WORKFLOW_EVENT_INVALID',
        422,
      );
    }
    const serializedPayload = serializeJson(
      payload,
      'Workflow event payload is not JSON-serializable',
      'WORKFLOW_EVENT_INVALID',
    );
    const eventId = crypto.randomUUID();
    const createdAt = this.clock.now().toISOString();
    let shouldAdvance = false;

    this.repository.transaction(() => {
      const instance = this.getInstanceRecord(instanceId);
      if (!instance) throw workflowNotFound();
      if (instance.status !== 'running' && instance.status !== 'paused') {
        throw new WorkflowError(
          `Cannot send an event to a ${instance.status} workflow`,
          'WORKFLOW_STATE_INVALID',
          409,
        );
      }
      shouldAdvance = instance.status === 'running';
      this.repository.insertEvent({
        event_id: eventId,
        instance_id: instanceId,
        event_name: eventName,
        payload: serializedPayload,
        sent_by: sentBy ?? null,
        created_at: createdAt,
      });
      this.runtime.recordDeliverableEvent(eventId, instanceId, eventName, createdAt);
    });

    if (shouldAdvance) await this.advance(instanceId);
    return this.runtime.isEventClaimed(eventId);
  }

  cancel(instanceId: string): void {
    this.assertAvailable();
    this.markOperationStarted();
    this.transitions.cancel(instanceId);
  }

  stop(instanceId: string): void {
    this.cancel(instanceId);
  }

  pause(instanceId: string): void {
    this.assertAvailable();
    this.markOperationStarted();
    this.transitions.pause(instanceId);
  }

  async resume(instanceId: string): Promise<void> {
    this.assertAvailable();
    this.markOperationStarted();
    await this.transitions.resume(
      instanceId,
      () => this.assertAvailable(),
      (id) => this.advance(id),
    );
  }

  /** Discover due instances; the normal frontier pump performs every retry. */
  async pollRetries(): Promise<number> {
    if (this.disposed) return 0;
    return this.lifecycle.pollRetries((instanceId, phase) => {
      this.dispatchAdvance(instanceId, phase);
    });
  }

  /** Expire only a still-current deadline after a transactional reread. */
  pollTimeouts(): number {
    if (this.disposed) return 0;
    return this.lifecycle.pollTimeouts();
  }

  /** Preflight every live handler, then normalize and re-drive crash-left work. */
  async recoverInFlight(onReady?: () => void): Promise<number> {
    return this.lifecycle.recoverInFlight(
      (instanceId, phase) => this.dispatchAdvance(instanceId, phase),
      () => this.assertAvailable(),
      onReady,
    );
  }

  dispose(): Promise<void> {
    if (this.disposalPromise) return this.disposalPromise;
    this.disposed = true;
    this.frontier.stop();
    this.disposalPromise = (async () => {
      let lifecycleError: unknown;
      try {
        await this.lifecycle.dispose();
      } catch (error) {
        lifecycleError = error;
      }
      await this.frontier.drain();
      if (lifecycleError !== undefined) throw lifecycleError;
    })();
    return this.disposalPromise;
  }

  getInstance(instanceId: string): Record<string, unknown> | null {
    return this.repository.getInstance(instanceId) as unknown as Record<string, unknown> | null;
  }

  get(instanceId: string): Record<string, unknown> | null {
    return this.getInstance(instanceId);
  }

  getSteps(instanceId: string): WorkflowStepRecord[] {
    return this.repository.getSteps(instanceId);
  }

  getEvents(instanceId: string): Record<string, unknown>[] {
    return this.repository.getEvents(instanceId);
  }

  listInstances(filter?: WorkflowInstanceListFilter): Record<string, unknown>[] {
    return this.repository.listInstances(filter);
  }

  list(filter?: Parameters<WorkflowService['listInstances']>[0]): Record<string, unknown>[] {
    return this.listInstances(filter);
  }

  private getInstanceRecord(instanceId: string): WorkflowInstanceRecord | null {
    return this.repository.getInstance(instanceId);
  }

  private dispatchAdvance(
    instanceId: string,
    phase: WorkflowDispatchPhase,
  ): void {
    void this.advance(instanceId).catch((error) => {
      emitPlatformCode(OBS_CODES.WORKFLOW_ADVANCE_FAILED, {
        error,
        metadata: { instanceId, phase },
      });
    });
  }

  private assertAvailable(): void {
    if (this.disposed) {
      throw new WorkflowError(
        'Workflow service is not available',
        'WORKFLOW_NOT_READY',
        503,
      );
    }
  }

  private markOperationStarted(): void {
    this.lifecycle.markOperationStarted();
  }
}

function serializeJson(
  value: unknown,
  message: string,
  code: 'WORKFLOW_INPUT_INVALID' | 'WORKFLOW_EVENT_INVALID',
): string | null {
  if (value === undefined) return null;
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError(message);
    return serialized;
  } catch {
    throw new WorkflowError(message, code, 422);
  }
}

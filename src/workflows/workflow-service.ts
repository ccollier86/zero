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
  createOwnerFencedWorkflowExecutor,
  type WorkflowExecutor,
  type WorkflowClock,
} from './workflow-executor';
import { WorkflowError, workflowNotFound } from './workflow-error';
import { WorkflowFrontierPump } from './workflow-frontier-pump';
import { WorkflowGraphRuntime } from './workflow-graph-runtime';
import { WorkflowInstanceFactory } from './workflow-instance-factory';
import type { WorkflowInteractionAuthority } from './workflow-interaction-authority';
import type { WorkflowInteractionActor } from './workflow-interaction-authority';
import { serializeWorkflowEventActor } from './workflow-event-actor';
import {
  WorkflowLifecycleCoordinator,
  type WorkflowDispatchPhase,
} from './workflow-lifecycle-coordinator';
import {
  WorkflowRepository,
  type WorkflowInstanceListFilter,
} from './workflow-repository';
import type { WorkflowRegistry } from './workflow-registry';
import {
  MAX_WORKFLOW_EVENT_NAME_LENGTH,
  WorkflowRuntimeStore,
} from './workflow-runtime-store';
import { serializeWorkflowRuntimeJson } from './workflow-runtime-json';
import { resolveWorkflowShutdownGraceMs } from './workflow-shutdown-policy';
import {
  validateWorkflowStartOptions,
  type WorkflowStartOptions,
} from './workflow-start-options';
import { tryStartWorkflowGraph } from './workflow-start-router';
import { WorkflowTransitionController } from './workflow-transition-controller';
import {
  createNativeWorkflowWakeTimer,
  WorkflowWakeCoordinator,
  type WorkflowWakeTimer,
} from './workflow-wake-coordinator';
import {
  WorkflowRuntimeOwnerLease,
  type WorkflowRuntimeOwnershipOptions,
} from './workflow-runtime-owner-lease';

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
  /** Optional Guardian/app policy adapter for graph interaction responses. */
  interactionAuthority?: WorkflowInteractionAuthority;
  /** Durable single-owner lease configuration; defaults are production-safe. */
  runtimeOwnership?: WorkflowRuntimeOwnershipOptions;
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
  private readonly graph: WorkflowGraphRuntime;
  private readonly clock: WorkflowClock;
  private readonly ownerLease: WorkflowRuntimeOwnerLease;
  private disposed = false;
  private disposalPromise: Promise<void> | null = null;

  constructor(
    db: ReactiveDB,
    private readonly registry: WorkflowRegistry,
    options: WorkflowServiceOptions = {},
  ) {
    this.clock = options.clock ?? systemClock;
    this.ownerLease = new WorkflowRuntimeOwnerLease(db, options.runtimeOwnership);
    try {
      const shutdownGraceMs = resolveWorkflowShutdownGraceMs(options.shutdownGraceMs);
      const wakeTimer = options.wakeTimer === undefined
        ? (options.clock ? false : createNativeWorkflowWakeTimer())
        : options.wakeTimer;
      this.runtime = WorkflowRuntimeStore.createOwnerFenced(
        db,
        this.ownerLease,
        options.runtime,
        () => this.clock.now(),
      );
      this.graph = new WorkflowGraphRuntime(db, registry, {
        now: () => this.clock.now(),
        shutdownGraceMs,
        interactionAuthority: options.interactionAuthority,
        wakeTimer,
        runtime: this.runtime,
        runtimeFence: this.ownerLease,
      });
      this.repository = new WorkflowRepository(db, this.ownerLease);
      this.wakes = new WorkflowWakeCoordinator(this.clock, wakeTimer, {
        retry: (wake) => this.dispatchAdvance(wake.instanceId, 'retry'),
        timeout: (wake) => this.lifecycle.handleTimeoutWake(wake),
      });
      this.executor = createOwnerFencedWorkflowExecutor(
        db,
        registry,
        this.runtime,
        this.clock,
        this.repository,
        this.wakes,
        shutdownGraceMs,
        this.ownerLease,
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
      this.ownerLease.onLost((error) => this.quiesceAfterOwnershipLoss(error));
    } catch (error) {
      this.ownerLease.release();
      throw error;
    }
  }

  /** Create an instance and drive its first legal frontier. */
  async start(
    name: string,
    input?: unknown,
    startedBy?: string,
    options: WorkflowStartOptions = {},
  ): Promise<string> {
    this.assertAvailable();
    this.markOperationStarted();
    const startOptions = validateWorkflowStartOptions(options);
    const graphInstanceId = await tryStartWorkflowGraph({
      graph: this.graph, registry: this.registry, name, workflowInput: input,
      startedBy: startedBy ?? null, options: startOptions,
    });
    if (graphInstanceId) return graphInstanceId;
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

  async run(
    name: string,
    input?: unknown,
    startedBy?: string,
    options?: WorkflowStartOptions,
  ): Promise<string> {
    return this.start(name, input, startedBy, options);
  }

  /** Coalesce concurrent triggers into one per-instance frontier pump. */
  async advance(instanceId: string): Promise<void> {
    if (this.disposed) return;
    this.ownerLease.assertCurrent();
    this.markOperationStarted();
    if (this.graph.isGraphInstance(instanceId)) return this.graph.advance(instanceId);
    return this.frontier.advance(instanceId, () => this.advance(instanceId));
  }

  /** Persist an event as an inbox item, then let the legal frontier claim it. */
  async sendEvent(
    instanceId: string,
    eventName: string,
    payload?: unknown,
    sentBy?: string,
    actor?: WorkflowInteractionActor,
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
    if (eventName.length > MAX_WORKFLOW_EVENT_NAME_LENGTH) {
      throw new WorkflowError(
        `Event name must be at most ${MAX_WORKFLOW_EVENT_NAME_LENGTH} characters`,
        'WORKFLOW_EVENT_INVALID',
        422,
      );
    }
    const serializedPayload = serializeWorkflowRuntimeJson(payload, {
      code: 'WORKFLOW_EVENT_INVALID', label: 'Workflow event payload',
    });
    const eventId = crypto.randomUUID();
    const createdAt = this.clock.now().toISOString();
    if (actor && sentBy && actor.actorId !== sentBy) {
      throw new WorkflowError(
        'Workflow event actor does not match its sender',
        'WORKFLOW_EVENT_INVALID',
        422,
      );
    }
    const eventActor = actor ?? (sentBy ? { actorId: sentBy } : null);
    const actorJson = serializeWorkflowEventActor(eventActor);
    const effectiveSender = sentBy ?? actor?.actorId;
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
        sent_by: effectiveSender ?? null,
        created_at: createdAt,
      });
      this.runtime.recordDeliverableEvent(
        eventId,
        instanceId,
        eventName,
        createdAt,
        actorJson,
        serializedPayload === null ? 0 : Buffer.byteLength(serializedPayload, 'utf8'),
        actorJson === null ? 0 : Buffer.byteLength(actorJson, 'utf8'),
      );
    });

    if (shouldAdvance) await this.advance(instanceId);
    return this.runtime.isEventClaimed(eventId);
  }

  cancel(instanceId: string): void {
    this.assertAvailable();
    this.markOperationStarted();
    if (this.graph.isGraphInstance(instanceId)) this.graph.cancel(instanceId);
    else this.transitions.cancel(instanceId);
  }

  stop(instanceId: string): void {
    this.cancel(instanceId);
  }

  pause(instanceId: string): void {
    this.assertAvailable();
    this.markOperationStarted();
    if (this.graph.isGraphInstance(instanceId)) this.graph.pause(instanceId);
    else this.transitions.pause(instanceId);
  }

  async resume(instanceId: string): Promise<void> {
    this.assertAvailable();
    this.markOperationStarted();
    if (this.graph.isGraphInstance(instanceId)) {
      await this.graph.resume(instanceId);
      return;
    }
    await this.transitions.resume(
      instanceId,
      () => this.assertAvailable(),
      (id) => this.advance(id),
    );
  }

  /** Discover due instances; the normal frontier pump performs every retry. */
  async pollRetries(): Promise<number> {
    if (this.disposed) return 0;
    this.ownerLease.assertCurrent();
    const legacy = this.lifecycle.pollRetries((instanceId, phase) => {
      this.dispatchAdvance(instanceId, phase);
    });
    return legacy + this.graph.pollRetries();
  }

  /** Expire only a still-current deadline after a transactional reread. */
  pollTimeouts(): number {
    if (this.disposed) return 0;
    this.ownerLease.assertCurrent();
    return this.lifecycle.pollTimeouts() + this.graph.pollTimeouts();
  }

  /** Preflight every live handler, then normalize and re-drive crash-left work. */
  async recoverInFlight(onReady?: () => void): Promise<number> {
    let graph = 0;
    const legacy = await this.lifecycle.recoverInFlight(
      (instanceId, phase) => this.dispatchAdvance(instanceId, phase),
      () => this.assertAvailable(),
      () => {
        graph = this.graph.prepareRecovery();
        onReady?.();
      },
    );
    this.graph.activateRecovery();
    return legacy + graph;
  }

  dispose(): Promise<void> {
    if (this.disposalPromise) return this.disposalPromise;
    this.disposed = true;
    this.frontier.stop();
    this.disposalPromise = (async () => {
      const failures: unknown[] = [];
      try {
        if (this.ownerLease.isCurrent()) await this.lifecycle.dispose();
        else await this.lifecycle.disposeWithoutPersistence();
      } catch (error) {
        failures.push(error);
      }
      try {
        await this.frontier.drain();
      } catch (error) {
        failures.push(error);
      }
      try {
        await this.graph.dispose();
      } catch (error) {
        failures.push(error);
      }
      try {
        this.ownerLease.release();
      } catch (error) {
        failures.push(error);
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, 'Workflow runtimes failed to dispose');
      }
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

  getGraphRuntime(): WorkflowGraphRuntime {
    return this.graph;
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
    this.ownerLease.assertCurrent();
  }

  private markOperationStarted(): void {
    this.lifecycle.markOperationStarted();
  }

  private quiesceAfterOwnershipLoss(error: WorkflowError): void {
    if (this.disposed) return;
    this.frontier.stop();
    void Promise.allSettled([
      this.lifecycle.disposeWithoutPersistence(),
      this.frontier.drain(),
      this.graph.dispose(),
    ]).then((settlements) => {
      for (const settlement of settlements) {
        if (settlement.status !== 'rejected') continue;
        emitPlatformCode(OBS_CODES.WORKFLOW_ADVANCE_FAILED, {
          error: settlement.reason,
          metadata: { phase: 'ownership-loss-quiescence', cause: error.code },
        });
      }
    });
  }
}

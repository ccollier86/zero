/**
 * workflow-service.ts
 *
 * Stable public facade, composition root, and lifecycle owner for legacy and
 * graph workflows. Focused collaborators own scope checks, reads, starts, and
 * event commands; this facade preserves their shared runtime, authority,
 * transaction, observability, recovery, and disposal boundaries.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import type { AuthContext } from '../auth/types';
import type { ServiceDataScope } from '../auth/service-data-scope';
import { OBS_CODES } from '../observability/codes';
import type {
  WorkflowEventRecord,
  WorkflowInstanceRecord,
  WorkflowStepRecord,
} from './types';
import {
  createOwnerFencedWorkflowExecutor,
  type WorkflowExecutor,
  type WorkflowClock,
} from './workflow-executor';
import {
  WorkflowExecutionAuthorityStore,
  type WorkflowExecutionAuthorityProvider,
  type WorkflowExecutionServiceProvider,
  type WorkflowSystemExecutionOptions,
} from './workflow-execution-authority';
import { WorkflowExecutionAuthorityGate } from './workflow-execution-authority-gate';
import { WorkflowError } from './workflow-error';
import {
  WorkflowEventCoordinator,
  type WorkflowEventMutationOptions,
} from './workflow-event-coordinator';
import { WorkflowSystemEventDeliveryCoordinator } from './workflow-system-event-delivery-coordinator';
import type {
  WorkflowSystemEventDeliveryOptions,
  WorkflowSystemEventDeliveryResult,
  WorkflowSystemEventDeliveryMutation,
} from './workflow-system-event-delivery-contract';
import { WorkflowFrontierPump } from './workflow-frontier-pump';
import { WorkflowGraphRuntime } from './workflow-graph-runtime';
import { WorkflowInstanceFactory } from './workflow-instance-factory';
import type { WorkflowInteractionAuthority } from './workflow-interaction-authority';
import type { WorkflowInteractionActor } from './workflow-interaction-authority';
import {
  WorkflowLifecycleCoordinator,
  type WorkflowDispatchPhase,
} from './workflow-lifecycle-coordinator';
import {
  createWorkflowObservability,
  type WorkflowObservability,
} from './workflow-observability';
import {
  WorkflowRepository,
  type WorkflowInstanceListFilter,
} from './workflow-repository';
import type { WorkflowRegistry } from './workflow-registry';
import type { WorkflowPublicTopology } from './workflow-public-topology';
import { WorkflowRunQueryService } from './workflow-run-query-service';
import { WorkflowRuntimeStore } from './workflow-runtime-store';
import { WorkflowScopeBoundary } from './workflow-scope-boundary';
import { resolveWorkflowShutdownGraceMs } from './workflow-shutdown-policy';
import {
  type WorkflowStartOptions,
} from './workflow-start-options';
import {
  WorkflowStartCoordinator,
  type WorkflowCapturedActorAuthorityFence,
} from './workflow-start-coordinator';
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
const graphRuntimes = new WeakMap<WorkflowService, WorkflowGraphRuntime>();

/** Framework-internal graph coordinator access; intentionally absent from the package barrel. */
export function getWorkflowGraphRuntime(service: WorkflowService): WorkflowGraphRuntime {
  const graph = graphRuntimes.get(service);
  if (!graph) {
    throw new WorkflowError(
      'Workflow graph runtime is not available',
      'WORKFLOW_NOT_READY',
      503,
    );
  }
  return graph;
}

export interface WorkflowServiceOptions {
  clock?: WorkflowClock;
  /**
   * @deprecated Retained as a same-database compatibility template. Each
   * service now constructs an owner-fenced runtime for its lease generation.
   */
  runtime?: WorkflowRuntimeStore;
  /** Exact in-process retry/deadline timer; false enables poll-only operation. */
  wakeTimer?: WorkflowWakeTimer | false;
  shutdownGraceMs?: number;
  interactionAuthority?: WorkflowInteractionAuthority;
  tenancyMode?: 'single' | 'multi';
  authorityStore?: WorkflowExecutionAuthorityStore;
  authorityProvider?: WorkflowExecutionAuthorityProvider | null;
  serviceProvider?: WorkflowExecutionServiceProvider | null;
  /** App-local, transaction-aware workflow event boundary. */
  observability?: WorkflowObservability;
  /** Durable single-owner lease configuration; defaults are production-safe. */
  runtimeOwnership?: WorkflowRuntimeOwnershipOptions;
  /** @internal Plugin-owner callback for retiring stale publication and jobs. */
  onRuntimeOwnershipLost?: (error: WorkflowError) => void | Promise<void>;
}

/** Public mutation authority contract retained for WorkflowService callers. */
export interface WorkflowMutationOptions extends WorkflowEventMutationOptions {}

/** Public captured-actor fence retained for WorkflowService callers. */
export interface WorkflowActorAuthorityFence extends WorkflowCapturedActorAuthorityFence {}

/** Public workflow API and owner of one composed legacy/graph runtime. */
export class WorkflowService {
  private readonly runtime: WorkflowRuntimeStore;
  private readonly repository: WorkflowRepository;
  private readonly executor: WorkflowExecutor;
  private readonly lifecycle: WorkflowLifecycleCoordinator;
  private readonly transitions: WorkflowTransitionController;
  private readonly frontier: WorkflowFrontierPump;
  private readonly graph: WorkflowGraphRuntime;
  private readonly authority: WorkflowExecutionAuthorityGate;
  private readonly observability: WorkflowObservability;
  private readonly scopes: WorkflowScopeBoundary;
  private readonly queries: WorkflowRunQueryService;
  private readonly starts: WorkflowStartCoordinator;
  private readonly events: WorkflowEventCoordinator;
  private readonly systemEventDeliveries: WorkflowSystemEventDeliveryCoordinator;
  private readonly ownerLease: WorkflowRuntimeOwnerLease;
  private readonly onRuntimeOwnershipLost:
    ((error: WorkflowError) => void | Promise<void>) | null;
  private disposed = false;
  private disposalPromise: Promise<void> | null = null;

  constructor(
    db: ReactiveDB,
    registry: WorkflowRegistry,
    modeOrOptions: 'single' | 'multi' | WorkflowServiceOptions = {},
    legacyOptions: WorkflowServiceOptions = {},
  ) {
    const options = typeof modeOrOptions === 'string' ? legacyOptions : modeOrOptions;
    const tenancyMode = typeof modeOrOptions === 'string'
      ? modeOrOptions
      : options.tenancyMode ?? 'single';
    const clock = options.clock ?? systemClock;
    this.onRuntimeOwnershipLost = options.onRuntimeOwnershipLost ?? null;
    this.observability = options.observability ?? createWorkflowObservability(db);
    this.ownerLease = new WorkflowRuntimeOwnerLease(
      db,
      options.runtimeOwnership,
      this.observability,
    );
    try {
      const authorityProvider = options.authorityProvider ?? null;
      const authorityStore = options.authorityStore
        ?? new WorkflowExecutionAuthorityStore(db, () => clock.now().getTime());
      this.authority = new WorkflowExecutionAuthorityGate(
        db,
        authorityStore,
        authorityProvider,
        options.serviceProvider ?? null,
        () => clock.now(),
        this.observability,
        this.ownerLease,
      );
      const shutdownGraceMs = resolveWorkflowShutdownGraceMs(options.shutdownGraceMs);
      const wakeTimer = options.wakeTimer === undefined
        ? (options.clock ? false : createNativeWorkflowWakeTimer())
        : options.wakeTimer;
      this.runtime = WorkflowRuntimeStore.createOwnerFenced(
        db,
        authorityStore,
        () => clock.now(),
        this.ownerLease,
        options.runtime,
      );
      this.graph = new WorkflowGraphRuntime(db, registry, {
        authority: this.authority,
        runtime: this.runtime,
        now: () => clock.now(),
        shutdownGraceMs,
        interactionAuthority: options.interactionAuthority,
        wakeTimer,
        observability: this.observability,
        runtimeFence: this.ownerLease,
      });
      graphRuntimes.set(this, this.graph);
      this.repository = new WorkflowRepository(db, this.ownerLease);
      this.scopes = new WorkflowScopeBoundary(tenancyMode, this.repository);
      const wakes = new WorkflowWakeCoordinator(clock, wakeTimer, {
        retry: (wake) => this.dispatchAdvance(wake.instanceId, 'retry'),
        timeout: (wake) => this.lifecycle.handleTimeoutWake(wake),
      }, this.observability);
      this.executor = createOwnerFencedWorkflowExecutor(
        db,
        registry,
        this.runtime,
        clock,
        this.repository,
        wakes,
        shutdownGraceMs,
        this.authority,
        this.observability,
        this.ownerLease,
      );
      this.lifecycle = new WorkflowLifecycleCoordinator(
        this.repository,
        registry,
        this.runtime,
        this.executor,
        clock,
        wakes,
        this.observability,
      );
      this.transitions = new WorkflowTransitionController(
        this.repository,
        this.runtime,
        this.executor,
        this.lifecycle,
        clock,
        wakes,
        this.observability,
      );
      const instanceFactory = new WorkflowInstanceFactory(
        registry,
        this.repository,
        clock,
      );
      this.frontier = new WorkflowFrontierPump(
        this.repository,
        this.runtime,
        this.executor,
        clock,
        wakes,
        this.observability,
      );
      const hooks = {
        beginOperation: () => {
          this.assertAvailable();
          this.markOperationStarted();
        },
        advance: (instanceId: string) => this.advanceTrusted(instanceId),
      };
      this.queries = new WorkflowRunQueryService(
        this.repository,
        this.graph,
        this.scopes,
      );
      this.starts = new WorkflowStartCoordinator(
        registry,
        this.graph,
        instanceFactory,
        this.authority,
        authorityProvider,
        this.scopes,
        this.observability,
        hooks,
      );
      this.events = new WorkflowEventCoordinator(
        this.repository,
        this.runtime,
        clock,
        this.scopes,
        hooks,
      );
      this.systemEventDeliveries = new WorkflowSystemEventDeliveryCoordinator(
        db,
        this.repository,
        this.runtime,
        clock,
        this.scopes,
        hooks,
        this.observability,
      );
      this.ownerLease.onLost((error) => this.quiesceAfterOwnershipLoss(error));
    } catch (error) {
      this.ownerLease.release();
      throw error;
    }
  }

  /** Compatibility start for standalone/trusted services without an auth provider. */
  async start(
    name: string,
    input?: unknown,
    startedBy?: string,
    scopeOrOptions: ServiceDataScope | WorkflowStartOptions = {},
    options: WorkflowStartOptions = {},
  ): Promise<string> {
    return this.starts.startCompatibility(
      name,
      input,
      startedBy ?? null,
      scopeOrOptions,
      options,
    );
  }

  /** Start under the exact live Guardian authority of an authenticated request. */
  async startAsActor(
    name: string,
    input: unknown,
    context: AuthContext,
    options: WorkflowStartOptions = {},
    assertCurrentAuthority?: () => void,
  ): Promise<string> {
    return this.starts.startAsActor(
      name,
      input,
      context,
      options,
      assertCurrentAuthority,
    );
  }

  async runAsActor(
    name: string,
    input: unknown,
    context: AuthContext,
    options: WorkflowStartOptions = {},
    assertCurrentAuthority?: () => void,
  ): Promise<string> {
    return this.startAsActor(name, input, context, options, assertCurrentAuthority);
  }

  /**
   * Capture a secret-free Guardian authority and return its final-commit fence.
   * Callers must invoke the returned assertion inside their writer transaction.
   */
  captureActorAuthorityFence(context: AuthContext): WorkflowActorAuthorityFence {
    return this.starts.captureActorAuthorityFence(context);
  }

  captureActorAuthorityAssertion(context: AuthContext): () => void {
    return this.starts.captureActorAuthorityAssertion(context);
  }

  /** Explicit, auditable privileged entry point for schedulers and plugins. */
  async startAsSystem(
    name: string,
    input: unknown,
    system: WorkflowSystemExecutionOptions,
    options: WorkflowStartOptions = {},
  ): Promise<string> {
    return this.starts.startAsSystem(name, input, system, options);
  }

  async runAsSystem(
    name: string,
    input: unknown,
    system: WorkflowSystemExecutionOptions,
    options: WorkflowStartOptions = {},
  ): Promise<string> {
    return this.startAsSystem(name, input, system, options);
  }

  async run(
    name: string,
    input?: unknown,
    startedBy?: string,
    scopeOrOptions: ServiceDataScope | WorkflowStartOptions = {},
    options: WorkflowStartOptions = {},
  ): Promise<string> {
    return this.start(name, input, startedBy, scopeOrOptions, options);
  }

  /** Scope-check an external advance; internal pumps use the trusted path. */
  async advance(instanceId: string, scope?: ServiceDataScope): Promise<void> {
    if (scope || this.scopes.requiresExplicitScope()) {
      this.scopes.requireInstance(instanceId, this.scopes.requireScope(scope));
    }
    return this.advanceTrusted(instanceId);
  }

  /** Persist an event as an inbox item, then let the legal frontier claim it. */
  async sendEvent(
    instanceId: string,
    eventName: string,
    payload?: unknown,
    sentBy?: string,
    scopeOrActor?: ServiceDataScope | WorkflowInteractionActor,
    explicitActor?: WorkflowInteractionActor,
    mutation: WorkflowMutationOptions = {},
  ): Promise<boolean> {
    return this.events.sendEvent(
      instanceId,
      eventName,
      payload,
      sentBy,
      scopeOrActor,
      explicitActor,
      mutation,
    );
  }

  /** Explicit privileged event responder with a MAC-sealed system identity. */
  async sendEventAsSystem(
    instanceId: string,
    eventName: string,
    payload: unknown,
    system: WorkflowSystemExecutionOptions,
  ): Promise<boolean> {
    return this.events.sendEventAsSystem(instanceId, eventName, payload, system);
  }

  /**
   * Deliver one privileged event exactly once per principal/scope/key command.
   * Replays return the original acknowledgement and re-kick a running frontier.
   */
  async deliverEventAsSystem(
    instanceId: string,
    eventName: string,
    payload: unknown,
    options: WorkflowSystemEventDeliveryOptions,
    mutation: WorkflowSystemEventDeliveryMutation = {},
  ): Promise<WorkflowSystemEventDeliveryResult> {
    return this.systemEventDeliveries.deliver(
      instanceId,
      eventName,
      payload,
      options,
      mutation,
    );
  }

  cancel(
    instanceId: string,
    scope?: ServiceDataScope,
    mutation: WorkflowMutationOptions = {},
  ): void {
    this.assertAvailable();
    this.markOperationStarted();
    this.scopes.requireInstance(instanceId, this.scopes.requireScope(scope));
    if (this.graph.isGraphInstance(instanceId)) {
      this.graph.cancel(instanceId, mutation.assertCurrentAuthority);
    } else this.transitions.cancel(instanceId, mutation.assertCurrentAuthority);
  }

  stop(
    instanceId: string,
    scope?: ServiceDataScope,
    mutation: WorkflowMutationOptions = {},
  ): void {
    this.cancel(instanceId, scope, mutation);
  }

  pause(
    instanceId: string,
    scope?: ServiceDataScope,
    mutation: WorkflowMutationOptions = {},
  ): void {
    this.assertAvailable();
    this.markOperationStarted();
    this.scopes.requireInstance(instanceId, this.scopes.requireScope(scope));
    if (this.graph.isGraphInstance(instanceId)) {
      this.graph.pause(instanceId, mutation.assertCurrentAuthority);
    } else this.transitions.pause(instanceId, mutation.assertCurrentAuthority);
  }

  async resume(
    instanceId: string,
    scope?: ServiceDataScope,
    mutation: WorkflowMutationOptions = {},
  ): Promise<void> {
    this.assertAvailable();
    this.markOperationStarted();
    this.scopes.requireInstance(instanceId, this.scopes.requireScope(scope));
    if (this.graph.isGraphInstance(instanceId)) {
      await this.graph.resume(instanceId, mutation.assertCurrentAuthority);
      return;
    }
    await this.transitions.resume(
      instanceId,
      () => this.assertAvailable(),
      (id) => this.advanceTrusted(id),
      mutation.assertCurrentAuthority,
    );
  }

  async pollRetries(): Promise<number> {
    if (this.disposed) return 0;
    this.assertAvailable();
    const legacy = this.lifecycle.pollRetries((instanceId, phase) => {
      this.dispatchAdvance(instanceId, phase);
    });
    return legacy + this.graph.pollRetries();
  }

  pollTimeouts(): number {
    if (this.disposed) return 0;
    this.assertAvailable();
    return this.lifecycle.pollTimeouts() + this.graph.pollTimeouts();
  }

  /** Preflight every live handler, normalize crash-left work, then publish. */
  async recoverInFlight(onReady?: () => void): Promise<number> {
    // Recovery is initialization-only, so it must not mark an ordinary
    // operation started; it must still reject disposed or stale ownership
    // before reading or validating any durable run.
    this.assertAvailable();
    for (const instance of this.repository.listNonterminalInstances()) {
      this.authority.validateRecoveryInstance(instance.instance_id);
    }
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

  getInstance(instanceId: string, scope?: ServiceDataScope): WorkflowInstanceRecord | null {
    return this.queries.getInstance(instanceId, scope);
  }

  get(instanceId: string, scope?: ServiceDataScope): WorkflowInstanceRecord | null {
    return this.getInstance(instanceId, scope);
  }

  getSteps(instanceId: string, scope?: ServiceDataScope): WorkflowStepRecord[] {
    return this.queries.getSteps(instanceId, scope);
  }

  getEvents(instanceId: string, scope?: ServiceDataScope): WorkflowEventRecord[] {
    return this.queries.getEvents(instanceId, scope);
  }

  /** Payload-free, scope-checked topology for a run visualization. */
  getPublicTopology(
    instanceId: string,
    scope?: ServiceDataScope,
  ): WorkflowPublicTopology | null {
    return this.queries.getPublicTopology(instanceId, scope);
  }

  listInstances(filter: WorkflowInstanceListFilter = {}): WorkflowInstanceRecord[] {
    return this.queries.listInstances(filter);
  }

  list(filter?: WorkflowInstanceListFilter): WorkflowInstanceRecord[] {
    return this.listInstances(filter);
  }

  private async advanceTrusted(instanceId: string): Promise<void> {
    if (this.disposed) return;
    this.ownerLease.assertCurrent();
    this.markOperationStarted();
    if (this.graph.isGraphInstance(instanceId)) return this.graph.advance(instanceId);
    return this.frontier.advance(instanceId, () => this.advanceTrusted(instanceId));
  }

  private dispatchAdvance(instanceId: string, phase: WorkflowDispatchPhase): void {
    void this.advanceTrusted(instanceId).catch((error) => {
      this.observability.emitNow(OBS_CODES.WORKFLOW_ADVANCE_FAILED, {
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
    let ownerQuiescence: Promise<unknown>;
    try {
      // Run the callback prefix synchronously so stale publication and
      // scheduler jobs disappear before the losing operation returns.
      ownerQuiescence = Promise.resolve(this.onRuntimeOwnershipLost?.(error));
    } catch (callbackError) {
      ownerQuiescence = Promise.reject(callbackError);
    }
    void Promise.allSettled([
      this.lifecycle.disposeWithoutPersistence(),
      this.frontier.drain(),
      this.graph.dispose(),
      ownerQuiescence,
    ]).then((settlements) => {
      for (const settlement of settlements) {
        if (settlement.status === 'rejected') {
          this.observability.emitNow(OBS_CODES.WORKFLOW_ADVANCE_FAILED, {
            error: settlement.reason,
            metadata: { phase: 'ownership-loss-quiescence', cause: error.code },
          });
        }
      }
    });
  }
}

/**
 * Lifecycle owner for one durable workflow runtime lease generation.
 *
 * The owner acquires synchronously before workflow composition, renews through
 * a bounded heartbeat, notifies the runtime when ownership is lost, and
 * releases only its exact generation during graceful shutdown.
 */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type {
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
} from '../observability/types';
import { WorkflowError } from './workflow-error';
import type { WorkflowRuntimeFence } from './workflow-runtime-fence';
import {
  WorkflowRuntimeLeaseStore,
  type WorkflowRuntimeLeaseToken,
} from './workflow-runtime-lease-store';
import type { ReactiveDB } from '../sync/reactive-db';

export const DEFAULT_WORKFLOW_RUNTIME_LEASE_MS = 30_000;
export const DEFAULT_WORKFLOW_RUNTIME_HEARTBEAT_MS = 10_000;

export interface WorkflowRuntimeOwnershipOptions {
  /** Primarily a deterministic-test seam; production owners use a random id. */
  ownerId?: string;
  leaseMs?: number;
  heartbeatMs?: number;
  now?: () => number;
  /** Disable native heartbeats only for crash/expiry simulations. */
  heartbeat?: boolean;
  /** Deterministic timer seam for ownership lifecycle tests. */
  heartbeatTimer?: WorkflowRuntimeHeartbeatTimer;
}

export interface WorkflowRuntimeHeartbeatTimer {
  schedule(callback: () => void, intervalMs: number): unknown;
  cancel(handle: unknown): void;
}

const nativeHeartbeatTimer: WorkflowRuntimeHeartbeatTimer = Object.freeze({
  schedule(callback: () => void, intervalMs: number): unknown {
    const handle = setInterval(callback, intervalMs);
    const unref = handle as ReturnType<typeof setInterval> & { unref?: () => void };
    unref.unref?.();
    return handle;
  },
  cancel(handle: unknown): void {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
});

/** Durable runtime-generation fence shared by every workflow persistence path. */
export class WorkflowRuntimeOwnerLease implements WorkflowRuntimeFence {
  private readonly store: WorkflowRuntimeLeaseStore;
  private readonly now: () => number;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly heartbeatTimer: WorkflowRuntimeHeartbeatTimer;
  private token: WorkflowRuntimeLeaseToken;
  private timer: { handle: unknown } | null = null;
  private state: 'active' | 'lost' | 'released' = 'active';
  private lostListener: ((error: WorkflowError) => void) | null = null;
  private lastObservedAt = 0;

  constructor(
    db: ReactiveDB,
    options: WorkflowRuntimeOwnershipOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.leaseMs = options.leaseMs ?? DEFAULT_WORKFLOW_RUNTIME_LEASE_MS;
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_WORKFLOW_RUNTIME_HEARTBEAT_MS;
    this.heartbeatTimer = options.heartbeatTimer ?? nativeHeartbeatTimer;
    validateOwnershipOptions(options.ownerId, this.leaseMs, this.heartbeatMs);
    this.store = new WorkflowRuntimeLeaseStore(db);
    const ownerId = options.ownerId ?? `workflow-owner-${crypto.randomUUID()}`;
    try {
      this.token = this.store.acquire(ownerId, this.currentTime(), this.leaseMs);
    } catch (error) {
      if (error instanceof WorkflowError && error.code === 'WORKFLOW_RUNTIME_OWNED') {
        this.emitSafely(OBS_CODES.WORKFLOWS_OWNER_CONFLICT, { error });
      }
      throw error;
    }
    try {
      this.emitSafely(OBS_CODES.WORKFLOWS_OWNER_ACQUIRED, {
        metadata: { generation: this.token.generation },
      });
      if (options.heartbeat !== false) this.startHeartbeat();
    } catch (error) {
      const failures: unknown[] = [error];
      this.stopHeartbeat();
      try {
        this.store.release(this.token, this.token.acquiredAt);
      } catch (releaseError) {
        failures.push(releaseError);
      }
      if (failures.length > 1) {
        throw new AggregateError(
          failures,
          'Workflow runtime ownership initialization and cleanup both failed',
        );
      }
      throw error;
    }
  }

  /** Subscribe once to permanent ownership loss for cooperative quiescence. */
  onLost(listener: (error: WorkflowError) => void): void {
    this.lostListener = listener;
    if (this.state === 'lost') this.notifyLost(listener, leaseLostError());
  }

  /** Throw unless the persisted row still names this live generation. */
  assertCurrent(): void {
    if (this.state !== 'active'
      || !this.store.isCurrent(this.token, this.currentTime())) {
      throw this.markLost();
    }
  }

  /** Best-effort state probe used to avoid stale-owner cleanup writes. */
  isCurrent(): boolean {
    if (this.state !== 'active') return false;
    try {
      if (this.store.isCurrent(this.token, this.currentTime())) return true;
    } catch (error) {
      this.emitSafely(OBS_CODES.WORKFLOWS_OWNER_HEARTBEAT_FAILED, { error });
      return false;
    }
    this.markLost();
    return false;
  }

  /** Release exactly this generation after all owned work has drained. */
  release(): void {
    if (this.state === 'released') return;
    this.stopHeartbeat();
    const wasActive = this.state === 'active';
    this.state = 'released';
    if (!wasActive) return;
    const released = this.store.release(this.token, this.currentTime());
    if (released) {
      this.emitSafely(OBS_CODES.WORKFLOWS_OWNER_RELEASED, {
        metadata: { generation: this.token.generation },
      });
    }
  }

  private startHeartbeat(): void {
    const handle = this.heartbeatTimer.schedule(() => this.heartbeat(), this.heartbeatMs);
    if (this.state !== 'active') {
      this.heartbeatTimer.cancel(handle);
      return;
    }
    this.timer = { handle };
  }

  private stopHeartbeat(): void {
    if (this.timer === null) return;
    this.heartbeatTimer.cancel(this.timer.handle);
    this.timer = null;
  }

  private heartbeat(): void {
    if (this.state !== 'active') return;
    try {
      const renewed = this.store.renew(this.token, this.currentTime(), this.leaseMs);
      if (!renewed) {
        this.markLost();
        return;
      }
      this.token = renewed;
    } catch (error) {
      this.emitSafely(OBS_CODES.WORKFLOWS_OWNER_HEARTBEAT_FAILED, {
        error,
        metadata: { generation: this.token.generation },
      });
      // A transient SQLite busy/error does not prove replacement ownership.
      // Every commit still checks the durable expiry/generation under lock.
      if (this.currentTime() >= this.token.expiresAt) this.markLost();
    }
  }

  private markLost(): WorkflowError {
    const error = leaseLostError();
    if (this.state !== 'active') return error;
    this.state = 'lost';
    this.stopHeartbeat();
    this.emitSafely(OBS_CODES.WORKFLOWS_OWNER_LOST, {
      error,
      metadata: { generation: this.token.generation },
    });
    if (this.lostListener) this.notifyLost(this.lostListener, error);
    return error;
  }

  private notifyLost(listener: (error: WorkflowError) => void, error: WorkflowError): void {
    try {
      listener(error);
    } catch (listenerError) {
      this.emitSafely(OBS_CODES.APP_LIFECYCLE_FAILED, {
        error: listenerError,
        metadata: {
          phase: 'ownership-loss-listener',
          plugin: 'workflows',
          cause: error.code,
        },
      });
    }
  }

  /** Ownership safety must never depend on a diagnostic sink behaving well. */
  private emitSafely(
    definition: PlatformCodeDefinition,
    options?: PlatformCodeEmitOptions,
  ): void {
    try {
      emitPlatformCode(definition, options);
    } catch {
      // Platform observability is best-effort by contract. A hostile injected
      // emitter must not replace lease errors or prevent runtime quiescence.
    }
  }

  private currentTime(): number {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new WorkflowError(
        'Workflow runtime ownership clock returned an invalid time',
        'WORKFLOW_CONFIG_INVALID',
        500,
      );
    }
    // Wall clocks can step backwards. A lease clock may stop briefly, but it
    // must never revive or lengthen a generation through time regression.
    this.lastObservedAt = Math.max(this.lastObservedAt, value);
    return this.lastObservedAt;
  }
}

function validateOwnershipOptions(
  ownerId: string | undefined,
  leaseMs: number,
  heartbeatMs: number,
): void {
  if (ownerId !== undefined && (ownerId.length < 1 || ownerId.length > 200)) {
    throw new WorkflowError(
      'Workflow runtime owner id must be between 1 and 200 characters',
      'WORKFLOW_CONFIG_INVALID',
      500,
    );
  }
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 3
    || !Number.isSafeInteger(heartbeatMs) || heartbeatMs < 1
    || heartbeatMs * 2 >= leaseMs) {
    throw new WorkflowError(
      'Workflow runtime heartbeat must be less than half its lease duration',
      'WORKFLOW_CONFIG_INVALID',
      500,
    );
  }
}

function leaseLostError(): WorkflowError {
  return new WorkflowError(
    'Workflow runtime ownership was lost; retry against the active service',
    'WORKFLOW_RUNTIME_LEASE_LOST',
    503,
    true,
  );
}

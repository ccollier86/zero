/**
 * Durable execution-authority gate shared by legacy and graph workflows.
 *
 * This service resolves MAC-sealed actor/system authority inside the same
 * ReactiveDB transaction that prepares or commits an attempt. It owns private
 * execution leases and the fail-closed transition used when live Guardian
 * authority no longer matches the authority captured at workflow start.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { AuthError } from '../auth/types';
import { OBS_CODES } from '../observability/codes';
import {
  scopeFromIdentity,
  sameExecutionIdentity,
  WorkflowExecutionAuthorityStore,
  type WorkflowAuthorityFailureReason,
  type WorkflowExecutionAuthorityProvider,
  type WorkflowExecutionIdentity,
  type WorkflowExecutionServiceProvider,
  type WorkflowPersistedExecutionAuthority,
  type WorkflowActorExecutionAuthority,
  type WorkflowSystemExecutionAuthority,
  type WorkflowResolvedExecutionAuthority,
} from './workflow-execution-authority';
import {
  workflowExecutionAuthorityStoreUsesDatabase,
} from './workflow-execution-authority-store';
import { WorkflowTerminalEventQueue } from './workflow-terminal-event-queue';
import { WorkflowError } from './workflow-error';
import {
  createWorkflowObservability,
  type WorkflowObservability,
} from './workflow-observability';
import {
  workflowRuntimeTransaction,
  type WorkflowRuntimeFence,
} from './workflow-runtime-fence';

const AUTHORITY_ERROR = 'Workflow execution authority is no longer valid';
const authorityGateDatabases = new WeakMap<WorkflowExecutionAuthorityGate, ReactiveDB>();

/** Authority-bearing fields injected into every app activity context. */
export interface WorkflowAttemptAuthorityContext {
  readonly execution: WorkflowExecutionIdentity;
  readonly zero: unknown;
  assertCurrentAuthority(): void;
}

/** Private lease attached to one physical handler or validator invocation. */
export interface WorkflowAuthorityLease {
  readonly instanceId: string;
  readonly leaseId: string;
  readonly executionId: string;
  readonly context: WorkflowAttemptAuthorityContext;
  readonly isCurrent: () => boolean;
}

export interface BeginWorkflowAuthorityLeaseInput {
  instanceId: string;
  leaseId: string;
  executionId: string;
  /** Must re-read durable state; never close over a stale row snapshot. */
  isCurrent: () => boolean;
}

/** Thrown when an activity tries to use authority after its durable fence moved. */
export class WorkflowAuthorityChangedError extends WorkflowError {
  constructor() {
    super(AUTHORITY_ERROR, 'WORKFLOW_AUTHORITY_CHANGED', 409, false);
    this.name = 'WorkflowAuthorityChangedError';
  }
}

export class WorkflowExecutionAuthorityGate {
  private readonly terminalEvents: WorkflowTerminalEventQueue;

  constructor(
    private readonly db: ReactiveDB,
    readonly store: WorkflowExecutionAuthorityStore =
      new WorkflowExecutionAuthorityStore(db),
    private readonly provider: WorkflowExecutionAuthorityProvider | null = null,
    private readonly services: WorkflowExecutionServiceProvider | null = null,
    private readonly now: () => Date = () => new Date(),
    private readonly observability: WorkflowObservability = createWorkflowObservability(db),
    private readonly runtimeFence: WorkflowRuntimeFence | null = null,
  ) {
    if (!workflowExecutionAuthorityStoreUsesDatabase(store, db)) {
      throw new WorkflowError(
        'Workflow authority store must use the composed runtime database',
        'WORKFLOW_CONFIG_INVALID',
        500,
      );
    }
    authorityGateDatabases.set(this, db);
    this.terminalEvents = new WorkflowTerminalEventQueue(db);
  }

  /**
   * Revalidate and persist the exact start authority at the instance commit.
   * The caller must invoke this from the same transaction that inserts the run
   * and its initial steps so a revoked actor can never leave a runnable row.
   */
  insertCurrent(
    instanceId: string,
    authority: WorkflowPersistedExecutionAuthority,
    expectedTenantId: string | null,
  ): void {
    this.transaction(() => {
      const capturedScope = scopeFromIdentity(authority.identity);
      if (capturedScope.scopeKind !== authority.identity.scopeKind
        || capturedScope.scopeId !== authority.identity.scopeId
        || capturedScope.tenantId !== authority.identity.tenantId
        || capturedScope.tenantId !== expectedTenantId) {
        throw startAuthorityChanged();
      }
      if (authority.kind === 'actor') {
        const resolved = this.provider?.revalidateActor(authority) ?? null;
        if (!resolved
          || !sameExecutionIdentity(resolved.identity, authority.identity)
          || resolved.scope.scopeKind !== capturedScope.scopeKind
          || resolved.scope.scopeId !== capturedScope.scopeId
          || resolved.scope.tenantId !== capturedScope.tenantId) {
          throw startAuthorityChanged();
        }
      }
      this.store.insert(instanceId, authority);
    });
  }

  /** Revalidate an exact request actor without consulting a mutable role snapshot. */
  assertActorCurrent(
    authority: WorkflowActorExecutionAuthority,
    expectedTenantId: string | null = authority.identity.tenantId,
  ): void {
    const capturedScope = scopeFromIdentity(authority.identity);
    const resolved = this.provider?.revalidateActor(authority) ?? null;
    if (!resolved
      || !sameExecutionIdentity(resolved.identity, authority.identity)
      || resolved.scope.scopeKind !== capturedScope.scopeKind
      || resolved.scope.scopeId !== capturedScope.scopeId
      || resolved.scope.tenantId !== capturedScope.tenantId
      || resolved.scope.tenantId !== expectedTenantId) {
      throw startAuthorityChanged();
    }
  }

  /** Validate the immutable scope of an explicitly trusted system event. */
  assertSystemCurrent(
    authority: WorkflowSystemExecutionAuthority,
    expectedTenantId: string | null,
  ): void {
    const scope = scopeFromIdentity(authority.identity);
    if (scope.tenantId !== expectedTenantId
      || scope.scopeKind !== authority.identity.scopeKind
      || scope.scopeId !== authority.identity.scopeId) {
      throw startAuthorityChanged();
    }
  }

  /**
   * Resolve live authority and publish a private lease before invoking app code.
   * Returns null after atomically failing the run when the seal/auth is invalid.
   */
  begin(input: BeginWorkflowAuthorityLeaseInput): WorkflowAuthorityLease | null {
    return this.transaction(() => {
      if (!input.isCurrent()) return null;
      const resolved = this.resolve(input.instanceId);
      if (!resolved) return null;
      this.store.putLease(input.leaseId, input.instanceId, input.executionId);
      const assertCurrentAuthority = () => this.assertCurrent({
        instanceId: input.instanceId,
        leaseId: input.leaseId,
        executionId: input.executionId,
        isCurrent: input.isCurrent,
      });
      const zero = this.services?.createServices({
        authority: resolved,
        assertCurrentAuthority,
      }) ?? null;
      return Object.freeze({
        instanceId: input.instanceId,
        leaseId: input.leaseId,
        executionId: input.executionId,
        isCurrent: input.isCurrent,
        context: Object.freeze({
          execution: resolved.identity,
          zero,
          assertCurrentAuthority,
        }),
      });
    });
  }

  /** Revalidate the exact physical attempt immediately before a durable commit. */
  validate(lease: WorkflowAuthorityLease): boolean {
    return this.transaction(() => {
      if (!lease.isCurrent()
        || !this.store.hasLease(lease.leaseId, lease.executionId)) return false;
      return this.resolve(lease.instanceId) !== null;
    });
  }

  /** Revalidate a live run before graph-only structural transitions. */
  validateInstance(instanceId: string): boolean {
    return this.transaction(() => {
      const instance = this.db.queryOne('workflow_instances', instanceId);
      if (!instance || instance.status !== 'running') return false;
      return this.resolve(instanceId) !== null;
    });
  }

  /** Validate running and paused authority before recovery publishes readiness. */
  validateRecoveryInstance(instanceId: string): boolean {
    return this.transaction(() => {
      const instance = this.db.queryOne('workflow_instances', instanceId);
      if (!instance || (instance.status !== 'running' && instance.status !== 'paused')) {
        return false;
      }
      return this.resolve(instanceId) !== null;
    });
  }

  /** Release an exact physical lease without disturbing a replacement attempt. */
  release(lease: WorkflowAuthorityLease): void {
    this.transaction(() => this.store.releaseLease(lease.leaseId, lease.executionId));
  }

  /** Fence every in-flight activity for a lifecycle transition or shutdown. */
  releaseInstance(instanceId: string): void {
    this.transaction(() => this.store.releaseInstanceLeases(instanceId));
  }

  private assertCurrent(input: BeginWorkflowAuthorityLeaseInput): void {
    const valid = this.transaction(() => {
      if (!input.isCurrent()
        || !this.store.hasLease(input.leaseId, input.executionId)) return false;
      return this.resolve(input.instanceId) !== null;
    });
    if (!valid) throw new WorkflowAuthorityChangedError();
  }

  private transaction<T>(operation: () => T): T {
    return workflowRuntimeTransaction(this.db, this.runtimeFence, operation);
  }

  private resolve(instanceId: string): WorkflowResolvedExecutionAuthority | null {
    const read = this.store.lockAndRead(instanceId);
    if (!read.ok) {
      this.fail(instanceId, read.reason);
      return null;
    }
    const instance = this.db.queryOne('workflow_instances', instanceId);
    if (!instance) {
      this.fail(instanceId, 'authority-scope-mismatch');
      return null;
    }

    const { authority } = read;
    if (authority.kind === 'system') {
      const scope = scopeFromIdentity(authority.identity);
      if ((instance.tenant_id ?? null) !== scope.tenantId) {
        this.fail(instanceId, 'authority-scope-mismatch');
        return null;
      }
      return Object.freeze({
        persisted: authority,
        identity: authority.identity,
        scope,
        authContext: null,
        userProperties: Object.freeze({}),
      });
    }

    const resolved = this.provider?.revalidateActor(authority) ?? null;
    if (!resolved) {
      this.fail(instanceId, 'authority-revoked');
      return null;
    }
    if ((instance.tenant_id ?? null) !== resolved.scope.tenantId) {
      this.fail(instanceId, 'authority-scope-mismatch');
      return null;
    }
    return resolved;
  }

  private fail(instanceId: string, reason: WorkflowAuthorityFailureReason): void {
    this.store.invalidate(instanceId, reason);
    // Runtime attempts and private authority leases are independent fences.
    // Clear both so late handler completions cannot become current again.
    this.db.prepare('DELETE FROM _workflow_step_attempts WHERE instance_id = ?')
      .run(instanceId);
    const now = this.now().toISOString();
    for (const step of this.db.query('workflow_steps')) {
      if (step.instance_id !== instanceId) continue;
      if (step.status === 'pending'
        || step.status === 'waiting'
        || step.status === 'running'
        || (step.status === 'failed' && step.retry_at !== null)) {
        this.db.update('workflow_steps', String(step.step_id), {
          status: 'failed',
          error: AUTHORITY_ERROR,
          retry_at: null,
          timeout_at: null,
          completed_at: now,
          ...(Object.hasOwn(step, 'updated_at') ? { updated_at: now } : {}),
        });
      }
    }
    const instance = this.db.queryOne('workflow_instances', instanceId);
    let transitioned = false;
    if (instance && instance.status !== 'completed'
      && instance.status !== 'failed' && instance.status !== 'cancelled') {
      this.db.update('workflow_instances', instanceId, {
        status: 'failed',
        error: AUTHORITY_ERROR,
        updated_at: now,
        completed_at: now,
      });
      transitioned = true;
    }
    this.terminalEvents.discardInstanceQueue(instanceId, now);
    if (transitioned) {
      this.observability.emitAfterCommit(OBS_CODES.WORKFLOWS_AUTHORITY_INVALIDATED, {
        metadata: { instanceId, reason },
      });
    }
  }
}

/** @internal Non-spoofable database identity for executor composition. */
export function workflowExecutionAuthorityGateUsesDatabase(
  authority: WorkflowExecutionAuthorityGate,
  db: ReactiveDB,
): boolean {
  return authorityGateDatabases.get(authority) === db;
}

function startAuthorityChanged(): AuthError {
  return new AuthError(
    'Authorization changed before the workflow could commit',
    'AUTH_STATE_CHANGED',
    409,
  );
}

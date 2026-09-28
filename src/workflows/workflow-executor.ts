/**
 * Executes workflow steps behind durable, revalidated authority gates.
 *
 * A step receives a unique execution lease. Handler output is accepted only
 * when the same lease is still current and the original actor authority still
 * resolves inside the SQLite write transaction which commits that output.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { StepContext, WorkflowStepRecord } from './types';
import {
  scopeFromIdentity,
  WorkflowExecutionAuthorityStore,
  type WorkflowAuthorityFailureReason,
  type WorkflowExecutionAuthorityProvider,
  type WorkflowExecutionServiceProvider,
  type WorkflowResolvedExecutionAuthority,
} from './workflow-execution-authority';
import type { WorkflowRegistry } from './workflow-registry';

const MAX_BACKOFF_MS = 5 * 60 * 1000;
const AUTHORITY_ERROR = 'Workflow execution authority is no longer valid';

interface PreparedExecution {
  executionId: string;
  step: WorkflowStepRecord;
  context: StepContext;
}

type PreparationResult =
  | { kind: 'execute'; prepared: PreparedExecution }
  | { kind: 'waiting' | 'skipped' | 'failed' | 'stale' };

export class WorkflowAuthorityChangedError extends Error {
  readonly code = 'WORKFLOW_AUTHORITY_CHANGED';

  constructor() {
    super(AUTHORITY_ERROR);
    this.name = 'WorkflowAuthorityChangedError';
  }
}

export class WorkflowExecutor {
  constructor(
    private readonly db: ReactiveDB,
    private readonly registry: WorkflowRegistry,
    private readonly authorityStore: WorkflowExecutionAuthorityStore =
      new WorkflowExecutionAuthorityStore(db),
    private readonly authorityProvider: WorkflowExecutionAuthorityProvider | null = null,
    private readonly serviceProvider: WorkflowExecutionServiceProvider | null = null,
  ) {}

  /** Execute one eligible step; stale/concurrent attempts are ignored. */
  async executeStep(
    instanceId: string,
    stepId: string,
    eventPayload?: { name: string; payload: unknown },
  ): Promise<boolean> {
    const preparation = this.prepare(instanceId, stepId, eventPayload);
    if (preparation.kind !== 'execute') return preparation.kind === 'skipped';
    const { executionId, step, context } = preparation.prepared;
    const handler = this.registry.getHandler(step.step_name);
    if (!handler) {
      return this.commitHandlerFailure(
        instanceId,
        step,
        executionId,
        `Handler "${step.step_name}" not found in registry`,
      );
    }

    try {
      const output = await handler(context);
      return this.commitHandlerSuccess(instanceId, step, executionId, output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.commitHandlerFailure(instanceId, step, executionId, message);
    }
  }

  /** Revalidate an in-flight lease for request-equivalent scoped services. */
  assertCurrentAuthority(
    instanceId: string,
    stepId: string,
    executionId: string,
  ): void {
    const valid = this.db.transaction(() => {
      const step = this.db.queryOne('workflow_steps', stepId);
      const instance = this.db.queryOne('workflow_instances', instanceId);
      if (!step
        || !instance
        || step.instance_id !== instanceId
        || step.status !== 'running'
        || instance.status !== 'running'
        || !this.authorityStore.hasLease(stepId, executionId)) return false;
      return this.resolveAuthority(instanceId) !== null;
    });
    if (!valid) throw new WorkflowAuthorityChangedError();
  }

  /** Gate lifecycle transitions which do not dispatch a handler. */
  withCurrentInstanceAuthority<T>(
    instanceId: string,
    operation: () => T,
  ): { committed: true; value: T } | { committed: false } {
    return this.db.transaction(() => {
      const instance = this.db.queryOne('workflow_instances', instanceId);
      if (!instance || instance.status !== 'running') return { committed: false };
      if (!this.resolveAuthority(instanceId)) return { committed: false };
      return { committed: true, value: operation() };
    });
  }

  private prepare(
    instanceId: string,
    stepId: string,
    eventPayload?: { name: string; payload: unknown },
  ): PreparationResult {
    return this.db.transaction(() => {
      const step = this.db.queryOne('workflow_steps', stepId) as WorkflowStepRecord | null;
      const instance = this.db.queryOne('workflow_instances', instanceId);
      if (!step || !instance || step.instance_id !== instanceId) return { kind: 'stale' };
      if (instance.status !== 'running') return { kind: 'stale' };

      const eligible = step.status === 'pending'
        || (step.status === 'waiting' && Boolean(eventPayload))
        || (step.status === 'failed' && step.retry_at !== null);
      if (!eligible) return { kind: 'stale' };

      const resolved = this.resolveAuthority(instanceId);
      if (!resolved) return { kind: 'failed' };
      const stepDefs = parseStepDefs(instance.steps_json);
      const definition = stepDefs[step.step_index];

      // A wait event cannot be supplied to a different wait name, and callers
      // cannot bypass a wait by racing an ordinary advance.
      if (step.wait_event) {
        if (!eventPayload) {
          this.db.update('workflow_steps', stepId, {
            status: 'waiting',
            timeout_at: step.timeout_at ?? (definition?.timeoutMs
              ? new Date(Date.now() + definition.timeoutMs).toISOString()
              : null),
          });
          return { kind: 'waiting' };
        }
        if (eventPayload.name !== step.wait_event) return { kind: 'waiting' };
      } else if (eventPayload) {
        return { kind: 'stale' };
      }

      if (step.status === 'pending') {
        const stepDef = stepDefs[step.step_index];
        if (stepDef?.condition
          && !this.evaluateCondition(stepDef.condition, instance)) {
          this.db.update('workflow_steps', stepId, {
            status: 'skipped',
            completed_at: new Date().toISOString(),
          });
          return { kind: 'skipped' };
        }
      }

      const executionId = `wexec_${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const timeoutAt = step.timeout_at ?? (definition?.timeoutMs
        ? new Date(Date.now() + definition.timeoutMs).toISOString()
        : null);

      this.authorityStore.putLease(stepId, instanceId, executionId);
      this.db.update('workflow_steps', stepId, {
        status: 'running',
        started_at: now,
        timeout_at: timeoutAt,
        retry_at: null,
      });

      const previousOutput = this.getPreviousStepOutput(instanceId, step.step_index);
      const assertCurrentAuthority = () => this.assertCurrentAuthority(
        instanceId,
        stepId,
        executionId,
      );
      const zero = this.serviceProvider?.createServices({
        authority: resolved,
        assertCurrentAuthority,
      }) ?? null;
      const context: StepContext = Object.freeze({
        input: step.step_index === 0
          ? parseJson(instance.input)
          : previousOutput,
        workflowInput: parseJson(instance.input),
        instanceId,
        stepIndex: step.step_index,
        attempt: step.retries,
        ...(eventPayload ? { waitEvent: Object.freeze({ ...eventPayload }) } : {}),
        execution: resolved.identity,
        zero,
        assertCurrentAuthority,
      });
      return {
        kind: 'execute',
        prepared: { executionId, step, context },
      };
    });
  }

  private commitHandlerSuccess(
    instanceId: string,
    step: WorkflowStepRecord,
    executionId: string,
    output: unknown,
  ): boolean {
    return this.db.transaction(() => {
      if (!this.isCurrentExecution(instanceId, step.step_id, executionId)) return false;
      if (!this.resolveAuthority(instanceId)) return false;
      this.db.update('workflow_steps', step.step_id, {
        status: 'completed',
        output: output !== undefined ? JSON.stringify(output) : null,
        completed_at: new Date().toISOString(),
        timeout_at: null,
        retry_at: null,
        error: null,
      });
      this.authorityStore.releaseLease(step.step_id, executionId);
      return true;
    });
  }

  private commitHandlerFailure(
    instanceId: string,
    step: WorkflowStepRecord,
    executionId: string,
    error: string,
  ): boolean {
    return this.db.transaction(() => {
      if (!this.isCurrentExecution(instanceId, step.step_id, executionId)) return false;
      if (!this.resolveAuthority(instanceId)) return false;
      this.authorityStore.releaseLease(step.step_id, executionId);
      this.handleStepFailure(step.step_id, step, boundedError(error));
      return false;
    });
  }

  private resolveAuthority(
    instanceId: string,
  ): WorkflowResolvedExecutionAuthority | null {
    const read = this.authorityStore.lockAndRead(instanceId);
    if (!read.ok) {
      this.failAuthority(instanceId, read.reason);
      return null;
    }
    const { authority } = read;
    if (authority.kind === 'system') {
      const instance = this.db.queryOne('workflow_instances', instanceId);
      const scope = scopeFromIdentity(authority.identity);
      if (!instance || (instance.tenant_id ?? null) !== scope.tenantId) {
        this.failAuthority(instanceId, 'authority-scope-mismatch');
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
    const resolved = this.authorityProvider?.revalidateActor(authority) ?? null;
    if (!resolved) {
      this.failAuthority(instanceId, 'authority-revoked');
      return null;
    }
    const instance = this.db.queryOne('workflow_instances', instanceId);
    if (!instance || (instance.tenant_id ?? null) !== resolved.scope.tenantId) {
      this.failAuthority(instanceId, 'authority-scope-mismatch');
      return null;
    }
    return resolved;
  }

  private failAuthority(
    instanceId: string,
    reason: WorkflowAuthorityFailureReason,
  ): void {
    this.authorityStore.invalidate(instanceId, reason);
    emitPlatformCode(OBS_CODES.WORKFLOWS_AUTHORITY_INVALIDATED, {
      metadata: { instanceId, reason },
    });
    const now = new Date().toISOString();
    const steps = this.db.query('workflow_steps')
      .filter((candidate) => candidate.instance_id === instanceId);
    for (const step of steps) {
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
        });
      }
    }
    if (this.db.queryOne('workflow_instances', instanceId)) {
      this.db.update('workflow_instances', instanceId, {
        status: 'failed',
        error: AUTHORITY_ERROR,
        updated_at: now,
        completed_at: now,
      });
    }
  }

  private isCurrentExecution(
    instanceId: string,
    stepId: string,
    executionId: string,
  ): boolean {
    const instance = this.db.queryOne('workflow_instances', instanceId);
    const step = this.db.queryOne('workflow_steps', stepId);
    return Boolean(instance
      && step
      && step.instance_id === instanceId
      && instance.status === 'running'
      && step.status === 'running'
      && this.authorityStore.hasLease(stepId, executionId));
  }

  private handleStepFailure(
    stepId: string,
    step: WorkflowStepRecord,
    error: string,
  ): void {
    const retries = step.retries + 1;
    if (retries < step.max_retries) {
      const definition = parseStepDefs(
        this.db.queryOne('workflow_instances', step.instance_id)?.steps_json,
      )[step.step_index];
      const baseBackoff = definition?.backoffMs ?? 1000;
      const backoffMs = Math.min(baseBackoff * Math.pow(2, retries), MAX_BACKOFF_MS);
      this.db.update('workflow_steps', stepId, {
        status: 'failed',
        error,
        retries,
        retry_at: new Date(Date.now() + backoffMs).toISOString(),
        timeout_at: null,
      });
      return;
    }
    this.db.update('workflow_steps', stepId, {
      status: 'failed',
      error,
      retries,
      completed_at: new Date().toISOString(),
      retry_at: null,
      timeout_at: null,
    });
  }

  private getPreviousStepOutput(instanceId: string, currentIndex: number): unknown {
    if (currentIndex === 0) return null;
    const previous = this.db.query('workflow_steps').find((candidate) =>
      candidate.instance_id === instanceId
        && candidate.step_index === currentIndex - 1);
    return parseJson(previous?.output);
  }

  private evaluateCondition(
    condition: string,
    instance: Record<string, unknown>,
  ): boolean {
    try {
      const input = parseJson(instance.input) ?? {};
      // Definitions are trusted server code; request input is passed only as
      // data to the compatibility expression evaluator.
      const evaluate = new Function('input', `return Boolean(${condition})`);
      return Boolean(evaluate(input));
    } catch {
      return true;
    }
  }
}

function parseStepDefs(value: unknown): Array<{
  condition?: string;
  backoffMs?: number;
  timeoutMs?: number;
}> {
  try {
    return typeof value === 'string' ? JSON.parse(value) : [];
  } catch {
    return [];
  }
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string' || !value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function boundedError(value: string): string {
  const normalized = value.trim();
  return (normalized || 'Workflow step failed').slice(0, 2_000);
}

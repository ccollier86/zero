/**
 * workflow-memory-store.ts
 *
 * Owns private, scoped workflow scratch-memory persistence. All writes are
 * synchronous ReactiveDB transactions so optimistic versions, attempt fences,
 * limits, and change recording share one atomic boundary.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { OBS_CODES } from '../observability/codes';
import { WorkflowError } from './workflow-error';
import {
  parseWorkflowJson,
  serializeWorkflowJson,
  workflowJsonBytes,
  type WorkflowJsonValue,
} from './workflow-json-value';
import {
  MEMORY_VALUE_INVALID,
  assertWorkflowAttemptFence,
  assertWorkflowMemoryExpectedVersion,
  isPromiseLike,
  nextWorkflowMemoryVersion,
  normalizeWorkflowMemoryScope,
  resolveWorkflowMemoryLimits,
  validateWorkflowMemoryExpectedVersion,
  validateWorkflowMemoryKey,
  validateWorkflowMemoryMetadata,
  workflowMemoryConflict,
  workflowMemoryLimit,
  type NormalizedWorkflowMemoryScope,
  type WorkflowAttemptFence,
  type WorkflowMemoryLimits,
  type WorkflowMemoryMutationMetadata,
  type WorkflowMemoryScope,
} from './workflow-memory-policy';
import { WorkflowRuntimeValueBudget } from './workflow-runtime-budget';
import {
  createWorkflowObservability,
  type WorkflowObservability,
} from './workflow-observability';

export type {
  WorkflowAttemptFence,
  WorkflowMemoryLimits,
  WorkflowMemoryScope,
} from './workflow-memory-policy';

export interface WorkflowMemoryEntry {
  key: string;
  value: WorkflowJsonValue;
  version: number;
  updatedAt: string;
  updatedByStepId: string | null;
  updatedByAttemptId: string | null;
}

export interface WorkflowMemoryWriteOptions {
  /** `null` requires absence; a number requires that exact current version. */
  expectedVersion?: number | null;
  fence?: WorkflowAttemptFence;
  updatedByStepId?: string;
  updatedByAttemptId?: string;
}

export type WorkflowMemoryTransactionOptions = WorkflowMemoryMutationMetadata;

export interface WorkflowMemoryTransaction {
  get(key: string): WorkflowMemoryEntry | null;
  list(): WorkflowMemoryEntry[];
  set(
    key: string,
    value: unknown,
    options?: Pick<WorkflowMemoryWriteOptions, 'expectedVersion'>,
  ): WorkflowMemoryEntry;
  update(
    key: string,
    updater: (value: WorkflowJsonValue) => unknown,
    options?: Pick<WorkflowMemoryWriteOptions, 'expectedVersion'>,
  ): WorkflowMemoryEntry;
  delete(
    key: string,
    options?: Pick<WorkflowMemoryWriteOptions, 'expectedVersion'>,
  ): boolean;
}

interface WorkflowMemoryRow {
  memory_id: string;
  instance_id: string;
  scope_kind: string;
  scope_id: string;
  key: string;
  value_json: string;
  version: number;
  updated_by_step_id: string | null;
  updated_by_attempt_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowMemoryStoreOptions {
  limits?: Partial<WorkflowMemoryLimits>;
  clock?: () => Date;
  observability?: WorkflowObservability;
}

/** Private durable store for workflow memory; underscore rows never enter Sync. */
export class WorkflowMemoryStore {
  readonly limits: Readonly<WorkflowMemoryLimits>;
  private readonly clock: () => Date;
  private readonly runtimeBudget: WorkflowRuntimeValueBudget;
  private readonly observability: WorkflowObservability;

  constructor(
    private readonly db: ReactiveDB,
    options: WorkflowMemoryStoreOptions = {},
  ) {
    this.limits = Object.freeze(resolveWorkflowMemoryLimits(options.limits));
    this.clock = options.clock ?? (() => new Date());
    this.observability = options.observability ?? createWorkflowObservability(db);
    this.runtimeBudget = new WorkflowRuntimeValueBudget(db);
  }

  /** Read one detached entry from an instance or each-item namespace. */
  get(scope: WorkflowMemoryScope, key: string): WorkflowMemoryEntry | null {
    return this.readEntry(
      normalizeWorkflowMemoryScope(scope),
      validateWorkflowMemoryKey(key, this.limits),
    );
  }

  /** List one namespace in stable key order. */
  list(scope: WorkflowMemoryScope): WorkflowMemoryEntry[] {
    return this.readEntries(normalizeWorkflowMemoryScope(scope));
  }

  /** Atomically write one JSON value with optional optimistic version fencing. */
  set(
    scope: WorkflowMemoryScope,
    key: string,
    value: unknown,
    options: WorkflowMemoryWriteOptions = {},
  ): WorkflowMemoryEntry {
    return this.transaction(scope, options.fence, (tx) => tx.set(key, value, options), options);
  }

  /** Atomically transform an existing value. The updater must be synchronous. */
  update(
    scope: WorkflowMemoryScope,
    key: string,
    updater: (value: WorkflowJsonValue) => unknown,
    options: WorkflowMemoryWriteOptions = {},
  ): WorkflowMemoryEntry {
    return this.transaction(scope, options.fence, (tx) => tx.update(key, updater, options), options);
  }

  /** Atomically delete one value, returning whether an entry existed. */
  delete(
    scope: WorkflowMemoryScope,
    key: string,
    options: WorkflowMemoryWriteOptions = {},
  ): boolean {
    return this.transaction(scope, options.fence, (tx) => tx.delete(key, options), options);
  }

  /**
   * Run synchronous memory operations in one transaction.
   *
   * The fence is checked after the transaction begins and again after the
   * callback. Throwing, stale fences, conflicts, and limit failures roll back
   * every mutation and every ReactiveDB change event.
   */
  transaction<T>(
    scope: WorkflowMemoryScope,
    fence: WorkflowAttemptFence | undefined,
    fn: (transaction: WorkflowMemoryTransaction) => T,
    metadata: WorkflowMemoryTransactionOptions = {},
  ): T {
    const normalized = normalizeWorkflowMemoryScope(scope);
    validateWorkflowMemoryMetadata(metadata);
    try {
      return this.db.transaction(() => {
        assertWorkflowAttemptFence(fence);
        const transaction = new MemoryTransaction(
          this.db,
          normalized,
          this.limits,
          this.clock,
          metadata,
          this.runtimeBudget,
        );
        const result = fn(transaction);
        if (isPromiseLike(result)) {
          throw new WorkflowError(
            'Workflow memory transactions must be synchronous',
            'WORKFLOW_STATE_INVALID',
            500,
          );
        }
        transaction.assertAggregateLimits();
        assertWorkflowAttemptFence(fence);
        return result;
      });
    } catch (error) {
      if (error instanceof WorkflowError
        && (error.code === 'WORKFLOW_MEMORY_LIMIT_EXCEEDED'
          || error.code === 'WORKFLOW_MEMORY_CONFLICT')) {
        this.observability.emitNow(
          error.code === 'WORKFLOW_MEMORY_LIMIT_EXCEEDED'
            ? OBS_CODES.WORKFLOW_MEMORY_LIMIT_REJECTED
            : OBS_CODES.WORKFLOW_MEMORY_CONFLICT,
          { metadata: { instanceId: normalized.instanceId, scopeKind: normalized.kind } },
        );
      }
      throw error;
    }
  }

  private readEntry(scope: NormalizedWorkflowMemoryScope, key: string): WorkflowMemoryEntry | null {
    const row = this.db.prepare(`
      SELECT * FROM _workflow_memory
      WHERE instance_id = ? AND scope_kind = ? AND scope_id = ? AND key = ?
      LIMIT 1
    `).get(scope.instanceId, scope.kind, scope.scopeId, key) as WorkflowMemoryRow | null;
    return row ? deserializeEntry(row) : null;
  }

  private readEntries(scope: NormalizedWorkflowMemoryScope): WorkflowMemoryEntry[] {
    const rows = this.db.prepare(`
      SELECT * FROM _workflow_memory
      WHERE instance_id = ? AND scope_kind = ? AND scope_id = ?
      ORDER BY key ASC
    `).all(scope.instanceId, scope.kind, scope.scopeId) as WorkflowMemoryRow[];
    return rows.map(deserializeEntry);
  }
}

class MemoryTransaction implements WorkflowMemoryTransaction {
  constructor(
    private readonly db: ReactiveDB,
    private readonly scope: NormalizedWorkflowMemoryScope,
    private readonly limits: Readonly<WorkflowMemoryLimits>,
    private readonly clock: () => Date,
    private readonly metadata: WorkflowMemoryTransactionOptions,
    private readonly runtimeBudget: WorkflowRuntimeValueBudget,
  ) {}

  get(key: string): WorkflowMemoryEntry | null {
    return this.readRow(validateWorkflowMemoryKey(key, this.limits));
  }

  list(): WorkflowMemoryEntry[] {
    const rows = this.db.prepare(`
      SELECT * FROM _workflow_memory
      WHERE instance_id = ? AND scope_kind = ? AND scope_id = ?
      ORDER BY key ASC
    `).all(this.scope.instanceId, this.scope.kind, this.scope.scopeId) as WorkflowMemoryRow[];
    return rows.map(deserializeEntry);
  }

  set(
    key: string,
    value: unknown,
    options: Pick<WorkflowMemoryWriteOptions, 'expectedVersion'> = {},
  ): WorkflowMemoryEntry {
    key = validateWorkflowMemoryKey(key, this.limits);
    validateWorkflowMemoryExpectedVersion(options.expectedVersion);
    const existing = this.readRawRow(key);
    assertWorkflowMemoryExpectedVersion(existing, options.expectedVersion, key);
    const valueJson = serializeWorkflowJson(value, MEMORY_VALUE_INVALID);
    if (workflowJsonBytes(valueJson) > this.limits.maxValueBytes) {
      throw workflowMemoryLimit(`Workflow memory value "${key}" exceeds its byte limit`);
    }
    const now = this.clock().toISOString();
    const version = nextWorkflowMemoryVersion(existing?.version, key);
    this.runtimeBudget.reserveMemoryChange(
      this.scope.instanceId,
      existing?.value_json ?? null,
      valueJson,
    );
    if (existing) {
      this.db.update('_workflow_memory', existing.memory_id, {
        value_json: valueJson,
        version,
        updated_by_step_id: this.metadata.updatedByStepId ?? null,
        updated_by_attempt_id: this.metadata.updatedByAttemptId ?? null,
        updated_at: now,
      });
    } else {
      this.db.insert('_workflow_memory', {
        memory_id: `wmem_${crypto.randomUUID()}`,
        instance_id: this.scope.instanceId,
        scope_kind: this.scope.kind,
        scope_id: this.scope.scopeId,
        key,
        value_json: valueJson,
        version,
        updated_by_step_id: this.metadata.updatedByStepId ?? null,
        updated_by_attempt_id: this.metadata.updatedByAttemptId ?? null,
        created_at: now,
        updated_at: now,
      });
    }
    return this.readRow(key)!;
  }

  update(
    key: string,
    updater: (value: WorkflowJsonValue) => unknown,
    options: Pick<WorkflowMemoryWriteOptions, 'expectedVersion'> = {},
  ): WorkflowMemoryEntry {
    key = validateWorkflowMemoryKey(key, this.limits);
    const existing = this.readRow(key);
    if (!existing) throw workflowMemoryConflict(`Workflow memory key "${key}" does not exist`);
    const value = updater(existing.value);
    if (isPromiseLike(value)) {
      throw new WorkflowError(
        'Workflow memory update functions must be synchronous',
        MEMORY_VALUE_INVALID,
        400,
      );
    }
    return this.set(key, value, {
      expectedVersion: options.expectedVersion === undefined
        ? existing.version
        : options.expectedVersion,
    });
  }

  delete(
    key: string,
    options: Pick<WorkflowMemoryWriteOptions, 'expectedVersion'> = {},
  ): boolean {
    key = validateWorkflowMemoryKey(key, this.limits);
    validateWorkflowMemoryExpectedVersion(options.expectedVersion);
    const existing = this.readRawRow(key);
    assertWorkflowMemoryExpectedVersion(existing, options.expectedVersion, key);
    if (!existing) return false;
    this.runtimeBudget.reserveMemoryChange(this.scope.instanceId, existing.value_json, null);
    this.db.delete('_workflow_memory', existing.memory_id);
    return true;
  }

  assertAggregateLimits(): void {
    const usage = this.db.prepare(`
      SELECT COUNT(*) AS entry_count,
        COALESCE(SUM(LENGTH(CAST(value_json AS BLOB))), 0) AS total_bytes
      FROM _workflow_memory
      WHERE instance_id = ? AND scope_kind = ? AND scope_id = ?
    `).get(this.scope.instanceId, this.scope.kind, this.scope.scopeId) as {
      entry_count: number;
      total_bytes: number;
    };
    if (Number(usage.entry_count) > this.limits.maxEntries) {
      throw workflowMemoryLimit('Workflow memory namespace exceeds its entry limit');
    }
    if (Number(usage.total_bytes) > this.limits.maxTotalBytes) {
      throw workflowMemoryLimit('Workflow memory namespace exceeds its total byte limit');
    }
  }

  private readRow(key: string): WorkflowMemoryEntry | null {
    const row = this.readRawRow(key);
    return row ? deserializeEntry(row) : null;
  }

  private readRawRow(key: string): WorkflowMemoryRow | null {
    const row = (this.db.prepare(`
      SELECT * FROM _workflow_memory
      WHERE instance_id = ? AND scope_kind = ? AND scope_id = ? AND key = ?
      LIMIT 1
    `).get(this.scope.instanceId, this.scope.kind, this.scope.scopeId, key)) as WorkflowMemoryRow | null;
    return row ?? null;
  }
}

function deserializeEntry(row: WorkflowMemoryRow): WorkflowMemoryEntry {
  return {
    key: row.key,
    value: parseWorkflowJson(row.value_json),
    version: Number(row.version),
    updatedAt: row.updated_at,
    updatedByStepId: row.updated_by_step_id,
    updatedByAttemptId: row.updated_by_attempt_id,
  };
}

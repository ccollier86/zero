/**
 * workflow-memory-context.ts
 *
 * Creates the attempt-local `ctx.memory` scratchpad. Handler mutations remain
 * staged until the runtime commits them with the successful step transition;
 * failed, timed-out, or stale attempts discard the overlay.
 */

import { WorkflowError, type WorkflowErrorCode } from './workflow-error';
import {
  type WorkflowAttemptFence,
  type WorkflowMemoryEntry,
  type WorkflowMemoryScope,
  type WorkflowMemoryStore,
} from './workflow-memory-store';
import {
  cloneWorkflowJson,
  normalizeWorkflowJson,
  type WorkflowJsonValue,
} from './workflow-json-value';

const MEMORY_CONFLICT = 'WORKFLOW_MEMORY_CONFLICT' as WorkflowErrorCode;
const MEMORY_VALUE_INVALID = 'WORKFLOW_MEMORY_VALUE_INVALID' as WorkflowErrorCode;

/** Handler-facing, synchronous scratch-memory API. */
export interface WorkflowMemoryContext {
  get(key: string): WorkflowJsonValue | undefined;
  has(key: string): boolean;
  set(key: string, value: unknown): void;
  update(key: string, updater: (value: WorkflowJsonValue) => unknown): void;
  /** Delete an attempt-visible key; return true only if it existed before deletion. */
  delete(key: string): boolean;
  entries(): Array<readonly [string, WorkflowJsonValue]>;
  toJSON(): Record<string, WorkflowJsonValue>;
}

export interface WorkflowMemoryContextOptions {
  scope: WorkflowMemoryScope;
  stepId: string;
  attemptId: string;
}

/** Runtime-owned controls kept separate from the handler-facing API. */
export interface WorkflowMemoryAttemptContext {
  memory: WorkflowMemoryContext;
  readonly dirty: boolean;
  /** Commit the staged overlay after revalidating the attempt in-transaction. */
  commit(fence: WorkflowAttemptFence): WorkflowMemoryEntry[];
  /** Permanently discard this physical attempt's staged overlay. */
  discard(): void;
}

interface SnapshotEntry {
  value: WorkflowJsonValue;
  version: number;
}

interface StagedEntry {
  value?: WorkflowJsonValue;
  deleted: boolean;
  baseVersion: number | null;
}

/** Create one isolated scratchpad for a physical handler attempt. */
export function createWorkflowMemoryContext(
  store: WorkflowMemoryStore,
  options: WorkflowMemoryContextOptions,
): WorkflowMemoryAttemptContext {
  validateAttemptMetadata(options);
  return new AttemptMemoryContext(store, options);
}

class AttemptMemoryContext implements WorkflowMemoryAttemptContext {
  readonly memory: WorkflowMemoryContext;
  private readonly snapshot = new Map<string, SnapshotEntry>();
  private readonly staged = new Map<string, StagedEntry>();
  private open = true;

  constructor(
    private readonly store: WorkflowMemoryStore,
    private readonly options: WorkflowMemoryContextOptions,
  ) {
    for (const entry of store.list(options.scope)) {
      this.snapshot.set(entry.key, {
        value: cloneWorkflowJson(entry.value),
        version: entry.version,
      });
    }
    this.memory = Object.freeze({
      get: (key: string) => this.get(key),
      has: (key: string) => this.get(key) !== undefined,
      set: (key: string, value: unknown) => this.set(key, value),
      update: (key: string, updater: (value: WorkflowJsonValue) => unknown) => {
        this.update(key, updater);
      },
      delete: (key: string) => this.delete(key),
      entries: () => this.entries(),
      toJSON: () => this.toJSON(),
    });
  }

  get dirty(): boolean {
    return this.staged.size > 0;
  }

  commit(fence: WorkflowAttemptFence): WorkflowMemoryEntry[] {
    this.assertOpen();
    try {
      this.store.transaction(
        this.options.scope,
        fence,
        (transaction) => {
          for (const [key, staged] of this.staged) {
            const expectedVersion = staged.baseVersion;
            if (staged.deleted) {
              transaction.delete(key, { expectedVersion });
            } else {
              transaction.set(key, staged.value, { expectedVersion });
            }
          }
        },
        {
          updatedByStepId: this.options.stepId,
          updatedByAttemptId: this.options.attemptId,
        },
      );
      return this.store.list(this.options.scope);
    } finally {
      this.close();
    }
  }

  discard(): void {
    if (!this.open) return;
    this.close();
  }

  private get(key: string): WorkflowJsonValue | undefined {
    this.assertOpen();
    const staged = this.staged.get(key);
    if (staged) {
      return staged.deleted ? undefined : cloneWorkflowJson(staged.value!);
    }
    const entry = this.snapshot.get(key);
    return entry ? cloneWorkflowJson(entry.value) : undefined;
  }

  private set(key: string, value: unknown): void {
    this.assertOpen();
    const normalized = normalizeWorkflowJson(value, MEMORY_VALUE_INVALID);
    const prior = this.snapshot.get(key);
    this.staged.set(key, {
      value: normalized,
      deleted: false,
      baseVersion: prior?.version ?? null,
    });
  }

  private update(key: string, updater: (value: WorkflowJsonValue) => unknown): void {
    this.assertOpen();
    const current = this.get(key);
    if (current === undefined) {
      throw new WorkflowError(
        `Workflow memory key "${key}" does not exist`,
        MEMORY_CONFLICT,
        409,
        true,
      );
    }
    const next = updater(current);
    if (isPromiseLike(next)) {
      throw new WorkflowError(
        'Workflow memory update functions must be synchronous',
        MEMORY_VALUE_INVALID,
        400,
      );
    }
    this.set(key, next);
  }

  private delete(key: string): boolean {
    this.assertOpen();
    const exists = this.get(key) !== undefined;
    const prior = this.snapshot.get(key);
    if (!prior) {
      this.staged.delete(key);
      return exists;
    }
    this.staged.set(key, { deleted: true, baseVersion: prior.version });
    return exists;
  }

  private entries(): Array<readonly [string, WorkflowJsonValue]> {
    this.assertOpen();
    const keys = new Set([...this.snapshot.keys(), ...this.staged.keys()]);
    const result: Array<readonly [string, WorkflowJsonValue]> = [];
    for (const key of [...keys].sort()) {
      const value = this.get(key);
      if (value !== undefined) result.push([key, value] as const);
    }
    return result;
  }

  private toJSON(): Record<string, WorkflowJsonValue> {
    const result: Record<string, WorkflowJsonValue> = Object.create(null);
    for (const [key, value] of this.entries()) result[key] = value;
    return result;
  }

  private close(): void {
    this.staged.clear();
    this.snapshot.clear();
    this.open = false;
  }

  private assertOpen(): void {
    if (!this.open) {
      throw new WorkflowError(
        'Workflow memory context is no longer active',
        'WORKFLOW_STATE_INVALID',
        409,
      );
    }
  }
}

function validateAttemptMetadata(options: WorkflowMemoryContextOptions): void {
  if (!options || typeof options.stepId !== 'string' || !options.stepId
    || typeof options.attemptId !== 'string' || !options.attemptId) {
    throw new WorkflowError(
      'Workflow memory context requires step and attempt IDs',
      'WORKFLOW_STATE_INVALID',
      500,
    );
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as { then?: unknown }).then === 'function');
}

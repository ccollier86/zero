/**
 * workflow-memory-policy.ts
 *
 * Defines scratch-memory namespaces, limits, optimistic-version rules, and
 * attempt-fence validation. It owns policy only and never touches SQLite.
 */

import { WorkflowError, type WorkflowErrorCode } from './workflow-error';

export const MEMORY_KEY_INVALID = 'WORKFLOW_MEMORY_KEY_INVALID' as WorkflowErrorCode;
export const MEMORY_VALUE_INVALID = 'WORKFLOW_MEMORY_VALUE_INVALID' as WorkflowErrorCode;
export const MEMORY_LIMIT_EXCEEDED = 'WORKFLOW_MEMORY_LIMIT_EXCEEDED' as WorkflowErrorCode;
export const MEMORY_CONFLICT = 'WORKFLOW_MEMORY_CONFLICT' as WorkflowErrorCode;
export const ATTEMPT_STALE = 'WORKFLOW_ATTEMPT_STALE' as WorkflowErrorCode;

const DEFAULT_LIMITS: WorkflowMemoryLimits = {
  maxKeyBytes: 256,
  maxValueBytes: 64 * 1024,
  maxEntries: 256,
  maxTotalBytes: 1024 * 1024,
};
const HARD_LIMITS: WorkflowMemoryLimits = {
  maxKeyBytes: 1024,
  maxValueBytes: 1024 * 1024,
  maxEntries: 4096,
  maxTotalBytes: 16 * 1024 * 1024,
};

/** One isolated workflow-memory namespace. */
export interface WorkflowMemoryScope {
  instanceId: string;
  kind: 'instance' | 'each-item';
  /** Required for `each-item`; omitted for the instance-wide namespace. */
  scopeId?: string;
}

/** Configurable limits, each capped by a non-configurable platform ceiling. */
export interface WorkflowMemoryLimits {
  maxKeyBytes: number;
  maxValueBytes: number;
  maxEntries: number;
  maxTotalBytes: number;
}

export interface NormalizedWorkflowMemoryScope {
  instanceId: string;
  kind: 'instance' | 'each-item';
  scopeId: string;
}

export interface WorkflowMemoryMutationMetadata {
  updatedByStepId?: string;
  updatedByAttemptId?: string;
}

/** Called twice inside the transaction, including immediately before commit. */
export type WorkflowAttemptFence = () => boolean;

export function resolveWorkflowMemoryLimits(
  input: Partial<WorkflowMemoryLimits> = {},
): WorkflowMemoryLimits {
  const limits = { ...DEFAULT_LIMITS, ...input };
  for (const key of Object.keys(limits) as Array<keyof WorkflowMemoryLimits>) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > HARD_LIMITS[key]) {
      throw new WorkflowError(
        `Workflow memory ${key} must be between 1 and ${HARD_LIMITS[key]}`,
        'WORKFLOW_CONFIG_INVALID',
        500,
      );
    }
  }
  if (limits.maxValueBytes > limits.maxTotalBytes) {
    throw new WorkflowError(
      'Workflow memory maxValueBytes cannot exceed maxTotalBytes',
      'WORKFLOW_CONFIG_INVALID',
      500,
    );
  }
  return limits;
}

export function normalizeWorkflowMemoryScope(
  scope: WorkflowMemoryScope,
): NormalizedWorkflowMemoryScope {
  if (!scope || typeof scope.instanceId !== 'string' || !scope.instanceId.trim()) {
    throw new WorkflowError('Workflow memory requires an instance ID', MEMORY_KEY_INVALID, 400);
  }
  if (scope.kind !== 'instance' && scope.kind !== 'each-item') {
    throw new WorkflowError('Workflow memory scope kind is invalid', MEMORY_KEY_INVALID, 400);
  }
  const scopeId = scope.kind === 'instance' ? '' : scope.scopeId;
  if (scope.kind === 'instance' && scope.scopeId) {
    throw new WorkflowError('Instance memory must not specify a scope ID', MEMORY_KEY_INVALID, 400);
  }
  if (typeof scopeId !== 'string' || (scope.kind === 'each-item' && !scopeId.trim())) {
    throw new WorkflowError('Each-item memory requires a scope ID', MEMORY_KEY_INVALID, 400);
  }
  if (utf8Bytes(scope.instanceId) > 512 || utf8Bytes(scopeId) > 512) {
    throw new WorkflowError('Workflow memory scope identifier is too long', MEMORY_KEY_INVALID, 400);
  }
  return { instanceId: scope.instanceId, kind: scope.kind, scopeId };
}

export function validateWorkflowMemoryKey(
  key: string,
  limits: Readonly<WorkflowMemoryLimits>,
): string {
  if (typeof key !== 'string' || !key || key.includes('\0')) {
    throw new WorkflowError('Workflow memory key is invalid', MEMORY_KEY_INVALID, 400);
  }
  if (utf8Bytes(key) > limits.maxKeyBytes) {
    throw new WorkflowError('Workflow memory key exceeds its byte limit', MEMORY_KEY_INVALID, 400);
  }
  return key;
}

export function validateWorkflowMemoryMetadata(
  metadata: WorkflowMemoryMutationMetadata,
): void {
  for (const value of [metadata.updatedByStepId, metadata.updatedByAttemptId]) {
    if (value !== undefined && (typeof value !== 'string' || !value || utf8Bytes(value) > 512)) {
      throw new WorkflowError('Workflow memory mutation metadata is invalid', MEMORY_KEY_INVALID, 400);
    }
  }
}

export function validateWorkflowMemoryExpectedVersion(
  version: number | null | undefined,
): void {
  if (version !== undefined && version !== null
    && (!Number.isSafeInteger(version) || version < 1)) {
    throw new WorkflowError('Workflow memory expected version is invalid', MEMORY_CONFLICT, 409);
  }
}

export function assertWorkflowMemoryExpectedVersion(
  row: { version: number } | null,
  expected: number | null | undefined,
  key: string,
): void {
  validateWorkflowMemoryExpectedVersion(expected);
  if (expected === undefined) return;
  if (expected === null ? row !== null : row?.version !== expected) {
    throw workflowMemoryConflict(`Workflow memory version conflict for "${key}"`);
  }
}

export function nextWorkflowMemoryVersion(current: number | undefined, key: string): number {
  const next = (current ?? 0) + 1;
  if (!Number.isSafeInteger(next)) {
    throw workflowMemoryConflict(`Workflow memory version overflow for "${key}"`);
  }
  return next;
}

export function assertWorkflowAttemptFence(fence: WorkflowAttemptFence | undefined): void {
  if (fence && !fence()) {
    throw new WorkflowError('Workflow attempt is no longer current', ATTEMPT_STALE, 409, true);
  }
}

export function workflowMemoryConflict(message: string): WorkflowError {
  return new WorkflowError(message, MEMORY_CONFLICT, 409, true);
}

export function workflowMemoryLimit(message: string): WorkflowError {
  return new WorkflowError(message, MEMORY_LIMIT_EXCEEDED, 413);
}

export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as { then?: unknown }).then === 'function');
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

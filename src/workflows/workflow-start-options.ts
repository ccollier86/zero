/**
 * workflow-start-options.ts
 *
 * Validates graph-run selection and trusted private-memory seeding. Private
 * memory is available only to direct service callers; the HTTP plugin does
 * not project this field into its request contract.
 */

import { WorkflowError } from './workflow-error';
import type { WorkflowMemoryLimits } from './workflow-memory-policy';

export interface WorkflowStartOptions {
  /** Start one already-published immutable graph version. */
  version?: number;
  /**
   * Atomically seed the graph run's private scratch-memory namespace.
   *
   * Values must be JSON-safe and are never copied into Sync-visible instance
   * or step input. Legacy sequential workflows do not support this option.
   */
  initialMemory?: Readonly<Record<string, unknown>>;
  /**
   * Trusted service-only, immutable memory budget for this graph run.
   *
   * Values remain capped by Torrent's platform ceilings and are persisted so
   * restart recovery enforces the identical policy. HTTP starts never project
   * this field, and legacy sequential workflows do not support it.
   */
  memoryLimits?: Partial<WorkflowMemoryLimits>;
}

export function validateWorkflowStartOptions(value: unknown): WorkflowStartOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('Workflow start options must be an object');
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).find((key) => (
    key !== 'version' && key !== 'initialMemory' && key !== 'memoryLimits'
  ));
  if (unknown) throw invalid(`Workflow start option "${unknown}" is not supported`);
  if (record.version !== undefined
    && (!Number.isSafeInteger(record.version) || Number(record.version) < 1)) {
    throw invalid('Workflow start version must be a positive integer');
  }
  if (record.initialMemory !== undefined
    && (!record.initialMemory
      || typeof record.initialMemory !== 'object'
      || Array.isArray(record.initialMemory))) {
    throw invalid('Workflow initialMemory must be an object map');
  }
  const memoryLimits = validateMemoryLimits(record.memoryLimits);
  return {
    ...(record.version === undefined ? {} : { version: Number(record.version) }),
    ...(record.initialMemory === undefined
      ? {}
      : { initialMemory: record.initialMemory as Readonly<Record<string, unknown>> }),
    ...(memoryLimits === undefined ? {} : { memoryLimits }),
  };
}

function validateMemoryLimits(value: unknown): Partial<WorkflowMemoryLimits> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('Workflow memoryLimits must be an object');
  }
  const allowed = new Set<keyof WorkflowMemoryLimits>([
    'maxKeyBytes', 'maxValueBytes', 'maxEntries', 'maxTotalBytes',
  ]);
  const copy: Partial<WorkflowMemoryLimits> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.has(key as keyof WorkflowMemoryLimits)) {
      throw invalid(`Workflow memory limit "${key}" is not supported`);
    }
    if (!Number.isSafeInteger(entry) || Number(entry) < 1) {
      throw invalid(`Workflow memory limit "${key}" must be a positive integer`);
    }
    copy[key as keyof WorkflowMemoryLimits] = Number(entry);
  }
  return Object.freeze(copy);
}

function invalid(message: string): WorkflowError {
  return new WorkflowError(message, 'WORKFLOW_REQUEST_INVALID', 422);
}

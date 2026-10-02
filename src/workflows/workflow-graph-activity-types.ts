/** Public contracts for graph activity execution. */

import type { WorkflowMemoryScope } from './workflow-memory-store';

export type WorkflowGraphActivityResult =
  | 'completed'
  | 'retry-scheduled'
  | 'failed'
  | 'timed-out'
  | 'stale';

export interface WorkflowGraphActivityExecutorOptions {
  now?: () => Date;
  shutdownGraceMs: number;
  onRetryScheduled?: (instanceId: string, stepId: string, retryAt: string) => void;
  onTimeoutScheduled?: (instanceId: string, stepId: string, timeoutAt: string) => void;
}

export interface WorkflowGraphActivityItemContext {
  value: unknown;
  index: number;
  key: string;
  memoryScope: WorkflowMemoryScope;
  /** Override default node input (used by interaction-delivery activities). */
  inputOverride?: unknown;
  /** Channel-neutral interaction projection exposed to a delivery activity. */
  interaction?: unknown;
  /** False for non-fan-out child invocations such as prompt delivery. */
  exposeItem?: boolean;
  /** False when activity input belongs only in a private subsystem table. */
  persistInput?: boolean;
  /** False when an activity result must not enter the public step projection. */
  persistOutput?: boolean;
}

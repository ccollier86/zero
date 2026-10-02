/** Bounded shutdown policy shared by direct services and the app plugin. */

import { WorkflowError } from './workflow-error';

/** Long enough for cooperative I/O cancellation without blocking teardown forever. */
export const DEFAULT_WORKFLOW_SHUTDOWN_GRACE_MS = 30_000;

// JavaScript runtimes clamp larger timeout values and could accidentally turn
// an intended long grace period into an immediate timeout.
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function resolveWorkflowShutdownGraceMs(value: number | undefined): number {
  const graceMs = value ?? DEFAULT_WORKFLOW_SHUTDOWN_GRACE_MS;
  if (!Number.isSafeInteger(graceMs) || graceMs < 0 || graceMs > MAX_TIMER_DELAY_MS) {
    throw new WorkflowError(
      `Workflow shutdownGraceMs must be an integer from 0 to ${MAX_TIMER_DELAY_MS}`,
      'WORKFLOW_CONFIG_INVALID',
      500,
    );
  }
  return graceMs;
}

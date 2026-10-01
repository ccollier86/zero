import type { StepDefinition, WorkflowStepRecord } from './types';

/** Parse the immutable definition snapshot stored on a workflow instance. */
export function parseWorkflowStepDefinitions(value: unknown): StepDefinition[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as StepDefinition[] : [];
  } catch {
    return [];
  }
}

/**
 * Resolve executable handler identity from the instance snapshot.
 *
 * New rows keep the human label in step_name. Zero 1.3 rows kept the handler
 * key there instead, so malformed/missing snapshots retain that legacy fallback.
 */
export function resolveWorkflowHandlerName(
  stepsJson: unknown,
  step: Pick<WorkflowStepRecord, 'step_index' | 'step_name'>,
): string {
  const definition = parseWorkflowStepDefinitions(stepsJson)[step.step_index];
  return typeof definition?.handler === 'string' && definition.handler.length > 0
    ? definition.handler
    : step.step_name;
}
